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
} from './server-api.js';

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
