/**
 * kocka.hu, a Hungarian LEGO webshop: the price of a LEGO set, found by its set number. It is a
 * built-in price source (id 'kocka', lib/priceSources.ts), read by this plain HTTP lookup instead
 * of Gemini or the desktop browser, by the server on the web and in the desktop app alike.
 *
 * The shop's search is a Laravel form posted with a CSRF token (gyors-kereses: _token,
 * expression). The page that form answers with is only a frame: its script then posts the same
 * search to szurt-termekek and gets the product cards back as JSON. This posts that second request
 * directly, as the shop's own script does: a GET of the home page gives the token (its csrf-token
 * meta, or else the search form's hidden _token) and the session cookies, which go with every
 * POST. A 419 (the session or the token expired) gets a fresh token once; any other answer fails
 * the check. The token is never stored, only kept in memory for a while.
 *
 * Only a card whose set number is exactly the one asked for counts (75461, not 754610), and only
 * a LEGO one (the shop sells other brands too). A set found once keeps its product page, which
 * later checks read with a plain GET; the search is the fallback when that page is gone or no
 * longer shows the set.
 *
 * One request at a time with a pause in between, and a browser's User-Agent.
 */

const ORIGIN = 'https://kocka.hu';
const HOME_URL = `${ORIGIN}/kezdolap`;
const SEARCH_PAGE_URL = `${ORIGIN}/gyors-kereses`;
const PRODUCTS_URL = `${ORIGIN}/szurt-termekek`;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0';
const ACCEPT_HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const REQUEST_TIMEOUT_MS = 30_000;
// Be gentle with the shop: one request at a time, with a pause in between.
const PAUSE_MS = 1_500;
// A token and its session cookies serve this long before a new home page is read.
const SESSION_MAX_AGE_MS = 30 * 60_000;
const MAX_REDIRECTS = 5;
// Product pages remembered by the shared reader (lookupKocka), the oldest dropped first.
const MAX_KNOWN_URLS = 2_000;

/** A set's price on kocka.hu, in forints, with the product page it was read from. */
export interface KockaPrice {
  url: string;
  price: number;
  currency: 'HUF';
}

/** The part of a fetch Response the reader uses (a test passes a fake). */
export interface KockaResponse {
  status: number;
  headers: Headers;
  text(): Promise<string>;
}

export interface KockaRequestInit {
  method: string;
  redirect: 'manual';
  signal: AbortSignal;
  headers: Record<string, string>;
  body?: string;
}

export type KockaFetch = (url: string, init: KockaRequestInit) => Promise<KockaResponse>;

export interface KockaOptions {
  fetch?: KockaFetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pauseMs?: number;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  '#39': "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
};
const decodeEntities = (text: string): string =>
  text.replace(/&(amp|quot|#39|lt|gt|nbsp);/g, (_, name: string) => ENTITIES[name]);
const attribute = (tag: string, name: string): string | null =>
  new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1] ?? null;

/** A set number as kocka.hu lists it (a tracker's "75461-1" is 75461), or null when it is not one. */
export const cleanSetNumber = (setNumber: unknown): string | null => {
  const base = String(setNumber ?? '')
    .trim()
    .replace(/-\d+$/, '');
  return /^\d{3,7}$/.test(base) ? base : null;
};

/** The CSRF token of a kocka.hu page: its csrf-token meta, or else a form's hidden _token; null when neither. */
export function readToken(html: string): string | null {
  const meta = /<meta\b[^>]*\bname\s*=\s*["']csrf-token["'][^>]*>/i.exec(String(html))?.[0];
  const fromMeta = meta ? attribute(meta, 'content') : null;
  if (fromMeta) return fromMeta;
  const input = /<input\b[^>]*\bname\s*=\s*["']_token["'][^>]*>/i.exec(String(html))?.[0];
  return (input ? attribute(input, 'value') : null) || null;
}

/** The search's form, as the shop's script posts it to szurt-termekek: the set number, no filters, first page. */
export function searchForm(token: string, setNumber: string): URLSearchParams {
  return new URLSearchParams({
    _token: token,
    orderBy: 'name',
    orderDirection: 'asc',
    page: '1',
    expression: String(setNumber),
    noveltyFilter: 'false',
    exclusiveFilter: 'false',
    discontinuedFilter: 'false',
  });
}

/** The set number in a kocka.hu LEGO product page's address (https://kocka.hu/LEGO-75461/...), or null. */
const productSet = (url: unknown): string | null =>
  /^https:\/\/kocka\.hu\/LEGO-([^/?#]+)\/[^/?#]+\/?$/i.exec(String(url ?? ''))?.[1] ?? null;

/** Whether the address is the kocka.hu product page of this LEGO set (the only pages read directly). */
export const isProductUrl = (url: unknown, setNumber: unknown): boolean => {
  const set = cleanSetNumber(setNumber);
  return set !== null && productSet(url) === set;
};

/** A forint price in text, e.g. "27 802 Ft" or "1.299 Ft"; null when there is none. */
const hufIn = (text: string): number | null => {
  const plain = decodeEntities(String(text).replace(/<[^>]*>/g, ' '));
  // Thousands are grouped by a space, a dot, or a (narrow) no-break space.
  const m = /(\d[\d\s.\u00a0\u202f]*)\s*Ft\b/i.exec(plain);
  const price = m ? Number(m[1].replace(/\D/g, '')) : NaN;
  return Number.isFinite(price) && price > 0 ? price : null;
};

/**
 * The set's card in the search's product cards (szurt-termekek's productsContent): its product
 * page and current price; null when no LEGO card has exactly that set number, or it has no price.
 */
export function parseResults(productsHtml: string, setNumber: string): KockaPrice | null {
  const set = cleanSetNumber(setNumber);
  if (!set) return null;
  const cards = String(productsHtml ?? '')
    .split(/<div\s+class="card product-card\b/)
    .slice(1);
  for (const card of cards) {
    const url = [...card.matchAll(/href\s*=\s*"(https:\/\/kocka\.hu\/[^"]+)"/gi)]
      .map((m) => decodeEntities(m[1]))
      .find((u) => productSet(u) === set);
    if (!url) continue;
    // The basket button names the set and the brand too, when there is one.
    const button = /<a\b[^>]*\bdata-original_id\s*=[^>]*>/i.exec(card)?.[0];
    if (
      button &&
      (attribute(button, 'data-original_id') !== set ||
        !/^LEGO$/i.test(attribute(button, 'data-product_brand') ?? 'LEGO'))
    )
      continue;
    // A discount shows the old price struck through, then the current one.
    const prices = [...card.matchAll(/<h4\b([^>]*)>([\s\S]*?)<\/h4>/gi)]
      .filter((m) => {
        const cls = attribute(m[1], 'class') ?? '';
        return /\bprice\b/.test(cls) && !/line-through/.test(cls);
      })
      .map((m) => hufIn(m[2]))
      .filter((p): p is number => p !== null);
    const price = prices[prices.length - 1];
    return price ? { url, price, currency: 'HUF' } : null;
  }
  return null;
}

/** A kocka.hu product page's current price, when the page is this set's (by its address and its own data); else null. */
export function parseProductPage(html: string, setNumber: string, url: string): KockaPrice | null {
  const set = cleanSetNumber(setNumber);
  const page = String(html ?? '');
  if (!set || productSet(url) !== set) return null;
  const data = /<input\b[^>]*\bid\s*=\s*["']product_data["'][^>]*>/i.exec(page)?.[0];
  const title = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(page);
  const listed = data ? attribute(data, 'data-original_id') : null;
  if (listed !== null ? listed !== set : !title || !title[1].includes(`(${set})`)) return null;
  // The price block under the title: the old price struck through when discounted, then the current one.
  const from = title ? title.index : 0;
  const block = /<div\b[^>]*\bclass\s*=\s*["']price\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
    page.slice(from)
  );
  const price = block
    ? hufIn(block[1].replace(/<span\b[^>]*line-through[^>]*>[\s\S]*?<\/span>/gi, ' '))
    : null;
  return price ? { url, price, currency: 'HUF' } : null;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The Set-Cookie headers of a response, one per cookie. */
const setCookies = (headers: Headers): string[] => {
  const withList = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withList.getSetCookie === 'function') return withList.getSetCookie();
  const joined = headers.get('set-cookie');
  return joined ? joined.split(/,(?=\s*[^;,=\s]+=)/) : [];
};

/**
 * A kocka.hu reader with its own session. fetch, the clock and the pause are given in tests; the
 * app uses one shared reader (lookupKocka).
 */
export function createKocka({
  fetch: fetchImpl = (url, init) => fetch(url, init),
  now = Date.now,
  sleep = pause,
  pauseMs = PAUSE_MS,
}: KockaOptions = {}) {
  const cookies = new Map<string, string>();
  let token: string | null = null;
  let tokenAt = 0;
  let lastRequestAt = -Infinity;
  let queue: Promise<unknown> = Promise.resolve();

  const keepCookies = (response: KockaResponse) => {
    for (const line of setCookies(response.headers)) {
      const m = /^\s*([^=;\s]+)=([^;]*)/.exec(line);
      if (!m) continue;
      if (/;\s*max-age=0\b/i.test(line) || m[2] === '' || m[2] === 'deleted') cookies.delete(m[1]);
      else cookies.set(m[1], m[2]);
    }
  };

  interface Answer {
    status: number;
    url: string;
    text: string;
  }

  /** One request at a time, pauseMs apart; redirects (within kocka.hu) are followed here to keep the cookies they set. */
  const request = (
    url: string,
    {
      method = 'GET',
      headers = {},
      body,
    }: { method?: string; headers?: Record<string, string>; body?: string } = {}
  ): Promise<Answer> => {
    const run = queue.then(async () => {
      let at = url;
      let init: { method: string; headers: Record<string, string>; body?: string } = {
        method,
        headers,
        body,
      };
      for (let hop = 0; ; hop++) {
        const wait = lastRequestAt + pauseMs - now();
        if (wait > 0) await sleep(wait);
        lastRequestAt = now();
        const response = await fetchImpl(at, {
          method: init.method,
          redirect: 'manual',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'hu-HU,hu;q=0.9,en;q=0.8',
            ...(cookies.size
              ? {
                  Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
                }
              : {}),
            ...init.headers,
          },
          ...(init.body !== undefined ? { body: init.body } : {}),
        });
        keepCookies(response);
        const location = response.headers.get('location');
        // Followed only within kocka.hu, so its cookies go nowhere else.
        let next: URL | null;
        try {
          next = location ? new URL(location, at) : null;
        } catch {
          next = null;
        }
        if (
          response.status >= 300 &&
          response.status < 400 &&
          next?.origin === ORIGIN &&
          hop < MAX_REDIRECTS
        ) {
          at = next.href;
          init = { method: 'GET', headers: { Accept: ACCEPT_HTML } };
          continue;
        }
        return { status: response.status, url: at, text: await response.text() };
      }
    });
    queue = run.catch(() => {});
    return run;
  };

  /** The search token, read from the home page (with fresh cookies) when there is none, it is old, or fresh is asked. */
  const session = async (fresh: boolean): Promise<string> => {
    if (!fresh && token && now() - tokenAt < SESSION_MAX_AGE_MS) return token;
    cookies.clear();
    token = null;
    const home = await request(HOME_URL, { headers: { Accept: ACCEPT_HTML } });
    if (home.status !== 200) throw new Error(`kocka.hu answered ${home.status}`);
    const read = readToken(home.text);
    if (!read) throw new Error('kocka.hu sent no search token');
    token = read;
    tokenAt = now();
    return token;
  };

  /** The search's product cards (HTML) for a set number; a 419 gets a fresh token once. */
  const search = async (setNumber: string): Promise<string> => {
    for (let attempt = 0; ; attempt++) {
      const answer = await request(PRODUCTS_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Origin: ORIGIN,
          Referer: SEARCH_PAGE_URL,
        },
        body: searchForm(await session(attempt > 0), setNumber).toString(),
      });
      if (answer.status === 419 && attempt === 0) continue;
      if (answer.status === 419) token = null;
      if (answer.status !== 200) throw new Error(`kocka.hu search answered ${answer.status}`);
      let results: { error_code?: unknown; productsContent?: unknown };
      try {
        results = JSON.parse(answer.text);
      } catch {
        throw new Error('kocka.hu search answered without results');
      }
      if (Number(results?.error_code) !== 0)
        throw new Error(`kocka.hu search failed (error ${String(results?.error_code)})`);
      return String(results.productsContent ?? '');
    }
  };

  /**
   * The set's price and product page, or null when kocka.hu does not list it. knownUrl, the
   * set's product page from an earlier check, is read first. Fails (throws) when the shop cannot
   * be read.
   */
  const lookup = async (
    setNumber: string,
    knownUrl?: string | null
  ): Promise<KockaPrice | null> => {
    const set = cleanSetNumber(setNumber);
    if (!set) return null;
    if (knownUrl && isProductUrl(knownUrl, set)) {
      try {
        const page = await request(knownUrl, { headers: { Accept: ACCEPT_HTML } });
        const found = page.status === 200 ? parseProductPage(page.text, set, page.url) : null;
        if (found) return found;
      } catch {
        // The search decides.
      }
    }
    return parseResults(await search(set), set);
  };

  return { lookup };
}

let shared: ReturnType<typeof createKocka> | null = null;
// The product page each set was last found on, so the next check reads it with one GET. Kept in
// memory only: a restart (or a new serverless instance) starts with the search again.
const knownUrls = new Map<string, string>();

/**
 * Looks up one LEGO set on kocka.hu with the app's shared session and its remembered product
 * pages (see createKocka's lookup): null when the shop does not list the set, throws when the
 * shop cannot be read.
 */
export async function lookupKocka(setNumber: string): Promise<KockaPrice | null> {
  const set = cleanSetNumber(setNumber);
  if (!set) return null;
  const found = await (shared ??= createKocka()).lookup(set, knownUrls.get(set));
  knownUrls.delete(set);
  if (found) {
    knownUrls.set(set, found.url);
    if (knownUrls.size > MAX_KNOWN_URLS) knownUrls.delete(knownUrls.keys().next().value!);
  }
  return found;
}
