import { describe, it, expect } from 'vitest';
import {
  isBlockedHost,
  isPrivateIp,
  isAllowedImageUrl,
  assertSafeOutboundUrl,
  mapWithConcurrency,
  isValidSetNumber,
  isValidIsoDate,
  normalizeBrickLinkCurrency,
  convertToHuf,
  decodeFirestoreFields,
  isValidPlannedListToken,
  isIncompleteLotDescription,
  pickCheapestNewLot,
  parseBricksetSetPage,
  parseLegoProductPage,
  parseBricksetMinifigs,
  parseBricksetSeriesSearch,
} from './server-api.js';

describe('page parsers', () => {
  it('reads a Brickset set page', () => {
    const html = `<h1>31393 Grey Wolf</h1><a class="highslide"><img src="https://images.brickset.com/sets/images/31393-1.jpg"></a>
      <dl><dt>RRP</dt><dd>$49.99, €44.99</dd></dl>`;
    expect(parseBricksetSetPage(html)).toEqual({
      name: 'Grey Wolf',
      image: 'https://images.brickset.com/sets/images/31393-1.jpg',
      priceEur: 44.99,
    });
  });

  it('reads a LEGO.com price from the price span, then meta, then JSON-LD', () => {
    expect(parseLegoProductPage('<h1>Farkas</h1><span data-test="product-price">14 999 Ft</span>').priceHuf).toBe(14999);
    expect(parseLegoProductPage('<meta property="product:price:amount" content="15999">').priceHuf).toBe(15999);
    const ld = `<h1 data-test="product-overview-name">Grey Wolf</h1><meta property="og:image" content="https://x/img.png">
      <script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"16999","priceCurrency":"HUF"}}</script>`;
    expect(parseLegoProductPage(ld)).toEqual({ name: 'Grey Wolf', priceHuf: 16999, image: 'https://x/img.png' });
  });

  it('reads Brickset minifigure lists', () => {
    const inSet = `<article class="set"><h1><a href="/minifigs/sw1234/cobb-vanth">Cobb <b>Vanth</b></a></h1><img src="https://img/fig.jpg"></article>`;
    expect(parseBricksetMinifigs(inSet)).toEqual([{ id: 'sw1234', name: 'Cobb Vanth', image: 'https://img/fig.jpg' }]);

    const series = `<div class="set"><h1><a href="/sets/71055-2/Bat"><span>71055-2:</span>71055: Bat Costume Fan</a></h1><img src="https://img/small/a.jpg"></div>
      <div class="set"><h1><a href="/sets/71055-0/Box">71055: Sealed Box</a></h1></div>`;
    expect(parseBricksetSeriesSearch(series, '71055')).toEqual([
      { id: '71055-2', name: 'Bat Costume Fan', image: 'https://img/images/a.jpg' },
    ]);
  });
});

describe('isIncompleteLotDescription', () => {
  // Real descriptions from 75437's New listings.
  it.each([
    'no minifigures or their accessories',
    'Speeder only.',
    'Great condition (no box)\nNo Minifigures ONLY speeder',
    'Without minifigs',
    'Ohne Minifiguren',
    'Incomplete, 3 parts missing',
  ])('flags %j', (desc) => {
    expect(isIncompleteLotDescription(desc)).toBe(true);
  });

  it.each(['', 'Sealed, box has minor dents', 'Only opened for inventory', 'no box, bags sealed', 'New, complete with instructions'])(
    'keeps %j',
    (desc) => {
      expect(isIncompleteLotDescription(desc)).toBe(false);
    }
  );
});

describe('pickCheapestNewLot', () => {
  // HUF per EUR and USD per EUR, in the frankfurter from=EUR shape.
  const rates = { HUF: 400, USD: 1.1, EUR: 1 };

  it('skips incomplete, unstated, used and mislabelled lots', () => {
    const best = pickCheapestNewLot(
      [
        { codeNew: 'N', codeComplete: 'B', strDesc: 'no minifigures', mDisplaySalePrice: 'HUF 2,031.27' },
        { codeNew: 'N', codeComplete: 'C', strDesc: 'No Minifigures ONLY speeder', mDisplaySalePrice: 'HUF 2,566.22' },
        { codeNew: 'N', codeComplete: 'X', strDesc: '', mDisplaySalePrice: 'HUF 2,600.00' },
        { codeNew: 'U', codeComplete: 'C', strDesc: '', mDisplaySalePrice: 'HUF 2,700.00' },
        { codeNew: 'N', codeComplete: 'S', strDesc: '', mDisplaySalePrice: 'HUF 6,802.56' },
        { codeNew: 'N', codeComplete: 'C', strDesc: 'no box', mDisplaySalePrice: 'HUF 7,100.00' },
      ],
      rates
    );
    expect(best).toEqual({ huf: 6802.56, completeness: 'S' });
  });

  it('compares across display currencies in HUF', () => {
    const best = pickCheapestNewLot(
      [
        { codeNew: 'N', codeComplete: 'S', mDisplaySalePrice: 'EUR 20.00' }, // 8000 HUF
        { codeNew: 'N', codeComplete: 'C', mDisplaySalePrice: 'US $11.00' }, // 4000 HUF
      ],
      rates
    );
    expect(best?.completeness).toBe('C');
    expect(best?.huf).toBeCloseTo(4000);
  });

  it('returns null when nothing qualifies', () => {
    expect(pickCheapestNewLot([{ codeNew: 'N', codeComplete: 'B', mDisplaySalePrice: 'HUF 1.00' }], rates)).toBeNull();
    expect(pickCheapestNewLot([], rates)).toBeNull();
  });
});

describe('isValidPlannedListToken', () => {
  it('accepts a generated 24-char hex token', () => {
    expect(isValidPlannedListToken('0123456789abcdef01234567')).toBe(true);
  });

  it.each(['', 'short', '../../sets/abc0123456789', 'a'.repeat(129), 'abc%2F0123456789abcd'])(
    'rejects %s',
    (token) => {
      expect(isValidPlannedListToken(token)).toBe(false);
    }
  );
});

describe('decodeFirestoreFields', () => {
  it('decodes nested REST values into plain JSON', () => {
    const decoded = decodeFirestoreFields({
      title: { stringValue: 'Planned sets' },
      sets: {
        arrayValue: {
          values: [
            {
              mapValue: {
                fields: {
                  setNumber: { stringValue: '10305' },
                  quantity: { integerValue: '2' },
                  legoPriceHuf: { doubleValue: 129990.5 },
                  releaseDate: { nullValue: null },
                  prices: { arrayValue: {} },
                },
              },
            },
          ],
        },
      },
      flag: { booleanValue: true },
    });

    expect(decoded).toEqual({
      title: 'Planned sets',
      sets: [
        { setNumber: '10305', quantity: 2, legoPriceHuf: 129990.5, releaseDate: null, prices: [] },
      ],
      flag: true,
    });
  });

  it('returns an empty object for missing fields', () => {
    expect(decodeFirestoreFields(undefined)).toEqual({});
  });
});

describe('isBlockedHost', () => {
  it.each([
    'localhost',
    'foo.localhost',
    '127.0.0.1',
    '10.1.2.3',
    '192.168.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '169.254.169.254', // cloud metadata
    '0.0.0.0',
    '::1',
  ])('blocks %s', (host) => {
    expect(isBlockedHost(host)).toBe(true);
  });

  it.each(['bricklink.com', 'www.lego.com', '8.8.8.8', '172.32.0.1', '11.0.0.1'])(
    'allows %s',
    (host) => {
      expect(isBlockedHost(host)).toBe(false);
    }
  );
});

describe('isPrivateIp', () => {
  it('treats IPv4-mapped private addresses as private', () => {
    expect(isPrivateIp('::ffff:127.0.0.1', 6)).toBe(true);
    expect(isPrivateIp('::ffff:10.0.0.1', 6)).toBe(true);
  });

  it('blocks IPv6 loopback, unique-local and link-local', () => {
    expect(isPrivateIp('::1', 6)).toBe(true);
    expect(isPrivateIp('fd00::1', 6)).toBe(true);
    expect(isPrivateIp('fe80::1', 6)).toBe(true);
  });

  it('allows public IPv6', () => {
    expect(isPrivateIp('2606:4700:4700::1111', 6)).toBe(false);
  });
});

describe('isAllowedImageUrl', () => {
  it('allows the image CDN hosts and their subdomains', () => {
    expect(isAllowedImageUrl(new URL('https://www.lego.com/a.jpg'))).toBe(true);
    expect(isAllowedImageUrl(new URL('https://img.brickset.com/a.jpg'))).toBe(true);
  });

  it('rejects look-alike hosts that merely end with the suffix text', () => {
    expect(isAllowedImageUrl(new URL('https://evil-lego.com/a.jpg'))).toBe(false);
    expect(isAllowedImageUrl(new URL('https://lego.com.evil.net/a.jpg'))).toBe(false);
  });

  it('rejects non-HTTP protocols', () => {
    expect(isAllowedImageUrl(new URL('file:///etc/passwd'))).toBe(false);
  });
});

describe('assertSafeOutboundUrl', () => {
  it('rejects non-HTTP schemes', async () => {
    await expect(assertSafeOutboundUrl('file:///etc/passwd')).rejects.toThrow(/protocol/i);
    await expect(assertSafeOutboundUrl('gopher://x/1')).rejects.toThrow(/protocol/i);
  });

  it('rejects the cloud metadata endpoint and loopback', async () => {
    await expect(
      assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data/')
    ).rejects.toThrow(/blocked host/i);
    await expect(assertSafeOutboundUrl('http://127.0.0.1:3000/')).rejects.toThrow(
      /blocked host/i
    );
    await expect(assertSafeOutboundUrl('http://localhost/admin')).rejects.toThrow(
      /blocked host/i
    );
  });

  it('rejects malformed input', async () => {
    await expect(assertSafeOutboundUrl('not a url')).rejects.toThrow(/invalid url/i);
  });

  it('accepts an ordinary public https URL', async () => {
    const parsed = await assertSafeOutboundUrl('https://www.bricklink.com/catalogPG.asp?S=1-1');
    expect(parsed.hostname).toBe('www.bricklink.com');
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order in the results', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 5, async (x) => x)).toEqual([]);
  });
});

describe('input validation', () => {
  it.each(['10305', '75192-1', 'abc123'])('accepts set number %s', (v) => {
    expect(isValidSetNumber(v)).toBe(true);
  });

  it.each([
    '',
    '-leading-dash',
    'has space',
    '../../etc/passwd',
    'a'.repeat(21),
    '10305&foo=bar',
    123 as unknown as string,
  ])('rejects set number %s', (v) => {
    expect(isValidSetNumber(v)).toBe(false);
  });

  it('accepts real ISO dates and rejects junk', () => {
    expect(isValidIsoDate('2024-01-31')).toBe(true);
    expect(isValidIsoDate('2024-1-5')).toBe(false);
    expect(isValidIsoDate('latest')).toBe(false);
    expect(isValidIsoDate('../../secrets')).toBe(false);
    expect(isValidIsoDate('2024-13-45')).toBe(false);
  });
});

describe('BrickLink currency normalisation', () => {
  it.each([
    ['HUF', 'HUF'],
    ['US $', 'USD'],
    ['$', 'USD'],
    ['EUR', 'EUR'],
  ])('maps %s to %s', (raw, expected) => {
    expect(normalizeBrickLinkCurrency(raw)).toBe(expected);
  });

  it('returns null for unrecognised tokens', () => {
    expect(normalizeBrickLinkCurrency('')).toBeNull();
    expect(normalizeBrickLinkCurrency('???')).toBeNull();
  });
});

describe('convertToHuf', () => {
  const rates = { HUF: 400, USD: 1.1, EUR: 1 };

  it('passes HUF through untouched', () => {
    expect(convertToHuf(1000, 'HUF', rates)).toBe(1000);
  });

  it('converts via EUR', () => {
    // 11 USD -> 10 EUR -> 4000 HUF
    expect(convertToHuf(11, 'USD', rates)).toBeCloseTo(4000);
  });

  it('returns null for a currency missing from the rate table', () => {
    expect(convertToHuf(10, 'XYZ', rates)).toBeNull();
  });
});
