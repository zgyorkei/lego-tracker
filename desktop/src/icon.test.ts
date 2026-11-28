import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { icoFromPngs, pngSize } from '../icon.mjs';

/** The first 24 bytes of a PNG of the given size: signature, then the IHDR chunk's length, name, width and height. */
function fakePng(width: number, height = width): Buffer {
  const png = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

describe('pngSize', () => {
  it('reads the width from the IHDR chunk', () => {
    expect(pngSize(fakePng(48))).toBe(48);
  });

  it('refuses a file that is not a PNG, and a non-square image', () => {
    expect(() => pngSize(Buffer.from('GIF89a, not a png at all, just text'))).toThrow(/not a PNG/);
    expect(() => pngSize(fakePng(32, 16))).toThrow(/not square/);
  });
});

describe('icoFromPngs', () => {
  it('writes the ICO header and one entry per image, smallest first', () => {
    const big = fakePng(256);
    const small = fakePng(16);
    const mid = fakePng(48);
    const ico = icoFromPngs([big, small, mid]);

    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // icon
    expect(ico.readUInt16LE(4)).toBe(3);

    const entries = [0, 1, 2].map((i) => {
      const at = 6 + 16 * i;
      return {
        width: ico[at],
        height: ico[at + 1],
        planes: ico.readUInt16LE(at + 4),
        bits: ico.readUInt16LE(at + 6),
        length: ico.readUInt32LE(at + 8),
        offset: ico.readUInt32LE(at + 12),
      };
    });
    expect(entries.map((e) => e.width)).toEqual([16, 48, 0]); // 256 is stored as 0
    expect(entries.map((e) => e.height)).toEqual([16, 48, 0]);
    expect(entries.every((e) => e.planes === 1 && e.bits === 32)).toBe(true);

    // every entry points at its own PNG, which follows the directory in order
    const sorted = [small, mid, big];
    expect(entries[0].offset).toBe(6 + 16 * 3);
    entries.forEach((e, i) => {
      expect(e.length).toBe(sorted[i].length);
      expect(ico.subarray(e.offset, e.offset + e.length).equals(sorted[i])).toBe(true);
      if (i > 0) expect(e.offset).toBe(entries[i - 1].offset + entries[i - 1].length);
    });
    expect(ico.length).toBe(6 + 16 * 3 + sorted.reduce((n, p) => n + p.length, 0));
  });

  it('refuses no images and an image over 256 px', () => {
    expect(() => icoFromPngs([])).toThrow(/at least one/);
    expect(() => icoFromPngs([fakePng(512)])).toThrow(/1 to 256 px/);
  });

  it('wraps the committed desktop icons, with a 64 px window icon and a 256 px entry', () => {
    const dir = path.resolve(__dirname, '..', 'icons');
    const files = fs.readdirSync(dir).filter((name) => /^\d+\.png$/.test(name));
    expect(files).toEqual(expect.arrayContaining(['64.png', '256.png']));
    const pngs = files.map((name) => fs.readFileSync(path.join(dir, name)));
    for (const [i, png] of pngs.entries()) expect(pngSize(png)).toBe(parseInt(files[i], 10));
    const ico = icoFromPngs(pngs);
    expect(ico.readUInt16LE(4)).toBe(files.length);
    expect(ico[6 + 16 * (files.length - 1)]).toBe(0); // the last (largest) entry is the 256 px one
  });
});
