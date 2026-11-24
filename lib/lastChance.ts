import { SET_NUMBER_RE } from './setNumber.js';

// LEGO.com's "last chance to buy" listing (the retiring sets). The page is a
// Next.js page: the server renders the HTML and embeds the listing's data as
// JSON in <script id="__NEXT_DATA__"> (an Apollo cache: a ProductListingPage
// with `tiles` and `pagination`, each product tile pointing at a product with
// its `productCode`, the set number). That embedded JSON is the most stable
// source (no CSS class names, no private GraphQL call), so it is what is read.
// Every page of the listing is read, one request at a time, with a pause.

export const LAST_CHANCE_ORIGIN = 'https://www.lego.com';
export const LAST_CHANCE_PATH = '/hu-hu/categories/last-chance-to-buy';
const LAST_CHANCE_QUERY = 'sort.direction=DESC&sort.key=PRICE';

/** An honest user agent that names the app and says what it does. */
export const LAST_CHANCE_USER_AGENT =
  'lego-tracker/1.0 (personal LEGO set tracker; reads the last-chance page every few hours)';

/** One read at most every this long (also the browser's and CDN's cache time). */
export const LAST_CHANCE_TTL_MS = 6 * 60 * 60 * 1000;
/** After a refusal or a failure, do not ask again for this long. */
export const LAST_CHANCE_RETRY_MS = 60 * 60 * 1000;
/** The pause between two pages of one read. */
export const LAST_CHANCE_PAGE_DELAY_MS = 1500;
/** The listing has about 14 pages; a runaway loop stops here. */
export const LAST_CHANCE_MAX_PAGES = 40;

export interface LastChanceResult {
  /** The set numbers on the page, in page order, no duplicates. */
  setNumbers: string[];
  /** When the page was read (ISO). */
  readAt: string;
}

/** What a fetcher answers: the status and body, never throwing for a 4xx or 5xx. */
export type LastChanceFetcher = (url: string) => Promise<{ status: number; body: string }>;

/** LEGO.com refused, or the page is not what it was (a wall, a challenge, a new layout). */
export class LastChanceRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LastChanceRefused';
  }
}

export const lastChanceUrl = (page: number): string =>
  `${LAST_CHANCE_ORIGIN}${LAST_CHANCE_PATH}?${LAST_CHANCE_QUERY}${page > 1 ? `&page=${page}` : ''}`;

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

const robotsPatternToRegExp = (pattern: string): RegExp => {
  const end = pattern.endsWith('$');
  const body = (end ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${end ? '$' : ''}`);
};

/**
 * Whether robots.txt lets a generic crawler (`User-agent: *`, or a group that
 * names this app) read `pathAndQuery`. The longest matching rule wins and an
 * Allow beats a Disallow of the same length (the usual interpretation).
 */
export function robotsAllows(robotsTxt: string, pathAndQuery: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (field !== 'allow' && field !== 'disallow') || !value) continue;
    current.rules.push({ allow: field === 'allow', pattern: value });
  }
  const named = groups.filter((g) => g.agents.some((a) => a !== '*' && 'lego-tracker'.includes(a)));
  const applicable = named.length ? named : groups.filter((g) => g.agents.includes('*'));
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of applicable.flatMap((g) => g.rules)) {
    if (!robotsPatternToRegExp(rule.pattern).test(pathAndQuery)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { allow: rule.allow, length };
    }
  }
  return best ? best.allow : true;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const BOT_WALL_RE = /captcha|px-captcha|access denied|verify you are (a )?human|just a moment/i;

interface ApolloRef {
  __ref?: string;
}

export interface ParsedListingPage {
  setNumbers: string[];
  currentPage: number;
  totalPages: number;
  totalProducts: number;
}

/**
 * The set numbers and the pagination in one page's HTML. Throws
 * LastChanceRefused when the page carries no listing (a bot wall, an error
 * page or a redesign), so a changed page is never read as "nothing is retiring".
 */
export function parseLastChancePage(html: string): ParsedListingPage {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) {
    throw new LastChanceRefused(
      BOT_WALL_RE.test(html)
        ? 'LEGO.com answered with a bot check instead of the listing'
        : 'The last-chance page has no embedded listing data'
    );
  }
  let apollo: Record<string, any>;
  try {
    apollo = JSON.parse(match[1]).props.pageProps.__APOLLO_STATE__;
    if (!apollo || typeof apollo !== 'object') throw new Error('no apollo state');
  } catch {
    throw new LastChanceRefused('The last-chance page data is not in the expected shape');
  }
  const listingKey = Object.keys(apollo).find((k) => k.startsWith('ProductListingPage:'));
  const listing = listingKey ? apollo[listingKey] : null;
  const pagination = listing?.pagination;
  if (
    !listing ||
    !Array.isArray(listing.tiles) ||
    typeof pagination?.currentPage !== 'number' ||
    typeof pagination?.totalPages !== 'number'
  ) {
    throw new LastChanceRefused('The last-chance page has no product listing');
  }
  const setNumbers: string[] = [];
  for (const ref of listing.tiles as ApolloRef[]) {
    const tile = ref?.__ref ? apollo[ref.__ref] : null;
    if (tile?.__typename !== 'ProductTile') continue; // promo, gift and discover tiles
    const productRef: string | undefined = tile.product?.__ref;
    const code = (productRef && apollo[productRef]?.productCode) ?? tile.id;
    if (typeof code === 'string' && SET_NUMBER_RE.test(code) && !setNumbers.includes(code)) {
      setNumbers.push(code);
    }
  }
  return {
    setNumbers,
    currentPage: pagination.currentPage,
    totalPages: pagination.totalPages,
    totalProducts: typeof pagination.totalProducts === 'number' ? pagination.totalProducts : 0,
  };
}

export interface ReadOptions {
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const refusal = (status: number): LastChanceRefused =>
  new LastChanceRefused(
    status === 403 || status === 429 || status === 503
      ? `LEGO.com refused the read (HTTP ${status}); not trying to get around it`
      : `LEGO.com answered HTTP ${status}`
  );

/**
 * Reads robots.txt, then every page of the listing, one at a time. Any page
 * that fails fails the whole read: a partial list would look like sets that
 * left the page.
 */
export async function readLastChance(
  fetcher: LastChanceFetcher,
  options: ReadOptions = {}
): Promise<LastChanceResult> {
  const sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const delayMs = options.delayMs ?? LAST_CHANCE_PAGE_DELAY_MS;

  const robots = await fetcher(`${LAST_CHANCE_ORIGIN}/robots.txt`);
  if (robots.status >= 200 && robots.status < 300) {
    if (!robotsAllows(robots.body, `${LAST_CHANCE_PATH}?${LAST_CHANCE_QUERY}`)) {
      throw new LastChanceRefused("LEGO.com's robots.txt does not allow reading the page");
    }
  } else if (robots.status === 401 || robots.status === 403 || robots.status === 429) {
    throw refusal(robots.status);
  }

  const all: string[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages && page <= LAST_CHANCE_MAX_PAGES; page++) {
    if (page > 1) await sleep(delayMs);
    const res = await fetcher(lastChanceUrl(page));
    if (res.status < 200 || res.status >= 300) throw refusal(res.status);
    const parsed = parseLastChancePage(res.body);
    if (parsed.currentPage !== page) {
      throw new LastChanceRefused(
        `Asked for page ${page}, LEGO.com sent page ${parsed.currentPage}`
      );
    }
    totalPages = parsed.totalPages;
    for (const n of parsed.setNumbers) if (!all.includes(n)) all.push(n);
  }
  if (all.length === 0) throw new LastChanceRefused('The last-chance page listed no sets');
  return { setNumbers: all, readAt: (options.now?.() ?? new Date()).toISOString() };
}

// ---------------------------------------------------------------------------
// The cache: one read every few hours, however many callers ask
// ---------------------------------------------------------------------------

export interface LastChanceCache {
  get(): Promise<LastChanceResult>;
}

/**
 * Serves the last good read for `ttlMs`, shares one read between simultaneous
 * callers, and after a failure serves the same failure for `retryMs` (the
 * failure is not retried sooner), falling back to an older good read if any.
 */
export function createLastChanceCache(
  read: () => Promise<LastChanceResult>,
  opts: { ttlMs?: number; retryMs?: number; now?: () => number } = {}
): LastChanceCache {
  const ttlMs = opts.ttlMs ?? LAST_CHANCE_TTL_MS;
  const retryMs = opts.retryMs ?? LAST_CHANCE_RETRY_MS;
  const now = opts.now ?? Date.now;
  let good: { value: LastChanceResult; at: number } | null = null;
  let failed: { error: unknown; at: number } | null = null;
  let inFlight: Promise<LastChanceResult> | null = null;

  return {
    async get() {
      if (good && now() - good.at < ttlMs) return good.value;
      if (failed && now() - failed.at < retryMs) {
        if (good) return good.value;
        throw failed.error;
      }
      if (!inFlight) {
        inFlight = read()
          .then((value) => {
            good = { value, at: now() };
            failed = null;
            return value;
          })
          .catch((error: unknown) => {
            failed = { error, at: now() };
            if (good) return good.value;
            throw error;
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    },
  };
}
