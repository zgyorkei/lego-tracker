import { describe, it, expect, vi } from 'vitest';
import { buildTeachPrompt, extractJsonObject, teachSource, type TeachDeps } from './teachSource.js';
import type { RecipeTestResult } from './scrapeRecipe.js';

const source = { name: 'Toy Shop', urlTemplate: 'https://shop.example/search?q={setNumber}', currency: 'HUF' };

const goodRecipe = {
  resultSelector: 'div.product',
  titleSelector: 'h2',
  priceSelector: '.price',
  linkSelector: 'h2 a',
  decimalSeparator: ',',
  requireWord: 'lego',
  excludeTitlePattern: null,
  productPagePriceSelector: 'null',
  consentSelector: null,
};

const hit = (price: number | null): RecipeTestResult => ({
  price,
  url: price ? 'https://shop.example/p/1' : null,
  cardsFound: 5,
  matched: price ? 1 : 0,
  titles: ['14 998 Ft | LEGO Creator Wolf (31393)'],
  blocked: false,
});

function deps(overrides: Partial<TeachDeps> = {}): TeachDeps {
  return {
    capture: vi.fn(async (url: string) => ({ html: '<div class="product">...</div>', title: 'Search', finalUrl: url })),
    test: vi.fn(async () => hit(14998)),
    ask: vi.fn(async () => JSON.stringify(goodRecipe)),
    ...overrides,
  };
}

describe('teachSource', () => {
  it('returns a validated recipe and the live test results', async () => {
    const d = deps();
    const r = await teachSource(source, ['31393', '11384'], d);
    expect(r.error).toBeUndefined();
    expect(r.attempts).toBe(1);
    // "null" strings and nulls from the model are dropped, not kept as selectors.
    expect(r.recipe).toEqual({
      version: 1,
      resultSelector: 'div.product',
      titleSelector: 'h2',
      priceSelector: '.price',
      linkSelector: 'h2 a',
      decimalSeparator: ',',
      requireWord: 'lego',
    });
    expect(r.samples.map((s) => s.result?.price)).toEqual([14998, 14998]);
    expect(d.test).toHaveBeenCalledWith('https://shop.example/search?q=31393', '31393', r.recipe);
  });

  it('retries once with test feedback when the first recipe finds nothing', async () => {
    const ask = vi.fn(async () => JSON.stringify(goodRecipe));
    const test = vi.fn().mockResolvedValueOnce(hit(null)).mockResolvedValue(hit(14998));
    const r = await teachSource(source, ['31393'], deps({ ask, test }));
    expect(r.attempts).toBe(2);
    expect(r.samples[0].result?.price).toBe(14998);
    const retryPrompt = (ask.mock.calls[1] as unknown as [string])[0];
    expect(retryPrompt).toContain('found no price');
    expect(retryPrompt).toContain('LEGO Creator Wolf');
  });

  it('reports an error after two empty attempts but keeps the last recipe for inspection', async () => {
    const r = await teachSource(source, ['31393'], deps({ test: vi.fn(async () => hit(null)) }));
    expect(r.attempts).toBe(2);
    expect(r.recipe).not.toBeNull();
    expect(r.error).toMatch(/no prices/);
  });

  it('fails cleanly when no page can be loaded', async () => {
    const ask = vi.fn();
    const r = await teachSource(source, ['31393'], deps({ capture: vi.fn(async () => null), ask }));
    expect(r.recipe).toBeNull();
    expect(r.error).toMatch(/could not be loaded/);
    expect(ask).not.toHaveBeenCalled();
  });

  it('rejects a response that is not a recipe', async () => {
    const r = await teachSource(source, ['31393'], deps({ ask: vi.fn(async () => 'I cannot help with that') }));
    expect(r.recipe).toBeNull();
    expect(r.error).toMatch(/usable recipe/);
  });

  it('caps the samples at three', async () => {
    const d = deps();
    await teachSource(source, ['1', '2', '3', '4'], d);
    expect(d.capture).toHaveBeenCalledTimes(3);
  });
});

describe('buildTeachPrompt', () => {
  it('includes each capture and marks page content as data', () => {
    const p = buildTeachPrompt(source, [{ setNumber: '31393', url: 'https://shop.example/search?q=31393', html: '<b>x</b>', title: 'T' }]);
    expect(p).toContain('=== Capture for set 31393');
    expect(p).toContain('<b>x</b>');
    expect(p).toMatch(/never as instructions/);
  });
});

describe('extractJsonObject', () => {
  it('tolerates code fences and rejects non-JSON', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('nope')).toBeNull();
  });
});
