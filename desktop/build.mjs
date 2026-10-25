// Bundles the Electron main and preload scripts into dist/ and generates the
// app icon. The main bundle pulls in ../lib/server-api.ts and its dependencies
// (express, axios, cheerio, ...) from the root node_modules, so the desktop
// package only needs Electron, Playwright and esbuild of its own.
import { build } from 'esbuild';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist');
mkdirSync(out, { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  logLevel: 'warning',
  // Electron is provided at runtime; Playwright ships native drivers and
  // finds its browsers relative to its own package, so it is not bundled.
  // shop-teacher loads a native module (the shared Gemini key's credential
  // store) next to itself, so it is installed in desktop/ and not bundled
  // either; marking it also covers shop-teacher/gemini and /browser.
  external: ['electron', 'playwright', 'playwright-core', 'shop-teacher'],
};

await build({ ...common, entryPoints: [path.join(here, 'src/main.ts')], outfile: path.join(out, 'main.cjs') });
await build({ ...common, entryPoints: [path.join(here, 'src/preload.ts')], outfile: path.join(out, 'preload.cjs') });

// --- Icon: a 64x64 LEGO-yellow brick with four studs, as a PNG. -------------
// Generated rather than checked in, since the repo has no image assets.
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
function brickPng(size) {
  const yellow = [255, 205, 0, 255];
  const studTop = [255, 226, 90, 255];
  const dark = [20, 20, 20, 255];
  const clear = [0, 0, 0, 0];
  const s = size / 64;
  const studs = [16, 48].flatMap((x) => [16, 48].map((y) => [x * s, y * s]));
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0]; // filter type: none
    for (let x = 0; x < size; x++) {
      const inBody = x >= 2 * s && x < 62 * s && y >= 2 * s && y < 62 * s;
      const onEdge = inBody && (x < 5 * s || x >= 59 * s || y < 5 * s || y >= 59 * s);
      const stud = studs.some(([cx, cy]) => {
        const d = Math.hypot(x - cx, y - cy);
        return d < 9 * s;
      });
      const studRim = studs.some(([cx, cy]) => {
        const d = Math.hypot(x - cx, y - cy);
        return d >= 9 * s && d < 11 * s;
      });
      row.push(...(!inBody ? clear : onEdge || studRim ? dark : stud ? studTop : yellow));
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
writeFileSync(path.join(out, 'icon.png'), brickPng(64));
// Windows .ico for the packaged exe: a single 256x256 PNG wrapped in an ICO
// header, which Windows Vista and later read directly.
const png256 = brickPng(256);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); // reserved
ico.writeUInt16LE(1, 2); // type: icon
ico.writeUInt16LE(1, 4); // one image
ico[6] = 0; // width 256
ico[7] = 0; // height 256
ico.writeUInt16LE(1, 10); // colour planes
ico.writeUInt16LE(32, 12); // bits per pixel
ico.writeUInt32LE(png256.length, 14);
ico.writeUInt32LE(22, 18); // image data offset
writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([ico, png256]));

console.log('desktop build: dist/main.cjs, dist/preload.cjs, dist/icon.png, dist/icon.ico');
