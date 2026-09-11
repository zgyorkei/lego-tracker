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

// One locale for the whole app. GiftRegistryDialog and RegistryView each used
// to inline their own Intl.NumberFormat with 'hu-HU' while this helper used
// 'en-US', so the same amount rendered differently depending on the screen.
const LOCALE = 'en-US';

/** Formats an amount that is already in `currency` (no conversion). */
export function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'HUF' ? 0 : 2,
  }).format(amount);
}

/** Formats a HUF amount as a localized string in the chosen display currency. */
export function formatPrice(
  priceHuf: number,
  displayCurrency: string,
  exchangeRates: ExchangeRates
): string {
  if (displayCurrency === 'HUF' || !exchangeRates) {
    return `${Math.round(priceHuf).toLocaleString(LOCALE)} HUF`;
  }
  return formatAmount(convertFromHuf(priceHuf, displayCurrency, exchangeRates), displayCurrency);
}
