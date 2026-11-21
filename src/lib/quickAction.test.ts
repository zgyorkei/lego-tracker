import { describe, expect, it } from 'vitest';
import { readQuickAction, withoutQuickAction } from './quickAction';

describe('quick actions', () => {
  it('reads the three actions the manifest opens', () => {
    expect(readQuickAction('?add=set')).toEqual({ add: true, filter: null, refreshPrices: false });
    expect(readQuickAction('?filter=planned&buy=pick')).toEqual({
      add: false,
      filter: 'planned',
      refreshPrices: false,
    });
    expect(readQuickAction('?filter=planned&refresh=prices')).toEqual({
      add: false,
      filter: 'planned',
      refreshPrices: true,
    });
  });

  it('is null for an ordinary open or an unknown value', () => {
    expect(readQuickAction('')).toBeNull();
    expect(readQuickAction('?add=other&filter=all&refresh=x')).toBeNull();
  });

  it('takes the action out of the address and keeps the rest', () => {
    expect(withoutQuickAction('https://x.test/?filter=planned&refresh=prices')).toBe('/');
    expect(withoutQuickAction('https://x.test/registry/abc?add=set&utm=1#top')).toBe(
      '/registry/abc?utm=1#top'
    );
  });
});
