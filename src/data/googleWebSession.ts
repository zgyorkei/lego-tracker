import {
  REQUESTED_WITH,
  SESSION_SCOPES,
  type AccessAnswer,
  type SessionAnswer,
  type SessionRefusal,
  type SessionUserJson,
} from '../../lib/sessionProtocol';
import type { TokenSource } from '../../lib/drive/client';
import { googleClientId } from '../lib/googleConfig';
import { removeStored } from '../lib/storage';
import type { AuthUser, SessionProvider } from './types';

// The website's own Google session (local-storage plan, Phase 6), for reading
// the desktop's copy through Google Drive without Firebase. The server holds
// it (lib/session.ts, /api/session*): this page only ever learns who is
// signed in and gets Drive access tokens that last an hour. Google Identity
// Services (the sign-in popup) loads only when someone signs in.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const HEADERS = { 'X-Requested-With': REQUESTED_WITH, 'Content-Type': 'application/json' };
/** A token this close to its end is replaced before it is used. */
const EARLY_MS = 60 * 1000;

/** A sign-in or token failure, already worded for the UI. `code` tells cancelled from refused. */
export class SessionError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

/** The user closed the popup or said no: nothing to report. */
export const isCancelledSignIn = (err: unknown) =>
  err instanceof SessionError && (err.code === 'popup_closed' || err.code === 'access_denied');

interface CodeResponse {
  code?: string;
  error?: string;
  error_description?: string;
}
interface CodeClient {
  requestCode(): void;
}
interface GoogleOauth2 {
  initCodeClient(config: {
    client_id: string;
    scope: string;
    ux_mode: 'popup';
    prompt?: string;
    callback: (r: CodeResponse) => void;
    error_callback?: (e: { type: string }) => void;
  }): CodeClient;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOauth2 } };
  }
}

let gis: Promise<GoogleOauth2> | null = null;

/** Loads Google Identity Services once; call it early (when a sign-in button shows) so the popup opens on the click. */
export function loadGoogleSignIn(): Promise<GoogleOauth2> {
  return (gis ??= new Promise<GoogleOauth2>((resolve, reject) => {
    const ready = () => window.google?.accounts?.oauth2;
    if (ready()) return resolve(ready()!);
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () =>
      ready() ? resolve(ready()!) : reject(new SessionError('Google sign-in did not load.'));
    script.onerror = () => {
      gis = null;
      reject(
        new SessionError('Google sign-in could not load. Check the connection and try again.')
      );
    };
    document.head.appendChild(script);
  }));
}

const toAuthUser = (u: SessionUserJson): AuthUser => ({
  uid: u.sub,
  email: u.email,
  displayName: u.name,
  googleSub: u.sub,
});

async function api<T>(path: string, init: RequestInit = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { ...HEADERS, ...(init.headers as Record<string, string>) },
  });
  let body = {} as Partial<T> & SessionRefusal;
  try {
    body = (await res.json()) as Partial<T> & SessionRefusal;
  } catch {
    // Not JSON: the status says enough.
  }
  return { status: res.status, body };
}

/** Local data a signed-out browser must not keep (the next person on it would see it). */
const signOutHooks = new Set<() => void>();
/** Runs `hook` on sign-out; returns the removal. */
export function onWebSignOut(hook: () => void): () => void {
  signOutHooks.add(hook);
  return () => signOutHooks.delete(hook);
}

let user: AuthUser | null | undefined;
let restoring: Promise<void> | null = null;
let access: { token: string; expiresAt: number } | null = null;
let fetchingToken: Promise<string> | null = null;
/** Google gave no lasting access last time: the next sign-in shows its consent screen. */
let askConsent = false;
const listeners = new Set<(u: AuthUser | null) => void>();

function setUser(next: AuthUser | null) {
  user = next;
  if (!next) access = null;
  listeners.forEach((l) => l(next));
}

function restore() {
  restoring ??= api<SessionAnswer>('/api/session').then(
    ({ status, body }) => setUser(status === 200 && body.user ? toAuthUser(body.user) : null),
    () => setUser(null)
  );
  return restoring;
}

function askForCode(oauth2: GoogleOauth2, consent: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = oauth2.initCodeClient({
      client_id: googleClientId!,
      scope: SESSION_SCOPES.join(' '),
      ux_mode: 'popup',
      ...(consent ? { prompt: 'consent' } : {}),
      callback: (r) =>
        r.code
          ? resolve(r.code)
          : reject(
              new SessionError(
                r.error === 'access_denied'
                  ? 'Sign-in was cancelled.'
                  : `Sign-in failed: ${r.error_description || r.error || 'unknown error'}`,
                r.error
              )
            ),
      error_callback: (e) =>
        reject(
          new SessionError(
            e.type === 'popup_failed_to_open'
              ? 'Your browser blocked the Google sign-in window. Allow pop-ups for this site, then try again.'
              : e.type === 'popup_closed'
                ? 'Sign-in was cancelled.'
                : 'Sign-in failed. Please try again.',
            e.type
          )
        ),
    });
    client.requestCode();
  });
}

/**
 * A short-lived access token for the account's Drive app-data folder, from the
 * server's session; `refresh` asks for a new one (Drive refused the last).
 * Signs the page out when the server says the session is over.
 */
export const driveAccessToken: TokenSource = async ({ refresh }) => {
  if (!refresh && access && access.expiresAt - Date.now() > EARLY_MS) return access.token;
  fetchingToken ??= (async () => {
    try {
      const { status, body } = await api<AccessAnswer>('/api/session/token', { method: 'POST' });
      if (status === 401 && body.signedOut) {
        setUser(null);
        throw new SessionError(body.error || 'You are signed out.', 'signed-out');
      }
      if (status !== 200 || !body.accessToken || !body.expiresAt)
        throw new SessionError(body.error || 'Could not get access to Google Drive.', 'token');
      access = { token: body.accessToken, expiresAt: body.expiresAt };
      return access.token;
    } finally {
      fetchingToken = null;
    }
  })();
  return fetchingToken;
};

/** The website's Google session (null provider when this website has no Google client id). */
export const googleWebSession: SessionProvider = {
  subscribe(listener) {
    listeners.add(listener);
    if (!googleClientId) listener(null);
    else if (user !== undefined) listener(user);
    else void restore();
    return () => {
      listeners.delete(listener);
    };
  },

  async signIn() {
    if (!googleClientId) throw new SessionError('Google sign-in is not set up on this website.');
    const oauth2 = await loadGoogleSignIn();
    const code = await askForCode(oauth2, askConsent);
    const { status, body } = await api<AccessAnswer>('/api/session/google', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    if (status === 409 && body.code === 'needs-consent') {
      // A second popup here would be blocked (no click behind it), so the next
      // click asks again, showing Google's consent screen.
      askConsent = true;
      throw new SessionError(
        'Google needs you to confirm access once more: click Sign in again.',
        'needs-consent'
      );
    }
    if (status !== 200 || !body.user || !body.accessToken || !body.expiresAt)
      throw new SessionError(body.error || 'Sign-in failed. Please try again.', body.code);
    askConsent = false;
    access = { token: body.accessToken, expiresAt: body.expiresAt };
    setUser(toAuthUser(body.user));
  },

  async signOut() {
    signOutHooks.forEach((hook) => hook());
    // Shared with Demo Mode (App writes it for every source): keep it per person.
    removeStored('cachedSets');
    // Never revoked (the API only forgets the cookie): Google ties the grant to
    // the project, so a revoke would also cut the desktop's Drive access.
    await api('/api/session/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  },

  // There is no allowlist in front of the account's own Drive folder.
  async hasAccess() {
    return true;
  },
};
