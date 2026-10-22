import { DEFAULT_PRICE_SOURCES, PERMANENT_SOURCE_IDS, PriceSource } from '../types';
import { parseRecipe } from '../../lib/scrapeRecipe';
import { builtinRecipeFor } from '../../lib/builtinRecipes';

// Ensures the permanent BrickLink source is always present and bricklink-new is
// removed (migration for existing users). Idempotent.
export const ensureBrickLinkSources = (sources: PriceSource[]): PriceSource[] => {
  const result = sources.filter(s => s.id !== 'bricklink-new');
  const amazonIdx = result.findIndex(s => s.id === 'amazon');
  let insertAt = amazonIdx >= 0 ? amazonIdx + 1 : 0;
  for (const id of PERMANENT_SOURCE_IDS) {
    const existingIdx = result.findIndex(s => s.id === id);
    if (existingIdx === -1) {
      const def = DEFAULT_PRICE_SOURCES.find(s => s.id === id);
      if (def) {
        result.splice(insertAt, 0, def);
        insertAt++;
      }
    } else {
      // Permanent sources are locked, so keep them canonical (e.g. picks up
      // URL-template changes) rather than leaving stale stored values.
      const def = DEFAULT_PRICE_SOURCES.find(s => s.id === id);
      if (def) result[existingIdx] = { ...def };
      insertAt = existingIdx + 1;
    }
  }
  return result;
};

/**
 * Keeps only the PriceSource fields, dropping anything undefined. Firestore
 * rejects undefined values outright, and sources read back from older
 * localStorage entries are not guaranteed to be clean.
 */
export const toStoredSource = (s: PriceSource): PriceSource => ({
  id: s.id,
  name: s.name,
  urlTemplate: s.urlTemplate,
  currency: s.currency,
  color: s.color,
  // Validated before it is stored: a recipe is untrusted model output.
  ...(parseRecipe(s.scraper) ? { scraper: parseRecipe(s.scraper)! } : {}),
});

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

/** How the desktop app will read a source: its own recipe, a built-in one, or not at all. */
export const scrapingStatus = (s: PriceSource): ScrapingStatus =>
  parseRecipe(s.scraper) ? 'taught' : builtinRecipeFor(s.urlTemplate.replace('{setNumber}', '0')) ? 'built-in' : 'not-taught';
