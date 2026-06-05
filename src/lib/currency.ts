// Shared currency conversion/formatting used by App, SetCard and the registry
// views. Previously this logic was duplicated verbatim in several components.

export type ExchangeRates = Record<string, number> | null | undefined;

/**
 * Converts a HUF amount into the display currency. Returns the original HUF
 * value when the display currency is HUF or rates are unavailable.
 */
export function convertFromHuf(
  priceHuf: number,
  displayCurrency: string,
  exchangeRates: ExchangeRates
): number {
  if (displayCurrency === 'HUF' || !exchangeRates) return priceHuf;
  const priceEur = priceHuf / exchangeRates.HUF;
  const targetRate = exchangeRates[displayCurrency] || 1;
  return priceEur * targetRate;
}

/** Formats a HUF amount as a localized string in the chosen display currency. */
export function formatPrice(
  priceHuf: number,
  displayCurrency: string,
  exchangeRates: ExchangeRates
): string {
  if (displayCurrency === 'HUF' || !exchangeRates) {
    return `${priceHuf.toLocaleString()} HUF`;
  }
  const finalPrice = convertFromHuf(priceHuf, displayCurrency, exchangeRates);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: displayCurrency,
    maximumFractionDigits: displayCurrency === 'HUF' ? 0 : 2,
  }).format(finalPrice);
}
