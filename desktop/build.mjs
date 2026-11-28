// Bundles the Electron main and preload scripts into dist/ and makes the app
// icon files there. The main bundle pulls in ../lib/server-api.ts and its
// dependencies (express, axios, cheerio, ...) from the root node_modules, so
// the desktop package only needs Electron, Playwright and esbuild of its own.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { icoFromPngs } from './icon.mjs';
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

await build({
  ...common,
  entryPoints: [path.join(here, 'src/main.ts')],
  outfile: path.join(out, 'main.cjs'),
});
await build({
  ...common,
  entryPoints: [path.join(here, 'src/preload.ts')],
  outfile: path.join(out, 'preload.cjs'),
});

// The setup window (src/setup.ts): its preload, its page script and the page.
await build({
  ...common,
  entryPoints: [path.join(here, 'src/setupPreload.ts')],
  outfile: path.join(out, 'setupPreload.cjs'),
});
await build({
  ...common,
  platform: 'browser',
  format: 'iife',
  target: 'chrome130',
  entryPoints: [path.join(here, 'src/setupPage.ts')],
  outfile: path.join(out, 'setupPage.js'),
});
copyFileSync(path.join(here, 'src/setup.html'), path.join(out, 'setup.html'));

// --- Icons: Glim the Ghost on an app tile, baked into icons/<size>.png by --
// docs/design/logo-minifigs/make_icons.py (the web app's public/icons come
// from the same run). icon.png (window, tray) is the 64 px one; the packaged
// exe's icon.ico holds every size, 16 to 256 px (icon.mjs).
const iconsDir = path.join(here, 'icons');
const iconFiles = readdirSync(iconsDir).filter((name) => /^\d+\.png$/.test(name));
if (!iconFiles.includes('64.png') || !iconFiles.includes('256.png')) {
  throw new Error(
    'desktop/icons needs 64.png and 256.png: run docs/design/logo-minifigs/make_icons.py'
  );
}
copyFileSync(path.join(iconsDir, '64.png'), path.join(out, 'icon.png'));
writeFileSync(
  path.join(out, 'icon.ico'),
  icoFromPngs(iconFiles.map((name) => readFileSync(path.join(iconsDir, name))))
);

console.log(
  'desktop build: dist/main.cjs, dist/preload.cjs, dist/setup*, dist/icon.png, dist/icon.ico'
);
