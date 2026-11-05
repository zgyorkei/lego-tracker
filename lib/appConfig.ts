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
  /**
   * The Firebase project, or null when none is saved. Needed only for 'both';
   * one kept while "On this PC only" is chosen makes switching back easy.
   */
  firebase: FirebaseWebConfig | null;
  /**
   * The website's address, e.g. https://bricks.example.com, without a trailing
   * slash. Required when Firebase is used (registry and Planned Sets links
   * point there); null is allowed on this PC only.
   */
  publicAppUrl: string | null;
  /** Absent in configs saved before there was a choice: they mean 'both', no Drive. */
  storage?: StorageConfig;
}

export const DEFAULT_STORAGE: StorageConfig = { mode: 'both', drive: false };

/** The config's storage choice, with the default for configs that have none. */
export const storageOf = (config: Pick<DesktopAppConfig, 'storage'> | null): StorageConfig =>
  config?.storage ?? DEFAULT_STORAGE;

/** The app talks to Firebase: 'both' with a project saved. */
export const usesFirebase = (config: DesktopAppConfig | null): boolean =>
  storageOf(config).mode === 'both' && !!config?.firebase;

/**
 * 'both' chosen but no project saved (a hand-edited file, say): the app runs
 * on this PC only and says Firebase is not set up, with the steps.
 */
export const firebaseMissing = (config: DesktopAppConfig | null): boolean =>
  !!config && storageOf(config).mode === 'both' && !config.firebase;

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

/**
 * Checks a stored or submitted config; returns the cleaned config, or what is
 * wrong with it.
 *
 * 'both' (also the default): a Firebase config that is there must be
 * complete, and then the website address is required. No Firebase config at
 * all is accepted when the choice is saved, so a stored file like that runs
 * on this PC with a warning (firebaseMissing); the setup window refuses to
 * save one, and a file without a choice (from before it) needs one. 'local': a
 * complete Firebase config is kept for switching back, an incomplete one is
 * dropped, and the website address is optional.
 */
export function validateAppConfig(
  input: unknown
): { config: DesktopAppConfig } | { error: string } {
  const raw = (input ?? {}) as {
    firebase?: Record<string, unknown> | null;
    publicAppUrl?: unknown;
    storage?: unknown;
  };

  const storage = validateStorage(raw.storage);
  if (storage && 'error' in storage) return storage;
  const mode = storage?.mode ?? DEFAULT_STORAGE.mode;

  const firebase = cleanFirebase(raw.firebase ?? {});
  if ('missing' in firebase && mode === 'both')
    return { error: `The Firebase config is missing ${firebase.missing.join(', ')}.` };
  // A file from before the choice existed always had a project: one without
  // is broken, not a choice.
  if ('none' in firebase && !storage) return { error: 'There is no Firebase config.' };
  const project = 'config' in firebase ? firebase.config : null;

  const urlText = typeof raw.publicAppUrl === 'string' ? raw.publicAppUrl.trim() : '';
  const publicAppUrl = urlText ? normalisePublicUrl(urlText) : null;
  if ((urlText && !publicAppUrl) || (!publicAppUrl && mode === 'both' && project))
    return {
      error:
        'The website address must be a full https:// address, such as https://bricks.example.com.',
    };

  return { config: { firebase: project, publicAppUrl, ...(storage ? { storage } : {}) } };
}

/** A complete Firebase config, none at all, or the fields a partial one lacks. */
function cleanFirebase(
  fb: Record<string, unknown>
): { config: FirebaseWebConfig } | { none: true } | { missing: string[] } {
  const given = (k: string) => typeof fb[k] === 'string' && (fb[k] as string).trim() !== '';
  if (![...REQUIRED, ...OPTIONAL, 'firestoreDatabaseId'].some(given)) return { none: true };
  const missing = REQUIRED.filter((k) => !given(k));
  if (missing.length) return { missing };

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
    if (given(k)) firebase[k] = (fb[k] as string).trim();
  }
  return { config: firebase };
}
