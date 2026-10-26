import { describe, it, expect } from 'vitest';
import { identityFromQuotes, isPlaceholderName, mergeLookupName, nameFromListing } from './setIdentity';
import type { PriceSource } from '../types';

const sources: PriceSource[] = [
  { id: 'amazon', name: 'Amazon EU', urlTemplate: 'https://www.amazon.de/s?k=lego+{setNumber}', currency: 'EUR', color: '#000' },
  { id: 'arukereso', name: 'Arukereso', urlTemplate: 'https://www.arukereso.hu/CategorySearch.php?st={setNumber}', currency: 'HUF', color: '#000' },
];

describe('isPlaceholderName', () => {
  it.each(['', '{?}', '633412-1', '633412', 'Lego Set 633412', 'LEGO SET 633412'])('%j is a placeholder', (n) => {
    expect(isPlaceholderName(n, '633412')).toBe(true);
  });
  it.each(['Gaming kontroller állvány', 'Forest Animals: Gray Wolf'])('%j is a real name', (n) => {
    expect(isPlaceholderName(n, '633412')).toBe(false);
  });
});

describe('nameFromListing', () => {
  it.each([
    ['LEGO® 633412 - LEGO® Gaming kontroller állvány (633412)', '633412', 'Gaming kontroller állvány'],
    [
      "LEGO Creator Forest Animals: Wolf Toy - Animal Figure with 2 Building Options - Falcon or Raccoon - Birthday Gift - 31393",
      '31393',
      'Creator Forest Animals: Wolf Toy',
    ],
    ['LEGO® Creator 3-in-1 - Erdei állatok: Szürke farkas (31393)', '31393', 'Creator 3-in-1 - Erdei állatok: Szürke farkas'],
    ['LEGO Icons Bürgermeistervilla 11383', '11383', 'Icons Bürgermeistervilla'],
  ])('%j -> %j', (title, num, expected) => {
    expect(nameFromListing(title, num)).toBe(expected);
  });

  it('returns null when nothing but brand and number remain', () => {
    expect(nameFromListing('LEGO® 633412 (633412)', '633412')).toBeNull();
  });
});

describe('identityFromQuotes', () => {
  const prices = {
    exchangeRate: 365,
    arukereso: {
      price: 9990,
      priceHuf: 9990,
      title: 'LEGO® 633412 - LEGO® Gaming kontroller állvány (633412)',
      image: 'https://p1.akcdn.net/thumb/1637711674.lego-633412.jpg',
    },
  };

  it('fills a placeholder name and a missing image from the listing', () => {
    expect(identityFromQuotes({ setNumber: '633412', name: '633412-1', productImage: null }, prices, sources)).toEqual({
      name: 'Gaming kontroller állvány',
      productImage: 'https://p1.akcdn.net/thumb/1637711674.lego-633412.jpg',
    });
  });

  it('never replaces a real name or an existing image', () => {
    expect(
      identityFromQuotes({ setNumber: '633412', name: 'Controller Stand', productImage: 'https://lego.com/x.png' }, prices, sources)
    ).toEqual({});
  });

  it('ignores listings without a title or a usable image', () => {
    const bare = { arukereso: { price: 1, priceHuf: 1, image: 'data:image/gif;base64,x' } };
    expect(identityFromQuotes({ setNumber: '633412', name: '{?}', productImage: null }, bare, sources)).toEqual({});
  });
});

describe('mergeLookupName', () => {
  it('keeps a real name when the lookup only has a placeholder', () => {
    expect(mergeLookupName('633412-1', { setNumber: '633412', name: 'Gaming kontroller állvány' })).toBe('Gaming kontroller állvány');
  });
  it('takes the lookup name otherwise', () => {
    expect(mergeLookupName('Dragon Ball: Shenron & Goku', { setNumber: '11390', name: '{?}' })).toBe('Dragon Ball: Shenron & Goku');
    expect(mergeLookupName(null, { setNumber: '11390', name: 'Old' })).toBe('Old');
  });
});
