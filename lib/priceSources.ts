// The shops the app shows: the default list and the permanent BrickLink source,
// put back when a stored list lacks it. Shared by the page (src/types.ts and
// src/lib/priceSources.ts re-export it) and by the desktop's main process, whose
// local Planned Sets route publishes the prices of the same shops the page shows
// (desktop/src/store/localStore.ts plannedListResponse), so it lives in lib/.

/** A default shop: the PriceSource fields (src/types.ts) the defaults carry. */
export interface DefaultPriceSource {
  id: string;
  name: string;
  urlTemplate: string;
  currency: 'EUR' | 'HUF';
  color: string;
  /**
   * Only on the BrickLink entry: the ids of the defaults added after launch
   * (ADDED_DEFAULT_IDS) that this list has already been given once. The list
   * is stored as one array (userSettings/{uid}.priceSources, whose rules allow
   * no other key), so the marker rides on the one entry that is always there.
   */
  offeredDefaults?: string[];
}

export const DEFAULT_PRICE_SOURCES: DefaultPriceSource[] = [
  {
    id: 'amazon',
    name: 'Amazon EU',
    urlTemplate: 'https://www.amazon.de/s?k=lego+{setNumber}',
    currency: 'EUR',
    color: '#2563eb',
  },
  {
    id: 'bricklink',
    name: 'BrickLink',
    urlTemplate: 'https://www.bricklink.com/v2/catalog/catalogitem.page?S={setNumber}-1',
    currency: 'EUR',
    color: '#D4A017',
  },
  {
    id: 'arukereso',
    name: 'Arukereso',
    urlTemplate: 'https://www.arukereso.hu/CategorySearch.php?st={setNumber}',
    currency: 'HUF',
    color: '#10b981',
  },
  {
    // kocka.hu's search is a POST form with a CSRF token (lib/kocka.ts), so it
    // has no search URL to template: the server looks it up by id and the
    // quote carries the product page. The template only names the shop.
    id: 'kocka',
    name: 'kocka.hu',
    urlTemplate: 'https://kocka.hu/kezdolap',
    currency: 'HUF',
    color: '#e11d48',
  },
];

// Sources that are always present and cannot be edited/removed in the UI. The
// backend distinguishes them by id, so their ids must stay stable.
export const PERMANENT_SOURCE_IDS = ['bricklink'];

// Sources the server prices by id with its own lookup, not from the URL
// template, so the editor locks their fields and offers no teaching. kocka.hu
// can still be removed, unlike BrickLink.
export const BUILT_IN_LOOKUP_IDS = ['bricklink', 'kocka'];

// Defaults added after users already had lists: each is given to an existing
// list once. A source the user removes stays removed, as amazon and arukereso
// do; Reset Defaults brings it back.
export const ADDED_DEFAULT_IDS = ['kocka'];

/** The most sources a list holds (the editor's limit, checked in lib/data/ops.ts). */
export const MAX_PRICE_SOURCES = 15;

const offeredDefaultsOf = (source: unknown): string[] => {
  const v = (source as { offeredDefaults?: unknown } | undefined)?.offeredDefaults;
  return Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string') : [];
};

// Ensures the permanent BrickLink source is always present and bricklink-new is
// removed (migration for existing users), and gives a list each default added
// since (ADDED_DEFAULT_IDS) once, unless the list is full. Idempotent.
export const ensureBrickLinkSources = <S extends { id: string }>(
  sources: readonly S[]
): (S | DefaultPriceSource)[] => {
  const result: (S | DefaultPriceSource)[] = sources.filter((s) => s.id !== 'bricklink-new');
  const offered = offeredDefaultsOf(result.find((s) => s.id === 'bricklink'));
  const amazonIdx = result.findIndex((s) => s.id === 'amazon');
  let insertAt = amazonIdx >= 0 ? amazonIdx + 1 : 0;
  for (const id of PERMANENT_SOURCE_IDS) {
    const existingIdx = result.findIndex((s) => s.id === id);
    if (existingIdx === -1) {
      const def = DEFAULT_PRICE_SOURCES.find((s) => s.id === id);
      if (def) {
        result.splice(insertAt, 0, def);
        insertAt++;
      }
    } else {
      // Permanent sources are locked, so keep them canonical (e.g. picks up
      // URL-template changes) rather than leaving stale stored values.
      const def = DEFAULT_PRICE_SOURCES.find((s) => s.id === id);
      if (def) result[existingIdx] = { ...def };
      insertAt = existingIdx + 1;
    }
  }
  for (const id of ADDED_DEFAULT_IDS) {
    if (offered.includes(id)) continue;
    if (!result.some((s) => s.id === id)) {
      const def = DEFAULT_PRICE_SOURCES.find((s) => s.id === id);
      // A full list is left alone and asked again once it has room.
      if (!def || result.length >= MAX_PRICE_SOURCES) continue;
      result.push({ ...def });
    }
    offered.push(id);
  }
  const bricklinkIdx = result.findIndex((s) => s.id === 'bricklink');
  if (bricklinkIdx >= 0 && offered.length > 0) {
    result[bricklinkIdx] = { ...result[bricklinkIdx], offeredDefaults: offered };
  }
  return result;
};

/** The shops shown for a stored list: BrickLink always, the defaults when none is stored. */
export const shownPriceSources = <S extends { id: string }>(
  stored: readonly S[] | null
): (S | DefaultPriceSource)[] =>
  ensureBrickLinkSources<S | DefaultPriceSource>(stored ?? DEFAULT_PRICE_SOURCES);
