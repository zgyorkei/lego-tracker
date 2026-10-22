import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { registerApiRoutes, type PriceScraper } from '../../lib/server-api';

/**
 * Serves the built web app and the shared API on loopback.
 *
 * The same registerApiRoutes as server.ts and api/index.ts, so routes cannot
 * drift between the three; the only difference is the injected scraper, which
 * makes the price routes read pages with Playwright instead of asking Gemini.
 *
 * Bound to 127.0.0.1 only: the API is unauthenticated, so it must never be
 * reachable from the network. The port is fixed because the page origin
 * (http://localhost:PORT) keys the Firebase sign-in and localStorage; a
 * random port would sign the user out on every launch.
 */
export function startLocalServer(opts: { port: number; distDir: string; scraper: PriceScraper }): Promise<http.Server> {
  const app = express();
  registerApiRoutes(app, { scraper: opts.scraper });
  app.use(express.static(opts.distDir, { index: false }));
  // SPA fallback (registry links etc.); /api/* already ended in a JSON 404.
  app.get('*', (_req, res) => res.sendFile(path.join(opts.distDir, 'index.html')));

  const server = http.createServer(app);
  // A scheduled refresh scrapes every set in one request and can run for
  // several minutes; Node's default 5-minute request timeout would cut it off.
  server.requestTimeout = 0;
  server.timeout = 0;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => resolve(server));
  });
}
