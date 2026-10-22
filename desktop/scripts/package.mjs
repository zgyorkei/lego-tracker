// Packages the desktop app for Windows and zips it with install.cmd.
//
// Uses @electron/packager plus PowerShell's Compress-Archive. Installer
// builders (electron-builder NSIS, Squirrel) are deliberately not used: they
// depend on 7-Zip, which is blocked on the build machine.
//
// Run via `npm run dist`, which first builds desktop/dist and the web app and
// stages Chromium.
import { packager } from '@electron/packager';
import { listPackage } from '@electron/asar';
import { cpSync, copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const release = path.join(desktop, 'release');
const staging = path.join(desktop, 'build-resources');
const webStage = path.join(staging, 'web');
const chromiumStage = path.join(staging, 'ms-playwright');
const pkg = JSON.parse(readFileSync(path.join(desktop, 'package.json'), 'utf8'));

if (!existsSync(path.join(desktop, '..', 'dist', 'index.html'))) throw new Error('Build the web app first (npm run build in the repo root).');
if (!existsSync(chromiumStage)) throw new Error('Stage Chromium first (node scripts/prepare-chromium.mjs).');

// extraResource keeps each folder's name, so the web build is staged as "web".
rmSync(webStage, { recursive: true, force: true });
cpSync(path.join(desktop, '..', 'dist'), webStage, { recursive: true });

const [appDir] = await packager({
  dir: desktop,
  out: release,
  overwrite: true,
  platform: 'win32',
  arch: 'x64',
  name: pkg.productName,
  executableName: pkg.productName,
  appVersion: pkg.version,
  icon: path.join(desktop, 'dist', 'icon.ico'),
  prune: true,
  // Playwright reads its own files and drivers from disk; keep it outside the asar.
  asar: { unpackDir: '{node_modules/playwright,node_modules/playwright-core}' },
  extraResource: [webStage, chromiumStage],
  // Only dist/, package.json and production node_modules belong in the app.
  // Secrets are listed explicitly so they can never be swept in.
  ignore: [
    /^\/\.env/,
    /^\/oauth-client\.json$/,
    /^\/(src|scripts|build-resources|release)(\/|$)/,
    /^\/(tsconfig\.json|build\.mjs|run\.mjs|README\.md)$/,
    /\.map$/,
  ],
  win32metadata: { CompanyName: pkg.author, FileDescription: pkg.productName, ProductName: pkg.productName },
});

// Belt and braces: fail the build if a secret reached the package anyway.
const asarPath = path.join(appDir, 'resources', 'app.asar');
const packaged = listPackage(asarPath, { isPack: false });
const leaked = packaged.filter((f) => /[\\/](\.env|oauth-client\.json)$/.test(f));
const secretValues = [];
for (const f of ['.env', 'oauth-client.json']) {
  const p = path.join(desktop, f);
  if (!existsSync(p)) continue;
  const text = readFileSync(p, 'utf8');
  for (const m of text.matchAll(/AIza[0-9A-Za-z_-]{35}|GOCSPX-[0-9A-Za-z_-]+/g)) secretValues.push(m[0]);
}
const asarBytes = readFileSync(asarPath).toString('latin1');
if (leaked.length || secretValues.some((v) => asarBytes.includes(v))) {
  rmSync(appDir, { recursive: true, force: true });
  throw new Error(`Secrets found in the package (${leaked.join(', ') || 'secret value in app.asar'}); build discarded.`);
}

copyFileSync(path.join(here, 'install.cmd'), path.join(release, 'install.cmd'));

const zip = path.join(release, `Brick-Tracker-${pkg.version}-win-x64.zip`);
rmSync(zip, { force: true });
console.log('Zipping (Compress-Archive)...');
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${appDir.replace(/'/g, "''")}', '${path.join(release, 'install.cmd').replace(/'/g, "''")}' -DestinationPath '${zip.replace(/'/g, "''")}' -CompressionLevel Optimal`,
  ],
  { stdio: 'inherit' }
);

const sizeMb = (p) => Math.round(statSync(p).size / 1024 / 1024);
console.log(`\nPackaged: ${appDir}`);
console.log(`Zip:      ${zip} (${sizeMb(zip)} MB)`);
console.log(`Contents: ${readdirSync(release).join(', ')}`);
