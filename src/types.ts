import type { ScrapeRecipe } from '../lib/scrapeRecipe';
import type { PriceQuote } from '../lib/priceQuote';
import type { PlannedListPurchase, PlannedListSet } from '../lib/plannedListPayload';

// The quote guard and the public planned-list shapes live in lib/, so the
// desktop's main process (its local Planned Sets route) shares them; the web
// app imports them from here as before.
export { isPriceQuote, type PriceQuote } from '../lib/priceQuote';
export type {
  PlannedListPrice,
  PlannedListPurchase,
  PlannedListSet,
} from '../lib/plannedListPayload';

export type Priority = 'low' | 'medium' | 'high';
export type Status = 'planned' | 'ordered';
export type MinifigureStatus = 'wanted' | 'got' | 'none';

export interface Minifigure {
  id: string;
  name: string;
  image: string | null;
}

// Currencies the price-source editor offers. The union was previously just
// HUF/EUR/USD while the dropdown listed all 13, so selecting any of the other
// ten wrote a value the type said was impossible. Single-sourced here so the
// <option> list and the type cannot drift apart again.
export const SUPPORTED_CURRENCIES = [
  'HUF',
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'PLN',
  'CZK',
  'DKK',
  'SEK',
  'NOK',
  'RON',
  'BGN',
  'ISK',
] as const;

export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const isSupportedCurrency = (v: string): v is Currency =>
  (SUPPORTED_CURRENCIES as readonly string[]).includes(v);

export interface PriceSource {
  id: string; // e.g., amazon
  name: string; // e.g., Amazon EU
  urlTemplate: string; // e.g., https://amazon.de/s?k={setNumber}
  currency: Currency;
  color: string; // hex color for charts
  /** How the desktop app reads this shop, written when the source is taught. */
  scraper?: ScrapeRecipe;
  /**
   * Only on the BrickLink entry: the defaults added after launch that this
   * list was already given once (lib/priceSources.ts ensureBrickLinkSources).
   */
  offeredDefaults?: string[];
}

// The default shops, the permanent BrickLink id and the sources the server
// looks up by id (lib/priceSources.ts, shared with the desktop's Planned Sets
// route).
export {
  BUILT_IN_LOOKUP_IDS,
  DEFAULT_PRICE_SOURCES,
  PERMANENT_SOURCE_IDS,
} from '../lib/priceSources';

export interface MarketPrices {
  exchangeRate?: number;
  error?: boolean;
  // Per-source entries keyed by PriceSource.id. Values may be undefined when a
  // source produced no usable price for a set.
  [source: string]: PriceQuote | number | boolean | undefined;
}

export interface PriceHistory {
  id?: string;
  date: string;
  exchangeRate: number;
  // Per-source columns, e.g. amazonPriceHuf / arukeresoPriceHuf. Narrowed to
  // the value types actually written rather than a blanket any.
  [key: string]: number | string | undefined;
}

export interface Registry {
  id: string; // the token
  userId: string;
  title: string;
  sets: LegoSet[];
  createdAt: string;
}

export interface PlannedList {
  id: string; // the token, also the last path segment of the API URL
  userId: string;
  title: string;
  sets: PlannedListSet[];
  /** Absent on lists written before purchases were published. */
  purchases?: PlannedListPurchase[];
  createdAt: string;
  updatedAt: string;
}

export interface RegistryReservation {
  id: string; // combination of registryId and setId, or just setId
  setId: string;
  reservedBy: string; // Name of the visitor
  createdAt: string;
}

export interface LegoSet {
  id: string;
  userId: string;
  setNumber: string;
  name: string;
  status: Status;
  priority: Priority;
  legoPriceHuf: number;
  productImage: string | null;
  legoUrl: string | null;
  orderedDate?: string;
  orderedPriceHuf?: number;
  orderedOriginalPrice?: number;
  orderedCurrency?: string;
  quantity?: number;
  createdAt: string;
  updatedAt: string;
  /**
   * When the set was added to the collection, written once on create. Unlike
   * createdAt (the server's time of the write, which the rules pin), it keeps
   * the original date when a collection is uploaded later. Sets from before it
   * existed have none: sort by `addedAt ?? createdAt`.
   */
  addedAt?: string;
  priceHistory?: PriceHistory[];
  isTemporary?: boolean;
  releaseDate?: string | null;
  lastPricesRefreshTime?: number;
  lastLegoPriceRefreshTime?: number;
  hasFetchedLegoInfo?: boolean;
  minifigures?: Minifigure[];
  minifiguresStatus?: Record<string, MinifigureStatus>;
  marketPrices?: MarketPrices;
  prices?: Record<string, number>;
  lowestPrices?: { sourceName: string; url: string; priceText: string }[];
  legoPriceError?: boolean;
  /**
   * Planned sets only, derived on this device (src/lib/retiring.ts): the date the
   * app first saw the set on LEGO.com's last-chance page, while it is still
   * there. Never written to a backend.
   */
  retiringSince?: string;
}
