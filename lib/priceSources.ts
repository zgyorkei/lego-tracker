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
];

// Sources that are always present and cannot be edited/removed in the UI. The
// backend distinguishes them by id, so their ids must stay stable.
export const PERMANENT_SOURCE_IDS = ['bricklink'];

// Ensures the permanent BrickLink source is always present and bricklink-new is
// removed (migration for existing users). Idempotent.
export const ensureBrickLinkSources = <S extends { id: string }>(
  sources: readonly S[]
): (S | DefaultPriceSource)[] => {
  const result: (S | DefaultPriceSource)[] = sources.filter((s) => s.id !== 'bricklink-new');
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
  return result;
};

/** The shops shown for a stored list: BrickLink always, the defaults when none is stored. */
export const shownPriceSources = <S extends { id: string }>(
  stored: readonly S[] | null
): (S | DefaultPriceSource)[] => ensureBrickLinkSources<S | DefaultPriceSource>(stored ?? DEFAULT_PRICE_SOURCES);
