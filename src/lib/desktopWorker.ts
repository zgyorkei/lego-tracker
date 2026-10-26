// ---------------------------------------------------------------------------
// The desktop app as the website's scraper.
//
// The desktop app reads shop pages with a real browser on the owner's home
// connection, which gets past bot checks that block Vercel's data-centre IPs,
// and spends no AI tokens. So when it is running, the website hands it the
// refresh instead of asking Gemini:
//
//   website  -> refreshRequests/{id}  status "pending"
//   desktop  -> claims it              status "running"   (transaction)
//   desktop  -> runs the refresh, writes the sets as usual
//   desktop  -> finishes it            status "done" | "failed"
//
// The website falls back to Gemini when the desktop has not been seen
// recently, does not claim the request in time (it then cancels it, also in a
// transaction, so the desktop cannot pick it up afterwards), or reports a
// failure. These are the pure parts of that protocol; the Firestore side is
// in src/hooks/useDesktopWorker.ts.
// ---------------------------------------------------------------------------

export const DESKTOP_STATUS_COLLECTION = 'desktopStatus';
export const REFRESH_REQUESTS_COLLECTION = 'refreshRequests';

/** How often the desktop app says it is alive. */
export const HEARTBEAT_MS = 2 * 60 * 1000;
/** A desktop not seen for this long is treated as offline. */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;
/** How long the website waits for the desktop to claim a request. */
export const CLAIM_TIMEOUT_MS = 45 * 1000;
/** How long the website waits for a claimed request to finish. */
export const RUN_TIMEOUT_MS = 45 * 60 * 1000;
/** Pending requests older than this are never picked up (the website gave up). */
export const STALE_PENDING_MS = CLAIM_TIMEOUT_MS + 15 * 1000;

/** Matches the refreshRequests rule's cap. */
export const MAX_REQUEST_SETS = 500;

/**
 * all: set details and images, then market prices ("Update all").
 * details: set details and images only (a card's info refresh, new sets).
 * prices: market prices only (a card's price refresh).
 */
export type RefreshKind = 'all' | 'details' | 'prices';
export type RequestStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface RefreshRequest {
  userId: string;
  kind: RefreshKind;
  setIds: string[];
  status: RequestStatus;
  requestedAt: string;
  claimedAt?: string;
  finishedAt?: string;
  error?: string;
}

/**
 * What a website caller should do next. Only "done" means the desktop did the
 * work; on anything else the caller runs its own (Gemini) path.
 */
export type DelegateOutcome = 'done' | 'failed' | 'unavailable';

const ms = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Whether a desktop heartbeat is recent enough to hand it work. */
export function isDesktopOnline(lastSeenAt: string | null | undefined, now = Date.now()): boolean {
  const seen = ms(lastSeenAt);
  // A heartbeat from a clock slightly ahead still counts as recent.
  return seen != null && now - seen < ONLINE_WINDOW_MS && seen - now < ONLINE_WINDOW_MS;
}

/** Whether the desktop should claim this request now. */
export function shouldClaim(req: Pick<RefreshRequest, 'status' | 'requestedAt'> | undefined, now = Date.now()): boolean {
  if (!req || req.status !== 'pending') return false;
  const asked = ms(req.requestedAt);
  return asked != null && now - asked < STALE_PENDING_MS;
}

/** Whether a website that stopped waiting may cancel the request. */
export const canCancel = (req: Pick<RefreshRequest, 'status'> | undefined): boolean => req?.status === 'pending';

/** The outcome a website waiter reports for a request's current state, or null to keep waiting. */
export function outcomeFor(status: RequestStatus | undefined): DelegateOutcome | null {
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'unavailable';
  return null;
}

/** A new request document; set ids are de-duplicated and capped. */
export function newRequest(userId: string, kind: RefreshKind, setIds: string[], now = new Date()): RefreshRequest {
  return {
    userId,
    kind,
    setIds: [...new Set(setIds)].slice(0, MAX_REQUEST_SETS),
    status: 'pending',
    requestedAt: now.toISOString(),
  };
}

// ---- The daily 4AM refresh -------------------------------------------------
//
// Each desktop app used to run its own 4AM refresh, so two machines signed in
// to the same account loaded every shop page twice and wrote two price-history
// entries per set per day. Now the run is a request with a fixed id per day:
// whichever desktop finds it missing creates it, the normal worker claim makes
// exactly one desktop run it, and every desktop sees when it is done.

/** After a failed daily run, wait this long before trying again. */
export const DAILY_RETRY_MS = 30 * 60 * 1000;

/** The day's request id; satisfies isValidId (Firebase uids are alphanumeric). */
export const dailyRequestId = (uid: string, day: string) => `daily-${uid}-${day}`;

/**
 * create: no request for today yet. retry: today's run failed (or was
 * abandoned) long enough ago to try again. done: finished, by any desktop.
 * wait: someone is on it.
 */
export type DailyRunAction = 'create' | 'retry' | 'done' | 'wait';

export function dailyRunAction(
  existing: Pick<RefreshRequest, 'status' | 'requestedAt' | 'claimedAt' | 'finishedAt'> | undefined,
  now = Date.now()
): DailyRunAction {
  if (!existing) return 'create';
  switch (existing.status) {
    case 'done':
      return 'done';
    case 'failed':
    case 'cancelled':
      return now - (ms(existing.finishedAt) ?? 0) > DAILY_RETRY_MS ? 'retry' : 'wait';
    case 'pending':
      // Nobody claimed it in time (every desktop busy or gone): make it fresh.
      return shouldClaim(existing, now) ? 'wait' : 'retry';
    case 'running':
      // A desktop that died mid-run leaves it running; give up on it eventually.
      return now - (ms(existing.claimedAt) ?? 0) > RUN_TIMEOUT_MS ? 'retry' : 'wait';
    default:
      return 'wait';
  }
}

/** Random request id that satisfies the rules' isValidId. */
export function newRequestId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
