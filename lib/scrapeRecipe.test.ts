import { describe, it, expect } from 'vitest';
import { parseDisplayPrice, parseRecipe, rankCards, titleMatchScore, type ScrapeRecipe } from './scrapeRecipe.js';

describe('parseDisplayPrice', () => {
  it.each([
    ['53,35 €', ',', 53.35],
    ['1.234,56 €', ',', 1234.56],
    ['14 998 Ft-tól', ',', 14998],
    ['14\u00a0998 Ft', ',', 14998],
    ['€1,234.56', '.', 1234.56],
    // auto: format follows the shop's UI language
    ['€45.89', 'auto', 45.89],
    ['45,89 €', 'auto', 45.89],
    ['1.234 €', 'auto', 1234],
    ['€1,234', 'auto', 1234],
    ['1.234,56 €', 'auto', 1234.56],
    ['HUF33,371.67', 'auto', 33371.67],
    ['33371.67', 'auto', 33371.67],
  ] as const)('%j (%s) -> %d', (text, sep, expected) => {
    expect(parseDisplayPrice(text, sep)).toBeCloseTo(expected);
  });

  it('returns null without a number', () => {
    expect(parseDisplayPrice(' ', 'auto')).toBeNull();
    expect(parseDisplayPrice('See options', ',')).toBeNull();
  });
});

describe('titleMatchScore', () => {
  it.each([
    ['LEGO Icons Bürgermeistervilla 11383', '11383', 2],
    ['LEGO® Creator 3-in-1 - Erdei állatok: Szürke farkas (31393)', '31393', 2],
    ['LEGO City 60488 Chip Truck', '60488', 2],
    ['LEGO Icons 11383 Mayor\'s Villa', '11383', 2],
    ['LEGO Building Set, 10305', '10305', 2],
    ['LED Light Set Compatible with Lego 10305 Lion Knight Castle (Not Model), Remote Control', '10305', 1],
    ['Beline tok Xiaomi Poco F6 (313939)', '31393', 0],
    ['LEGO City Burger-Truck 60404', '60488', 0],
  ] as const)('%j vs %s -> %d', (title, num, expected) => {
    expect(titleMatchScore(title, num)).toBe(expected);
  });
});

describe('rankCards', () => {
  const recipe: ScrapeRecipe = {
    version: 1,
    resultSelector: 'x',
    titleSelector: 'x',
    priceSelector: 'x',
    decimalSeparator: 'auto',
    requireWord: 'lego',
    excludeTitlePattern: 'compatible|\\bled\\b',
  };

  it('picks the cheapest strong match and drops add-ons and unrelated products', () => {
    const ranked = rankCards(
      [
        { title: 'Kanlux Grun 31393', priceText: '3 968 Ft', href: null },
        { title: 'LocoLee Light Kit Compatible with LEGO 31393', priceText: '€21.00', href: null },
        { title: 'LEGO Creator Forest Animals: Wolf 31393', priceText: '€53.35', href: '/a' },
        { title: 'LEGO Creator Wolf 31393', priceText: '€51.00', href: '/b' },
      ],
      '31393',
      recipe
    );
    expect(ranked.map((c) => c.href)).toEqual(['/b', '/a']);
  });

  it('does not fall through to a weaker match when the set itself has no price', () => {
    const ranked = rankCards(
      [
        { title: 'LEGO Building Set, 10305', priceText: null, href: '/set' },
        { title: 'LEGO Knight Figures Falcon Knights, minifigures from set 10305 and others', priceText: '€39.47', href: '/pack' },
      ],
      '10305',
      recipe
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ href: '/set', price: null });
  });
});

describe('parseRecipe', () => {
  const base = { resultSelector: 'div.card', titleSelector: 'h2', priceSelector: '.price', decimalSeparator: ',' };

  it('keeps known fields only', () => {
    expect(parseRecipe({ ...base, onload: 'alert(1)', requireWord: 'lego' })).toEqual({ version: 1, ...base, requireWord: 'lego' });
  });

  it('rejects missing selectors, bad separators and invalid regexes', () => {
    expect(parseRecipe({ ...base, priceSelector: '' })).toBeNull();
    expect(parseRecipe({ ...base, decimalSeparator: ';' })).toBeNull();
    expect(parseRecipe({ ...base, excludeTitlePattern: '(' })).toBeNull();
    expect(parseRecipe(null)).toBeNull();
  });

  it('drops malformed cookies', () => {
    const r = parseRecipe({ ...base, cookies: [{ name: 'i18n-prefs', value: 'EUR', domain: '.amazon.de' }, { name: 'bad name', value: 'x', domain: 'y' }] });
    expect(r?.cookies).toEqual([{ name: 'i18n-prefs', value: 'EUR', domain: '.amazon.de' }]);
  });
});
