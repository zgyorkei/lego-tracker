// The website's own Google session, for a copy that reads the desktop's data
// through Google Drive (local-storage plan, Phase 6). The page signs in with
// Google Identity Services' code popup; the API (lib/server-api.ts) exchanges
// the code, keeps the refresh token sealed in an httpOnly cookie, and gives
// the page only short-lived Drive access tokens and who is signed in.
//
// Pure apart from the crypto: no I/O and no clocks (callers pass the time), so
// every rule here is tested. Server-only: never import this from src/.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { isGoogleSub } from './data/storeBridge.js';
import { ENV_NAMES, readEnv } from './envSettings.js';
import { DRIVE_APPDATA_SCOPE, REQUESTED_WITH } from './sessionProtocol.js';

export { DRIVE_APPDATA_SCOPE, REQUESTED_WITH, SESSION_SCOPES } from './sessionProtocol.js';

/** `__Host-`: the browser keeps it only Secure, on Path=/, and for this exact host. */
export const SESSION_COOKIE = '__Host-bt_session';
/** How long the browser keeps the cookie (Google keeps the grant until revoked or unused for 6 months). */
export const SESSION_MAX_AGE_S = 180 * 24 * 60 * 60;
/** SESSION_SECRET is refused when shorter: it is the only thing keeping the refresh token sealed. */
export const MIN_SECRET_LENGTH = 32;

const FORMAT = 'v1';
const SALT = 'brick-tracker/web-session';
const AAD = Buffer.from(SESSION_COOKIE);

export interface GoogleIdentity {
  sub: string;
  email: string | null;
  name: string | null;
}

export interface WebSession extends GoogleIdentity {
  v: 1;
  refreshToken: string;
  /** When the session was made (ms). */
  issuedAt: number;
}

const isWebSession = (s: unknown): s is WebSession => {
  const o = s as Record<string, unknown> | null;
  return (
    !!o &&
    o.v === 1 &&
    isGoogleSub(o.sub) &&
    typeof o.refreshToken === 'string' &&
    o.refreshToken.length > 0 &&
    typeof o.issuedAt === 'number' &&
    (o.email === null || typeof o.email === 'string') &&
    (o.name === null || typeof o.name === 'string')
  );
};

/**
 * The id a secret's key goes by. A sealed value names it, so one sealed under
 * an earlier SESSION_SECRET reads as "no session", never as garbage.
 */
export function keyId(secret: string): string {
  return createHash('sha256').update(`bt-key-id:${secret}`).digest('base64url').slice(0, 8);
}

function keyFor(secret: string, kid: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, SALT, `bt-session:${kid}`, 32));
}

/** AES-256-GCM under a key derived (HKDF-SHA256) from the secret: `v1.<kid>.<iv>.<ciphertext>.<tag>`. */
export function seal(session: WebSession, secret: string): string {
  const kid = keyId(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret, kid), iv);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
  return [
    FORMAT,
    kid,
    iv.toString('base64url'),
    body.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.');
}

/** The session a sealed value holds, or null for anything else (tampered, another secret, malformed). */
export function unseal(value: string | null | undefined, secret: string): WebSession | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 5 || parts[0] !== FORMAT) return null;
  const [, kid, iv, body, tag] = parts;
  if (kid !== keyId(secret)) return null;
  try {
    // A fixed tag length: GCM would otherwise accept a truncated tag.
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyFor(secret, kid),
      Buffer.from(iv, 'base64url'),
      {
        authTagLength: 16,
      }
    );
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const json = Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const session: unknown = JSON.parse(json);
    return isWebSession(session) ? session : null;
  } catch {
    return null;
  }
}

// ---- cookies ----------------------------------------------------------------------------------

/** The Set-Cookie value holding a sealed session. */
export function sessionCookie(sealed: string, maxAgeS = SESSION_MAX_AGE_S): string {
  return `${SESSION_COOKIE}=${sealed}; Path=/; Max-Age=${maxAgeS}; HttpOnly; Secure; SameSite=Strict`;
}

/** The Set-Cookie value that removes the session. */
export const clearedSessionCookie = () => sessionCookie('', 0);

/** One cookie's value from a Cookie header, or null. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

// ---- the ID token -----------------------------------------------------------------------------

/** A JWT's payload, unverified: the server has it straight from Google's token endpoint over TLS. */
export function decodeJwtPayload(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
/** Clocks a little apart still agree. */
const SKEW_S = 5 * 60;

/**
 * Who an ID token names, or why it is not accepted: Google issued it, for this
 * app's client, it has not expired, and the address is verified.
 */
export function checkIdToken(
  payload: Record<string, unknown> | null,
  clientId: string,
  nowS: number
): { identity: GoogleIdentity } | { reason: string } {
  if (!payload) return { reason: 'Google did not send who signed in' };
  if (!ISSUERS.includes(String(payload.iss)))
    return { reason: 'The sign-in was not issued by Google' };
  const aud = payload.aud;
  if (!(aud === clientId || (Array.isArray(aud) && aud.includes(clientId))))
    return { reason: 'The sign-in was made for another app' };
  if (typeof payload.exp !== 'number' || payload.exp + SKEW_S < nowS)
    return { reason: 'The sign-in has expired' };
  if (!isGoogleSub(payload.sub)) return { reason: 'Google did not send an account id' };
  if (payload.email_verified !== true && payload.email_verified !== 'true')
    return { reason: 'This Google account has no verified email address' };
  return {
    identity: {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      name: typeof payload.name === 'string' ? payload.name.slice(0, 200) : null,
    },
  };
}

/** Whether Google granted every scope the session needs (it lists them space-separated). */
export const grantsDrive = (scope: unknown) =>
  typeof scope === 'string' && scope.split(/\s+/).includes(DRIVE_APPDATA_SCOPE);

// ---- same-site calls --------------------------------------------------------------------------

export interface CallHeaders {
  method: string;
  origin?: string;
  requestedWith?: string;
  host?: string;
  forwardedHost?: string;
  forwardedProto?: string;
  /** The connection itself is TLS. */
  encrypted: boolean;
}

const first = (v: string | undefined) => v?.split(',')[0]?.trim() || undefined;

/** The site's own origin as the request reached it (behind Vercel's proxy, its forwarded host and scheme). */
export function ownOrigin(
  h: Omit<CallHeaders, 'method' | 'origin' | 'requestedWith'>
): string | null {
  const host = first(h.forwardedHost) ?? h.host;
  if (!host) return null;
  const proto = first(h.forwardedProto) ?? (h.encrypted ? 'https' : 'http');
  return `${proto}://${host}`.toLowerCase();
}

/**
 * Whether a session call comes from this site's own page: it carries our
 * X-Requested-With (which a cross-site page cannot send without a preflight
 * these routes never approve), and anything that changes state also carries
 * this site's Origin. With SameSite=Strict on the cookie, that is the CSRF
 * defence; the routes send no CORS headers at all.
 */
export function isSameSiteCall(h: CallHeaders): boolean {
  if (h.requestedWith !== REQUESTED_WITH) return false;
  if (h.method === 'GET' || h.method === 'HEAD') return true;
  const own = ownOrigin(h);
  return !!own && !!h.origin && h.origin.toLowerCase() === own;
}

// ---- configuration ----------------------------------------------------------------------------

export interface SessionConfig {
  clientId: string;
  clientSecret: string;
  secret: string;
}

/**
 * The website's Google session settings from the environment, or null when
 * any is missing (the routes then say sign-in is not set up). The client id is
 * the one the page uses too; the other two are server-only. Names: ENV_NAMES.
 */
export function sessionConfig(env: Record<string, string | undefined>): SessionConfig | null {
  const clientId = readEnv(env, ENV_NAMES.googleClientId);
  const clientSecret = readEnv(env, ENV_NAMES.googleClientSecret);
  const secret = readEnv(env, ENV_NAMES.sessionSecret);
  if (!clientId || !clientSecret || !secret || secret.length < MIN_SECRET_LENGTH) return null;
  return { clientId, clientSecret, secret };
}
