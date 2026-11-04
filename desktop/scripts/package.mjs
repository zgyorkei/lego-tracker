// Builds the Windows installer (NSIS, per user, no admin rights) with
// electron-builder.
//
// 7-Zip: electron-builder compresses the installer payload with 7-Zip and
// would otherwise download its own old copy. Only the installed 7-Zip 26.03
// or newer passes the build machine's security check, so it is located here,
// version-checked, and handed over as ELECTRON_BUILDER_7ZIP_PATH. The newer
// NSIS and rcedit toolsets (`toolsets` below) come as .tar.gz/.zip, so no
// 7z-packed download is involved either, and Squirrel (electron-winstaller,
// which vendors 7-Zip 16.04) is stubbed out in package.json's overrides.
//
// Run via `npm run dist`, which first builds desktop/dist and the web app and
// stages Chromium.
import { build } from 'electron-builder';
import { listPackage } from '@electron/asar';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const release = path.join(desktop, 'release');
const staging = path.join(desktop, 'build-resources');
const webStage = path.join(staging, 'web');
const chromiumStage = path.join(staging, 'ms-playwright');
const pkg = JSON.parse(readFileSync(path.join(desktop, 'package.json'), 'utf8'));
const require = createRequire(import.meta.url);

// The fixed name the intro page's releases/latest/download/... link points at.
const SETUP_NAME = 'Brick-Tracker-Setup.exe';
const MIN_7ZIP = [26, 3];

if (!existsSync(path.join(desktop, '..', 'dist', 'index.html'))) throw new Error('Build the web app first (npm run build in the repo root).');
if (!existsSync(chromiumStage)) throw new Error('Stage Chromium first (node scripts/prepare-chromium.mjs).');

/** The installed 7-Zip, 26.03 or newer; never a bundled or downloaded copy. */
function locate7zip() {
  const candidates = [
    process.env.SEVENZIP_PATH,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, '7-Zip', '7z.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], '7-Zip', '7z.exe'),
  ].filter(Boolean);
  const exe = candidates.find((p) => existsSync(p));
  if (!exe) {
    throw new Error(
      'No installed 7-Zip found. electron-builder needs 7-Zip 26.03 or newer to compress the installer: ' +
        'install it to C:\\Program Files\\7-Zip (winget install 7zip.7zip) or point SEVENZIP_PATH at its 7z.exe.'
    );
  }
  const info = execFileSync(exe, ['i'], { encoding: 'utf8', timeout: 15_000 });
  const match = /7-Zip[^\d]*(\d+)\.(\d+)/.exec(info);
  const version = match ? [Number(match[1]), Number(match[2])] : null;
  const tooOld = !version || version[0] < MIN_7ZIP[0] || (version[0] === MIN_7ZIP[0] && version[1] < MIN_7ZIP[1]);
  if (tooOld) {
    throw new Error(`${exe} is 7-Zip ${version ? version.join('.') : '(unknown version)'}; 26.03 or newer is required.`);
  }
  return { exe, version: `${version[0]}.${String(version[1]).padStart(2, '0')}` };
}

const sevenZip = locate7zip();
console.log(`Using 7-Zip ${sevenZip.version} at ${sevenZip.exe}`);

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

rmSync(webStage, { recursive: true, force: true });
cpSync(path.join(desktop, '..', 'dist'), webStage, { recursive: true });

/** Fails the build, before the installer is made, if a secret reached the app. */
function assertNoSecrets(appOutDir) {
  const asarPath = path.join(appOutDir, 'resources', 'app.asar');
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
    rmSync(appOutDir, { recursive: true, force: true });
    throw new Error(`Secrets found in the package (${leaked.join(', ') || 'secret value in app.asar'}); build discarded.`);
  }
}

// Each build gets its own folder. Overwriting the previous one in place fails
// whenever anything (antivirus, a lingering Chromium) still holds one of its
// files open; old builds are cleaned up best-effort at the end instead.
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const buildDir = path.join(release, `${pkg.version}-${stamp}`);

process.env.ELECTRON_BUILDER_7ZIP_PATH = sevenZip.exe;
// electron-builder's default (-mx=9, a 64 MB dictionary per thread on every
// core) needs more free memory than a busy 32 GB machine has ("Can't allocate
// required memory"). Level 7 needs about half and costs only a few MB of
// installer size, since most of the payload is already compressed binaries.
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ??= '7';

await build({
  projectDir: desktop,
  win: ['nsis:x64'],
  publish: 'never',
  config: {
    appId: 'com.zgyorkei.bricktracker',
    productName: pkg.productName,
    executableName: pkg.productName,
    copyright: `Copyright (c) ${new Date().getFullYear()} ${pkg.author}`,
    directories: { output: buildDir, buildResources: path.join(desktop, 'installer') },
    // The Electron already installed for development, instead of a download.
    electronDist: path.join(path.dirname(require.resolve('electron/package.json')), 'dist'),
    // Allow-list: the bundled main process and package.json. Production
    // node_modules are added by electron-builder itself. Secrets and the dev
    // setup are outside the list, so they can never be swept in.
    files: ['dist/**/*', 'package.json', '!**/*.map'],
    // Native modules ship as prebuilt N-API binaries; nothing to compile.
    npmRebuild: false,
    asar: true,
    // Playwright reads its own files and drivers from disk, and native modules
    // (the shared Gemini key's credential store) cannot load from inside an
    // archive: both stay outside the asar.
    asarUnpack: ['node_modules/playwright/**/*', 'node_modules/playwright-core/**/*', '**/*.node'],
    extraResources: [
      { from: webStage, to: 'web' },
      { from: chromiumStage, to: 'ms-playwright' },
    ],
    toolsets: { nsis: '1.2.1', winCodeSign: '1.1.0' },
    win: {
      icon: path.join(desktop, 'dist', 'icon.ico'),
      // Not code-signed: with no CSC_LINK set, electron-builder skips signing.
      signtoolOptions: { signingHashAlgorithms: ['sha256'] },
    },
    nsis: {
      // One click, for the current user only: no admin rights, installs to
      // %LOCALAPPDATA%\Programs\Brick Tracker (where install.cmd put it too,
      // so a newer setup replaces such a copy in place).
      oneClick: true,
      perMachine: false,
      createDesktopShortcut: false,
      createStartMenuShortcut: true,
      shortcutName: pkg.productName,
      runAfterFinish: true,
      // %APPDATA%\Brick Tracker (setup, sign-in, scraper profile) survives an
      // uninstall, so a reinstall needs no new setup.
      deleteAppDataOnUninstall: false,
      differentialPackage: false,
      artifactName: SETUP_NAME,
      uninstallDisplayName: pkg.productName,
      // Start with Windows on a fresh install; see the file.
      include: path.join(desktop, 'installer', 'installer.nsh'),
    },
    afterPack: async (context) => {
      // Electron's placeholder app, copied in with electronDist; app.asar replaces it.
      rmSync(path.join(context.appOutDir, 'resources', 'default_app.asar'), { force: true });
      assertNoSecrets(context.appOutDir);
    },
  },
});

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

const setup = path.join(buildDir, SETUP_NAME);
const sizeMb = (p) => Math.round(statSync(p).size / 1024 / 1024);
console.log(`\nApp:      ${path.join(buildDir, 'win-unpacked')}`);
console.log(`Setup:    ${setup} (${sizeMb(setup)} MB)`);
