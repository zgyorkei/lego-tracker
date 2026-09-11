import { describe, it, expect } from 'vitest';
import { getLowestPrices } from './prices';
import { PriceSource, LegoSet } from '../types';

const sources: PriceSource[] = [
  { id: 'amazon', name: 'Amazon EU', urlTemplate: 'https://a.test/{setNumber}', currency: 'EUR', color: '#000' },
  { id: 'bricklink', name: 'BrickLink', urlTemplate: 'https://b.test/{setNumber}', currency: 'EUR', color: '#111' },
  { id: 'arukereso', name: 'Arukereso', urlTemplate: 'https://c.test/{setNumber}', currency: 'HUF', color: '#222' },
];

const makeSet = (marketPrices: LegoSet['marketPrices']) =>
  ({ setNumber: '10305', name: 'Lion Knights Castle', marketPrices }) as LegoSet;

describe('getLowestPrices', () => {
  it('returns an empty list when there are no market prices', () => {
    expect(getLowestPrices(makeSet(undefined), sources, 'HUF', null)).toEqual([]);
  });

  it('sorts ascending by HUF cost and caps the result', () => {
    const result = getLowestPrices(
      makeSet({
        amazon: { price: 30, priceHuf: 12000 },
        bricklink: { price: 10, priceHuf: 4000 },
        arukereso: { price: 8000, priceHuf: 8000 },
      }),
      sources,
      'HUF',
      null
    );
    expect(result.map(r => r.sourceName)).toEqual(['BrickLink', 'Arukereso']);
    expect(result[0].costValueHuf).toBe(4000);
  });

  it('honours a custom limit', () => {
    const result = getLowestPrices(
      makeSet({
        amazon: { price: 30, priceHuf: 12000 },
        bricklink: { price: 10, priceHuf: 4000 },
        arukereso: { price: 8000, priceHuf: 8000 },
      }),
      sources,
      'HUF',
      null,
      3
    );
    expect(result).toHaveLength(3);
  });

  // The exchangeRate and error keys share the marketPrices object with real
  // quotes; treating them as quotes previously produced NaN rows.
  it('skips the exchangeRate and error metadata keys', () => {
    const result = getLowestPrices(
      makeSet({ exchangeRate: 400, error: true, bricklink: { price: 10, priceHuf: 4000 } }),
      sources,
      'HUF',
      null
    );
    expect(result).toHaveLength(1);
    expect(result[0].sourceName).toBe('BrickLink');
  });

  it('skips sources that are not in the configured list', () => {
    const result = getLowestPrices(
      makeSet({ 'some-removed-source': { price: 1, priceHuf: 100 } }),
      sources,
      'HUF',
      null
    );
    expect(result).toEqual([]);
  });

  it('skips non-positive and malformed quotes', () => {
    const result = getLowestPrices(
      makeSet({
        amazon: { price: 0, priceHuf: 0 },
        bricklink: { price: 10, priceHuf: -5 },
        arukereso: undefined,
      }),
      sources,
      'HUF',
      null
    );
    expect(result).toEqual([]);
  });

  it('falls back to the source urlTemplate when the quote has no url', () => {
    const [first] = getLowestPrices(
      makeSet({ bricklink: { price: 10, priceHuf: 4000 } }),
      sources,
      'HUF',
      null
    );
    expect(first.url).toBe('https://b.test/10305');
  });

  it('prefers the url supplied on the quote', () => {
    const [first] = getLowestPrices(
      makeSet({ bricklink: { price: 10, priceHuf: 4000, url: 'https://direct.test/x' } }),
      sources,
      'HUF',
      null
    );
    expect(first.url).toBe('https://direct.test/x');
  });

  it('formats priceText in the requested display currency', () => {
    const [first] = getLowestPrices(
      makeSet({ bricklink: { price: 10, priceHuf: 4000 } }),
      sources,
      'EUR',
      { HUF: 400, EUR: 1 }
    );
    expect(first.priceText).toBe('€10.00');
  });
});
