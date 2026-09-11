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
  'HUF', 'EUR', 'USD', 'GBP', 'CHF', 'PLN', 'CZK',
  'DKK', 'SEK', 'NOK', 'RON', 'BGN', 'ISK',
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
}

export const DEFAULT_PRICE_SOURCES: PriceSource[] = [
  { id: 'amazon', name: 'Amazon EU', urlTemplate: 'https://www.amazon.de/s?k=lego+{setNumber}', currency: 'EUR', color: '#2563eb' },
  { id: 'bricklink', name: 'BrickLink', urlTemplate: 'https://www.bricklink.com/v2/catalog/catalogitem.page?S={setNumber}-1', currency: 'EUR', color: '#D4A017' },
  { id: 'arukereso', name: 'Arukereso', urlTemplate: 'https://www.arukereso.hu/CategorySearch.php?st={setNumber}', currency: 'HUF', color: '#10b981' }
];

// Sources that are always present and cannot be edited/removed in the UI. The
// backend distinguishes them by id, so their ids must stay stable.
export const PERMANENT_SOURCE_IDS = ['bricklink'];

// One price reading from a single source, as returned by /api/prices* and
// stored on LegoSet.marketPrices. Previously this shape existed only as an
// `any` index signature, so every read (priceHuf, price, url, store) was
// unchecked and a typo in a field name compiled fine.
export interface PriceQuote {
  price: number;
  priceHuf: number;
  priceEur?: number;
  store?: string;
  url?: string;
}

export interface MarketPrices {
  exchangeRate?: number;
  error?: boolean;
  // Per-source entries keyed by PriceSource.id. Values may be undefined when a
  // source produced no usable price for a set.
  [source: string]: PriceQuote | number | boolean | undefined;
}

/** Narrows a MarketPrices entry to a real quote, skipping the metadata keys. */
export function isPriceQuote(v: unknown): v is PriceQuote {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as PriceQuote).priceHuf === 'number'
  );
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
  lowestPrices?: { sourceName: string, url: string, priceText: string }[];
  legoPriceError?: boolean;
}
