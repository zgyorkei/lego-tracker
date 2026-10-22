import type { ScrapeRecipe } from './scrapeRecipe.js';

// Hand-written recipes for the default price sources, keyed by host. Taught
// recipes (stored on the source itself) take precedence; these cover the
// defaults so a fresh install works before anything has been taught.
//
// Both were built from live pages on 2026-10-22.

// Third-party add-ons that put the set number in their title, in both UI
// languages. Deliberately avoids bare words like "stand", which genuine set
// titles use ("... Exit Portal Stand as Room Decoration").
const AMAZON_ACCESSORIES =
  'kompatibel|compatible|\\bled\\b|light(?:ing)? (?:kit|set)|licht|beleuchtung|' +
  'display (?:case|cabinet|box)|vitrine|acryl|acrylic|wall mount|halterung|' +
  'aufkleber|sticker|not included|nicht im lieferumfang|\\bfor lego\\b|\\bfür lego\\b';

const RECIPES: Record<string, ScrapeRecipe> = {
  'amazon.de': {
    version: 1,
    resultSelector: 'div[data-component-type="s-search-result"]',
    // The English layout splits the brand ("LEGO") and the product title into
    // two h2s; both are read and joined. The wrapper around them also holds
    // the "Sponsored" disclosure text, so it is not used directly.
    titleSelector: 'h2',
    priceSelector: '.a-price:not(.a-text-price) .a-offscreen',
    linkSelector: 'a.a-link-normal.s-no-outline, h2 a, a:has(> h2)',
    decimalSeparator: 'auto',
    requireWord: 'lego',
    excludeTitlePattern: AMAZON_ACCESSORIES,
    // Used when the set's card shows no price. Only the buy-box price counts:
    // "Other sellers, New & Used, from ..." mixes in used offers, so a
    // listing without a buy box is reported as having no price. Selectors
    // shared with the budget-tracker app's working Amazon lookup.
    productPagePriceSelector:
      '#twister-plus-price-data-price, #corePrice_feature_div .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen, #apex_desktop .a-offscreen, #price_inside_buybox',
    consentSelector: '#sp-cc-accept',
    // Amazon converts to the visitor's local currency (HUF from Hungary);
    // this preference keeps prices in the source's configured EUR.
    cookies: [{ name: 'i18n-prefs', value: 'EUR', domain: '.amazon.de' }],
  },
  'arukereso.hu': {
    version: 1,
    resultSelector: 'div.product-box',
    titleSelector: 'h2',
    // "14 998 Ft-tól" is the lowest offer across the listed shops.
    priceSelector: 'a.price',
    linkSelector: 'h2 a',
    decimalSeparator: ',',
    requireWord: 'lego',
  },
};

/** The built-in recipe for a source URL's host, matching subdomains too. */
export function builtinRecipeFor(url: string): ScrapeRecipe | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [domain, recipe] of Object.entries(RECIPES)) {
    if (host === domain || host.endsWith('.' + domain)) return recipe;
  }
  return null;
}
