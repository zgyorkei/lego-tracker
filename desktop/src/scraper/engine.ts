import type { BrowserContext, Page } from 'playwright';
import { capturePage as captureOpenPage, GENERIC_CONSENT, readPagePrice, readSearchCards } from 'shop-teacher/browser';
import { parseRecipe, rankCards, type RecipeTestResult, type ScrapeRecipe, type ScrapedCard } from '../../../lib/scrapeRecipe';
import type { PageCapture, PriceScraper } from '../../../lib/server-api';
import { builtinRecipeFor } from '../../../lib/builtinRecipes';

// Close the browser after this long without work, so it is not left running
// all day between the 4AM refresh and the next one.
const IDLE_CLOSE_MS = 2 * 60 * 1000;
const NAV_TIMEOUT_MS = 30_000;
// Cloudflare's interstitial (Arukereso) usually clears in a few seconds.
const CHALLENGE_TIMEOUT_MS = 40_000;
const MAX_PRODUCT_PAGES = 2;


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// A person-paced gap between page loads.
const politePause = () => sleep(1500 + Math.random() * 2000);

/**
 * Playwright-backed PriceScraper for the desktop app.
 *
 * Settings come from live trials, and each one matters:
 * - Bundled Chromium, not the installed Chrome: Amazon served its 503 page to
 *   every launch of the installed Chrome on the dev machine.
 * - Headed, with the window parked off-screen: Cloudflare (Arukereso) never
 *   cleared in either headless mode, but clears at once in a real window.
 * - English browser language (en-US): Amazon.de answers a Hungarian or German
 *   browser with its 503 page or an empty interstitial, but serves en-US
 *   normally. A headed browser would otherwise inherit the OS language (hu).
 *   The display currency is pinned separately by the i18n-prefs cookie.
 * - A persistent profile, so consent and Cloudflare clearance cookies survive
 *   between runs, as they would for a person.
 * All page loads go through one queue: one tab, one page at a time.
 */
export class PlaywrightScraper implements PriceScraper {
  private context: Promise<BrowserContext> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private cookiesSet = new Set<string>();

  constructor(private readonly profileDir: string) {}

  async scrapePrice(
    source: { id: string; urlTemplate: string; scraper?: unknown },
    setNumber: string
  ): Promise<{ price: number; url: string | null } | null> {
    const url = source.urlTemplate.replace('{setNumber}', encodeURIComponent(setNumber));
    // A taught recipe wins over a built-in one for the same host.
    const recipe = parseRecipe(source.scraper) ?? builtinRecipeFor(url);
    if (!recipe) {
      console.warn(`No scraping recipe for source ${source.id}; teach it first.`);
      return null;
    }
    const r = await this.enqueue((page) => this.runRecipe(page, url, setNumber, recipe));
    return r.price != null ? { price: r.price, url: r.url } : null;
  }

  /**
   * The rendered HTML of a page (Brickset, LEGO.com) for the set-details,
   * image and minifigure lookups. Null if the page was blocked or failed.
   */
  fetchPageHtml(url: string): Promise<string | null> {
    return this.enqueue(async (page) => {
      if (!(await this.open(page, url, GENERIC_CONSENT))) return null;
      // LEGO.com renders its price client-side; give it a moment to settle.
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      return page.content();
    });
  }

  /** Runs a candidate recipe on a live page and reports what it saw. */
  testRecipe(url: string, setNumber: string, recipe: ScrapeRecipe): Promise<RecipeTestResult> {
    return this.enqueue((page) => this.runRecipe(page, url, setNumber, recipe));
  }

  /**
   * Loads a page and returns a compact HTML excerpt for teaching: scripts,
   * styles and most attributes stripped, centred on the first mention of
   * `focus` (the set number) so the product list is inside the excerpt.
   */
  capturePage(url: string, focus: string): Promise<PageCapture | null> {
    return this.enqueue(async (page) => {
      if (!(await this.open(page, url, GENERIC_CONSENT))) return null;
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      return captureOpenPage(page, focus, { before: 15_000 });
    });
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const ctx = this.context;
    this.context = null;
    this.cookiesSet.clear();
    if (ctx) await (await ctx).close().catch(() => {});
  }

  private enqueue<T>(task: (page: Page) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      const ctx = await this.getContext();
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      try {
        return await task(page);
      } finally {
        this.idleTimer = setTimeout(() => void this.close(), IDLE_CLOSE_MS);
      }
    });
    // Keep the chain alive past a failed task.
    this.queue = run.catch(() => {});
    return run;
  }

  private getContext(): Promise<BrowserContext> {
    if (!this.context) {
      // Loaded on first use, not at startup: Playwright resolves its browser
      // location when the module loads, and the packaged app points
      // PLAYWRIGHT_BROWSERS_PATH at its bundled Chromium only after start.
      this.context = import('playwright')
        .then(({ chromium }) => chromium.launchPersistentContext(this.profileDir, {
          headless: false,
          // Sets Accept-Language and navigator.languages together.
          locale: 'en-US',
          // Real window size rather than an emulated viewport, which is an
          // automation tell in a headed browser.
          viewport: null,
          args: [
            '--window-position=-32000,-32000',
            '--window-size=1280,900',
            '--disable-blink-features=AutomationControlled',
            '--no-first-run',
            '--no-default-browser-check',
            '--mute-audio',
          ],
          // Without this the browser sets navigator.webdriver and shows the
          // "controlled by automated software" bar.
          ignoreDefaultArgs: ['--enable-automation'],
        }))
        .catch((e) => {
          this.context = null;
          throw e;
        });
    }
    return this.context;
  }

  private async runRecipe(page: Page, url: string, setNumber: string, recipe: ScrapeRecipe): Promise<RecipeTestResult> {
    const result: RecipeTestResult = { price: null, url: null, cardsFound: 0, matched: 0, titles: [], blocked: false };

    if (recipe.cookies?.length) {
      const fresh = recipe.cookies.filter((c) => !this.cookiesSet.has(`${c.domain}|${c.name}`));
      if (fresh.length) {
        await page.context().addCookies(fresh.map((c) => ({ ...c, path: '/' })));
        fresh.forEach((c) => this.cookiesSet.add(`${c.domain}|${c.name}`));
      }
    }

    if (!(await this.open(page, url, recipe.consentSelector))) return { ...result, blocked: true };
    await page.waitForSelector(recipe.resultSelector, { timeout: 10_000 }).catch(() => {});

    let cards: ScrapedCard[];
    try {
      cards = await readSearchCards(page, recipe);
    } catch (e) {
      // A taught recipe can carry a selector the browser rejects outright.
      return { ...result, titles: [`selector error: ${String((e as Error)?.message || e).slice(0, 160)}`] };
    }

    const ranked = rankCards(cards, setNumber, recipe);
    result.cardsFound = cards.length;
    result.matched = ranked.length;
    result.titles = cards.slice(0, 8).map((c) => `${c.priceText ?? 'no price'} | ${c.title.slice(0, 100)}`);
    if (process.env.SCRAPER_DEBUG) {
      console.log(`[scraper] ${url}: ${cards.length} cards, ${ranked.length} matched`);
      for (const t of result.titles) console.log(`  ${t}`);
    }
    const absolute = (href: string | null) => {
      if (!href) return null;
      try {
        return new URL(href, page.url()).toString();
      } catch {
        return null;
      }
    };

    let productPages = 0;
    for (const card of ranked) {
      if (card.price != null) return { ...result, price: card.price, url: absolute(card.href) };
      // The best match shows no price in the results: read its product page.
      const link = absolute(card.href);
      if (!recipe.productPagePriceSelector || !link || productPages >= MAX_PRODUCT_PAGES) continue;
      productPages++;
      if (!(await this.open(page, link, recipe.consentSelector))) continue;
      await page.waitForSelector(recipe.productPagePriceSelector, { timeout: 8000 }).catch(() => {});
      // The first match that reads as a price: the first is often an empty placeholder.
      const price = await readPagePrice(page, recipe.productPagePriceSelector, recipe.decimalSeparator);
      if (price != null) return { ...result, price, url: link };
    }
    return result;
  }

  /** Navigates and waits out cookie banners and Cloudflare. False if blocked. */
  private async open(page: Page, url: string, consentSelector?: string): Promise<boolean> {
    await politePause();
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch((e) => {
      console.warn(`Could not load ${url}:`, e?.message || e);
      return null;
    });
    if (!resp) return false;
    // The challenge page is served as a 403, and that stays the response
    // status after it clears, so the status check below must skip it.
    const challenged = /just a moment/i.test(await page.title());
    if (challenged) {
      await page
        .waitForFunction(() => !/just a moment/i.test(document.title), null, { timeout: CHALLENGE_TIMEOUT_MS })
        .catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }
    if (consentSelector) {
      const consent = page.locator(consentSelector).first();
      if (await consent.isVisible().catch(() => false)) await consent.click().catch(() => {});
    }
    const title = await page.title();
    const status = resp.status();
    if (/just a moment/i.test(title) || (await page.locator('form[action*="validateCaptcha"]').count())) {
      console.warn(`Blocked by a bot check on ${new URL(url).hostname}`);
      return false;
    }
    // Amazon answers a flagged browser with a 503 apology page.
    if (!challenged && (status >= 500 || status === 403)) {
      console.warn(`HTTP ${status} from ${new URL(url).hostname}`);
      return false;
    }
    return true;
  }
}
