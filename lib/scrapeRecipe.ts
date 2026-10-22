// ---------------------------------------------------------------------------
// Declarative scraping recipes for the desktop app.
//
// A recipe tells the desktop scraper how to read one shop's search-results
// page: which elements are product cards, where the title and price sit, and
// how numbers are written. Recipes are data, never code. The desktop app asks
// Gemini to write one when a source is added ("teaching"), and running
// AI-written JavaScript would let a malicious shop page steer the model into
// producing code that then runs on the user's machine. A recipe can only
// select elements and read their text.
//
// Pure helpers live here (not in desktop/) so they are unit-tested by the
// main test suite and shared with the server's recipe validation.
// ---------------------------------------------------------------------------

export interface ScrapeCookie {
  name: string;
  value: string;
  domain: string;
}

export type DecimalSeparator = ',' | '.' | 'auto';

export interface ScrapeRecipe {
  version: 1;
  /** CSS selector matching each product card on the search page. */
  resultSelector: string;
  /**
   * Within a card: the product title. Every match is joined with spaces, so a
   * layout that splits brand and title ("LEGO" + "Creator ... 31393") reads
   * as one title.
   */
  titleSelector: string;
  /** Within a card: the current price (not a struck-through list price). */
  priceSelector: string;
  /** Within a card: the product link, used for the product-page fallback. */
  linkSelector?: string;
  /**
   * How the shop writes decimals: "1.234,56" uses ",", "1,234.56" uses ".".
   * "auto" reads it off each price, for shops whose format follows the UI
   * language (Amazon switches between "45,89 €" and "€45.89").
   */
  decimalSeparator: DecimalSeparator;
  /** Case-insensitive word every genuine title contains, e.g. "lego". */
  requireWord?: string;
  /** Case-insensitive regex source; matching titles are skipped (accessories). */
  excludeTitlePattern?: string;
  /** On the product page: the price, for cards that show none in the results. */
  productPagePriceSelector?: string;
  /** Cookie-banner accept button, clicked if present. */
  consentSelector?: string;
  /** Cookies set before the first visit, e.g. a display-currency preference. */
  cookies?: ScrapeCookie[];
}

/**
 * What a recipe produced on one live page. The counts and titles are what
 * teaching feeds back to Gemini when a recipe finds nothing.
 */
export interface RecipeTestResult {
  price: number | null;
  url: string | null;
  /** Elements matched by resultSelector. */
  cardsFound: number;
  /** Cards that passed the title rules (set number, requireWord, exclusions). */
  matched: number;
  /** The first few card titles as read, for diagnosing selector problems. */
  titles: string[];
  /** The page was a bot check or an error page. */
  blocked: boolean;
}

/** One product card as read off the page, before any matching. */
export interface ScrapedCard {
  title: string;
  priceText: string | null;
  href: string | null;
}

const MAX_SELECTOR_LEN = 300;

const isSelector = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_SELECTOR_LEN;

/**
 * Validates an untrusted recipe (from Gemini or Firestore) and returns a clean
 * copy with only known fields, or null. Regex patterns are compiled here so a
 * bad one is rejected up front rather than throwing mid-scrape.
 */
export function parseRecipe(raw: unknown): ScrapeRecipe | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isSelector(r.resultSelector) || !isSelector(r.titleSelector) || !isSelector(r.priceSelector)) {
    return null;
  }
  if (r.decimalSeparator !== ',' && r.decimalSeparator !== '.' && r.decimalSeparator !== 'auto') return null;

  const recipe: ScrapeRecipe = {
    version: 1,
    resultSelector: r.resultSelector,
    titleSelector: r.titleSelector,
    priceSelector: r.priceSelector,
    decimalSeparator: r.decimalSeparator,
  };
  if (isSelector(r.linkSelector)) recipe.linkSelector = r.linkSelector;
  if (isSelector(r.productPagePriceSelector)) recipe.productPagePriceSelector = r.productPagePriceSelector;
  if (isSelector(r.consentSelector)) recipe.consentSelector = r.consentSelector;
  if (typeof r.requireWord === 'string' && /^[\p{L}\p{N}]{1,40}$/u.test(r.requireWord)) {
    recipe.requireWord = r.requireWord;
  }
  if (typeof r.excludeTitlePattern === 'string' && r.excludeTitlePattern.length <= 500) {
    try {
      new RegExp(r.excludeTitlePattern, 'i');
      recipe.excludeTitlePattern = r.excludeTitlePattern;
    } catch {
      return null;
    }
  }
  if (Array.isArray(r.cookies)) {
    const cookies = r.cookies
      .filter(
        (c): c is ScrapeCookie =>
          !!c &&
          typeof c.name === 'string' && /^[\w.-]{1,64}$/.test(c.name) &&
          typeof c.value === 'string' && c.value.length <= 200 &&
          typeof c.domain === 'string' && /^\.?[a-z0-9.-]{3,100}$/i.test(c.domain)
      )
      .slice(0, 5);
    if (cookies.length) recipe.cookies = cookies;
  }
  return recipe;
}

/**
 * Reads a price out of display text such as "1.234,56 €", "13 990 Ft" or
 * "US $1,234.56". Returns null if no number is present.
 */
export function parseDisplayPrice(text: string, decimalSeparator: DecimalSeparator): number | null {
  // Thin and non-breaking spaces are common thousands separators.
  const compact = text.replace(/[\s\u00a0\u202f]/g, '');
  const m = compact.match(/\d[\d.,]*/);
  if (!m) return null;
  let num = m[0].replace(/[.,]$/, '');
  let sep = decimalSeparator;
  if (sep === 'auto') {
    // The last separator is the decimal one only if exactly two digits
    // follow it; "1.234" and "1,234" are thousands, "45,89" is cents.
    const last = Math.max(num.lastIndexOf(','), num.lastIndexOf('.'));
    const isDecimal = last >= 0 && num.length - last - 1 === 2;
    sep = isDecimal ? (num[last] as ',' | '.') : num.includes(',') ? '.' : ',';
  }
  if (sep === ',') {
    num = num.replace(/\./g, '').replace(',', '.');
  } else {
    num = num.replace(/,/g, '');
  }
  const value = parseFloat(num);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 2 = the set number sits where shops put the product code of the set itself:
 * closing the title ("LEGO Icons Bürgermeistervilla 11383") or among its
 * first four words ("LEGO City 60488 Chip Truck"). 1 = elsewhere, typical of
 * bundles and add-ons that merely reference the set. 0 = absent.
 */
export function titleMatchScore(title: string, setNumber: string): number {
  const t = title.trim();
  const re = new RegExp(`(^|\\D)${setNumber}(\\D|$)`);
  if (!re.test(t)) return 0;
  const tail = new RegExp(`(^|\\D)${setNumber}[\\s)\\]|.,:;-]*$`);
  if (tail.test(t)) return 2;
  const lead = t.split(/\s+/).slice(0, 4).map((w) => w.replace(/[^\p{L}\p{N}-]/gu, ''));
  return lead.includes(setNumber) ? 2 : 1;
}

export interface PickedCard extends ScrapedCard {
  price: number | null;
  score: number;
}

/**
 * Filters cards to genuine listings of the set, keeps only the strongest title
 * match present, and orders those cheapest first. Cards with no visible price
 * come last so the caller can try their product page.
 *
 * Weaker matches are dropped rather than ranked lower: when the set's own
 * listing has no price (Amazon's "See options"), falling through to the next
 * card used to report a minifigure pack that merely mentions the set number.
 * No price is better than the wrong product's price.
 */
export function rankCards(cards: ScrapedCard[], setNumber: string, recipe: ScrapeRecipe): PickedCard[] {
  const exclude = recipe.excludeTitlePattern ? new RegExp(recipe.excludeTitlePattern, 'i') : null;
  const word = recipe.requireWord ? new RegExp(`(^|[^\\p{L}])${recipe.requireWord}([^\\p{L}]|$)`, 'iu') : null;

  const matched = cards
    .map((c) => ({
      ...c,
      score: titleMatchScore(c.title, setNumber),
      price: c.priceText ? parseDisplayPrice(c.priceText, recipe.decimalSeparator) : null,
    }))
    .filter((c) => c.score > 0 && (!word || word.test(c.title)) && (!exclude || !exclude.test(c.title)));

  const best = Math.max(0, ...matched.map((c) => c.score));
  return matched
    .filter((c) => c.score === best)
    .sort((a, b) => {
      if (a.price == null) return b.price == null ? 0 : 1;
      if (b.price == null) return -1;
      return a.price - b.price;
    });
}
