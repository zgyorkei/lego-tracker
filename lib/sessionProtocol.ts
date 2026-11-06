// What the website's page and its API agree on for the Google session
// (lib/session.ts on the server, src/data/googleWebSession.ts in the page).
// No Node imports: the page bundles this.

/** This app's own folder in the account's Google Drive, nothing else of the user's Drive. */
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
/** What the page asks Google for: who you are, and the Drive folder above. */
export const SESSION_SCOPES = ['openid', 'email', 'profile', DRIVE_APPDATA_SCOPE];
/** The header every session call carries; a cross-site page cannot add it without a preflight the API never answers. */
export const REQUESTED_WITH = 'brick-tracker';

/** Who is signed in, as the API tells the page (never the refresh token). */
export interface SessionUserJson {
  sub: string;
  email: string | null;
  name: string | null;
}

/** GET /api/session */
export interface SessionAnswer {
  /** The server has the three settings it needs. */
  configured: boolean;
  user: SessionUserJson | null;
}

/** POST /api/session/google and POST /api/session/token */
export interface AccessAnswer {
  user: SessionUserJson;
  accessToken: string;
  /** When the access token stops working (ms). */
  expiresAt: number;
}

/** What a refused session call says. */
export interface SessionRefusal {
  error?: string;
  /** 'drive-scope': Drive was not ticked; 'needs-consent': ask again showing Google's consent screen. */
  code?: string;
  /** The session is over (signed out, or Google no longer honours the grant). */
  signedOut?: boolean;
}
