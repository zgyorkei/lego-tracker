export type Priority = 'low' | 'medium' | 'high';
export type Status = 'planned' | 'ordered';

export interface PriceSource {
  id: string; // e.g., amazon
  name: string; // e.g., Amazon EU
  urlTemplate: string; // e.g., https://amazon.de/s?k={setNumber}
  currency: 'HUF' | 'EUR' | 'USD';
  color: string; // hex color for charts
}

export const DEFAULT_PRICE_SOURCES: PriceSource[] = [
  { id: 'amazon', name: 'Amazon EU', urlTemplate: 'https://www.amazon.de/s?k=lego+{setNumber}', currency: 'EUR', color: '#2563eb' },
  { id: 'arukereso', name: 'Arukereso', urlTemplate: 'https://www.arukereso.hu/CategorySearch.php?st={setNumber}', currency: 'HUF', color: '#10b981' }
];

export interface PriceHistory {
  id?: string;
  date: string;
  exchangeRate: number;
  [key: string]: any; // generic placeholder for source rates, e.g. amazonPriceEur, amazonPriceHuf, arukeresoPriceHuf
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
  minifigures?: { id: string; name: string; image: string | null }[];
  minifiguresStatus?: Record<string, 'wanted' | 'got' | 'none'>;
  marketPrices?: {
    exchangeRate?: number;
    error?: boolean;
    [source: string]: any;
  };
  legoPriceError?: boolean;
}
