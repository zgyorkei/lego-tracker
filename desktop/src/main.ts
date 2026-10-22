import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } from 'electron';
import path from 'node:path';
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

// Packaged builds carry their files in resources/; dev runs from desktop/dist.
const resource = (...p: string[]) =>
  app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(__dirname, '..', ...p);

// GEMINI_API_KEY for the shared API routes, from the gitignored desktop/.env.
// It stays in this process: the page talks to the local API, never to Gemini.
// Price refreshes do not use it (the scraper replaces Gemini there).
loadEnv({ path: resource('.env'), quiet: true });
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
    return googleSignIn(loadOAuthClient(resource('oauth-client.json')));
  });

  createWindow();
  createTray();

  // Start with Windows, straight into the tray, so the 4AM refresh happens
  // without anyone opening the app. Dev runs would register electron.exe.
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
  }
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
