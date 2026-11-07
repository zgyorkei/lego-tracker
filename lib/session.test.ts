import { describe, expect, it } from 'vitest';
import {
  REQUESTED_WITH,
  SESSION_COOKIE,
  checkIdToken,
  clearedSessionCookie,
  decodeJwtPayload,
  grantsDrive,
  isSameSiteCall,
  keyId,
  ownOrigin,
  readCookie,
  seal,
  sessionConfig,
  sessionCookie,
  unseal,
  type WebSession,
} from './session';

const SECRET = 'a'.repeat(40);
const SESSION: WebSession = {
  v: 1,
  sub: '112233445566778899',
  email: 'owner@example.com',
  name: 'Owner',
  refreshToken: '1//refresh-token-value',
  issuedAt: 1_790_000_000_000,
};

describe('seal / unseal', () => {
  it('round-trips a session', () => {
    expect(unseal(seal(SESSION, SECRET), SECRET)).toEqual(SESSION);
  });

  it('seals the same session differently each time (random IV)', () => {
    expect(seal(SESSION, SECRET)).not.toBe(seal(SESSION, SECRET));
  });

  it('does not show the refresh token or the email in the sealed value', () => {
    const sealed = seal(SESSION, SECRET);
    expect(sealed).not.toContain('refresh-token');
    expect(sealed).not.toContain('owner@example.com');
  });

  it('names its key, and reads as no session under another secret', () => {
    const sealed = seal(SESSION, SECRET);
    expect(sealed.split('.')[1]).toBe(keyId(SECRET));
    expect(unseal(sealed, 'b'.repeat(40))).toBeNull();
  });

  it('refuses a tampered value', () => {
    const parts = seal(SESSION, SECRET).split('.');
    const body = Buffer.from(parts[3], 'base64url');
    body[0] ^= 1;
    parts[3] = body.toString('base64url');
    expect(unseal(parts.join('.'), SECRET)).toBeNull();
  });

  it('refuses a truncated tag', () => {
    const parts = seal(SESSION, SECRET).split('.');
    parts[4] = Buffer.from(parts[4], 'base64url').subarray(0, 4).toString('base64url');
    expect(unseal(parts.join('.'), SECRET)).toBeNull();
  });

  it('refuses anything that is not a sealed session', () => {
    expect(unseal(undefined, SECRET)).toBeNull();
    expect(unseal('', SECRET)).toBeNull();
    expect(unseal('v1.x.y.z', SECRET)).toBeNull();
    expect(unseal('v2.a.b.c.d', SECRET)).toBeNull();
    const notASession = { ...SESSION, sub: '../etc' } as unknown as WebSession;
    expect(unseal(seal(notASession, SECRET), SECRET)).toBeNull();
  });
});

describe('cookies', () => {
  it('sets the session cookie with the __Host- rules', () => {
    const c = sessionCookie('v1.abc');
    expect(c.startsWith(`${SESSION_COOKIE}=v1.abc;`)).toBe(true);
    for (const attr of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict'])
      expect(c).toContain(attr);
    expect(c).not.toMatch(/Domain=/i);
  });

  it('clears it with Max-Age=0', () => {
    expect(clearedSessionCookie()).toMatch(new RegExp(`^${SESSION_COOKIE}=; Path=/; Max-Age=0;`));
  });

  it('reads one cookie from a header', () => {
    const header = `theme=dark; ${SESSION_COOKIE}=v1.a.b.c.d ; other=1`;
    expect(readCookie(header, SESSION_COOKIE)).toBe('v1.a.b.c.d');
    expect(readCookie(header, 'missing')).toBeNull();
    expect(readCookie(undefined, SESSION_COOKIE)).toBeNull();
    expect(readCookie(`${SESSION_COOKIE}=`, SESSION_COOKIE)).toBeNull();
  });
});

describe('the ID token', () => {
  const CLIENT = '123-abc.apps.googleusercontent.com';
  const NOW = 1_790_000_000;
  const good = {
    iss: 'https://accounts.google.com',
    aud: CLIENT,
    exp: NOW + 3600,
    sub: '112233445566778899',
    email: 'owner@example.com',
    email_verified: true,
    name: 'Owner',
  };
  const jwt = (p: object) => `x.${Buffer.from(JSON.stringify(p)).toString('base64url')}.sig`;

  it('decodes a JWT payload', () => {
    expect(decodeJwtPayload(jwt(good))).toEqual(good);
    expect(decodeJwtPayload('not.a')).toBeNull();
    expect(decodeJwtPayload('a.!!!.c')).toBeNull();
    expect(decodeJwtPayload(42)).toBeNull();
  });

  it('accepts a token for this client with a verified address', () => {
    expect(checkIdToken(good, CLIENT, NOW)).toEqual({
      identity: { sub: good.sub, email: good.email, name: 'Owner' },
    });
    expect('identity' in checkIdToken({ ...good, iss: 'accounts.google.com' }, CLIENT, NOW)).toBe(
      true
    );
  });

  it('refuses another issuer, another audience, an expired token, no sub, an unverified address', () => {
    const bad = (p: object) => 'reason' in checkIdToken({ ...good, ...p }, CLIENT, NOW);
    expect(bad({ iss: 'https://evil.example' })).toBe(true);
    expect(bad({ aud: 'other.apps.googleusercontent.com' })).toBe(true);
    expect(bad({ exp: NOW - 3600 })).toBe(true);
    expect(bad({ sub: undefined })).toBe(true);
    expect(bad({ sub: 'not-digits' })).toBe(true);
    expect(bad({ email_verified: false })).toBe(true);
    expect('reason' in checkIdToken(null, CLIENT, NOW)).toBe(true);
  });

  it('tells whether Drive was granted', () => {
    expect(grantsDrive('openid https://www.googleapis.com/auth/drive.appdata email')).toBe(true);
    expect(grantsDrive('openid email profile')).toBe(false);
    expect(grantsDrive(undefined)).toBe(false);
  });
});

describe('same-site calls', () => {
  const site = { host: 'lego.example.com', encrypted: true };

  it("works out the site's own origin, behind a proxy too", () => {
    expect(ownOrigin(site)).toBe('https://lego.example.com');
    expect(ownOrigin({ host: 'localhost:3000', encrypted: false })).toBe('http://localhost:3000');
    expect(
      ownOrigin({
        host: 'internal:8080',
        forwardedHost: 'lego.example.com, proxy',
        forwardedProto: 'https',
        encrypted: false,
      })
    ).toBe('https://lego.example.com');
    expect(ownOrigin({ encrypted: true })).toBeNull();
  });

  it('needs our X-Requested-With on every call', () => {
    expect(isSameSiteCall({ ...site, method: 'GET', requestedWith: REQUESTED_WITH })).toBe(true);
    expect(isSameSiteCall({ ...site, method: 'GET' })).toBe(false);
    expect(isSameSiteCall({ ...site, method: 'GET', requestedWith: 'XMLHttpRequest' })).toBe(false);
  });

  it("needs the site's own Origin on a call that changes something", () => {
    const post = { ...site, method: 'POST', requestedWith: REQUESTED_WITH };
    expect(isSameSiteCall({ ...post, origin: 'https://lego.example.com' })).toBe(true);
    expect(isSameSiteCall({ ...post, origin: 'https://evil.example' })).toBe(false);
    expect(isSameSiteCall({ ...post, origin: 'http://lego.example.com' })).toBe(false);
    expect(isSameSiteCall(post)).toBe(false);
  });
});

describe('sessionConfig', () => {
  const env = {
    VITE_GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    SESSION_SECRET: 'x'.repeat(32),
  };

  it('needs all three settings and a long enough secret', () => {
    expect(sessionConfig(env)).toEqual({
      clientId: env.VITE_GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      clientSecretFrom: 'GOOGLE_CLIENT_SECRET',
      secret: env.SESSION_SECRET,
    });
    expect(sessionConfig({ ...env, GOOGLE_CLIENT_SECRET: '' })).toBeNull();
    expect(sessionConfig({ ...env, VITE_GOOGLE_CLIENT_ID: undefined })).toBeNull();
    expect(sessionConfig({ ...env, SESSION_SECRET: 'short' })).toBeNull();
  });

  it('reads the alternative names first', () => {
    const renamed = {
      ...env,
      NEW_GOOGLE_CLIENT_CONFIG: 'new.apps.googleusercontent.com',
      GOOGLE_CLIENT_CONFIG: 'new-secret',
      SESSION_CONFIG_2: 'y'.repeat(32),
    };
    expect(sessionConfig(renamed)).toEqual({
      clientId: 'new.apps.googleusercontent.com',
      clientSecret: 'new-secret',
      clientSecretFrom: 'GOOGLE_CLIENT_CONFIG',
      secret: 'y'.repeat(32),
    });
    expect(sessionConfig({ ...renamed, SESSION_CONFIG_2: 'short' })).toBeNull();
  });
});
