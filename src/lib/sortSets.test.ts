import { describe, expect, it } from 'vitest';
import type { LegoSet } from '../types';
import { compareSets } from './sortSets';
import { withSetDates } from './setDates';

// createdAt as Firestore delivers it ({ seconds, nanoseconds }), typed as the
// string the rest of the app expects.
const ts = (iso: string) =>
  ({ seconds: Date.parse(iso) / 1000, nanoseconds: 0 }) as unknown as string;

const set = (id: string, overrides: Partial<LegoSet> = {}): LegoSet =>
  ({
    id,
    setNumber: id,
    name: id,
    status: 'planned',
    priority: 'medium',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as LegoSet;

const order = (sets: LegoSet[], sortBy: string) =>
  [...sets].sort(compareSets(sortBy)).map((s) => s.id);

describe('compareSets', () => {
  const old = set('old', { createdAt: ts('2025-03-01T00:00:00Z') });
  const mid = set('mid', { createdAt: ts('2025-09-01T00:00:00Z') });
  const fresh = set('fresh', { createdAt: ts('2026-10-01T00:00:00Z') });
  // Firestore's own order: newest first.
  const fromFirestore = [fresh, mid, old];

  it('sorts Timestamp-shaped dates oldest first for "Date (Oldest)"', () => {
    expect(order(fromFirestore, 'date-asc')).toEqual(['old', 'mid', 'fresh']);
  });

  it('sorts newest first for "Date (Newest)" and for unknown values', () => {
    expect(order([old, fresh, mid], 'date-desc')).toEqual(['fresh', 'mid', 'old']);
    expect(order([old, fresh, mid], 'whatever')).toEqual(['fresh', 'mid', 'old']);
  });

  it('sorts the same once the dates are normalised to ISO strings', () => {
    const normalised = fromFirestore.map(withSetDates);
    expect(normalised[0].createdAt).toBe('2026-10-01T00:00:00.000Z');
    expect(order(normalised, 'date-asc')).toEqual(['old', 'mid', 'fresh']);
  });

  it('breaks priority ties newest first', () => {
    const sets = [
      set('low', { priority: 'low', createdAt: ts('2026-01-01T00:00:00Z') }),
      set('high-old', { priority: 'high', createdAt: ts('2025-01-01T00:00:00Z') }),
      set('high-new', { priority: 'high', createdAt: ts('2026-05-01T00:00:00Z') }),
    ];
    expect(order(sets, 'priority-desc')).toEqual(['high-new', 'high-old', 'low']);
    expect(order(sets, 'priority-asc')).toEqual(['low', 'high-new', 'high-old']);
  });

  it('puts purchased sets last whatever the sort', () => {
    const bought = set('bought', { status: 'ordered', createdAt: ts('2020-01-01T00:00:00Z') });
    expect(order([bought, fresh, old], 'date-asc')).toEqual(['old', 'fresh', 'bought']);
    expect(order([bought, fresh, old], 'name-asc')).toEqual(['fresh', 'old', 'bought']);
  });

  it('sorts by addedAt where a set has one, else by createdAt', () => {
    // Uploaded later (new createdAt) but added long ago.
    const uploaded = set('uploaded', {
      createdAt: ts('2026-11-01T00:00:00Z'),
      addedAt: '2024-06-01T00:00:00.000Z',
    });
    expect(order([fresh, uploaded, old], 'date-asc')).toEqual(['uploaded', 'old', 'fresh']);
    expect(order([fresh, uploaded, old], 'date-desc')).toEqual(['fresh', 'old', 'uploaded']);
  });

  it('counts a set with no usable date as the oldest', () => {
    const undated = set('undated', { createdAt: undefined as unknown as string });
    expect(order([fresh, undated, old], 'date-asc')).toEqual(['undated', 'old', 'fresh']);
  });

  it('sorts by name and set number both ways', () => {
    const sets = [
      set('b', { name: 'beta', setNumber: '200' }),
      set('a', { name: 'Alpha', setNumber: '1000' }),
      set('c', { name: 'gamma', setNumber: '30' }),
    ];
    expect(order(sets, 'name-asc')).toEqual(['a', 'b', 'c']);
    expect(order(sets, 'name-desc')).toEqual(['c', 'b', 'a']);
    expect(order(sets, 'set-asc')).toEqual(['c', 'b', 'a']);
    expect(order(sets, 'set-desc')).toEqual(['a', 'b', 'c']);
  });
});
