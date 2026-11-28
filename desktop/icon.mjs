// The desktop app's icon files. The picture itself (Glim the Ghost on an app
// tile) is baked as PNGs by docs/design/logo-minifigs/make_icons.py into
// desktop/icons/<size>.png, the same image as the web app's public/icons.
// The build (build.mjs) copies the 64 px one to dist/icon.png (window, tray)
// and wraps all of them into dist/icon.ico with this file.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The pixel size of a square PNG, read from its IHDR chunk.
 *
 * @param {Buffer} png
 * @returns {number}
 */
export function pngSize(png) {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG file');
  }
  if (png.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('PNG without an IHDR chunk first');
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== height) throw new Error(`icon is ${width}x${height}, not square`);
  return width;
}

/**
 * A Windows .ico holding the given PNGs, smallest first. Windows Vista and
 * later read PNG entries directly, so the files go in as they are. An .ico
 * entry is at most 256 px (stored as 0 in its one-byte width and height).
 *
 * @param {Buffer[]} pngs square PNG files, each at most 256 px
 * @returns {Buffer}
 */
export function icoFromPngs(pngs) {
  if (pngs.length === 0) throw new Error('an .ico needs at least one image');
  const images = pngs
    .map((data) => ({ data, size: pngSize(data) }))
    .sort((a, b) => a.size - b.size);
  for (const { size } of images) {
    if (size < 1 || size > 256) throw new Error(`an .ico holds 1 to 256 px, not ${size}`);
  }

  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ data, size }, i) => {
    const at = 6 + 16 * i;
    head[at] = size === 256 ? 0 : size; // width
    head[at + 1] = size === 256 ? 0 : size; // height
    head[at + 2] = 0; // palette colours: none
    head[at + 3] = 0; // reserved
    head.writeUInt16LE(1, at + 4); // colour planes
    head.writeUInt16LE(32, at + 6); // bits per pixel
    head.writeUInt32LE(data.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((image) => image.data)]);
}
