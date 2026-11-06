/**
 * The desktop browser could not start (Playwright's launch failed or timed out). Every page a refresh still needs
 * would fail the same way, so the whole refresh fails with the reason: a route answers 503 with it, and the desktop
 * worker ends the refresh as failed, rather than each page being skipped as "not found" or the request left
 * unanswered. A plain flag, not a class, so the desktop engine and the routes agree without sharing a module graph.
 */
export interface ScraperUnavailable extends Error {
  scraperUnavailable: true;
}

export function scraperUnavailable(reason: string): ScraperUnavailable {
  return Object.assign(new Error(reason), { scraperUnavailable: true as const });
}

export const isScraperUnavailable = (e: unknown): e is ScraperUnavailable =>
  !!e &&
  typeof e === 'object' &&
  (e as { scraperUnavailable?: unknown }).scraperUnavailable === true;

/** The status a route answers it with; its body is `{ error, scraperUnavailable: true }`. */
export const SCRAPER_UNAVAILABLE_STATUS = 503;
