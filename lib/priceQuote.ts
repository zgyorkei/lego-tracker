// One price reading from a single source, as returned by /api/prices* and
// stored on LegoSet.marketPrices. Previously this shape existed only as an
// `any` index signature, so every read (priceHuf, price, url, store) was
// unchecked and a typo in a field name compiled fine.
//
// Here rather than in src/types.ts (which re-exports both) so code outside
// the web app, such as the desktop's Planned Sets route, narrows the same way.
export interface PriceQuote {
  price: number;
  priceHuf: number;
  priceEur?: number;
  store?: string;
  url?: string;
  /** The shop's own title and image for the listing (desktop scraper only). */
  title?: string;
  image?: string;
}

/** Narrows a MarketPrices entry to a real quote, skipping the metadata keys. */
export function isPriceQuote(v: unknown): v is PriceQuote {
  return typeof v === 'object' && v !== null && typeof (v as PriceQuote).priceHuf === 'number';
}
