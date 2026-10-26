import { describe, it, expect } from 'vitest';
import { buildPlannedListPurchases, buildPlannedListSets, stableStringify } from './plannedList';
import { LegoSet, PriceSource } from '../types';

const sources: PriceSource[] = [
  { id: 'amazon', name: 'Amazon EU', urlTemplate: 'https://a/{setNumber}', currency: 'EUR', color: '#000' },
  { id: 'arukereso', name: 'Arukereso', urlTemplate: 'https://b/{setNumber}', currency: 'HUF', color: '#000' },
];

const makeSet = (overrides: Partial<LegoSet>): LegoSet => ({
  id: 'id-1',
  userId: 'owner-uid',
  setNumber: '10305',
  name: 'Lion Knights Castle',
  status: 'planned',
  priority: 'high',
  legoPriceHuf: 150000,
  productImage: 'https://img/1.png',
  legoUrl: 'https://lego.com/10305',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
  ...overrides,
});

describe('buildPlannedListSets', () => {
  it('keeps only planned sets and never publishes owner or purchase fields', () => {
    const result = buildPlannedListSets(
      [
        makeSet({}),
        makeSet({ id: 'id-2', setNumber: '75192', status: 'ordered', orderedPriceHuf: 300000 }),
      ],
      sources
    );

    expect(result).toHaveLength(1);
    expect(Object.keys(result[0]).sort()).toEqual([
      'id', 'legoPriceHuf', 'legoUrl', 'name', 'prices', 'priority',
      'productImage', 'quantity', 'releaseDate', 'setNumber',
    ]);
    expect(JSON.stringify(result)).not.toContain('owner-uid');
  });

  it('lists known-source quotes cheapest first and skips metadata keys', () => {
    const [set] = buildPlannedListSets(
      [
        makeSet({
          marketPrices: {
            exchangeRate: 400,
            error: false,
            amazon: { price: 350, priceHuf: 140000, url: 'https://amazon/x' },
            arukereso: { price: 135000, priceHuf: 135000 },
            unknownSource: { price: 1, priceHuf: 1 },
          },
        }),
      ],
      sources
    );

    expect(set.prices).toEqual([
      { sourceId: 'arukereso', sourceName: 'Arukereso', price: 135000, currency: 'HUF', priceHuf: 135000, url: null },
      { sourceId: 'amazon', sourceName: 'Amazon EU', price: 350, currency: 'EUR', priceHuf: 140000, url: 'https://amazon/x' },
    ]);
  });

  it('uses null rather than undefined for absent optional fields', () => {
    const [set] = buildPlannedListSets(
      [makeSet({ legoPriceHuf: 0, legoUrl: null, productImage: null, releaseDate: undefined })],
      sources
    );
    expect(set).toMatchObject({ legoPriceHuf: null, legoUrl: null, productImage: null, releaseDate: null, quantity: 1 });
  });
});

describe('buildPlannedListPurchases', () => {
  it('publishes the sets bought: day, price per set as paid and in forints, and the official price', () => {
    const result = buildPlannedListPurchases([
      makeSet({}),
      makeSet({
        id: 'id-2', setNumber: '75192', name: 'Millennium Falcon', status: 'ordered', quantity: 2,
        orderedDate: '2026-10-20T00:00:00.000Z', orderedPriceHuf: 300000, orderedOriginalPrice: 750, orderedCurrency: 'EUR', legoPriceHuf: 330000,
      }),
      makeSet({ id: 'id-3', setNumber: '40000', status: 'ordered', orderedDate: '2026-10-21T00:00:00.000Z', orderedPriceHuf: 9990, legoPriceHuf: 0 }),
      makeSet({ id: 'id-4', status: 'ordered' }), // no day or price: nothing to book
    ]);
    expect(result).toEqual([
      { id: 'id-2', setNumber: '75192', name: 'Millennium Falcon', quantity: 2, purchasedOn: '2026-10-20', price: 750, currency: 'EUR', priceHuf: 300000, legoPriceHuf: 330000 },
      { id: 'id-3', setNumber: '40000', name: 'Lion Knights Castle', quantity: 1, purchasedOn: '2026-10-21', price: 9990, currency: 'HUF', priceHuf: 9990, legoPriceHuf: null },
    ]);
    expect(JSON.stringify(result)).not.toContain('owner-uid');
  });
});

describe('stableStringify', () => {
  it('is insensitive to object key order', () => {
    expect(stableStringify({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(
      stableStringify({ a: [{ x: 1, y: 2 }], b: 1 })
    );
  });

  it('distinguishes array order', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});
