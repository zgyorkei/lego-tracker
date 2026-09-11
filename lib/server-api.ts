import type { Express, Request, Response, NextFunction } from 'express';
import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import dns from 'node:dns/promises';
import { GoogleGenAI } from '@google/genai';

// ---------------------------------------------------------------------------
// Shared backend logic for both the local dev server (server.ts) and the
// Vercel serverless entry point (api/index.ts). Keeping a single source of
// truth here prevents the two from drifting apart (previously the Vercel copy
// was missing the batch-images, prices-batch and proxy-image endpoints, and
// shipped weaker scraping/fallback logic).
// ---------------------------------------------------------------------------

export const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  // clearTimeout in finally: without it the pending timer keeps the event loop
  // alive for the full duration even when the wrapped promise settled early.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Default Gemini model fallback chain, ordered from cheapest/fastest to most
// capable, with preview models last.
export const DEFAULT_GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-pro',
];

// Hosts the image proxy is permitted to fetch from. Prevents the proxy from
// being abused as an SSRF gateway to internal/cloud-metadata endpoints.
const ALLOWED_IMAGE_HOST_SUFFIXES = [
  'lego.com',
  'legocdn.com',
  'brickset.com',
  'bricklink.com',
  'rebrickable.com',
];

// Reject IP literals that point at private/loopback/link-local ranges (incl. the
// 169.254.169.254 cloud metadata endpoint). Hostname allowlisting already blocks
// most SSRF, but bare-IP URLs would otherwise slip through.
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '[::1]' || h === '::1') return true;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

export function isAllowedImageUrl(parsed: URL): boolean {
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (isBlockedHost(parsed.hostname)) return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_IMAGE_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith('.' + suffix)
  );
}

// Same private-range test as isBlockedHost, but against a resolved IP literal
// rather than a hostname. Needed because a public hostname can resolve to a
// private address (DNS rebinding), which hostname checks alone cannot catch.
export function isPrivateIp(addr: string, family: number): boolean {
  if (family === 4) return isBlockedHost(addr);
  const a = addr.toLowerCase();
  if (a === '::1' || a === '::') return true;
  if (a.startsWith('fc') || a.startsWith('fd')) return true; // unique-local
  if (a.startsWith('fe80')) return true; // link-local
  // IPv4-mapped (::ffff:10.0.0.1) -- test the embedded v4 address.
  const mapped = a.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedHost(mapped[1]);
  return false;
}

/**
 * Validates a URL that the server is about to fetch on a caller's behalf.
 *
 * Price sources are user-configurable, so a host allowlist is not an option
 * here the way it is for the image proxy. Instead we reject non-HTTP schemes,
 * private/loopback/metadata hosts, and hostnames that *resolve* into a private
 * range. Callers must also pass maxRedirects: 0, since this only validates the
 * initial URL and a 302 would otherwise walk straight past it.
 */
export async function assertSafeOutboundUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Blocked non-HTTP protocol: ${parsed.protocol}`);
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`Blocked host: ${parsed.hostname}`);
  }
  const resolved = await dns.lookup(parsed.hostname, { all: true });
  for (const { address, family } of resolved) {
    if (isPrivateIp(address, family)) {
      throw new Error(`Blocked host ${parsed.hostname} (resolves to ${address})`);
    }
  }
  return parsed;
}

// Caps on caller-supplied arrays. Without these, a single request body under
// the 100kb JSON limit can fan out into thousands of concurrent outbound
// sockets (self-DoS, plus amplification against the sites being scraped).
const MAX_SET_NUMBERS = 50;
const MAX_SOURCES = 15;
const OUTBOUND_CONCURRENCY = 5;

/** Runs an async mapper over items with a bounded number of in-flight calls. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Rate limiting
//
// These routes are unauthenticated and several of them spend GEMINI_API_KEY
// quota, so without a limiter anyone who finds the deployment can run up the
// bill. This is a fixed-window in-memory limiter.
//
// IMPORTANT deployment caveat: on Vercel each serverless instance has its own
// memory, so the effective limit is per-instance and resets on cold start.
// That makes this best-effort mitigation, not a hard guarantee. Pair it with a
// hard spend cap on the Google Cloud side. To make it authoritative, back the
// counter with a shared store (Vercel KV / Upstash Redis).
// ---------------------------------------------------------------------------

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

/** Behind Vercel's proxy req.ip is the proxy, so prefer the forwarded chain. */
function clientKey(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  const first = raw?.split(',')[0]?.trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

function rateLimit(opts: { windowMs: number; max: number; name: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${opts.name}:${clientKey(req)}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    if (bucket.count >= opts.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Rate limit exceeded.', retryAfter });
    }
    bucket.count++;
    next();
  };
}

// Opportunistic sweep so the map cannot grow without bound on a long-lived
// process (the dev server); serverless instances are recycled anyway.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) if (now >= v.resetAt) rateBuckets.delete(k);
}, 60_000).unref?.();

const SET_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isValidSetNumber = (v: unknown): v is string =>
  typeof v === 'string' && SET_NUMBER_RE.test(v);

export const isValidIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && ISO_DATE_RE.test(v) && !Number.isNaN(Date.parse(v));

// Lazily load genAI to avoid startup crashes if the API key is missing.
// The key comes from the environment only: an earlier x-gemini-api-key header
// path was removed, since no client ever sent it and it let a caller hand the
// server an arbitrary credential to use.
function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is missing. Please set it in the server environment.');
  }
  // Disable the SDK's built-in 429/5xx auto-retry (which backs off internally for
  // up to ~60s). We want a rate-limited model to fail fast so callGeminiWithFallback
  // can advance to the next model immediately; our loop owns retry/backoff.
  return new GoogleGenAI({
    apiKey,
    httpOptions: { retryOptions: { attempts: 1 }, timeout: 20000 },
  });
}

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0',
];

const getCommonHeaders = () => ({
  'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'cross-site',
  'Upgrade-Insecure-Requests': '1',
});

interface RateLimitError {
  isRateLimit: true;
  retryAfter: number;
  message?: string;
}

interface GeminiCallOptions {
  prompt: string;
  config?: any;
  models?: string[];
  timeoutMs?: number;
  attemptsPerModel?: number;
  // Hard ceiling on total time spent across all models/attempts. Prevents the
  // fallback chain from running long enough to exceed a serverless function's
  // execution limit. Defaults to 40s.
  overallBudgetMs?: number;
  // Returns true when the response text should be accepted. Lets callers reject
  // empty/invalid payloads and fall through to the next attempt/model.
  accept?: (text: string) => boolean;
  logLabel?: string;
}

/**
 * Single Gemini caller used by every AI-backed endpoint. Walks the model
 * fallback chain; for each model retries up to `attemptsPerModel` times with
 * backoff on 503s, and advances to the next model on 429 (rate limit) or other
 * errors. Throws the last error (a RateLimitError when the cause was a 429).
 */
async function callGeminiWithFallback(opts: GeminiCallOptions): Promise<string> {
  const models = opts.models ?? DEFAULT_GEMINI_MODELS;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const attemptsPerModel = opts.attemptsPerModel ?? 3;
  const overallBudgetMs = opts.overallBudgetMs ?? 40000;
  const accept = opts.accept ?? ((t: string) => !!t);
  const label = opts.logLabel ?? 'gemini';
  const startedAt = Date.now();
  let lastError: any;

  for (const model of models) {
    let advanceModel = false;
    for (let attempt = 1; attempt <= attemptsPerModel && !advanceModel; attempt++) {
      if (Date.now() - startedAt > overallBudgetMs) {
        console.warn(`[${label}] Gemini fallback budget (${overallBudgetMs}ms) exhausted; giving up.`);
        throw lastError ?? new Error('Gemini fallback time budget exhausted');
      }
      try {
        console.log(`[${label}] Trying model ${model} (attempt ${attempt})...`);
        const result: any = await withTimeout(
          getGenAI().models.generateContent({
            model,
            contents: opts.prompt,
            config: opts.config,
          }),
          timeoutMs
        );
        const text = result.text || '';
        if (accept(text)) return text;
        lastError = new Error('Gemini response not acceptable');
      } catch (e: any) {
        lastError = e;
        const msg = e?.message || '';
        if (msg.includes('503')) {
          await sleep(2000 * attempt); // backoff, retry same model
          continue;
        }
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
          const retryMatch = msg.match(/retry in ([\d.]+)s/);
          const waitSecs = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 90;
          lastError = { isRateLimit: true, retryAfter: waitSecs, message: msg } as RateLimitError;
          advanceModel = true; // move to next model
        } else {
          advanceModel = true; // don't retry other errors (e.g. 404)
        }
      }
    }
  }
  throw lastError ?? new Error('All Gemini models failed');
}

const extractJson = (text: string): string | null => {
  const fenced = text.match(/```json\n([\s\S]*?)\n```/);
  if (fenced) return fenced[1];
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
};

// Accept predicate for JSON endpoints: only accept a model response we can
// actually parse. An unparseable/prose reply then falls through to the next
// model in callGeminiWithFallback instead of aborting the whole request.
const isParseableJson = (text: string): boolean => {
  const json = extractJson(text);
  if (!json) return false;
  try {
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
};

// Permanent BrickLink price-source ids. Must match PERMANENT_SOURCE_IDS in
// src/types.ts. These are fetched by scraping BrickLink's server-rendered price
// guide (the v2 catalog page is JS-rendered and has no prices), not via Gemini.
const BRICKLINK_SOURCE_IDS = ['bricklink'];

type Rates = Record<string, number>;

const FX_BASE_URL = 'https://api.frankfurter.app';
const FX_TIMEOUT_MS = 5000;
const FX_TTL_MS = 30 * 60 * 1000; // rates move once per business day

// Exchange rates were previously re-fetched on every price request, with no
// timeout on four of the five call sites. Cached per-date ('latest' included)
// with a TTL. On serverless this is per-instance, which is still a large
// reduction in outbound calls.
const fxCache = new Map<string, { rates: Rates; at: number }>();

/**
 * Fetches EUR-based rates for a date ('latest' or YYYY-MM-DD), memoised for
 * FX_TTL_MS. Historical dates are immutable, so those are cached indefinitely.
 */
async function getRates(date: string = 'latest'): Promise<Rates> {
  const historical = date !== 'latest';
  const hit = fxCache.get(date);
  if (hit && (historical || Date.now() - hit.at < FX_TTL_MS)) return hit.rates;

  const res = await axios.get(`${FX_BASE_URL}/${date}?from=EUR`, {
    timeout: FX_TIMEOUT_MS,
  });
  const rates: Rates = Object.assign({}, res.data?.rates, { EUR: 1 });
  if (typeof rates.HUF !== 'number' || !isFinite(rates.HUF) || rates.HUF <= 0) {
    throw new Error('Exchange-rate response missing a usable HUF rate');
  }
  fxCache.set(date, { rates, at: Date.now() });
  return rates;
}

// Normalizes a BrickLink price-guide currency token (e.g. "HUF", "US $", "£")
// to an ISO code we can look up in the EUR-based frankfurter rates.
export function normalizeBrickLinkCurrency(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  if (!t) return null;
  if (/^[A-Z]{3}$/.test(t)) return t; // HUF, EUR, GBP, USD, CHF, PLN, ...
  if (t.includes('US') && t.includes('$')) return 'USD';
  if (t.includes('CA') && t.includes('$')) return 'CAD';
  if (t.includes('AU') && t.includes('$')) return 'AUD';
  if (t.includes('NZ') && t.includes('$')) return 'NZD';
  if (t.includes('HK') && t.includes('$')) return 'HKD';
  if (t === '$') return 'USD';
  if (t === '£') return 'GBP';
  if (t === '€') return 'EUR';
  return null;
}

// rates are units-of-currency per 1 EUR (frankfurter, from=EUR), incl. HUF.
export function convertToHuf(amount: number, cur: string, rates: Rates): number | null {
  if (cur === 'HUF') return amount;
  const rate = rates[cur];
  if (!rate || !rates.HUF) return null;
  return (amount / rate) * rates.HUF;
}

interface BrickLinkPrices {
  cheapestHuf: number | null;
  cheapestCondition: string | null; // 'New' | 'Used'
}

/**
 * Scrapes BrickLink's server-rendered price guide (catalogPG.asp) for a set and
 * returns the cheapest current listing (min of New/Used), converted to HUF. The page's currency is region-dependent, so it is
 * read off the page rather than assumed. Returns null if nothing parseable.
 */
async function fetchBrickLinkPrices(setNumber: string, rates: Rates): Promise<BrickLinkPrices | null> {
  try {
    const r = await axios.get(`https://www.bricklink.com/catalogPG.asp?S=${setNumber}-1`, {
      headers: getCommonHeaders(),
      timeout: 7000,
    });
    const $ = cheerio.load(r.data);
    $('script, style').remove();
    const text = $('body').text().replace(/\s+/g, ' ');

    // Each price block: "(Times Sold|Total Lots): N Total Qty: M Min Price:<min> Avg Price:...".
    // "Total Lots" blocks are the Current Items for Sale sections, in order: New, then Used.
    const blockRe =
      /(Times Sold|Total Lots):\s*[\d,]+\s*Total Qty:\s*[\d,]+\s*Min Price:\s*(.*?)\s*Avg Price:/g;
    const currentMins: (number | null)[] = []; // [New, Used] in HUF
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(text)) !== null) {
      if (m[1] !== 'Total Lots') continue; // skip the "Last 6 Months Sales" blocks
      const priceMatch = m[2].match(/([A-Za-z$£€ ]*?)([\d][\d.,]*)/);
      if (!priceMatch) {
        currentMins.push(null);
        continue;
      }
      const cur = normalizeBrickLinkCurrency(priceMatch[1]);
      const amount = parseFloat(priceMatch[2].replace(/,/g, ''));
      if (!cur || !isFinite(amount) || amount <= 0) {
        currentMins.push(null);
        continue;
      }
      currentMins.push(convertToHuf(amount, cur, rates));
    }

    const newHuf = currentMins[0] ?? null;
    const usedHuf = currentMins[1] ?? null;
    const candidates = [
      { huf: newHuf, cond: 'New' },
      { huf: usedHuf, cond: 'Used' },
    ].filter((c): c is { huf: number; cond: string } => typeof c.huf === 'number' && c.huf > 0);

    if (candidates.length === 0) return null;
    const cheapest = candidates.reduce((a, b) => (b.huf < a.huf ? b : a));
    return { cheapestHuf: cheapest.huf, cheapestCondition: cheapest.cond };
  } catch (e: any) {
    console.warn('BrickLink price-guide scrape failed:', e?.message || e);
    return null;
  }
}

/**
 * Scrapes the product image for a single set via cheerio (Brickset first, then
 * lego.com's og:image), mirroring the image logic in /api/lego. Returns null
 * when nothing could be scraped. Used so batch image fetching tries cheap,
 * reliable scraping before falling back to Gemini/AI search.
 */
async function scrapeSetImage(setNumber: string): Promise<string | null> {
  // 1. Brickset
  try {
    const bs = await axios.get(`https://brickset.com/sets/${setNumber}-1`, {
      headers: getCommonHeaders(),
      timeout: 8000,
    });
    const $bs = cheerio.load(bs.data);
    const img =
      $bs('a.highslide img').attr('src') ||
      $bs('img[src*="images.brickset.com/sets/images"]').attr('src');
    if (img) return img;
  } catch {
    /* fall through to lego.com */
  }
  // 2. lego.com (HU) og:image
  try {
    const hu = await axios.get(`https://www.lego.com/hu-hu/product/${setNumber}`, {
      headers: getCommonHeaders(),
      timeout: 8000,
    });
    const $hu = cheerio.load(hu.data);
    const img =
      $hu('meta[property="og:image"]').attr('content') ||
      $hu('img[class*="ProductImage"]').first().attr('src');
    if (img) return img;
  } catch {
    /* fall through */
  }
  return null;
}

/** Registers all /api routes (plus the JSON body parser) onto an Express app. */
export function registerApiRoutes(app: Express): void {
  app.use(express.json({ limit: '64kb' }));

  // Baseline limit for every /api route, then a much tighter bucket on the
  // handlers that can trigger a Gemini call or a burst of outbound scrapes.
  const generalLimit = rateLimit({ windowMs: 60_000, max: 120, name: 'general' });
  const expensiveLimit = rateLimit({ windowMs: 60_000, max: 12, name: 'expensive' });

  app.use('/api', generalLimit);

  // API Route: Fetch Minifigure Series Items
  app.get('/api/minifigures/:setNumber', expensiveLimit, async (req, res) => {
    const { setNumber } = req.params;
    if (!isValidSetNumber(setNumber)) {
      return res.status(400).json({ error: 'setNumber must be alphanumeric, max 20 chars' });
    }
    try {
      let results: any[] = [];

      // 1. First try regular set minifigures list
      const minResp = await axios
        .get(`https://brickset.com/minifigs/in-${setNumber}-1`, {
          headers: getCommonHeaders(),
          timeout: 10000,
        })
        .catch(() => null);
      if (minResp && minResp.data) {
        const $m = cheerio.load(minResp.data);
        $m('article.set').each((_i, el) => {
          const href = $m(el).find('h1 a').attr('href') || '';
          const img = $m(el).find('img').attr('src');
          const name = $m(el).find('h1 a').html();
          const match = href.match(/\/minifigs\/([^/]+)\//);
          if (match && name) {
            results.push({
              id: match[1],
              name: name.toString().replace(/<[^>]*>?/gm, '').trim(),
              image: img || null,
            });
          }
        });
      }

      // 2. If no results, fallback to Minifigure Series search
      if (results.length === 0) {
        const response = await axios.get(`https://brickset.com/sets?query=${setNumber}`, {
          headers: getCommonHeaders(),
          timeout: 10000,
        });
        const $ = cheerio.load(response.data);
        $('.set').each((_i, el) => {
          const heading = $(el).find('h1 a').clone().children().remove().end().text().trim();
          const url = $(el).find('h1 a').attr('href') || '';
          let image = $(el).find('img').attr('src');

          if (image) image = image.replace('/small/', '/images/');

          const match = url.match(new RegExp(`/sets/${setNumber}-(\\d+)/`));
          if (match) {
            const subId = match[1];
            const name = heading.replace(`${setNumber}:`, '').trim();
            if (name.startsWith('LEGO Minifigures')) return;

            if (
              parseInt(subId) > 0 &&
              !name.toLowerCase().includes('random pack') &&
              !name.toLowerCase().includes('sealed box') &&
              !name.toLowerCase().includes('complete')
            ) {
              results.push({ id: `${setNumber}-${subId}`, name, image: image || null });
            }
          }
        });
        results.sort((a, b) => parseInt(a.id.split('-')[1]) - parseInt(b.id.split('-')[1]));
      }

      // 3. Fallback using Gemini if still empty
      if (results.length === 0 && process.env.GEMINI_API_KEY) {
        console.log('Scraping minifigures failed, attempting Gemini Search fallback...');
        const prompt = `Find all the minifigures or characters included in Lego set ${setNumber}. Prioritize searching jaysbrickblog.com and brickfanatics.com, or other reputable lego news sites. Return a JSON object with this exact shape: { "figures": [{ "id": "string (create a short distinct id, e.g. fig1)", "name": "string", "image": "string (direct image url or null)" }] } Return ONLY the JSON object.`;
        try {
          const text = await callGeminiWithFallback({
            prompt,
            config: { tools: [{ googleSearch: {} }], responseMimeType: 'application/json' },
            logLabel: 'minifigures',
            accept: (t) => {
              try {
                const parsed = JSON.parse(t || '{}');
                return Array.isArray(parsed.figures) && parsed.figures.length > 0;
              } catch {
                return false;
              }
            },
          });
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed.figures)) results = parsed.figures;
        } catch (e) {
          console.warn('Gemini minifigures fallback failed', e);
        }
      }

      res.json({ figures: results });
    } catch (error) {
      console.error('Error fetching minifigures:', error);
      res.status(500).json({ error: 'Failed to fetch minifigures' });
    }
  });

  // API Route: Batch fetch product images. Tries cheerio scraping per set
  // first (cheap and reliable), and only falls back to Gemini/AI search for the
  // sets that could not be scraped.
  app.post('/api/batch-images', expensiveLimit, async (req, res) => {
    const { setNumbers } = req.body;

    if (!setNumbers || !Array.isArray(setNumbers) || setNumbers.length === 0) {
      return res.status(400).json({ error: 'No set numbers provided' });
    }
    if (setNumbers.length > MAX_SET_NUMBERS) {
      return res.status(400).json({ error: `At most ${MAX_SET_NUMBERS} set numbers per request` });
    }
    if (!setNumbers.every(isValidSetNumber)) {
      return res.status(400).json({ error: 'setNumbers must be alphanumeric, max 20 chars' });
    }

    const results: Record<string, string> = {};

    try {
      // 1. Scrape each set's image with cheerio first, bounded concurrency.
      const missing: string[] = [];
      await mapWithConcurrency(setNumbers as string[], OUTBOUND_CONCURRENCY, async (setNumber) => {
        const img = await scrapeSetImage(setNumber);
        if (img) results[setNumber] = img;
        else missing.push(setNumber);
      });

      // 2. Gemini fallback only for the sets scraping could not resolve.
      if (missing.length > 0 && process.env.GEMINI_API_KEY) {
        console.log(`Scraping found ${Object.keys(results).length}/${setNumbers.length} images; querying Gemini for ${missing.length} missing.`);
        const queryList = missing.map((n) => `"Lego ${n}"`).join(', ');
        const prompt = `Find the main high-quality product image URL for the following Lego sets: ${queryList}.
Return ONLY a JSON object mapping each set number to its image URL. Example format: { "75192": "https://example.com/image1.jpg", "10294": "https://example.com/image2.png" }. Use the googleSearch tool to perform standard Google searches. Find direct image links if possible (e.g., from retailer sites, wikis, or brickset). Ensure the URLs are absolute.`;

        try {
          const text = await callGeminiWithFallback({
            prompt,
            config: { tools: [{ googleSearch: {} }], responseMimeType: 'application/json' },
            logLabel: 'batch-images',
            accept: isParseableJson,
          });
          const json = extractJson(text);
          if (json) {
            const aiMap = JSON.parse(json);
            for (const n of missing) {
              if (aiMap[n]) results[n] = aiMap[n];
            }
          }
        } catch (e: any) {
          // Keep the scraped results even if the AI fallback is rate-limited/fails.
          console.warn('Gemini batch-images fallback failed:', e?.message || e);
        }
      }

      res.json(results);
    } catch (error: any) {
      console.error('Batch image search error:', error);
      // Return whatever was scraped so far rather than dropping everything.
      res.status(200).json(results);
    }
  });

  // API Route: Proxy image to bypass CORS
  app.get('/api/proxy-image', async (req, res) => {
    const transparentPngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    // Failures get a short TTL: these were previously cached for a year, so a
    // transient upstream blip pinned a blank image for every future visitor.
    const sendTransparent = () => {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(Buffer.from(transparentPngBase64, 'base64'));
    };

    try {
      let imageUrl = req.query.url as string;
      if (!imageUrl) {
        return res.status(400).send('URL is required');
      }

      if (imageUrl.startsWith('//')) {
        imageUrl = 'https:' + imageUrl;
      } else if (imageUrl.startsWith('/')) {
        imageUrl = 'https://www.lego.com' + imageUrl;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(imageUrl);
      } catch {
        return res.status(400).send('Invalid URL');
      }
      if (!isAllowedImageUrl(parsedUrl)) {
        console.warn('Image proxy blocked disallowed host:', parsedUrl.hostname);
        return res.status(403).send('Host not allowed');
      }

      // redirect: 'manual' because the allowlist above only validates the
      // initial URL; with 'follow' an open redirect on an allowed host would
      // walk straight past it. Any 3xx is re-validated before being followed.
      const MAX_HOPS = 3;
      let response: globalThis.Response | null = null;
      let currentUrl = imageUrl;

      for (let hop = 0; hop <= MAX_HOPS; hop++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          response = await fetch(currentUrl, {
            redirect: 'manual',
            signal: controller.signal,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
              Referer: 'https://www.lego.com/',
            },
          });
        } finally {
          clearTimeout(timer);
        }

        if (response.status < 300 || response.status >= 400) break;

        const location = response.headers.get('location');
        if (!location) break;
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          return res.status(400).send('Invalid redirect target');
        }
        if (!isAllowedImageUrl(nextUrl)) {
          console.warn('Image proxy blocked redirect to disallowed host:', nextUrl.hostname);
          return res.status(403).send('Host not allowed');
        }
        currentUrl = nextUrl.toString();
        if (hop === MAX_HOPS) return res.status(508).send('Too many redirects');
      }

      if (!response || !response.ok) {
        console.error(
          'Image proxy fetch error:',
          response?.status,
          response?.statusText,
          imageUrl
        );
        return sendTransparent();
      }

      const contentType = response.headers.get('content-type');
      // SVG is scriptable and this is served same-origin, so an allowlisted
      // host serving image/svg+xml would otherwise be a stored-XSS vector.
      if (
        !contentType ||
        !contentType.startsWith('image/') ||
        contentType.includes('svg')
      ) {
        console.warn('Image proxy blocked content-type:', contentType, imageUrl);
        return res.status(415).send('Not a supported image type');
      }

      const declaredLength = Number(response.headers.get('content-length') || 0);
      const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
      if (declaredLength > MAX_IMAGE_BYTES) {
        return res.status(413).send('Image too large');
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
        return res.status(413).send('Image too large');
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(Buffer.from(arrayBuffer));
    } catch (error) {
      console.error('Image proxy error:', error);
      return sendTransparent();
    }
  });

  // API Route: Fetch Lego Set Info
  app.get('/api/lego/:setNumber', expensiveLimit, async (req, res) => {
    const { setNumber } = req.params;
    const skipImage = req.query.skipImage === 'true';

    if (!isValidSetNumber(setNumber)) {
      return res.status(400).json({ error: 'setNumber must be alphanumeric, max 20 chars' });
    }

    const legoUrlHuf = `https://www.lego.com/hu-hu/product/${setNumber}`;
    const legoUrlEn = `https://www.lego.com/en-us/product/${setNumber}`;

    let fallbackImage: string | null = null;
    let fallbackName: string | null = null;

    try {
      // 1. Try Brickset first
      try {
        const bricksetRes = await axios.get(`https://brickset.com/sets/${setNumber}-1`, {
          headers: getCommonHeaders(),
          timeout: 7000,
        });
        const $bs = cheerio.load(bricksetRes.data);

        const title = $bs('h1').text().trim();
        const name = title ? title.replace(/^\d+\s/, '') : '';
        if (name) fallbackName = name;

        let productImage = null;
        if (!skipImage) {
          productImage =
            $bs('a.highslide img').attr('src') ||
            $bs('img[src*="images.brickset.com/sets/images"]').attr('src');
          if (productImage) fallbackImage = productImage;
        }

        const rrpText = $bs('dt:contains("RRP")').next('dd').text();
        const eurMatch = rrpText.match(/€([\d.]+)/);
        const usdMatch = rrpText.match(/\$([\d.]+)/);

        let priceEur = 0;
        if (eurMatch) {
          priceEur = parseFloat(eurMatch[1]);
        } else if (usdMatch) {
          priceEur = parseFloat(usdMatch[1]) * 0.9;
        }

        let priceHuf = 0;
        if (priceEur > 0) {
          try {
            const rates = await getRates();
            priceHuf = Math.round(priceEur * rates.HUF);
          } catch (e: any) {
            // Previously fell back to a hardcoded 395 HUF/EUR silently, so a
            // broken rate source looked identical to a working one. Leave
            // priceHuf at 0 and let the caller see priceEur only.
            console.warn(
              `Exchange-rate lookup failed for ${setNumber}, leaving priceHuf unset:`,
              e?.message || e
            );
          }
        }

        if (priceHuf > 0 || name) {
          console.log(`Brickset info fetched for ${setNumber}:`, {
            name,
            priceEur,
            priceHuf,
            image: productImage || null,
          });
          return res.json({ name, priceHuf, image: productImage || null, url: legoUrlHuf });
        }
      } catch (bricksetError: any) {
        console.warn('Brickset scraping failed:', bricksetError.message);
      }

      const responseHu = await axios.get(legoUrlHuf, {
        headers: getCommonHeaders(),
        timeout: 7000,
      });
      const $hu = cheerio.load(responseHu.data);

      const priceText = $hu('span[data-test="product-price"]').first().text().trim();
      let priceHuf = parseInt(priceText.replace(/[^0-9]/g, '')) || 0;
      if (priceHuf === 0) {
        priceHuf = parseInt($hu('meta[property="product:price:amount"]').attr('content') || '0', 10);
      }
      let productImage = null;
      if (!skipImage) {
        productImage = $hu('meta[property="og:image"]').attr('content');
        if (!productImage) {
          productImage = $hu('img[class*="ProductImage"]').first().attr('src');
        }
        if (productImage) fallbackImage = productImage;
      }

      if (priceHuf === 0) {
        throw new Error(
          'Price not found on Lego page (both span and meta were empty/0), trying fallback'
        );
      }

      let name = `Lego Set ${setNumber}`;
      try {
        const responseEn = await axios.get(legoUrlEn, {
          headers: {
            ...getCommonHeaders(),
            'Accept-Language': 'en-US,en;q=0.9',
            Cookie: 'cs-setCountry=US; cs-setLanguage=en_US; cs-CountryRegion=US;',
          },
          timeout: 5000,
        });
        const $en = cheerio.load(responseEn.data);
        name =
          $en('h1[data-test="product-overview-name"]').first().text().trim() ||
          $en('h1').first().text().trim() ||
          name;
        if (name && name !== `Lego Set ${setNumber}`) fallbackName = name;
      } catch (enError) {
        name =
          $hu('h1[data-test="product-overview-name"]').first().text().trim() ||
          $hu('h1').first().text().trim() ||
          name;
        if (name && name !== `Lego Set ${setNumber}`) fallbackName = name;
      }

      res.json({ name, priceHuf, image: productImage, url: legoUrlHuf });
    } catch (scrapingError: any) {
      console.warn(
        'Scraping Lego.com failed, attempting Gemini Search fallback...',
        scrapingError.message
      );

      try {
        const imagePrompt = skipImage ? '' : 'and the main product image URL. ';
        const imageJsonFormat = skipImage ? '' : ', "imageUrl": "string"';
        const prompt = `Search for Lego set ${setNumber}. ALWAYS find the official ENGLISH name, current HUF price, ${imagePrompt}If it's an unreleased set or not on lego.com, prioritize searching jaysbrickblog.com and brickfanatics.com to find information such as price (convert USD/EUR to HUF roughly), image, and release date. If you get the info from an unofficial source like jaysbrickblog or brickfanatics, set 'isTemporary' to true. Return ONLY a JSON object: { "name": "string", "priceHuf": 1234${imageJsonFormat}, "isTemporary": boolean, "releaseDate": "string | null" }.`;

        const text = await callGeminiWithFallback({
          prompt,
          config: { tools: [{ googleSearch: {} }] },
          logLabel: 'lego-info',
          accept: isParseableJson,
        });

        const json = extractJson(text);
        if (json) {
          const data = JSON.parse(json);
          res.json({
            name: data.name || fallbackName || `Lego Set ${setNumber}`,
            priceHuf: data.priceHuf,
            image: data.imageUrl || fallbackImage,
            url: legoUrlHuf,
            isTemporary: data.isTemporary || false,
            releaseDate: data.releaseDate || null,
          });
        } else {
          throw new Error('Could not parse Gemini response');
        }
      } catch (fallbackError: any) {
        console.error('Gemini failed:', fallbackError);
        if (fallbackError?.isRateLimit) {
          return res
            .status(429)
            .json({ error: 'Rate limit exceeded.', retryAfter: fallbackError.retryAfter });
        }
        res.status(500).json({
          error:
            'Failed to fetch LEGO set info from all sources. Make sure your GEMINI_API_KEY is valid.',
        });
      }
    }
  });

  // API Route: Fetch prices dynamically based on sources for MULTIPLE SETS
  app.post('/api/prices-batch', expensiveLimit, async (req, res) => {
    const { setNumbers, sources } = req.body;

    if (!sources || !Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({ error: 'No price sources provided' });
    }
    if (!setNumbers || !Array.isArray(setNumbers) || setNumbers.length === 0) {
      return res.status(400).json({ error: 'No set numbers provided' });
    }
    if (sources.length > MAX_SOURCES) {
      return res.status(400).json({ error: `At most ${MAX_SOURCES} sources per request` });
    }
    if (setNumbers.length > MAX_SET_NUMBERS) {
      return res.status(400).json({ error: `At most ${MAX_SET_NUMBERS} set numbers per request` });
    }
    if (!setNumbers.every(isValidSetNumber)) {
      return res.status(400).json({ error: 'setNumbers must be alphanumeric, max 20 chars' });
    }

    try {
      const rates = await getRates();
      const hufRate = rates.HUF;

      const blSources = sources.filter((s: any) => BRICKLINK_SOURCE_IDS.includes(s.id));
      const geminiSources = sources.filter((s: any) => !BRICKLINK_SOURCE_IDS.includes(s.id));

      const result: any = {};
      for (const setNumber of setNumbers) result[setNumber] = { exchangeRate: hufRate };

      // 1. Non-BrickLink sources via a single batched Gemini call.
      if (geminiSources.length > 0) {
        const expectedJsonFormat: any = {};
        let prompt = `Find the current lowest market prices for the following Lego sets across the listed sources.\n`;
        for (const setNumber of setNumbers) {
          prompt += `\nSet Number: ${setNumber}\nSources:\n`;
          expectedJsonFormat[setNumber] = {};
          for (const s of geminiSources) {
            prompt += `- "${s.id}": ${s.urlTemplate.replace('{setNumber}', setNumber)} (Expected currency: ${s.currency})\n`;
            expectedJsonFormat[setNumber][s.id] = { price: 0, store: `string (name of the specific store)` };
          }
        }
        prompt += `\nReturn ONLY a JSON object mapping each setNumber to its sources in this exact format:\n${JSON.stringify(expectedJsonFormat, null, 2)}`;

        const text = await callGeminiWithFallback({
          prompt,
          config: { tools: [{ googleSearch: {} }] },
          timeoutMs: 25000, // Give it a bit more time for batch
          logLabel: 'prices-batch',
          accept: isParseableJson,
        });

        const json = extractJson(text);
        const parsedBatch = json ? JSON.parse(json) : {};
        for (const setNumber of setNumbers) {
          const parsed = parsedBatch[setNumber];
          if (!parsed) continue;
          for (const s of geminiSources) {
            const originalPrice = parsed[s.id]?.price;
            if (originalPrice) {
              const sourceRate = rates[s.currency] || 1;
              const priceInEur = originalPrice / sourceRate;
              result[setNumber][s.id] = {
                price: originalPrice,
                store: parsed[s.id].store,
                priceHuf: Math.round(priceInEur * hufRate),
                priceEur: priceInEur,
                url: s.urlTemplate.replace('{setNumber}', setNumber),
              };
            }
          }
        }
      }

      // 2. BrickLink sources: scrape the price guide per set, with bounded
      // concurrency so a large batch cannot open one socket per set at once.
      if (blSources.length > 0) {
        await mapWithConcurrency(
          setNumbers as string[],
          OUTBOUND_CONCURRENCY,
          async (setNumber) => {
            const bl = await fetchBrickLinkPrices(setNumber, rates);
            if (!bl) return;
            for (const s of blSources) {
              const url = s.urlTemplate.replace('{setNumber}', setNumber);
              if (s.id === 'bricklink' && bl.cheapestHuf != null) {
                result[setNumber]['bricklink'] = {
                  price: Math.round(bl.cheapestHuf / hufRate),
                  priceHuf: bl.cheapestHuf,
                  priceEur: bl.cheapestHuf / hufRate,
                  store: bl.cheapestCondition || 'BrickLink',
                  url,
                };
              }
            }
          }
        );
      }

      res.json(result);
    } catch (error: any) {
      console.error('Batch Price Error:', error);
      if (error?.isRateLimit) {
        return res.status(429).json({ error: 'Rate limit exceeded.', retryAfter: error.retryAfter });
      }
      res.status(500).json({
        error: 'Failed to fetch batch market prices. Make sure your GEMINI_API_KEY is valid.',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // API Route: Fetch prices dynamically based on sources
  app.post('/api/prices/:setNumber', expensiveLimit, async (req, res) => {
    const { setNumber } = req.params;
    const { sources } = req.body;

    if (!sources || !Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({ error: 'No price sources provided' });
    }
    if (sources.length > MAX_SOURCES) {
      return res.status(400).json({ error: `At most ${MAX_SOURCES} sources per request` });
    }
    if (!isValidSetNumber(setNumber)) {
      return res.status(400).json({ error: 'setNumber must be alphanumeric, max 20 chars' });
    }

    try {
      const rates = await getRates();
      const hufRate = rates.HUF;

      const blSources = sources.filter((s: any) => BRICKLINK_SOURCE_IDS.includes(s.id));
      const geminiSources = sources.filter((s: any) => !BRICKLINK_SOURCE_IDS.includes(s.id));

      const responseData: any = { exchangeRate: hufRate };

      // 1. Non-BrickLink sources: scrape locally where possible, then Gemini.
      if (geminiSources.length > 0) {
        const expectedJsonFormat = geminiSources.reduce((acc: any, s: any) => {
          acc[s.id] = { price: 0, store: `string (name of the specific store)` };
          return acc;
        }, {});

        // Price sources are user-configurable, so this URL is caller-controlled
        // and must be treated as hostile: validate scheme/host (incl. resolved
        // IP) before fetching, refuse redirects so a 302 cannot walk past that
        // check, and cap the body so cheerio is not handed an arbitrary blob.
        const fetchHTML = async (url: string) => {
          try {
            await assertSafeOutboundUrl(url);
            const r = await axios.get(url, {
              headers: getCommonHeaders(),
              timeout: 6000,
              maxRedirects: 0,
              maxContentLength: 5 * 1024 * 1024,
              maxBodyLength: 5 * 1024 * 1024,
              validateStatus: (s) => s >= 200 && s < 300,
            });
            const $ = cheerio.load(r.data);
            $('script, style, svg, noscript, header, footer').remove();
            return $('body').text().replace(/\s+/g, ' ').substring(0, 30000);
          } catch (e: any) {
            console.warn(`Price-source fetch skipped for ${url}:`, e?.message || e);
            return null;
          }
        };

        const sourceHtmlMap: any = {};
        await mapWithConcurrency(geminiSources as any[], OUTBOUND_CONCURRENCY, async (s) => {
          const url = s.urlTemplate.replace('{setNumber}', setNumber);
          sourceHtmlMap[s.id] = await fetchHTML(url);
        });

        let prompt = `Find the current lowest price for Lego set ${setNumber} on the following sources:\n`;
        let needsGoogleSearch = false;
        for (const s of geminiSources) {
          prompt += `- "${s.id}": ${s.urlTemplate.replace('{setNumber}', setNumber)} (Expected currency: ${s.currency})\n`;
          if (sourceHtmlMap[s.id]) {
            prompt += `  Extracted webpage text for ${s.id} (use this to find the price):\n  """${sourceHtmlMap[s.id]}"""\n\n`;
          } else {
            prompt += `  (Could not fetch webpage locally. Use googleSearch to find the price for this source. Ensure you don't hallucinate prices.)\n\n`;
            needsGoogleSearch = true;
          }
        }
        prompt += `Return ONLY a JSON object in this exact format:\n${JSON.stringify(expectedJsonFormat, null, 2)}`;

        const config: any = {};
        if (needsGoogleSearch) {
          config.tools = [{ googleSearch: {} }];
        }

        const text = await callGeminiWithFallback({
          prompt,
          config,
          logLabel: 'prices',
          accept: isParseableJson,
        });

        const json = extractJson(text);
        const data = json ? JSON.parse(json) : {};
        for (const s of geminiSources) {
          if (data[s.id]) {
            const p = data[s.id].price;
            const sourceRate = rates[s.currency] || 1;
            const priceEur = p / sourceRate;
            const priceHuf = priceEur * hufRate;
            responseData[s.id] = {
              price: p,
              priceHuf,
              priceEur,
              store: data[s.id].store,
              url: s.urlTemplate.replace('{setNumber}', setNumber),
            };
          }
        }
      }

      // 2. BrickLink: scrape the server-rendered price guide, bypassing Gemini.
      if (blSources.length > 0) {
        const bl = await fetchBrickLinkPrices(setNumber, rates);
        if (bl) {
          for (const s of blSources) {
            const url = s.urlTemplate.replace('{setNumber}', setNumber);
            if (s.id === 'bricklink' && bl.cheapestHuf != null) {
              responseData['bricklink'] = {
                price: Math.round(bl.cheapestHuf / hufRate),
                priceHuf: bl.cheapestHuf,
                priceEur: bl.cheapestHuf / hufRate,
                store: bl.cheapestCondition || 'BrickLink',
                url,
              };
            }
          }
        }
      }

      res.json(responseData);
    } catch (error: any) {
      console.error('Error fetching market prices:', error);
      if (error?.isRateLimit) {
        return res.status(429).json({ error: 'Rate limit exceeded.', retryAfter: error.retryAfter });
      }
      res.status(500).json({
        error: 'Failed to fetch market prices. Make sure your GEMINI_API_KEY is valid.',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // API Route: Fetch latest exchange rates
  app.get('/api/exchange-rates', async (_req, res) => {
    try {
      const rates = await getRates();
      res.json({ rates });
    } catch (error) {
      console.error('Error fetching exchange rates:', error);
      res.status(500).json({ error: 'Failed to fetch exchange rates' });
    }
  });

  // API Route: Fetch historical exchange rate
  app.get('/api/exchange-rate/:date', async (req, res) => {
    const { date } = req.params;
    if (!isValidIsoDate(date)) {
      return res.status(400).json({ error: 'date must be a valid YYYY-MM-DD value' });
    }
    try {
      const rates = await getRates(date);
      res.json({ rates });
    } catch (error) {
      console.error('Error fetching historical exchange rate:', error);
      res.status(500).json({ error: 'Failed to fetch historical exchange rate' });
    }
  });

  // Unknown /api/* paths should be JSON 404s, not the SPA HTML fallback.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Terminal error handler. Without this, malformed JSON bodies render
  // Express's default HTML error page, which includes a stack trace whenever
  // NODE_ENV is not 'production'.
  app.use('/api', (err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled API error:', err);
    const status = err?.status || err?.statusCode || 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: status === 400 ? 'Malformed request' : 'Internal server error',
    });
  });
}
