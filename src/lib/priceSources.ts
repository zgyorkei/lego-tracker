import type { PriceSource } from '../types';
import { parseRecipe } from '../../lib/scrapeRecipe';
import { builtinRecipeFor } from '../../lib/builtinRecipes';
import { BUILT_IN_LOOKUP_IDS } from '../../lib/priceSources';

// The permanent BrickLink source and the defaults live in lib/, so the desktop's
// Planned Sets route publishes the same shops the page shows (IDEA-7dfb29).
export { ensureBrickLinkSources, shownPriceSources } from '../../lib/priceSources';

/** The source's well-formed offeredDefaults marker, empty when it has none. */
const offeredDefaultsOf = (s: PriceSource): string[] =>
  Array.isArray(s.offeredDefaults)
    ? s.offeredDefaults.filter((id): id is string => typeof id === 'string' && id.length <= 40)
    : [];

/**
 * Keeps only the PriceSource fields, dropping anything undefined. Firestore
 * rejects undefined values outright, and sources read back from older
 * localStorage entries are not guaranteed to be clean.
 */
export const toStoredSource = (s: PriceSource): PriceSource => {
  const offered = offeredDefaultsOf(s);
  return {
    id: s.id,
    name: s.name,
    urlTemplate: s.urlTemplate,
    currency: s.currency,
    color: s.color,
    // Validated before it is stored: a recipe is untrusted model output.
    ...(parseRecipe(s.scraper) ? { scraper: parseRecipe(s.scraper)! } : {}),
    // The marker of the defaults a list was already given (on BrickLink only):
    // dropping it would give a removed kocka.hu back on the next load.
    ...(offered.length > 0 ? { offeredDefaults: offered } : {}),
  };
};

const hostOf = (urlTemplate: string): string => {
  try {
    return new URL(urlTemplate.replace('{setNumber}', '0')).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/**
 * Applies a URL-template edit. A taught recipe describes one shop's pages, so
 * it is dropped when the template moves to a different host; edits within
 * the same shop (a query parameter, say) keep it.
 */
export const withUrlTemplate = (s: PriceSource, urlTemplate: string): PriceSource => {
  if (!s.scraper || hostOf(urlTemplate) === hostOf(s.urlTemplate)) return { ...s, urlTemplate };
  const { scraper: _dropped, ...rest } = s;
  return { ...rest, urlTemplate };
};

export type ScrapingStatus = 'taught' | 'built-in' | 'not-taught';

/**
 * How the desktop app will read a source: its own recipe, a built-in one (a
 * built-in recipe, or a lookup the server runs by id, as for kocka.hu), or not
 * at all.
 */
export const scrapingStatus = (s: PriceSource): ScrapingStatus =>
  BUILT_IN_LOOKUP_IDS.includes(s.id)
    ? 'built-in'
    : parseRecipe(s.scraper)
      ? 'taught'
      : builtinRecipeFor(s.urlTemplate.replace('{setNumber}', '0'))
        ? 'built-in'
        : 'not-taught';
