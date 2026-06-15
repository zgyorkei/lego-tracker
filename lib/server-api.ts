import type { Express, Request } from 'express';
import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { GoogleGenAI } from '@google/genai';

// ---------------------------------------------------------------------------
// Shared backend logic for both the local dev server (server.ts) and the
// Vercel serverless entry point (api/index.ts). Keeping a single source of
// truth here prevents the two from drifting apart (previously the Vercel copy
// was missing the batch-images, prices-batch and proxy-image endpoints, and
// shipped weaker scraping/fallback logic).
// ---------------------------------------------------------------------------

export const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
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
function isBlockedHost(hostname: string): boolean {
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

function isAllowedImageUrl(parsed: URL): boolean {
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (isBlockedHost(parsed.hostname)) return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_IMAGE_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith('.' + suffix)
  );
}

// Lazily load genAI to avoid startup crashes if the API key is missing. A
// per-request key (x-gemini-api-key header) takes precedence over the env var.
function getGenAI(customKey?: string) {
  const apiKey = customKey || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is missing. Please set it in AI Studio or provide a custom key.'
    );
  }
  // Disable the SDK's built-in 429/5xx auto-retry (which backs off internally for
  // up to ~60s). We want a rate-limited model to fail fast so callGeminiWithFallback
  // can advance to the next model immediately; our loop owns retry/backoff.
  return new GoogleGenAI({
    apiKey,
    httpOptions: { retryOptions: { attempts: 1 }, timeout: 20000 },
  });
}

const getCustomKey = (req: Request): string | undefined =>
  (req.headers['x-gemini-api-key'] as string | undefined) || undefined;

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
  customKey?: string;
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
          getGenAI(opts.customKey).models.generateContent({
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
// src/types.ts. Both ids point at the same BrickLink page, so the prompt hint
// below is what tells Gemini them apart (cheapest vs New/Sealed).
const BRICKLINK_SOURCE_IDS = ['bricklink', 'bricklink-new'];

// Per-source instruction appended to the price prompt. Lets the two BrickLink
// sources (same URL) resolve to different prices.
function sourceHint(id: string): string {
  if (id === 'bricklink') {
    return ' (BrickLink: report the SINGLE LOWEST current "Items for Sale" price for this exact set, any condition (New or Used), in EUR.)';
  }
  if (id === 'bricklink-new') {
    return ' (BrickLink: report the LOWEST current "Items for Sale" price for a NEW and factory-SEALED copy of this exact set, in EUR. If no New/Sealed listing exists, return price 0.)';
  }
  return '';
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
  app.use(express.json());

  // API Route: Fetch Minifigure Series Items
  app.get('/api/minifigures/:setNumber', async (req, res) => {
    const { setNumber } = req.params;
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
        $m('article.set').each((i, el) => {
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
        $('.set').each((i, el) => {
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
      if (results.length === 0 && (getCustomKey(req) || process.env.GEMINI_API_KEY)) {
        console.log('Scraping minifigures failed, attempting Gemini Search fallback...');
        const prompt = `Find all the minifigures or characters included in Lego set ${setNumber}. Prioritize searching jaysbrickblog.com and brickfanatics.com, or other reputable lego news sites. Return a JSON object with this exact shape: { "figures": [{ "id": "string (create a short distinct id, e.g. fig1)", "name": "string", "image": "string (direct image url or null)" }] } Return ONLY the JSON object.`;
        try {
          const text = await callGeminiWithFallback({
            prompt,
            config: { tools: [{ googleSearch: {} }], responseMimeType: 'application/json' },
            customKey: getCustomKey(req),
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
  app.post('/api/batch-images', async (req, res) => {
    const { setNumbers } = req.body;

    if (!setNumbers || !Array.isArray(setNumbers) || setNumbers.length === 0) {
      return res.status(400).json({ error: 'No set numbers provided' });
    }

    const results: Record<string, string> = {};

    try {
      // 1. Scrape each set's image with cheerio first.
      const missing: string[] = [];
      await Promise.all(
        setNumbers.map(async (n: unknown) => {
          const setNumber = String(n);
          const img = await scrapeSetImage(setNumber);
          if (img) results[setNumber] = img;
          else missing.push(setNumber);
        })
      );

      // 2. Gemini fallback only for the sets scraping could not resolve.
      if (missing.length > 0 && (getCustomKey(req) || process.env.GEMINI_API_KEY)) {
        console.log(`Scraping found ${Object.keys(results).length}/${setNumbers.length} images; querying Gemini for ${missing.length} missing.`);
        const queryList = missing.map((n) => `"Lego ${n}"`).join(', ');
        const prompt = `Find the main high-quality product image URL for the following Lego sets: ${queryList}.
Return ONLY a JSON object mapping each set number to its image URL. Example format: { "75192": "https://example.com/image1.jpg", "10294": "https://example.com/image2.png" }. Use the googleSearch tool to perform standard Google searches. Find direct image links if possible (e.g., from retailer sites, wikis, or brickset). Ensure the URLs are absolute.`;

        try {
          const text = await callGeminiWithFallback({
            prompt,
            config: { tools: [{ googleSearch: {} }], responseMimeType: 'application/json' },
            customKey: getCustomKey(req),
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
    const sendTransparent = () => {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
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

      const response = await fetch(imageUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          Referer: 'https://www.lego.com/',
        },
      });

      if (!response.ok) {
        console.error('Image proxy fetch error:', response.status, response.statusText, imageUrl);
        return sendTransparent();
      }

      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.startsWith('image/')) {
        console.warn('Image proxy blocked non-image content-type:', contentType, imageUrl);
        return res.status(415).send('Not an image');
      }
      res.setHeader('Content-Type', contentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000');

      const arrayBuffer = await response.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch (error) {
      console.error('Image proxy error:', error);
      return sendTransparent();
    }
  });

  // API Route: Fetch Lego Set Info
  app.get('/api/lego/:setNumber', async (req, res) => {
    const { setNumber } = req.params;
    const skipImage = req.query.skipImage === 'true';

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
            const ratesRes = await axios.get(`https://api.frankfurter.app/latest?from=EUR`, {
              timeout: 5000,
            });
            const eurToHuf = ratesRes.data.rates.HUF;
            if (eurToHuf) priceHuf = Math.round(priceEur * eurToHuf);
          } catch (e) {
            priceHuf = Math.round(priceEur * 395);
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
          customKey: getCustomKey(req),
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
  app.post('/api/prices-batch', async (req, res) => {
    const { setNumbers, sources } = req.body;

    if (!sources || !Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({ error: 'No price sources provided' });
    }
    if (!setNumbers || !Array.isArray(setNumbers) || setNumbers.length === 0) {
      return res.status(400).json({ error: 'No set numbers provided' });
    }

    try {
      const exRateRes = await axios.get('https://api.frankfurter.app/latest?from=EUR');
      const rates = Object.assign({}, exRateRes.data.rates, { EUR: 1 });
      const hufRate = rates.HUF;

      const expectedJsonFormat: any = {};
      let prompt = `Find the current lowest market prices for the following Lego sets across the listed sources.\n`;

      for (const setNumber of setNumbers) {
        prompt += `\nSet Number: ${setNumber}\nSources:\n`;
        expectedJsonFormat[setNumber] = {};
        for (const s of sources) {
          prompt += `- "${s.id}": ${s.urlTemplate.replace('{setNumber}', setNumber)} (Expected currency: ${s.currency})${sourceHint(s.id)}\n`;
          expectedJsonFormat[setNumber][s.id] = { price: 0, store: `string (name of the specific store)` };
        }
      }

      prompt += `\nReturn ONLY a JSON object mapping each setNumber to its sources in this exact format:\n${JSON.stringify(expectedJsonFormat, null, 2)}`;

      const text = await callGeminiWithFallback({
        prompt,
        config: { tools: [{ googleSearch: {} }] },
        customKey: getCustomKey(req),
        timeoutMs: 25000, // Give it a bit more time for batch
        logLabel: 'prices-batch',
        accept: isParseableJson,
      });

      const json = extractJson(text);
      if (!json) {
        throw new Error('Could not parse batch price data from Gemini');
      }
      const parsedBatch = JSON.parse(json);

      // Calculate HUF and formatting per item
      for (const setNumber of setNumbers) {
        if (parsedBatch[setNumber]) {
          const parsed = parsedBatch[setNumber];
          parsed.exchangeRate = hufRate;
          for (const s of sources) {
            if (parsed[s.id]) {
              const originalPrice = parsed[s.id].price;
              if (originalPrice) {
                const sourceRate = rates[s.currency] || 1;
                const priceInEur = originalPrice / sourceRate;
                parsed[s.id].priceHuf = Math.round(priceInEur * hufRate);
                parsed[s.id].url = s.urlTemplate.replace('{setNumber}', setNumber);
              }
            }
          }
        }
      }

      res.json(parsedBatch);
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
  app.post('/api/prices/:setNumber', async (req, res) => {
    const { setNumber } = req.params;
    const { sources } = req.body;

    if (!sources || !Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({ error: 'No price sources provided' });
    }

    try {
      const exRateRes = await axios.get('https://api.frankfurter.app/latest?from=EUR');
      const rates = Object.assign({}, exRateRes.data.rates, { EUR: 1 });
      const hufRate = rates.HUF;

      const expectedJsonFormat = sources.reduce((acc: any, s: any) => {
        acc[s.id] = { price: 0, store: `string (name of the specific store)` };
        return acc;
      }, {});

      // Use cheerio to fetch the content of each source URL directly if possible
      const fetchHTML = async (url: string) => {
        try {
          const r = await axios.get(url, { headers: getCommonHeaders(), timeout: 6000 });
          const $ = cheerio.load(r.data);
          $('script, style, svg, noscript, header, footer').remove();
          return $('body').text().replace(/\s+/g, ' ').substring(0, 30000);
        } catch (e) {
          return null;
        }
      };

      const sourceHtmlMap: any = {};
      await Promise.all(
        sources.map(async (s: any) => {
          // BrickLink listing pages are JS-rendered; skip the local scrape and
          // let the prompt route these straight to googleSearch.
          if (BRICKLINK_SOURCE_IDS.includes(s.id)) {
            sourceHtmlMap[s.id] = null;
            return;
          }
          const url = s.urlTemplate.replace('{setNumber}', setNumber);
          sourceHtmlMap[s.id] = await fetchHTML(url);
        })
      );

      let prompt = `Find the current lowest price for Lego set ${setNumber} on the following sources:\n`;
      let needsGoogleSearch = false;

      for (const s of sources) {
        prompt += `- "${s.id}": ${s.urlTemplate.replace('{setNumber}', setNumber)} (Expected currency: ${s.currency})${sourceHint(s.id)}\n`;
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
        customKey: getCustomKey(req),
        logLabel: 'prices',
        accept: isParseableJson,
      });

      const json = extractJson(text);
      if (json) {
        const data = JSON.parse(json);
        const responseData: any = { exchangeRate: hufRate };

        for (const s of sources) {
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

        res.json(responseData);
      } else {
        throw new Error('Failed to parse price data from Gemini');
      }
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
  app.get('/api/exchange-rates', async (req, res) => {
    try {
      const response = await axios.get(`https://api.frankfurter.app/latest?from=EUR`);
      res.json({ rates: response.data.rates });
    } catch (error) {
      console.error('Error fetching exchange rates:', error);
      res.status(500).json({ error: 'Failed to fetch exchange rates' });
    }
  });

  // API Route: Fetch historical exchange rate
  app.get('/api/exchange-rate/:date', async (req, res) => {
    const { date } = req.params;
    try {
      const response = await axios.get(`https://api.frankfurter.app/${date}?from=EUR`);
      res.json({ rates: response.data.rates });
    } catch (error) {
      console.error('Error fetching historical exchange rate:', error);
      res.status(500).json({ error: 'Failed to fetch historical exchange rate' });
    }
  });
}
