// Bundles the Electron main and preload scripts into dist/ and generates the
// app icon. The main bundle pulls in ../lib/server-api.ts and its dependencies
// (express, axios, cheerio, ...) from the root node_modules, so the desktop
// package only needs Electron, Playwright and esbuild of its own.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { brickPng } from './icon.mjs';
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

// The setup window (src/setup.ts): its preload, its page script and the page.
await build({ ...common, entryPoints: [path.join(here, 'src/setupPreload.ts')], outfile: path.join(out, 'setupPreload.cjs') });
await build({
  ...common,
  platform: 'browser',
  format: 'iife',
  target: 'chrome130',
  entryPoints: [path.join(here, 'src/setupPage.ts')],
  outfile: path.join(out, 'setupPage.js'),
});
copyFileSync(path.join(here, 'src/setup.html'), path.join(out, 'setup.html'));

// --- Icons: the shared LEGO-yellow brick (icon.mjs). ------------------------
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

console.log('desktop build: dist/main.cjs, dist/preload.cjs, dist/setup*, dist/icon.png, dist/icon.ico');
