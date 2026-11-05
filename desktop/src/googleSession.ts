import { safeStorage } from 'electron';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { writeFileAtomicSync } from './store/files';
import {
  DRIVE_SCOPE,
  googleSignIn,
  refreshGoogleTokens,
  SessionRevokedError,
  type OAuthClient,
} from './oauth';

// The desktop's own Google session, for Google Drive (the mailbox the phone
// and website reach this PC's copy through, lib/drive/). Kept only when Drive
// is on: then the sign-in asks for offline access, and the refresh token is
// stored here, encrypted with Windows' DPAPI through Electron's safeStorage,
// in google-session.bin in the app's data folder (never packaged).
//
// Drive access tokens never leave the main process; the page only ever gets
// ID tokens (for Firebase) and the account's name.
//
// Signing out forgets the token on this PC but does not revoke it at Google:
// Google ties consent to the Cloud project, not to one client, so revoking it
// here would also cut the website's and any other PC's Drive access (found in
// the local-storage plan's Spike A/B check).

export interface GoogleAccount {
  sub: string;
  email: string | null;
  name: string | null;
  /** The user granted the app-data folder (they can untick it on the consent screen). */
  drive: boolean;
}

interface Stored {
  refreshToken: string;
  sub: string;
  email: string | null;
  name: string | null;
  scope: string;
}

/** Who an ID token (straight from Google's token endpoint) is for. */
export function claimsOf(idToken: string): {
  sub: string;
  email: string | null;
  name: string | null;
} {
  const payload = JSON.parse(
    Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')
  );
  if (typeof payload.sub !== 'string' || !/^[0-9]{1,64}$/.test(payload.sub))
    throw new Error('Google sent no account id');
  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    name: typeof payload.name === 'string' ? payload.name : null,
  };
}

export class GoogleSession {
  private stored: Stored | null = null;
  private access: { token: string; expiresAt: number } | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private readonly file: string,
    private readonly client: () => OAuthClient
  ) {}

  /** Reads the stored session, if any. Call once the app is ready (safeStorage needs it). */
  load(): void {
    if (!existsSync(this.file) || !safeStorage.isEncryptionAvailable()) return;
    try {
      const v = JSON.parse(safeStorage.decryptString(readFileSync(this.file))) as Stored;
      if (typeof v.refreshToken === 'string' && typeof v.sub === 'string') this.stored = v;
    } catch (err) {
      console.error('Google session: could not read the stored sign-in; it is ignored', err);
    }
  }

  /** Called when the account or its Drive access changes. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed() {
    for (const l of [...this.listeners]) l();
  }

  account(): GoogleAccount | null {
    const s = this.stored;
    return s
      ? {
          sub: s.sub,
          email: s.email,
          name: s.name,
          drive: s.scope.split(' ').includes(DRIVE_SCOPE),
        }
      : null;
  }

  /**
   * The browser sign-in. With `drive`, the Drive session is kept (replacing
   * any before); without, nothing is stored, as before Drive existed.
   * Resolves with the ID token for the page.
   */
  async signIn(drive: boolean): Promise<string> {
    const t = await googleSignIn(this.client(), { drive });
    if (drive && t.refreshToken) {
      this.stored = { refreshToken: t.refreshToken, ...claimsOf(t.idToken), scope: t.scope };
      this.access = { token: t.accessToken, expiresAt: Date.now() + t.expiresIn * 1000 };
      this.persist();
      this.changed();
    }
    return t.idToken;
  }

  /** A Drive access token, for the main process only. */
  async accessToken({ refresh }: { refresh: boolean }): Promise<string> {
    if (!refresh && this.access && this.access.expiresAt - Date.now() > 60_000)
      return this.access.token;
    const t = await this.refresh();
    return t.accessToken;
  }

  /** A fresh Google ID token for the stored account (the page signs in to Firebase with it), or null. */
  async idToken(): Promise<string | null> {
    if (!this.stored) return null;
    return (await this.refresh()).idToken;
  }

  /** Forgets the session on this PC (no revoke: see the top of this file). */
  forget(): void {
    const had = this.stored !== null;
    this.stored = null;
    this.access = null;
    rmSync(this.file, { force: true });
    if (had) this.changed();
  }

  private async refresh() {
    if (!this.stored) throw new Error('Not signed in to Google Drive');
    try {
      const t = await refreshGoogleTokens(this.client(), this.stored.refreshToken);
      this.access = { token: t.accessToken, expiresAt: Date.now() + t.expiresIn * 1000 };
      return t;
    } catch (err) {
      if (err instanceof SessionRevokedError) this.forget();
      throw err;
    }
  }

  private persist() {
    if (!this.stored) return;
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('Google session: Windows encryption is not available; kept until the app quits');
      return;
    }
    writeFileAtomicSync(this.file, safeStorage.encryptString(JSON.stringify(this.stored)));
  }
}
