import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { registerApiRoutes } from './server-api.js';
import { REQUESTED_WITH, SESSION_COOKIE } from './session.js';

// The website's own Google session routes (lib/server-api.ts, lib/session.ts),
// with Google's token endpoint faked.

const CLIENT = '123-abc.apps.googleusercontent.com';
const SUB = '112233445566778899';
const DRIVE = 'https://www.googleapis.com/auth/drive.appdata';
const idToken = (p: object = {}) =>
  `h.${Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: CLIENT,
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: SUB,
      email: 'owner@example.com',
      email_verified: true,
      name: 'Owner',
      ...p,
    })
  ).toString('base64url')}.sig`;

type Answer = { status?: number; body: Record<string, unknown> };
let answers: Answer[] = [];
const calls: URLSearchParams[] = [];
const fakeFetch = (async (_url: string, init: RequestInit) => {
  calls.push(new URLSearchParams(String(init.body)));
  const a = answers.shift() ?? { status: 500, body: {} };
  return new Response(JSON.stringify(a.body), {
    status: a.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof fetch;

async function withServer(
  run: (base: string) => Promise<void>,
  options: { webSession?: boolean } = {}
) {
  const app = express();
  registerApiRoutes(app, { rateLimit: false, sessionFetch: fakeFetch, ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

const cookieOf = (res: Response) => {
  const set = res.headers.get('set-cookie') ?? '';
  const m = new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(set);
  return m ? m[1] : null;
};

describe("the website's Google session", () => {
  beforeEach(() => {
    answers = [];
    calls.length = 0;
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
  });
  afterEach(() => vi.unstubAllEnvs());

  const call = (
    base: string,
    path: string,
    init: RequestInit = {},
    extra: Record<string, string> = {}
  ) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: {
        'X-Requested-With': REQUESTED_WITH,
        Origin: base,
        'Content-Type': 'application/json',
        ...extra,
        ...(init.headers as Record<string, string>),
      },
    });

  it('signs in, keeps the session in a sealed cookie, refreshes the Drive token and signs out', async () => {
    await withServer(async (base) => {
      const none = await call(base, '/api/session');
      expect(none.headers.get('cache-control')).toBe('no-store');
      expect(none.headers.get('access-control-allow-origin')).toBeNull();
      expect(await none.json()).toEqual({ configured: true, user: null });

      answers.push({
        body: {
          access_token: 'ya29.first',
          expires_in: 3599,
          refresh_token: '1//refresh',
          id_token: idToken(),
          scope: `openid email profile ${DRIVE}`,
        },
      });
      const signIn = await call(base, '/api/session/google', {
        method: 'POST',
        body: JSON.stringify({ code: '4/code' }),
      });
      expect(signIn.status).toBe(200);
      expect(calls[0].get('code')).toBe('4/code');
      expect(calls[0].get('redirect_uri')).toBe('postmessage');
      const setCookie = signIn.headers.get('set-cookie') ?? '';
      for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/'])
        expect(setCookie).toContain(attr);
      const body = await signIn.json();
      expect(body.user).toEqual({ sub: SUB, email: 'owner@example.com', name: 'Owner' });
      expect(body.accessToken).toBe('ya29.first');
      expect(JSON.stringify(body)).not.toContain('1//refresh');
      const cookie = cookieOf(signIn)!;
      expect(cookie).not.toContain('refresh');

      const withCookie = { Cookie: `${SESSION_COOKIE}=${cookie}` };
      const me = await call(base, '/api/session', {}, withCookie);
      expect((await me.json()).user.sub).toBe(SUB);

      answers.push({ body: { access_token: 'ya29.second', expires_in: 3599 } });
      const token = await call(base, '/api/session/token', { method: 'POST' }, withCookie);
      expect(token.status).toBe(200);
      expect((await token.json()).accessToken).toBe('ya29.second');
      expect(calls[1].get('grant_type')).toBe('refresh_token');
      expect(calls[1].get('refresh_token')).toBe('1//refresh');

      const out = await call(base, '/api/session/logout', { method: 'POST' }, withCookie);
      expect(out.headers.get('set-cookie')).toMatch(
        new RegExp(`^${SESSION_COOKIE}=; Path=/; Max-Age=0`)
      );
      // Never revoked: no further call to Google.
      expect(calls).toHaveLength(2);
    });
  });

  it('refuses calls without our header, or a change from another origin', async () => {
    await withServer(async (base) => {
      expect((await fetch(`${base}/api/session`)).status).toBe(403);
      const cross = await call(
        base,
        '/api/session/google',
        { method: 'POST', body: JSON.stringify({ code: 'x' }) },
        { Origin: 'https://evil.example' }
      );
      expect(cross.status).toBe(403);
      expect(calls).toHaveLength(0);
    });
  });

  it('asks again when Drive was not ticked or Google gave no lasting access', async () => {
    await withServer(async (base) => {
      answers.push({
        body: { access_token: 'a', id_token: idToken(), scope: 'openid email', refresh_token: 'r' },
      });
      const noDrive = await call(base, '/api/session/google', {
        method: 'POST',
        body: '{"code":"c"}',
      });
      expect(noDrive.status).toBe(403);
      expect((await noDrive.json()).code).toBe('drive-scope');
      expect(cookieOf(noDrive)).toBeNull();

      answers.push({ body: { access_token: 'a', id_token: idToken(), scope: DRIVE } });
      const noRefresh = await call(base, '/api/session/google', {
        method: 'POST',
        body: '{"code":"c"}',
      });
      expect(noRefresh.status).toBe(409);
      expect((await noRefresh.json()).code).toBe('needs-consent');
    });
  });

  it('refuses a token for another client or an unverified address', async () => {
    await withServer(async (base) => {
      answers.push({
        body: {
          access_token: 'a',
          refresh_token: 'r',
          scope: DRIVE,
          id_token: idToken({ aud: 'other' }),
        },
      });
      expect(
        (await call(base, '/api/session/google', { method: 'POST', body: '{"code":"c"}' })).status
      ).toBe(401);
      answers.push({
        body: {
          access_token: 'a',
          refresh_token: 'r',
          scope: DRIVE,
          id_token: idToken({ email_verified: false }),
        },
      });
      expect(
        (await call(base, '/api/session/google', { method: 'POST', body: '{"code":"c"}' })).status
      ).toBe(401);
    });
  });

  it("names Google's reason when it refuses the code, and the setting when it refuses the client", async () => {
    await withServer(async (base) => {
      answers.push({ status: 401, body: { error: 'invalid_client' } });
      const badClient = await call(base, '/api/session/google', {
        method: 'POST',
        body: '{"code":"c"}',
      });
      expect(badClient.status).toBe(401);
      const refused = await badClient.json();
      expect(refused.google).toBe('invalid_client');
      expect(refused.error).toContain('client secret on the server');

      answers.push({ status: 400, body: { error: 'invalid_grant' } });
      const badCode = await (
        await call(base, '/api/session/google', { method: 'POST', body: '{"code":"c"}' })
      ).json();
      expect(badCode).toEqual({
        error: 'Google refused the sign-in (invalid_grant). Please try again.',
        google: 'invalid_grant',
      });

      answers.push({ status: 400, body: { error: '<b>not a code</b>' } });
      const odd = await (
        await call(base, '/api/session/google', { method: 'POST', body: '{"code":"c"}' })
      ).json();
      expect(odd.google).toBe('unknown');
    });
  });

  it('ends the session when Google no longer honours the grant', async () => {
    await withServer(async (base) => {
      answers.push({
        body: { access_token: 'a', refresh_token: 'r', scope: DRIVE, id_token: idToken() },
      });
      const cookie = cookieOf(
        await call(base, '/api/session/google', { method: 'POST', body: '{"code":"c"}' })
      )!;
      answers.push({ status: 400, body: { error: 'invalid_grant' } });
      const res = await call(
        base,
        '/api/session/token',
        { method: 'POST' },
        { Cookie: `${SESSION_COOKIE}=${cookie}` }
      );
      expect(res.status).toBe(401);
      expect((await res.json()).signedOut).toBe(true);
      expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    });
  });

  it('says when the website has no Google sign-in set up', async () => {
    vi.stubEnv('SESSION_SECRET', '');
    await withServer(async (base) => {
      expect(await (await call(base, '/api/session')).json()).toEqual({
        configured: false,
        user: null,
      });
      expect(
        (await call(base, '/api/session/google', { method: 'POST', body: '{"code":"c"}' })).status
      ).toBe(503);
    });
  });

  it('is not there on the desktop', async () => {
    await withServer(
      async (base) => {
        expect((await call(base, '/api/session')).status).toBe(404);
      },
      { webSession: false }
    );
  });
});
