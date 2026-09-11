import { describe, it, expect } from 'vitest';
import { convertFromHuf, formatPrice, formatAmount } from './currency';

const rates = { HUF: 400, EUR: 1, USD: 1.1, GBP: 0.85 };

describe('convertFromHuf', () => {
  it('returns the input unchanged when the display currency is HUF', () => {
    expect(convertFromHuf(4000, 'HUF', rates)).toBe(4000);
  });

  it('falls back to the raw HUF value when rates are unavailable', () => {
    expect(convertFromHuf(4000, 'EUR', null)).toBe(4000);
    expect(convertFromHuf(4000, 'EUR', undefined)).toBe(4000);
  });

  it('converts HUF to the target currency via EUR', () => {
    expect(convertFromHuf(4000, 'EUR', rates)).toBeCloseTo(10);
    expect(convertFromHuf(4000, 'USD', rates)).toBeCloseTo(11);
  });

  it('treats an unknown currency as a 1:1 rate against EUR', () => {
    expect(convertFromHuf(4000, 'XYZ', rates)).toBeCloseTo(10);
  });
});

describe('formatPrice', () => {
  it('uses a plain HUF suffix rather than Intl for HUF', () => {
    expect(formatPrice(4000, 'HUF', rates)).toBe('4,000 HUF');
  });

  it('rounds HUF rather than emitting fractional forint', () => {
    expect(formatPrice(4000.6, 'HUF', rates)).toBe('4,001 HUF');
  });

  it('formats converted values as currency', () => {
    expect(formatPrice(4000, 'EUR', rates)).toBe('€10.00');
  });

  // Regression: GiftRegistryDialog and RegistryView each used to inline their
  // own hu-HU formatter while this helper used en-US, so the same amount
  // rendered two different ways depending on the screen.
  it('is locale-stable across call sites', () => {
    expect(formatPrice(4000, 'EUR', rates)).toBe(formatAmount(10, 'EUR'));
  });
});
