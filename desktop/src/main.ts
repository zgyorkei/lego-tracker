import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { adoptGeminiKey, storedGeminiKey } from 'shop-teacher/gemini';
import { startLocalServer } from './localServer';
import { PlaywrightScraper } from './scraper/engine';
import { googleSignIn, loadOAuthClient } from './oauth';
import { readAppConfig, runSetup } from './setup';
import { LocalStore } from './store/localStore';
import { registerStoreIpc } from './store/ipc';
import type { DesktopAppConfig } from '../../lib/appConfig';

// Express renders stack traces on its error pages outside production.
process.env.NODE_ENV ??= 'production';

const PORT = 47321;
const APP_ORIGIN = `http://localhost:${PORT}`;
// Passed by the login item, so a start with Windows goes straight to the tray.
const startHidden = process.argv.includes('--hidden');

// The installer ships Playwright's Chromium in resources/ms-playwright, so a
// fresh machine needs no separate browser download. Dev runs use the
// per-user Playwright cache instead.
if (app.isPackaged)
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'ms-playwright');

// Secrets are never packaged: the installer must be safe to copy around. A
// packaged app reads them from its data folder (%APPDATA%\Brick Tracker);
// dev runs read the gitignored files in desktop/.
const secretFile = (name: string) =>
  app.isPackaged ? path.join(app.getPath('userData'), name) : path.join(__dirname, '..', name);

// GEMINI_API_KEY for the shared API routes (teaching sources only). It stays
// in this process: the page talks to the local API, never to Gemini.
loadEnv({ path: secretFile('.env'), quiet: true });

// The Gemini key is shared with the user's other apps (the shop-teacher
// package keeps it in Windows Credential Manager). A key from .env is moved
// there once; after that the shared key wins, so a key entered in BrickBudget
// or with `npx shop-teacher key set` works here from the next start.
adoptGeminiKey(process.env.GEMINI_API_KEY);
const sharedGeminiKey = storedGeminiKey();
if (sharedGeminiKey) process.env.GEMINI_API_KEY = sharedGeminiKey;

// The packaged web app sits in resources/web; dev runs use the repo build.
const webDir = app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.resolve(__dirname, '../../dist');

// Which Firebase project and website this install uses. Not built in, so the
// installer works for anybody: the setup window asks on first start and saves
// it here (lib/appConfig.ts), next to the sign-in client file.
const setupFiles = {
  configFile: secretFile('app-config.json'),
  oauthFile: secretFile('oauth-client.json'),
};
let appConfig: DesktopAppConfig | null = null;

let win: BrowserWindow | null = null;
let setupWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let scraper: PlaywrightScraper | null = null;
// The account's data on this PC (desktop/src/store), one folder per Google
// account under <userData>/data, in dev runs too.
let localStore: LocalStore | null = null;

function showWindow() {
  if (setupWin) {
    setupWin.show();
    setupWin.focus();
    return;
  }
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: !startHidden,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      // The 4AM refresh runs from a timer in the page while the window is
      // hidden in the tray; Chromium would otherwise throttle that timer.
      backgroundThrottling: false,
    },
  });
  void win.loadURL(`${APP_ORIGIN}/`);

  // Closing the window keeps the app (and the daily refresh) in the tray.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });

  // Shop and registry links open in the normal browser, never in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_ORIGIN)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')));
  tray.setToolTip('Brick Tracker');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Brick Tracker', click: showWindow },
      { label: 'Settings...', click: () => void openSettings() },
      // Lets the user stop (or restore) the start-with-Windows entry, which
      // is also how the 4AM refresh gets its chance to run.
      ...(app.isPackaged
        ? [
            {
              label: 'Start with Windows',
              type: 'checkbox' as const,
              checked: app.getLoginItemSettings({ path: process.execPath, args: ['--hidden'] })
                .openAtLogin,
              click: (item: Electron.MenuItem) =>
                app.setLoginItemSettings({
                  openAtLogin: item.checked,
                  path: process.execPath,
                  args: ['--hidden'],
                }),
            },
          ]
        : []),
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', showWindow);
}

const setupIcon = () => path.join(__dirname, 'icon.png');

/** The tray's "Settings...": the same window as the first-run setup; saving restarts the app. */
async function openSettings() {
  if (setupWin) return showWindow();
  const saved = await runSetup(setupFiles, {
    current: appConfig,
    icon: setupIcon(),
    onWindow: (w) => (setupWin = w),
  });
  if (!saved) return;
  app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--hidden') });
  quitting = true;
  app.quit();
}

async function start() {
  const stored = readAppConfig(setupFiles.configFile);
  appConfig =
    stored.config ??
    (await runSetup(setupFiles, {
      current: null,
      problem: stored.problem,
      icon: setupIcon(),
      onWindow: (w) => (setupWin = w),
    }));
  if (!appConfig) {
    // Closed without saving: there is nothing to connect to yet.
    quitting = true;
    app.quit();
    return;
  }
  // The planned-sets route reads Firestore over REST and finds the project
  // the same way as on the website (getFirestoreTarget in lib/server-api.ts).
  process.env.VITE_FIREBASE_PROJECT_ID = appConfig.firebase.projectId;
  process.env.VITE_FIREBASE_DATABASE_ID = appConfig.firebase.firestoreDatabaseId;

  // Read synchronously by the preload script as the page starts.
  ipcMain.on('config:get', (event) => {
    event.returnValue = event.senderFrame?.url.startsWith(APP_ORIGIN) ? appConfig : null;
  });

  localStore = new LocalStore(path.join(app.getPath('userData'), 'data'));
  registerStoreIpc(localStore, APP_ORIGIN, () => win);
  // The sync state under the tray icon ("Brick Tracker: 3 changes waiting").
  ipcMain.on('tray:status', (event, text: unknown) => {
    if (!event.senderFrame?.url.startsWith(APP_ORIGIN) || typeof text !== 'string') return;
    const line = text.replace(/[\r\n]+/g, ' ').slice(0, 100);
    tray?.setToolTip(line ? `Brick Tracker: ${line}` : 'Brick Tracker');
  });

  scraper = new PlaywrightScraper(path.join(app.getPath('userData'), 'scraper-profile'));
  await startLocalServer({ port: PORT, distDir: webDir, scraper });

  ipcMain.handle('auth:google', (event) => {
    // Only the app's own page may start a sign-in.
    if (!event.senderFrame?.url.startsWith(APP_ORIGIN)) throw new Error('Unexpected sender');
    const clientFile = setupFiles.oauthFile;
    if (!existsSync(clientFile)) {
      throw new Error(
        'Sign-in is not set up yet: choose the Google sign-in client in the tray menu, Settings...'
      );
    }
    return googleSignIn(loadOAuthClient(clientFile));
  });

  // The Start menu shortcut and the start-with-Windows entry come from the
  // installer (installer/installer.nsh), so running the packaged app from a
  // build folder (or a test) never leaves either behind.
  createWindow();
  createTray();
}

if (!app.requestSingleInstanceLock()) {
  // The fixed port and the scraper profile can only be held once.
  app.quit();
} else {
  app.on('second-instance', showWindow);
  // The tray keeps the app alive with every window closed.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    quitting = true;
    // Synchronous, so the last changes are on disk before the process ends.
    localStore?.flushSync();
    void scraper?.close();
  });
  app.whenReady().then(start, (err) => {
    console.error('Brick Tracker failed to start', err);
    app.quit();
  });
}
