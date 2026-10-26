import { LegoSet, PlannedListPrice, PlannedListPurchase, PlannedListSet, PriceSource, isPriceQuote } from '../types';
import { publicAppUrl } from './appUrl';

export const PLANNED_LISTS_COLLECTION = 'plannedLists';

// Same public origin the gift registry links use (publicAppUrl). The API URL
// is handed to another application, so it must point at the deployment, not
// at the desktop app's localhost.
export const plannedListApiUrl = (token: string): string =>
  `${publicAppUrl()}/api/planned-sets/${token}`;

/** 24 hex chars from the CSPRNG. The token is the only access control. */
export function generatePlannedListToken(): string {
  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Projects the owner's planned sets into the public list shape.
 *
 * The list doc is world-readable (the token is the share secret), so this is
 * an explicit whitelist rather than a spread of LegoSet, for the same reason
 * GiftRegistryDialog does it: a spread would publish userId and purchase data.
 */
export function buildPlannedListSets(
  sets: LegoSet[],
  priceSources: PriceSource[]
): PlannedListSet[] {
  return sets
    .filter(s => s.status === 'planned')
    .map(s => {
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
        legoPriceHuf: s.legoPriceHuf > 0 ? s.legoPriceHuf : null,
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
export function buildPlannedListPurchases(sets: LegoSet[]): PlannedListPurchase[] {
  return sets
    .filter(s => s.status === 'ordered' && s.orderedDate && (s.orderedPriceHuf ?? 0) > 0)
    .map(s => {
      // The order dialog stores the chosen day as UTC midnight
      const purchasedOn = String(s.orderedDate).slice(0, 10);
      const hasOriginal = Number.isFinite(s.orderedOriginalPrice) && (s.orderedOriginalPrice ?? 0) > 0 && !!s.orderedCurrency;
      return {
        id: s.id,
        setNumber: s.setNumber,
        name: s.name || '',
        quantity: s.quantity || 1,
        purchasedOn,
        price: hasOriginal ? (s.orderedOriginalPrice as number) : (s.orderedPriceHuf as number),
        currency: hasOriginal ? (s.orderedCurrency as string) : 'HUF',
        priceHuf: s.orderedPriceHuf as number,
        legoPriceHuf: s.legoPriceHuf > 0 ? s.legoPriceHuf : null,
      };
    })
    .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.purchasedOn))
    .sort((a, b) => a.purchasedOn.localeCompare(b.purchasedOn) || a.setNumber.localeCompare(b.setNumber));
}

/**
 * JSON with object keys sorted, for change detection. Firestore does not
 * preserve map key order, so comparing plain JSON.stringify output of the
 * stored doc against a freshly built payload would always see a difference
 * and rewrite the doc on every snapshot.
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
