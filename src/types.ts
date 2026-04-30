export type Priority = 'low' | 'medium' | 'high';
export type Status = 'planned' | 'ordered';

export interface PriceHistory {
  id?: string;
  date: string;
  amazonPriceEur: number;
  arukeresoPriceHuf: number;
  arukeresoStore: string;
  exchangeRate: number;
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
  quantity?: number;
  createdAt: string;
  updatedAt: string;
  priceHistory?: PriceHistory[];
  isTemporary?: boolean;
  releaseDate?: string | null;
  lastPricesRefreshTime?: number;
  lastLegoPriceRefreshTime?: number;
  hasFetchedLegoInfo?: boolean;
  marketPrices?: {
    amazon?: { priceEur: number; priceHuf: number; url?: string };
    arukereso?: { store: string; priceHuf: number; url?: string };
    exchangeRate?: number;
    error?: boolean;
  };
  legoPriceError?: boolean;
}
