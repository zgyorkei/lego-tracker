import { BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { geminiKeyStatus, setGeminiKey } from 'shop-teacher/gemini';
import {
  parseFirebaseConfigText,
  storageOf,
  validateAppConfig,
  type DesktopAppConfig,
  type StorageConfig,
} from '../../lib/appConfig';
import { loadOAuthClient } from './oauth';

/**
 * The desktop app's settings window: where the data is kept ("On this PC
 * only", or Firebase with a copy on this PC), which Firebase project to use
 * for the second, the website address for shared links, the Google sign-in
 * client file and, optionally, a Gemini key. Shown on first start (nothing is
 * built into the installer), from the tray's "Settings..." and from the app.
 *
 * Everything the page sends is checked again here; the page only collects
 * text. The config is written to app-config.json and the client file copied
 * to oauth-client.json, both in the app's data folder.
 */

export interface SetupFiles {
  configFile: string;
  oauthFile: string;
}

/** The saved config, or null when there is none yet; `problem` says why a file present was not usable. */
export function readAppConfig(file: string): { config: DesktopAppConfig | null; problem?: string } {
  if (!existsSync(file)) return { config: null };
  try {
    const result = validateAppConfig(JSON.parse(readFileSync(file, 'utf8')));
    return 'config' in result ? { config: result.config } : { config: null, problem: result.error };
  } catch {
    return { config: null, problem: `${file} is not valid JSON.` };
  }
}

export interface SetupForm {
  mode: StorageConfig['mode'];
  drive: boolean;
  firebaseText: string;
  databaseId: string;
  publicAppUrl: string;
  geminiKey: string;
}

export interface SetupState extends Omit<SetupForm, 'geminiKey'> {
  firstRun: boolean;
  /** The mode saved now (null on first run), for the notes on switching. */
  savedMode: StorageConfig['mode'] | null;
  problem: string | null;
  oauthClient: string | null;
  gemini: { hasKey: boolean; storeAvailable: boolean };
}

const IPC = ['setup:load', 'setup:pickOAuthClient', 'setup:save'] as const;

/**
 * Opens the settings window and resolves with the saved config, or null if it
 * was closed without saving.
 */
export function runSetup(
  files: SetupFiles,
  opts: {
    current: DesktopAppConfig | null;
    problem?: string;
    icon: string;
    onWindow?: (w: BrowserWindow | null) => void;
  }
): Promise<DesktopAppConfig | null> {
  const win = new BrowserWindow({
    width: 680,
    height: 940,
    title: 'Brick Tracker setup',
    icon: opts.icon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'setupPreload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  opts.onWindow?.(win);
  // Nothing in the page is meant to navigate or open windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // A client file the user picked, copied into place only on save.
  let pickedClient: string | null = null;
  const fromThisWindow = (e: Electron.IpcMainInvokeEvent) => {
    if (e.sender !== win.webContents) throw new Error('Unexpected sender');
  };
  const { firestoreDatabaseId, ...firebase } = opts.current?.firebase ?? {
    firestoreDatabaseId: '',
  };

  return new Promise((resolve) => {
    let saved: DesktopAppConfig | null = null;

    ipcMain.handle('setup:load', (e): SetupState => {
      fromThisWindow(e);
      const gemini = geminiKeyStatus();
      const storage = storageOf(opts.current);
      return {
        firstRun: !opts.current,
        // A first run starts with no Firebase to set up; an existing setup
        // shows what it uses (configs from before the choice mean 'both').
        mode: opts.current ? storage.mode : 'local',
        drive: opts.current ? storage.drive : false,
        savedMode: opts.current ? storage.mode : null,
        problem: opts.problem ?? null,
        firebaseText: opts.current?.firebase ? JSON.stringify(firebase, null, 2) : '',
        databaseId: firestoreDatabaseId,
        publicAppUrl: opts.current?.publicAppUrl ?? '',
        oauthClient: existsSync(files.oauthFile) ? files.oauthFile : null,
        gemini: { hasKey: gemini.hasKey, storeAvailable: gemini.storeAvailable },
      };
    });

    ipcMain.handle('setup:pickOAuthClient', async (e) => {
      fromThisWindow(e);
      const pick = await dialog.showOpenDialog(win, {
        title: 'Google OAuth client (Desktop app) JSON',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (pick.canceled || !pick.filePaths[0]) return { file: null };
      try {
        loadOAuthClient(pick.filePaths[0]);
      } catch (err) {
        return { file: null, error: err instanceof Error ? err.message : String(err) };
      }
      pickedClient = pick.filePaths[0];
      return { file: pickedClient };
    });

    ipcMain.handle('setup:save', (e, form: SetupForm) => {
      fromThisWindow(e);
      const parsed = parseFirebaseConfigText(String(form?.firebaseText ?? ''));
      const databaseId = String(form?.databaseId ?? '').trim();
      const mode: StorageConfig['mode'] = form?.mode === 'local' ? 'local' : 'both';
      const result = validateAppConfig({
        firebase: { ...parsed, ...(databaseId ? { firestoreDatabaseId: databaseId } : {}) },
        publicAppUrl: String(form?.publicAppUrl ?? ''),
        // Saved explicitly from now on; Drive is only a saved choice until it
        // arrives (local-storage plan, Phase 5).
        storage: { mode, drive: form?.drive === true },
      });
      if ('error' in result) return { error: result.error };
      // A stored file may say 'both' without a project (the app then warns);
      // the form never saves one.
      if (mode === 'both' && !result.config.firebase)
        return {
          error: 'Paste the Firebase config of your web app, or choose "On this PC only".',
        };
      if (!pickedClient && !existsSync(files.oauthFile)) {
        return {
          error: 'Choose the Google sign-in client file (the "Desktop app" OAuth client JSON).',
        };
      }

      const key = String(form?.geminiKey ?? '').trim();
      if (key) {
        try {
          setGeminiKey(key);
          process.env.GEMINI_API_KEY = key;
        } catch (err) {
          return {
            error: `Gemini key not saved: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      mkdirSync(path.dirname(files.configFile), { recursive: true });
      if (pickedClient) copyFileSync(pickedClient, files.oauthFile);
      writeFileSync(files.configFile, JSON.stringify(result.config, null, 2) + '\n');
      saved = result.config;
      win.close();
      return {};
    });

    win.on('closed', () => {
      for (const channel of IPC) ipcMain.removeHandler(channel);
      opts.onWindow?.(null);
      resolve(saved);
    });

    void win.loadFile(path.join(__dirname, 'setup.html'));
  });
}
