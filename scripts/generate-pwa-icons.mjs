// Writes the web app's install icons into public/icons/ from the same brick
// drawing the desktop app uses (desktop/icon.mjs). The PNGs are committed;
// re-run after changing the drawing:  node scripts/generate-pwa-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { brickPng } from '../desktop/icon.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'icons');
mkdirSync(out, { recursive: true });

const icons = {
  'icon-192.png': brickPng(192),
  'icon-512.png': brickPng(512),
  // Cropped to a circle/squircle by Android and ChromeOS: brick in the safe zone.
  'icon-maskable-512.png': brickPng(512, { maskable: true, background: [255, 205, 0, 255] }),
  // iOS / iPadOS home screen ignores the manifest and does not round transparency well.
  'apple-touch-icon.png': brickPng(180, { maskable: true }),
  'favicon-32.png': brickPng(32),
};
for (const [name, png] of Object.entries(icons)) {
  writeFileSync(path.join(out, name), png);
  console.log(`public/icons/${name} (${png.length} bytes)`);
}
