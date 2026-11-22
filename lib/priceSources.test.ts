import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRICE_SOURCES,
  MAX_PRICE_SOURCES,
  ensureBrickLinkSources,
  shownPriceSources,
} from './priceSources';

type Source = { id: string; name: string; offeredDefaults?: string[] };

const ids = (list: readonly { id: string }[]) => list.map((s) => s.id);
const bricklinkOf = (list: readonly { id: string }[]) =>
  list.find((s) => s.id === 'bricklink') as { offeredDefaults?: string[] } | undefined;

// A list stored before kocka.hu was a default: no kocka, no marker.
const OLD_LIST: Source[] = [
  { id: 'amazon', name: 'Amazon EU' },
  { id: 'bricklink', name: 'BrickLink' },
  { id: 'arukereso', name: 'Arukereso' },
];

describe('kocka.hu as a default', () => {
  it('is in the defaults, in forints', () => {
    const kocka = DEFAULT_PRICE_SOURCES.find((s) => s.id === 'kocka');
    expect(kocka).toMatchObject({ name: 'kocka.hu', currency: 'HUF' });
    expect(ids(shownPriceSources(null))).toEqual(['amazon', 'bricklink', 'arukereso', 'kocka']);
  });

  it('is given to an existing list once, at its end, changing nothing else', () => {
    const custom: Source = { id: 'shop', name: 'My shop' };
    const next = ensureBrickLinkSources<Source>([...OLD_LIST, custom]);
    expect(ids(next)).toEqual(['amazon', 'bricklink', 'arukereso', 'shop', 'kocka']);
    expect(next.find((s) => s.id === 'shop')).toBe(custom);
    expect(bricklinkOf(next)?.offeredDefaults).toEqual(['kocka']);
  });

  it('is idempotent and never doubles kocka.hu', () => {
    const once = ensureBrickLinkSources<Source>(OLD_LIST);
    const twice = ensureBrickLinkSources(once);
    expect(twice).toEqual(once);
    expect(ids(twice).filter((id) => id === 'kocka')).toHaveLength(1);
  });

  it('keeps a kocka.hu the list already has where it is', () => {
    const list: Source[] = [{ id: 'kocka', name: 'kocka.hu' }, ...OLD_LIST];
    const next = ensureBrickLinkSources<Source>(list);
    expect(ids(next)).toEqual(['kocka', 'amazon', 'bricklink', 'arukereso']);
    expect(bricklinkOf(next)?.offeredDefaults).toEqual(['kocka']);
  });

  it('stays removed once the user removes it', () => {
    const given = ensureBrickLinkSources<Source>(OLD_LIST);
    const removed = given.filter((s) => s.id !== 'kocka');
    const next = ensureBrickLinkSources(removed);
    expect(ids(next)).toEqual(['amazon', 'bricklink', 'arukereso']);
  });

  it('comes back with Reset Defaults', () => {
    expect(ids(ensureBrickLinkSources(DEFAULT_PRICE_SOURCES))).toContain('kocka');
  });

  it('waits while the list is full, then is given once there is room', () => {
    const full: Source[] = [
      ...OLD_LIST,
      ...Array.from({ length: MAX_PRICE_SOURCES - OLD_LIST.length }, (_, i) => ({
        id: `shop-${i}`,
        name: `Shop ${i}`,
      })),
    ];
    const asFull = ensureBrickLinkSources<Source>(full);
    expect(asFull).toHaveLength(MAX_PRICE_SOURCES);
    expect(ids(asFull)).not.toContain('kocka');
    expect(bricklinkOf(asFull)?.offeredDefaults).toBeUndefined();

    const withRoom = ensureBrickLinkSources(asFull.filter((s) => s.id !== 'shop-0'));
    expect(ids(withRoom).at(-1)).toBe('kocka');
    expect(withRoom).toHaveLength(MAX_PRICE_SOURCES);
  });

  it('keeps the BrickLink entry canonical apart from the marker', () => {
    const stale: Source[] = [{ id: 'bricklink', name: 'Renamed' }];
    const [bricklink] = ensureBrickLinkSources<Source>(stale);
    const def = DEFAULT_PRICE_SOURCES.find((s) => s.id === 'bricklink');
    expect(bricklink).toEqual({ ...def, offeredDefaults: ['kocka'] });
  });

  it('ignores a malformed marker', () => {
    const odd = [
      { id: 'bricklink', name: 'BrickLink', offeredDefaults: 'kocka' as unknown as string[] },
    ];
    expect(ids(ensureBrickLinkSources<Source>(odd))).toEqual(['bricklink', 'kocka']);
  });
});
