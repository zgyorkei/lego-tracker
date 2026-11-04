/**
 * The desktop app's own settings: which Firebase project it signs in to, and
 * the public website address for links it hands out. They live in
 * %APPDATA%\Brick Tracker\app-config.json, not in the build, so one installer
 * works for anybody's project: whoever installs it enters their own on first
 * run (desktop/src/setup.ts). The website keeps reading its build-time
 * VITE_FIREBASE_* variables.
 *
 * Shared by the desktop main process (reads, validates, writes the file) and
 * the web app (receives it from the preload script).
 */

/** The values Firebase's console shows for a web app, plus the database name. */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  /** "(default)" unless the project's Firestore database was given a name. */
  firestoreDatabaseId: string;
}

/**
 * Where the desktop app keeps the data. 'both': Firebase, with a copy on this
 * PC that is also the backup; 'local': on this PC only (from Phase 4 of the
 * local-storage plan). `drive`: let the phone and website reach this PC's
 * copy through Google Drive (Phase 5).
 */
export interface StorageConfig {
  mode: 'local' | 'both';
  drive: boolean;
}

export interface DesktopAppConfig {
  firebase: FirebaseWebConfig;
  /** The website's address, e.g. https://bricks.example.com, without a trailing slash. */
  publicAppUrl: string;
  /** Absent in configs saved before there was a choice: they mean 'both', no Drive. */
  storage?: StorageConfig;
}

export const DEFAULT_STORAGE: StorageConfig = { mode: 'both', drive: false };

/** The config's storage choice, with the default for configs that have none. */
export const storageOf = (config: Pick<DesktopAppConfig, 'storage'> | null): StorageConfig =>
  config?.storage ?? DEFAULT_STORAGE;

function validateStorage(input: unknown): StorageConfig | undefined | { error: string } {
  if (input === undefined || input === null) return undefined;
  const s = input as { mode?: unknown; drive?: unknown };
  if (s.mode !== 'local' && s.mode !== 'both')
    return { error: 'The storage mode must be "local" or "both".' };
  if (s.drive !== undefined && typeof s.drive !== 'boolean')
    return { error: 'The storage "drive" setting must be true or false.' };
  return { mode: s.mode, drive: s.drive === true };
}

const REQUIRED = ['apiKey', 'authDomain', 'projectId', 'appId'] as const;
const OPTIONAL = ['storageBucket', 'messagingSenderId'] as const;

/**
 * Reads a Firebase web config from what the user pastes: the console's
 * `const firebaseConfig = { apiKey: "...", ... };` snippet, or JSON such as
 * firebase-applet-config.json. Only string fields are kept; anything else in
 * the text is ignored.
 */
export function parseFirebaseConfigText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/["']?([A-Za-z]+)["']?\s*:\s*(["'])([^"'\r\n]*)\2/g))
    out[m[1]] = m[3].trim();
  return out;
}

/** The address with any trailing slash removed, or null if it is not a usable http(s) URL. */
export function normalisePublicUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  // Links go to other people, so plain http is only accepted for a local test.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.search || url.hash || url.username) return null;
  return url.toString().replace(/\/+$/, '');
}

/** Checks a stored or submitted config; returns the cleaned config, or what is wrong with it. */
export function validateAppConfig(
  input: unknown
): { config: DesktopAppConfig } | { error: string } {
  const raw = (input ?? {}) as {
    firebase?: Record<string, unknown>;
    publicAppUrl?: unknown;
    storage?: unknown;
  };
  const fb = raw.firebase ?? {};
  const missing = REQUIRED.filter((k) => typeof fb[k] !== 'string' || !(fb[k] as string).trim());
  if (missing.length) return { error: `The Firebase config is missing ${missing.join(', ')}.` };

  const firebase: FirebaseWebConfig = {
    apiKey: (fb.apiKey as string).trim(),
    authDomain: (fb.authDomain as string).trim(),
    projectId: (fb.projectId as string).trim(),
    appId: (fb.appId as string).trim(),
    firestoreDatabaseId:
      typeof fb.firestoreDatabaseId === 'string' && fb.firestoreDatabaseId.trim()
        ? fb.firestoreDatabaseId.trim()
        : '(default)',
  };
  for (const k of OPTIONAL) {
    if (typeof fb[k] === 'string' && (fb[k] as string).trim())
      firebase[k] = (fb[k] as string).trim();
  }

  const publicAppUrl =
    typeof raw.publicAppUrl === 'string' ? normalisePublicUrl(raw.publicAppUrl) : null;
  if (!publicAppUrl)
    return {
      error:
        'The website address must be a full https:// address, such as https://bricks.example.com.',
    };

  const storage = validateStorage(raw.storage);
  if (storage && 'error' in storage) return storage;

  return { config: { firebase, publicAppUrl, ...(storage ? { storage } : {}) } };
}
