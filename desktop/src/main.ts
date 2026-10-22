import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { startLocalServer } from './localServer';
import { PlaywrightScraper } from './scraper/engine';
import { googleSignIn, loadOAuthClient } from './oauth';

// Express renders stack traces on its error pages outside production.
process.env.NODE_ENV ??= 'production';

const PORT = 47321;
const APP_ORIGIN = `http://localhost:${PORT}`;
// Passed by the login item, so a start with Windows goes straight to the tray.
const startHidden = process.argv.includes('--hidden');

// The installer ships Playwright's Chromium in resources/ms-playwright, so a
// fresh machine needs no separate browser download. Dev runs use the
// per-user Playwright cache instead.
if (app.isPackaged) process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'ms-playwright');

// Secrets are never packaged: the installer must be safe to copy around. A
// packaged app reads them from its data folder (%APPDATA%\Brick Tracker);
// dev runs read the gitignored files in desktop/.
const secretFile = (name: string) =>
  app.isPackaged ? path.join(app.getPath('userData'), name) : path.join(__dirname, '..', name);

// GEMINI_API_KEY for the shared API routes (teaching sources only). It stays
// in this process: the page talks to the local API, never to Gemini.
loadEnv({ path: secretFile('.env'), quiet: true });

// The packaged web app sits in resources/web; dev runs use the repo build.
const webDir = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.resolve(__dirname, '../../dist');

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let scraper: PlaywrightScraper | null = null;

function showWindow() {
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
      // Lets the user stop (or restore) the start-with-Windows entry, which
      // is also how the 4AM refresh gets its chance to run.
      ...(app.isPackaged
        ? [
            {
              label: 'Start with Windows',
              type: 'checkbox' as const,
              checked: app.getLoginItemSettings({ path: process.execPath, args: ['--hidden'] }).openAtLogin,
              click: (item: Electron.MenuItem) =>
                app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath, args: ['--hidden'] }),
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

async function start() {
  scraper = new PlaywrightScraper(path.join(app.getPath('userData'), 'scraper-profile'));
  await startLocalServer({ port: PORT, distDir: webDir, scraper });

  ipcMain.handle('auth:google', (event) => {
    // Only the app's own page may start a sign-in.
    if (!event.senderFrame?.url.startsWith(APP_ORIGIN)) throw new Error('Unexpected sender');
    const clientFile = secretFile('oauth-client.json');
    if (!existsSync(clientFile)) {
      throw new Error(`Sign-in is not set up yet: place the Google OAuth client file at ${clientFile}`);
    }
    return googleSignIn(loadOAuthClient(clientFile));
  });

  createWindow();
  createTray();

  // install.cmd copies the app into place and starts it once with --install.
  // Only then does it register itself, so running the packaged app from a
  // build folder (or a test) never leaves a login item behind.
  if (app.isPackaged && process.argv.includes('--install')) registerInstall();
}

/**
 * Start with Windows, straight into the tray, so the 4AM refresh happens
 * without anyone opening the app; plus a Start menu shortcut, since there is
 * no installer to create one (installer builders need 7-Zip, which is
 * blocked on this machine).
 */
function registerInstall() {
  app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: ['--hidden'] });
  const link = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Brick Tracker.lnk');
  shell.writeShortcutLink(link, existsSync(link) ? 'replace' : 'create', {
    target: process.execPath,
    description: 'Brick Tracker',
    icon: process.execPath,
    iconIndex: 0,
  });
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
    void scraper?.close();
  });
  app.whenReady().then(start, (err) => {
    console.error('Brick Tracker failed to start', err);
    app.quit();
  });
}
