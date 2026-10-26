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

// The installer must not carry the builder's Firebase project: every install
// gets its own from the setup window (src/setup.ts). `npm run build:desktop`
// leaves it out; a plain website build would bake it in.
const firebaseValues = new Set();
for (const f of [path.join(desktop, '..', 'firebase-applet-config.json'), path.join(desktop, 'app-config.json')]) {
  if (!existsSync(f)) continue;
  const cfg = JSON.parse(readFileSync(f, 'utf8'));
  const fb = cfg.firebase ?? cfg;
  for (const k of ['apiKey', 'projectId', 'appId']) if (typeof fb[k] === 'string' && fb[k]) firebaseValues.add(fb[k]);
}
for (const k of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']) if (process.env[k]) firebaseValues.add(process.env[k]);
const webFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? webFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const baked = webFiles(path.join(desktop, '..', 'dist')).filter((f) => {
  const text = readFileSync(f).toString('latin1');
  return /AIza[0-9A-Za-z_-]{35}/.test(text) || [...firebaseValues].some((v) => text.includes(v));
});
if (baked.length) {
  throw new Error(
    `The web build contains a Firebase project (${baked.map((f) => path.basename(f)).join(', ')}). ` +
      'Build it with npm run build:desktop in the repo root (npm run dist does).'
  );
}

// extraResource keeps each folder's name, so the web build is staged as "web".
rmSync(webStage, { recursive: true, force: true });
cpSync(path.join(desktop, '..', 'dist'), webStage, { recursive: true });

// Each build gets its own folder. Overwriting the previous one in place fails
// whenever anything (antivirus, a lingering Chromium) still holds one of its
// files open; old builds are cleaned up best-effort at the end instead.
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const buildDir = path.join(release, `${pkg.version}-${stamp}`);

const [appDir] = await packager({
  dir: desktop,
  out: buildDir,
  overwrite: true,
  platform: 'win32',
  arch: 'x64',
  name: pkg.productName,
  executableName: pkg.productName,
  appVersion: pkg.version,
  icon: path.join(desktop, 'dist', 'icon.ico'),
  prune: true,
  // Playwright reads its own files and drivers from disk, and native modules
  // (the shared Gemini key's credential store) cannot load from inside an
  // archive: both stay outside the asar.
  asar: { unpackDir: '{node_modules/playwright,node_modules/playwright-core}', unpack: '**/*.node' },
  extraResource: [webStage, chromiumStage],
  // Only dist/, package.json and production node_modules belong in the app.
  // Secrets and the dev setup are listed explicitly so they can never be
  // swept in.
  ignore: [
    /^\/\.env/,
    /^\/oauth-client\.json$/,
    /^\/app-config\.json$/,
    /^\/(src|scripts|build-resources|release)(\/|$)/,
    /^\/(tsconfig\.json|build\.mjs|run\.mjs|README\.md)$/,
    /\.map$/,
  ],
  win32metadata: { CompanyName: pkg.author, FileDescription: pkg.productName, ProductName: pkg.productName },
});

// Belt and braces: fail the build if a secret reached the package anyway.
const asarPath = path.join(appDir, 'resources', 'app.asar');
const packaged = listPackage(asarPath, { isPack: false });
const leaked = packaged.filter((f) => /[\\/](\.env|oauth-client\.json|app-config\.json)$/.test(f));
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

const installCmd = path.join(buildDir, 'install.cmd');
copyFileSync(path.join(here, 'install.cmd'), installCmd);

const zip = path.join(buildDir, `Brick-Tracker-${pkg.version}-win-x64.zip`);
console.log('Zipping (Compress-Archive)...');
const ps = (p) => `'${p.replace(/'/g, "''")}'`;
execFileSync(
  'powershell.exe',
  ['-NoProfile', '-Command', `Compress-Archive -Path ${ps(appDir)}, ${ps(installCmd)} -DestinationPath ${ps(zip)} -CompressionLevel Optimal`],
  { stdio: 'inherit' }
);

// Best-effort removal of earlier builds; a locked one is left for later.
for (const entry of readdirSync(release)) {
  const p = path.join(release, entry);
  if (p === buildDir) continue;
  try {
    rmSync(p, { recursive: true, force: true });
  } catch {
    console.warn(`Could not remove old build ${entry} (a file is still in use); delete it later.`);
  }
}

const sizeMb = (p) => Math.round(statSync(p).size / 1024 / 1024);
console.log(`\nPackaged: ${appDir}`);
console.log(`Install:  ${installCmd}`);
console.log(`Zip:      ${zip} (${sizeMb(zip)} MB)`);
