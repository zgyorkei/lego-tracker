// The Brick Tracker icon (a LEGO-yellow 2x2 brick), drawn as a PNG with no
// image tooling. Shared by the desktop build (tray, window, .ico) and the
// web app's install icons (scripts/generate-pwa-icons.mjs), so both look alike.
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const YELLOW = [255, 205, 0, 255];
const STUD_TOP = [255, 226, 90, 255];
const DARK = [20, 20, 20, 255];
const CLEAR = [0, 0, 0, 0];

/** The brick's colour at (x, y) in a 64-unit design square, or null outside it. */
function brickAt(x, y) {
  const inBody = x >= 2 && x < 62 && y >= 2 && y < 62;
  if (!inBody) return null;
  const onEdge = x < 5 || x >= 59 || y < 5 || y >= 59;
  const studs = [16, 48].flatMap((cx) => [16, 48].map((cy) => Math.hypot(x - cx, y - cy)));
  if (onEdge || studs.some((d) => d >= 9 && d < 11)) return DARK;
  return studs.some((d) => d < 9) ? STUD_TOP : YELLOW;
}

/**
 * The icon as a square PNG of `size` pixels.
 *
 * `maskable`: Android and ChromeOS crop install icons to a circle, squircle or
 * similar, keeping only the central 80%. The brick is then drawn at 64% on a
 * full-bleed background so no shape cuts into it.
 */
export function brickPng(size, { maskable = false, background = [255, 255, 255, 255] } = {}) {
  const scale = maskable ? 0.64 : 1;
  const inner = size * scale;
  const offset = (size - inner) / 2;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0]; // filter type: none
    for (let x = 0; x < size; x++) {
      const colour = brickAt(((x - offset) / inner) * 64, ((y - offset) / inner) * 64);
      row.push(...(colour ?? (maskable ? background : CLEAR)));
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
