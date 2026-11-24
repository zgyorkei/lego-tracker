import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createKocka,
  isProductUrl,
  parseProductPage,
  parseResults,
  readToken,
  searchForm,
  type KockaOptions,
  type KockaRequestInit,
  type KockaResponse,
} from './kocka';

// Saved from what kocka.hu answered (2026-11-22), trimmed; no cookies, the token made up.
const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/kocka/${name}`, import.meta.url)), 'utf8');
const homeHtml = fixture('home.html');
const darthVader = fixture('results-darth-vader.html');
const noResults = fixture('results-none.html');
const productPage = fixture('product-75461.html');

const PRODUCT_75461 =
  'https://kocka.hu/LEGO-75461/lego-star-wars-nagy-meretu-darth-vader-minifigura-75461';

describe('readToken', () => {
  it('reads the csrf-token meta, or else the search form hidden _token', () => {
    expect(readToken(homeHtml)).toBe('test-token-from-meta');
    const withoutMeta = homeHtml.replace(/<meta name="csrf-token"[^>]*>/, '');
    expect(readToken(withoutMeta)).toBe('test-token-from-form');
    expect(readToken(withoutMeta.replace(/<input type="hidden" name="_token"[^>]*>/, ''))).toBe(
      null
    );
    expect(readToken('')).toBe(null);
  });
});

describe('searchForm', () => {
  it('carries the token and the set number, as the shop script posts it', () => {
    const form = searchForm('the-token', '75461');
    expect(Object.fromEntries(form)).toEqual({
      _token: 'the-token',
      orderBy: 'name',
      orderDirection: 'asc',
      page: '1',
      expression: '75461',
      noveltyFilter: 'false',
      exclusiveFilter: 'false',
      discontinuedFilter: 'false',
    });
    expect(form.toString()).toMatch(/^_token=the-token&.*&expression=75461&/);
  });
});

describe('parseResults', () => {
  it('counts only the exact LEGO set number, at its current price', () => {
    // Discounted: the struck-through old price (and the basket button's data-price) is not the price.
    expect(parseResults(darthVader, '75461')).toEqual({
      url: PRODUCT_75461,
      price: 27802,
      currency: 'HUF',
    });
    expect(parseResults(darthVader, '40547')).toEqual({
      url: 'https://kocka.hu/LEGO-40547/lego-brickheadz-obi-wan-kenobi-es-darth-vader-40547',
      price: 19995,
      currency: 'HUF',
    });
    expect(parseResults(darthVader, '854236')?.price).toBe(3333);
    // A tracker's set number with its variant.
    expect(parseResults(darthVader, '75461-1')?.price).toBe(27802);
    // A number inside a longer one is not the set.
    expect(parseResults(darthVader, '7546')).toBe(null);
    expect(parseResults(darthVader, '4054')).toBe(null);
    expect(parseResults(darthVader, '461')).toBe(null);
    // Another brand's card (Mould King) with the same number is not the LEGO set.
    expect(parseResults(darthVader.replaceAll('MK10237', '10237'), '10237')).toBe(null);
  });

  it('gives null when kocka.hu does not list the set', () => {
    expect(parseResults(noResults, '99999')).toBe(null);
    expect(parseResults(darthVader, '99999')).toBe(null);
    expect(parseResults('', '75461')).toBe(null);
  });
});

describe('parseProductPage', () => {
  it('gives the set price; another set page does not count', () => {
    expect(parseProductPage(productPage, '75461', PRODUCT_75461)).toEqual({
      url: PRODUCT_75461,
      price: 27802,
      currency: 'HUF',
    });
    // Without a discount the one price is the price.
    const fullPrice = productPage
      .replace(/<span class="text-decoration-line-through[^>]*>[^<]*<\/span><br \/>/, '')
      .replace('27 802 Ft', '34 840 Ft');
    expect(parseProductPage(fullPrice, '75461', PRODUCT_75461)?.price).toBe(34840);
    // The address is of another set.
    expect(parseProductPage(productPage, '75462', PRODUCT_75461)).toBe(null);
    // The page is of another set.
    expect(
      parseProductPage(productPage, '75462', 'https://kocka.hu/LEGO-75462/some-other-set-75462')
    ).toBe(null);
    // No price.
    expect(
      parseProductPage(
        productPage.replace(/<div class="price[\s\S]*?<\/div>/, ''),
        '75461',
        PRODUCT_75461
      )
    ).toBe(null);
  });

  it('reads only kocka.hu LEGO product pages of the set', () => {
    expect(isProductUrl(PRODUCT_75461, '75461')).toBe(true);
    expect(isProductUrl('https://kocka.hu/', '75461')).toBe(false);
    expect(isProductUrl('https://evil.example/LEGO-75461/x', '75461')).toBe(false);
  });
});

// A made-up shop: each request takes the next answer, and is recorded.
interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}
const respond = (status: number, body = '', headers: [string, string][] = []): KockaResponse => ({
  status,
  headers: new Headers(headers),
  text: async () => body,
});
const homeAnswer = (n: number) =>
  respond(200, homeHtml.replace('test-token-from-meta', `token-${n}`), [
    [
      'set-cookie',
      `XSRF-TOKEN=xsrf-${n}; expires=Sun, 22 Nov 2026 12:00:00 GMT; Max-Age=7200; path=/; samesite=lax`,
    ],
    [
      'set-cookie',
      `kockahu_lego_webshop_session=session-${n}; expires=Sun, 22 Nov 2026 12:00:00 GMT; Max-Age=7200; path=/; httponly; samesite=lax`,
    ],
  ]);
const resultsAnswer = (productsContent: string, errorCode = 0) =>
  respond(
    200,
    JSON.stringify({
      error_code: errorCode,
      productsContent,
      pagerContent: '',
      filtersContent: '',
    }),
    [['content-type', 'application/json']]
  );

const shop = (answers: KockaResponse[], options: Omit<KockaOptions, 'fetch'> = {}) => {
  const calls: Call[] = [];
  const fetch = async (url: string, init: KockaRequestInit) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const next = answers.shift();
    if (!next) throw new Error(`unexpected request: ${init.method} ${url}`);
    return next;
  };
  return { calls, kocka: createKocka({ fetch, pauseMs: 0, ...options }) };
};
const tokenOf = (call: Call) => new URLSearchParams(call.body).get('_token');
const requests = (calls: Call[]) => calls.map((c) => `${c.method} ${c.url}`);

describe('createKocka lookup', () => {
  it('reads the token and cookies from the home page, and sends them with the search', async () => {
    const { calls, kocka } = shop([homeAnswer(1), resultsAnswer(darthVader)]);
    expect(await kocka.lookup('75461')).toEqual({
      url: PRODUCT_75461,
      price: 27802,
      currency: 'HUF',
    });
    expect(requests(calls)).toEqual([
      'GET https://kocka.hu/kezdolap',
      'POST https://kocka.hu/szurt-termekek',
    ]);
    const [home, search] = calls;
    expect(home.headers.Cookie).toBe(undefined);
    // A browser User-Agent.
    expect(home.headers['User-Agent']).toMatch(/^Mozilla\/5\.0 .*Chrome\//);
    expect(search.headers.Cookie).toBe('XSRF-TOKEN=xsrf-1; kockahu_lego_webshop_session=session-1');
    expect(tokenOf(search)).toBe('token-1');
    expect(new URLSearchParams(search.body).get('expression')).toBe('75461');
    expect(search.headers['X-Requested-With']).toBe('XMLHttpRequest');
    expect(search.headers['User-Agent']).toMatch(/^Mozilla\/5\.0 /);
  });

  it('gets a fresh token and cookies once after a 419, then retries the search', async () => {
    const { calls, kocka } = shop([
      homeAnswer(1),
      respond(419, '{"message":"CSRF token mismatch."}'),
      homeAnswer(2),
      resultsAnswer(darthVader),
    ]);
    expect((await kocka.lookup('75461'))?.price).toBe(27802);
    expect(requests(calls)).toEqual([
      'GET https://kocka.hu/kezdolap',
      'POST https://kocka.hu/szurt-termekek',
      'GET https://kocka.hu/kezdolap',
      'POST https://kocka.hu/szurt-termekek',
    ]);
    // The expired session is not sent again.
    expect(calls[2].headers.Cookie).toBe(undefined);
    expect(tokenOf(calls[3])).toBe('token-2');
    expect(calls[3].headers.Cookie).toBe(
      'XSRF-TOKEN=xsrf-2; kockahu_lego_webshop_session=session-2'
    );
  });

  it('fails the check on a second 419, or any other failure', async () => {
    const twice = shop([homeAnswer(1), respond(419), homeAnswer(2), respond(419)]);
    await expect(twice.kocka.lookup('75461')).rejects.toThrow(/kocka\.hu search answered 419/);
    expect(twice.calls.length).toBe(4);

    const broken = shop([homeAnswer(1), respond(500, 'Server Error')]);
    await expect(broken.kocka.lookup('75461')).rejects.toThrow(/answered 500/);
    // No retry for other answers.
    expect(broken.calls.length).toBe(2);

    await expect(shop([homeAnswer(1), resultsAnswer('', 1)]).kocka.lookup('75461')).rejects.toThrow(
      /error 1/
    );
    await expect(shop([respond(503)]).kocka.lookup('75461')).rejects.toThrow(/answered 503/);
    await expect(shop([respond(200, '<html></html>')]).kocka.lookup('75461')).rejects.toThrow(
      /no search token/
    );
  });

  it('resolves a set kocka.hu does not list with null, and keeps the session for the next search', async () => {
    const { calls, kocka } = shop([
      homeAnswer(1),
      resultsAnswer(noResults),
      resultsAnswer(darthVader),
    ]);
    expect(await kocka.lookup('99999')).toBe(null);
    expect((await kocka.lookup('40547'))?.price).toBe(19995);
    // The home page is read once.
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST', 'POST']);
    expect(tokenOf(calls[2])).toBe('token-1');
    // Nothing is asked without a set number.
    expect(await shop([]).kocka.lookup('not a set')).toBe(null);
  });

  it('reads a known product page directly, and searches when it is gone', async () => {
    const direct = shop([respond(200, productPage)]);
    expect(await direct.kocka.lookup('75461', PRODUCT_75461)).toEqual({
      url: PRODUCT_75461,
      price: 27802,
      currency: 'HUF',
    });
    expect(requests(direct.calls)).toEqual([`GET ${PRODUCT_75461}`]);

    // The page it moved to.
    const redirected = shop([
      respond(301, '', [['location', '/LEGO-75461/new-name-75461']]),
      respond(200, productPage),
    ]);
    expect((await redirected.kocka.lookup('75461', PRODUCT_75461))?.url).toBe(
      'https://kocka.hu/LEGO-75461/new-name-75461'
    );

    const gone = shop([respond(404, 'Not found'), homeAnswer(1), resultsAnswer(darthVader)]);
    expect((await gone.kocka.lookup('75461', PRODUCT_75461))?.price).toBe(27802);
    expect(gone.calls.length).toBe(3);
  });

  it('fetches only kocka.hu product pages of the set, and never follows a redirect off kocka.hu', async () => {
    const elsewhere = shop([homeAnswer(1), resultsAnswer(darthVader)]);
    await elsewhere.kocka.lookup('75461', 'https://evil.example/LEGO-75461/x');
    expect(elsewhere.calls.every((c) => c.url.startsWith('https://kocka.hu/'))).toBe(true);

    const offsite = shop([
      respond(302, '', [['location', 'https://evil.example/LEGO-75461/x']]),
      homeAnswer(1),
      resultsAnswer(darthVader),
    ]);
    expect((await offsite.kocka.lookup('75461', PRODUCT_75461))?.url).toBe(PRODUCT_75461);
    expect(offsite.calls.every((c) => c.url.startsWith('https://kocka.hu/'))).toBe(true);
  });

  it('spaces the requests: one at a time, a pause apart', async () => {
    const waits: number[] = [];
    let clock = 10_000;
    const { kocka } = shop([homeAnswer(1), resultsAnswer(darthVader)], {
      pauseMs: 1_500,
      now: () => clock,
      sleep: async (ms: number) => {
        waits.push(ms);
        clock += ms;
      },
    });
    await kocka.lookup('75461');
    // The search waits after the home page.
    expect(waits).toEqual([1_500]);
  });
});
