import { describe, it, expect } from 'vitest';
import { scrapingStatus, toStoredSource, withUrlTemplate } from './priceSources';
import type { PriceSource } from '../types';

const recipe = { version: 1 as const, resultSelector: 'div.p', titleSelector: 'h2', priceSelector: '.price', decimalSeparator: ',' as const };
const shop: PriceSource = {
  id: 'shop',
  name: 'Shop',
  urlTemplate: 'https://shop.example/search?q={setNumber}',
  currency: 'HUF',
  color: '#000000',
  scraper: recipe,
};

describe('withUrlTemplate', () => {
  it('keeps the recipe for an edit within the same shop', () => {
    expect(withUrlTemplate(shop, 'https://shop.example/search?q=lego+{setNumber}').scraper).toEqual(recipe);
  });

  it('drops the recipe when the template moves to another host', () => {
    const moved = withUrlTemplate(shop, 'https://other.example/?s={setNumber}');
    expect(moved.urlTemplate).toBe('https://other.example/?s={setNumber}');
    expect('scraper' in moved).toBe(false);
  });
});

describe('toStoredSource', () => {
  it('keeps a valid recipe and drops an invalid one', () => {
    expect(toStoredSource(shop).scraper).toEqual(recipe);
    const bad = toStoredSource({ ...shop, scraper: { ...recipe, priceSelector: '' } });
    expect('scraper' in bad).toBe(false);
  });

  it('never carries undefined fields, which Firestore rejects', () => {
    const { scraper: _s, ...plain } = shop;
    expect(Object.values(toStoredSource(plain)).includes(undefined)).toBe(false);
  });
});

describe('scrapingStatus', () => {
  it('distinguishes taught, built-in and untaught sources', () => {
    expect(scrapingStatus(shop)).toBe('taught');
    expect(scrapingStatus({ ...shop, scraper: undefined, urlTemplate: 'https://www.amazon.de/s?k=lego+{setNumber}' })).toBe('built-in');
    expect(scrapingStatus({ ...shop, scraper: undefined })).toBe('not-taught');
  });
});
