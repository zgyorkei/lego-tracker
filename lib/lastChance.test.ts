import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LastChanceRefused,
  createLastChanceCache,
  lastChanceUrl,
  parseLastChancePage,
  readLastChance,
  robotsAllows,
  type LastChanceFetcher,
} from './lastChance.js';
import { registerApiRoutes } from './server-api.js';

// Stored, trimmed copies of the live page (2026-11-20): the embedded listing
// data of pages 1 and 2, with the pagination edited to say 2 pages. The spec
// never reads the live site.
const fixture = (n: number) =>
  readFileSync(join(__dirname, '__fixtures__', `last-chance-page${n}.html`), 'utf8');

const ROBOTS = [
  'User-agent: *',
  'Disallow: /checkout',
  'Disallow: /*?icmp=',
  'Disallow: /*/galleries/',
].join('\n');

/** A fake lego.com: robots.txt and the two stored pages. */
const fakeSite = (over: Partial<Record<string, { status: number; body: string }>> = {}) => {
  const calls: string[] = [];
  const fetcher: LastChanceFetcher = async (url) => {
    calls.push(url);
    if (over[url]) return over[url]!;
    if (url.endsWith('/robots.txt')) return { status: 200, body: ROBOTS };
    if (url === lastChanceUrl(1)) return { status: 200, body: fixture(1) };
    if (url === lastChanceUrl(2)) return { status: 200, body: fixture(2) };
    return { status: 404, body: '' };
  };
  return { fetcher, calls };
};

describe('parseLastChancePage', () => {
  it('reads the set numbers and the pagination, skipping promo tiles', () => {
    const p = parseLastChancePage(fixture(1));
    expect(p.currentPage).toBe(1);
    expect(p.totalPages).toBe(2);
    expect(p.setNumbers).toHaveLength(17);
    expect(p.setNumbers.slice(0, 3)).toEqual(['75192', '75367', '75397']);
  });

  it('refuses a page with no listing instead of reading it as empty', () => {
    expect(() => parseLastChancePage('<html><body>Hello</body></html>')).toThrow(LastChanceRefused);
    expect(() => parseLastChancePage('<html><title>Access Denied</title></html>')).toThrow(
      /Access Denied|bot check|embedded/i
    );
    const noListing =
      '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"__APOLLO_STATE__":{}}}}</script>';
    expect(() => parseLastChancePage(noListing)).toThrow(/no product listing/);
  });
});

describe('robotsAllows', () => {
  it("honours the generic group's rules and wildcards", () => {
    expect(robotsAllows(ROBOTS, '/hu-hu/categories/last-chance-to-buy?sort.key=PRICE')).toBe(true);
    expect(robotsAllows(ROBOTS, '/checkout/step')).toBe(false);
    expect(robotsAllows(ROBOTS, '/hu-hu/x?icmp=abc')).toBe(false);
    expect(robotsAllows(ROBOTS, '/hu-hu/galleries/')).toBe(false);
  });

  it('lets a longer Allow beat a Disallow, and an empty file allow everything', () => {
    const txt = 'User-agent: *\nDisallow: /hu-hu/\nAllow: /hu-hu/categories/';
    expect(robotsAllows(txt, '/hu-hu/categories/last-chance-to-buy')).toBe(true);
    expect(robotsAllows(txt, '/hu-hu/other')).toBe(false);
    expect(robotsAllows('', '/anything')).toBe(true);
  });
});

describe('readLastChance', () => {
  it('reads robots.txt, then every page in order with a pause, from the stored copy', async () => {
    const site = fakeSite();
    const sleep = vi.fn(async () => {});
    const r = await readLastChance(site.fetcher, {
      sleep,
      now: () => new Date('2026-11-20T10:00:00Z'),
    });
    expect(site.calls).toEqual([
      'https://www.lego.com/robots.txt',
      lastChanceUrl(1),
      lastChanceUrl(2),
    ]);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(r.setNumbers).toHaveLength(17 + 24);
    expect(new Set(r.setNumbers).size).toBe(r.setNumbers.length);
    expect(r.readAt).toBe('2026-11-20T10:00:00.000Z');
  });

  it('stops without reading the page when robots.txt disallows it', async () => {
    const site = fakeSite({
      'https://www.lego.com/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /hu-hu/' },
    });
    await expect(readLastChance(site.fetcher, { sleep: async () => {} })).rejects.toThrow(
      /robots\.txt/
    );
    expect(site.calls).toEqual(['https://www.lego.com/robots.txt']);
  });

  it('reports a refusal or a challenge and does not go on', async () => {
    const blocked = fakeSite({ [lastChanceUrl(1)]: { status: 403, body: 'denied' } });
    await expect(readLastChance(blocked.fetcher, { sleep: async () => {} })).rejects.toThrow(
      /refused the read \(HTTP 403\)/
    );
    const wall = fakeSite({
      [lastChanceUrl(1)]: { status: 200, body: '<html>Please solve the CAPTCHA</html>' },
    });
    await expect(readLastChance(wall.fetcher, { sleep: async () => {} })).rejects.toThrow(
      /bot check/
    );
    expect(wall.calls).toHaveLength(2);
  });

  it('fails the whole read when a later page fails (no partial list)', async () => {
    const site = fakeSite({ [lastChanceUrl(2)]: { status: 500, body: '' } });
    await expect(readLastChance(site.fetcher, { sleep: async () => {} })).rejects.toThrow(/500/);
  });
});

describe('createLastChanceCache', () => {
  const result = { setNumbers: ['1'], readAt: 'x' };

  it('reads once per TTL and shares one read between simultaneous callers', async () => {
    let clock = 0;
    const read = vi.fn(async () => result);
    const cache = createLastChanceCache(read, { ttlMs: 100, retryMs: 50, now: () => clock });
    await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(read).toHaveBeenCalledTimes(1);
    clock = 99;
    await cache.get();
    expect(read).toHaveBeenCalledTimes(1);
    clock = 101;
    await cache.get();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failure before the retry time, and keeps serving an older good read', async () => {
    let clock = 0;
    const read = vi
      .fn<() => Promise<typeof result>>()
      .mockRejectedValueOnce(new LastChanceRefused('no'))
      .mockResolvedValueOnce(result)
      .mockRejectedValue(new LastChanceRefused('no again'));
    const cache = createLastChanceCache(read, { ttlMs: 100, retryMs: 50, now: () => clock });
    await expect(cache.get()).rejects.toThrow('no');
    clock = 10;
    await expect(cache.get()).rejects.toThrow('no');
    expect(read).toHaveBeenCalledTimes(1);
    clock = 60;
    expect(await cache.get()).toEqual(result);
    clock = 200;
    expect(await cache.get()).toEqual(result); // refused again: the older read stands
    clock = 210;
    await cache.get();
    expect(read).toHaveBeenCalledTimes(3);
  });
});

describe('GET /api/last-chance', () => {
  async function withServer(fetcher: LastChanceFetcher, run: (base: string) => Promise<void>) {
    const app = express();
    registerApiRoutes(app, { rateLimit: false, lastChanceFetcher: fetcher });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    } finally {
      server.close();
    }
  }

  it('answers the set numbers and the read time, cached for hours, one read for two calls', async () => {
    const site = fakeSite();
    await withServer(site.fetcher, async (base) => {
      const res = await fetch(`${base}/api/last-chance`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toContain('s-maxage=21600');
      const body = (await res.json()) as { setNumbers: string[]; readAt: string };
      expect(body.setNumbers).toHaveLength(41);
      expect(Number.isNaN(Date.parse(body.readAt))).toBe(false);
      await fetch(`${base}/api/last-chance`);
      expect(site.calls.filter((u) => u.endsWith('/robots.txt'))).toHaveLength(1);
    });
  });

  it('answers 502 with the reason when LEGO.com refuses', async () => {
    const site = fakeSite({ [lastChanceUrl(1)]: { status: 429, body: '' } });
    await withServer(site.fetcher, async (base) => {
      const res = await fetch(`${base}/api/last-chance`);
      expect(res.status).toBe(502);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(((await res.json()) as { error: string }).error).toMatch(/HTTP 429/);
    });
  });
});
