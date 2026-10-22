// Stages the Chromium build that the pinned Playwright version expects into
// build-resources/ms-playwright, from where electron-builder copies it into
// the installer (resources/ms-playwright). Copies from the per-user Playwright
// cache when that revision is already installed, otherwise downloads it.
import { cpSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const target = path.join(desktop, 'build-resources', 'ms-playwright');

const require = createRequire(import.meta.url);
const browsersJson = path.join(path.dirname(require.resolve('playwright-core/package.json')), 'browsers.json');
const chromium = JSON.parse(readFileSync(browsersJson, 'utf8')).browsers.find((b) => b.name === 'chromium');
const dirName = `chromium-${chromium.revision}`;
const staged = path.join(target, dirName);

if (existsSync(path.join(staged, 'INSTALLATION_COMPLETE'))) {
  console.log(`prepare-chromium: ${dirName} already staged`);
  process.exit(0);
}

mkdirSync(target, { recursive: true });
const cache = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'ms-playwright', dirName)
  : path.join(os.homedir(), '.cache', 'ms-playwright', dirName);

if (existsSync(path.join(cache, 'INSTALLATION_COMPLETE'))) {
  console.log(`prepare-chromium: copying ${dirName} from the Playwright cache`);
  cpSync(cache, staged, { recursive: true });
} else {
  console.log(`prepare-chromium: downloading ${dirName}`);
  const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
  execFileSync(process.execPath, [cli, 'install', 'chromium', '--no-shell'], {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: target },
  });
}
console.log(`prepare-chromium: ready at ${staged}`);
