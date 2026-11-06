import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserContext } from 'playwright';
import { PlaywrightScraper, type Launch } from './engine';
import { isScraperUnavailable } from '../../../lib/scraperErrors';

// No real browser: the launch is a stub. A page that loads nothing makes
// fetchPageHtml answer null once the browser is up.
const fakeContext = (): BrowserContext => {
  const page = { goto: async () => null, title: async () => '' };
  return {
    pages: () => [page],
    newPage: async () => page,
    close: async () => {},
  } as unknown as BrowserContext;
};

describe('PlaywrightScraper when the browser does not start', () => {
  let scraper: PlaywrightScraper | null = null;
  afterEach(async () => {
    await scraper?.close();
    scraper = null;
  });

  it('rejects every queued page as scraper-unavailable, with the reason, after one launch', async () => {
    const calls: number[] = [];
    const launch: Launch = async (_dir, timeoutMs) => {
      calls.push(timeoutMs);
      throw new Error(
        'browserType.launchPersistentContext: Timeout 60000ms exceeded.\nCall log: ...'
      );
    };
    scraper = new PlaywrightScraper('profile', { launch });
    const first = scraper.fetchPageHtml('https://www.lego.com/hu-hu/product/99992');
    const second = scraper.fetchPageHtml('https://www.lego.com/en-us/product/99992');
    const e1 = await first.catch((e) => e);
    const e2 = await second.catch((e) => e);
    expect(isScraperUnavailable(e1)).toBe(true);
    expect(e1.message).toBe(
      'The desktop browser did not start: browserType.launchPersistentContext: Timeout 60000ms exceeded.'
    );
    // the page queued behind the failed launch fails at once, without a launch of its own
    expect(isScraperUnavailable(e2)).toBe(true);
    expect(calls).toEqual([60_000]);
  });

  it('launches again once the retry window has passed, and the queue still works', async () => {
    let t = 0;
    let fail = true;
    let launches = 0;
    const launch: Launch = async () => {
      launches += 1;
      if (fail) throw new Error('spawn failed');
      return fakeContext();
    };
    scraper = new PlaywrightScraper('profile', { launch, launchRetryMs: 1000, now: () => t });
    await expect(scraper.fetchPageHtml('https://example.test/a')).rejects.toThrow(
      'The desktop browser did not start: spawn failed'
    );
    t = 500;
    await expect(scraper.fetchPageHtml('https://example.test/b')).rejects.toThrow(/did not start/);
    expect(launches).toBe(1);
    t = 2000;
    fail = false;
    await expect(scraper.fetchPageHtml('https://example.test/c')).resolves.toBeNull();
    expect(launches).toBe(2);
  });
});
