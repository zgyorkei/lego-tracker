import { LegoSet, PriceSource, isPriceQuote } from '../types';
import { formatPrice as formatPriceUtil, ExchangeRates } from './currency';

export interface LowestPrice {
  sourceName: string;
  url: string;
  priceText: string;
  costValueHuf: number;
}

/**
 * Picks the cheapest market prices for a set, resolved against the supplied
 * price sources and formatted for display.
 *
 * GiftRegistryDialog and RegistryView each had a near-verbatim copy of this,
 * which had already drifted: they used different locales and different source
 * lists. Keeping one implementation means a registry and the card it came from
 * cannot disagree about the price.
 */
export function getLowestPrices(
  set: Pick<LegoSet, 'marketPrices' | 'setNumber' | 'name'>,
  priceSources: PriceSource[],
  displayCurrency: string,
  exchangeRates: ExchangeRates,
  limit = 2
): LowestPrice[] {
  if (!set.marketPrices) return [];

  const available: LowestPrice[] = [];

  for (const [sourceId, quote] of Object.entries(set.marketPrices)) {
    if (sourceId === 'error' || sourceId === 'exchangeRate') continue;
    if (!isPriceQuote(quote)) continue;

    const source = priceSources.find(ps => ps.id === sourceId);
    if (!source) continue;

    const costValueHuf = quote.priceHuf;
    if (!(costValueHuf > 0)) continue;

    available.push({
      sourceName: source.name,
      url:
        quote.url ||
        source.urlTemplate
          .replace('{setNumber}', set.setNumber)
          .replace('{name}', encodeURIComponent(set.name)),
      priceText: formatPriceUtil(costValueHuf, displayCurrency, exchangeRates),
      costValueHuf,
    });
  }

  available.sort((a, b) => a.costValueHuf - b.costValueHuf);
  return available.slice(0, limit);
}
