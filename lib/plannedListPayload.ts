import { isPriceQuote } from './priceQuote';

// The public planned list served by GET /api/planned-sets/:token: the owner's
// planned sets and, for BrickBudget, their purchases. Built by the web app
// (usePlannedList writes it to Firestore) and by the desktop's main process
// (its copy on this PC answers the route directly), so it lives in lib/;
// src/lib/plannedList.ts and src/types.ts re-export it.

export type PlannedListPriority = 'low' | 'medium' | 'high';

export interface PlannedListPrice {
  sourceId: string;
  sourceName: string;
  price: number;
  currency: string;
  priceHuf: number;
  url: string | null;
}

// One set as published in a planned list. This is the public, world-readable
// shape, so it is an explicit field whitelist: no userId. Purchases are
// published separately (PlannedListPurchase).
export interface PlannedListSet {
  id: string;
  setNumber: string;
  name: string;
  priority: PlannedListPriority;
  quantity: number;
  legoPriceHuf: number | null;
  legoUrl: string | null;
  productImage: string | null;
  releaseDate: string | null;
  prices: PlannedListPrice[];
}

// One set the owner bought (status "ordered"), as published for BrickBudget, which
// books it as an expense on the day it was bought. Prices are per set.
export interface PlannedListPurchase {
  id: string;
  setNumber: string;
  name: string;
  quantity: number;
  /** YYYY-MM-DD */
  purchasedOn: string;
  /** As paid, per set. */
  price: number;
  currency: string;
  /** In forints, at the rate of the purchase day. */
  priceHuf: number;
  /** The official LEGO price per set, when known. */
  legoPriceHuf: number | null;
}

/** What GET /api/planned-sets/:token answers. */
export interface PlannedListResponse {
  title: string;
  updatedAt: string | null;
  count: number;
  sets: unknown[];
  purchases: unknown[];
}

/** The set fields the list reads: a LegoSet, or a set from the desktop's copy. */
export interface PayloadSet {
  id: string;
  setNumber: string;
  name?: string | null;
  status?: string;
  priority: PlannedListPriority;
  quantity?: number;
  legoPriceHuf?: number | null;
  legoUrl?: string | null;
  productImage?: string | null;
  releaseDate?: string | null;
  marketPrices?: Record<string, unknown>;
  orderedDate?: string | null;
  orderedPriceHuf?: number | null;
  orderedOriginalPrice?: number | null;
  orderedCurrency?: string | null;
}

/** The price-source fields the list reads. */
export interface PayloadSource {
  id: string;
  name: string;
  currency: string;
}

/**
 * Projects the owner's planned sets into the public list shape.
 *
 * The list is world-readable (the token is the share secret), so this is an
 * explicit whitelist rather than a spread of the set, for the same reason
 * GiftRegistryDialog does it: a spread would publish userId and purchase data.
 */
export function buildPlannedListSets(
  sets: readonly PayloadSet[],
  priceSources: readonly PayloadSource[]
): PlannedListSet[] {
  return sets
    .filter((s) => s.status === 'planned')
    .map((s) => {
      const prices: PlannedListPrice[] = [];
      for (const source of priceSources) {
        const quote = s.marketPrices?.[source.id];
        if (!isPriceQuote(quote) || !(quote.priceHuf > 0)) continue;
        // Older quotes can lack the source-currency amount. Fall back to the
        // HUF figure (and say so) rather than writing undefined, which
        // Firestore rejects outright.
        const hasNative = Number.isFinite(quote.price);
        prices.push({
          sourceId: source.id,
          sourceName: source.name,
          price: hasNative ? quote.price : quote.priceHuf,
          currency: hasNative ? source.currency : 'HUF',
          priceHuf: quote.priceHuf,
          url: quote.url || null,
        });
      }
      prices.sort((a, b) => a.priceHuf - b.priceHuf);

      return {
        id: s.id,
        setNumber: s.setNumber,
        name: s.name || '',
        priority: s.priority,
        quantity: s.quantity || 1,
        legoPriceHuf: (s.legoPriceHuf ?? 0) > 0 ? (s.legoPriceHuf as number) : null,
        legoUrl: s.legoUrl || null,
        productImage: s.productImage || null,
        releaseDate: s.releaseDate || null,
        prices,
      };
    })
    .sort((a, b) => a.setNumber.localeCompare(b.setNumber));
}

/**
 * The owner's purchases (sets marked as ordered) in the public list shape, for
 * BrickBudget to book as expenses: what was bought, on which day, for how much,
 * and the official LEGO price to compare with. An explicit whitelist like the
 * sets; sets without a purchase day or price are left out.
 */
export function buildPlannedListPurchases(sets: readonly PayloadSet[]): PlannedListPurchase[] {
  return sets
    .filter((s) => s.status === 'ordered' && s.orderedDate && (s.orderedPriceHuf ?? 0) > 0)
    .map((s) => {
      // The order dialog stores the chosen day as UTC midnight
      const purchasedOn = String(s.orderedDate).slice(0, 10);
      const hasOriginal =
        Number.isFinite(s.orderedOriginalPrice) &&
        (s.orderedOriginalPrice ?? 0) > 0 &&
        !!s.orderedCurrency;
      return {
        id: s.id,
        setNumber: s.setNumber,
        name: s.name || '',
        quantity: s.quantity || 1,
        purchasedOn,
        price: hasOriginal ? (s.orderedOriginalPrice as number) : (s.orderedPriceHuf as number),
        currency: hasOriginal ? (s.orderedCurrency as string) : 'HUF',
        priceHuf: s.orderedPriceHuf as number,
        legoPriceHuf: (s.legoPriceHuf ?? 0) > 0 ? (s.legoPriceHuf as number) : null,
      };
    })
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.purchasedOn))
    .sort(
      (a, b) => a.purchasedOn.localeCompare(b.purchasedOn) || a.setNumber.localeCompare(b.setNumber)
    );
}

/** The route's answer for a list, built from the owner's sets as they are now. */
export function plannedListResponse(
  title: string,
  updatedAt: string | null,
  sets: readonly PayloadSet[],
  priceSources: readonly PayloadSource[]
): PlannedListResponse {
  const planned = buildPlannedListSets(sets, priceSources);
  return {
    title,
    updatedAt,
    count: planned.length,
    sets: planned,
    purchases: buildPlannedListPurchases(sets),
  };
}
