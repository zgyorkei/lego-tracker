import { shell } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import { readFileSync } from 'node:fs';

// Google sign-in for the desktop app.
//
// Firebase's signInWithPopup cannot work here: Google refuses OAuth inside
// embedded browsers such as Electron's. Instead this runs the standard
// desktop flow (RFC 8252): open Google in the user's normal browser, receive
// the authorisation code on a one-off loopback port, and exchange it with PKCE.
// The resulting Google ID token is handed to the renderer, which signs in to
// Firebase with signInWithCredential.

export interface OAuthClient {
  client_id: string;
  client_secret: string;
}

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

const base64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Reads the "Desktop app" client JSON downloaded from the Google Cloud console. */
export function loadOAuthClient(file: string): OAuthClient {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const c = json.installed ?? json;
  if (typeof c?.client_id !== 'string' || typeof c?.client_secret !== 'string') {
    throw new Error(`${file} is not a Google "Desktop app" OAuth client file`);
  }
  return { client_id: c.client_id, client_secret: c.client_secret };
}

const PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>Brick Tracker</title>` +
  `<body style="font-family:system-ui;display:grid;place-items:center;height:90vh">` +
  `<p style="font-size:1.2rem;font-weight:700">${message}</p></body>`;

/** Runs the browser sign-in and resolves with a Google ID token. */
export async function googleSignIn(client: OAuthClient): Promise<string> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));

  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as { port: number };
  const redirectUri = `http://127.0.0.1:${port}`;

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sign-in timed out')), SIGN_IN_TIMEOUT_MS);
      server.on('request', (req, res) => {
        const url = new URL(req.url || '/', redirectUri);
        // Browsers also ask for /favicon.ico; only the callback matters.
        if (url.pathname !== '/') {
          res.writeHead(404).end();
          return;
        }
        const error = url.searchParams.get('error');
        const gotCode = url.searchParams.get('code');
        // The state check stops another local page from injecting its own code.
        if (url.searchParams.get('state') !== state || (!gotCode && !error)) {
          res.writeHead(400, { 'Content-Type': 'text/html' }).end(PAGE('Invalid sign-in response.'));
          return;
        }
        clearTimeout(timer);
        if (error || !gotCode) {
          res.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE('Sign-in was cancelled. You can close this tab.'));
          reject(new Error(error === 'access_denied' ? 'Sign-in was cancelled' : `Sign-in failed: ${error}`));
          return;
        }
        res
          .writeHead(200, { 'Content-Type': 'text/html' })
          .end(PAGE('Signed in. You can close this tab and return to Brick Tracker.'));
        resolve(gotCode);
      });

      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        prompt: 'select_account',
      }).toString();
      shell.openExternal(auth.toString()).catch(reject);
    });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: client.client_id,
        client_secret: client.client_secret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
    const body = (await tokenRes.json().catch(() => ({}))) as { id_token?: string; error?: string };
    if (!tokenRes.ok || !body.id_token) {
      throw new Error(`Token exchange failed: ${body.error || tokenRes.status}`);
    }
    return body.id_token;
  } finally {
    server.close();
  }
}
