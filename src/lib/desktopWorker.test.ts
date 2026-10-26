import { describe, it, expect } from 'vitest';
import {
  CLAIM_TIMEOUT_MS,
  DAILY_RETRY_MS,
  MAX_REQUEST_SETS,
  ONLINE_WINDOW_MS,
  RUN_TIMEOUT_MS,
  STALE_PENDING_MS,
  canCancel,
  dailyRequestId,
  dailyRunAction,
  isDesktopOnline,
  newRequest,
  newRequestId,
  outcomeFor,
  shouldClaim,
} from './desktopWorker';

const now = Date.parse('2026-10-26T12:00:00Z');
const ago = (msAgo: number) => new Date(now - msAgo).toISOString();

describe('isDesktopOnline', () => {
  it('is online within the window and offline after it', () => {
    expect(isDesktopOnline(ago(60_000), now)).toBe(true);
    expect(isDesktopOnline(ago(ONLINE_WINDOW_MS + 1), now)).toBe(false);
  });
  it('tolerates a slightly fast desktop clock but not nonsense', () => {
    expect(isDesktopOnline(ago(-30_000), now)).toBe(true);
    expect(isDesktopOnline(ago(-ONLINE_WINDOW_MS * 10), now)).toBe(false);
    expect(isDesktopOnline(null, now)).toBe(false);
    expect(isDesktopOnline('not a date', now)).toBe(false);
  });
});

describe('shouldClaim', () => {
  it('claims fresh pending requests only', () => {
    expect(shouldClaim({ status: 'pending', requestedAt: ago(5_000) }, now)).toBe(true);
    expect(shouldClaim({ status: 'running', requestedAt: ago(5_000) }, now)).toBe(false);
    expect(shouldClaim({ status: 'cancelled', requestedAt: ago(5_000) }, now)).toBe(false);
    expect(shouldClaim(undefined, now)).toBe(false);
  });
  it('never claims a request the website has had time to give up on', () => {
    expect(STALE_PENDING_MS).toBeGreaterThan(CLAIM_TIMEOUT_MS);
    expect(shouldClaim({ status: 'pending', requestedAt: ago(STALE_PENDING_MS + 1) }, now)).toBe(false);
  });
});

describe('dailyRunAction', () => {
  it('creates the day\'s run once and reports it done for every desktop', () => {
    expect(dailyRunAction(undefined, now)).toBe('create');
    expect(dailyRunAction({ status: 'done', requestedAt: ago(3_600_000) }, now)).toBe('done');
  });
  it('waits while another desktop is on it', () => {
    expect(dailyRunAction({ status: 'pending', requestedAt: ago(5_000) }, now)).toBe('wait');
    expect(dailyRunAction({ status: 'running', requestedAt: ago(600_000), claimedAt: ago(600_000) }, now)).toBe('wait');
  });
  it('retries a failed, unclaimed or abandoned run, but not straight away', () => {
    expect(dailyRunAction({ status: 'failed', requestedAt: ago(0), finishedAt: ago(60_000) }, now)).toBe('wait');
    expect(dailyRunAction({ status: 'failed', requestedAt: ago(0), finishedAt: ago(DAILY_RETRY_MS + 1) }, now)).toBe('retry');
    expect(dailyRunAction({ status: 'pending', requestedAt: ago(STALE_PENDING_MS + 1) }, now)).toBe('retry');
    expect(dailyRunAction({ status: 'running', requestedAt: ago(0), claimedAt: ago(RUN_TIMEOUT_MS + 1) }, now)).toBe('retry');
  });
  it('builds a per-day id the rules accept', () => {
    expect(dailyRequestId('AbC123xyz', '2026-10-26')).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

describe('request lifecycle', () => {
  it('only a pending request can be cancelled', () => {
    expect(canCancel({ status: 'pending' })).toBe(true);
    expect(canCancel({ status: 'running' })).toBe(false);
  });
  it('maps statuses to what the website does next', () => {
    expect(outcomeFor('done')).toBe('done');
    expect(outcomeFor('failed')).toBe('failed');
    expect(outcomeFor('cancelled')).toBe('unavailable');
    expect(outcomeFor('pending')).toBeNull();
    expect(outcomeFor('running')).toBeNull();
  });
  it('builds requests the rules accept', () => {
    const r = newRequest('uid', 'prices', ['a', 'b', 'a'], new Date(now));
    expect(r).toEqual({ userId: 'uid', kind: 'prices', setIds: ['a', 'b'], status: 'pending', requestedAt: '2026-10-26T12:00:00.000Z' });
    expect(newRequest('uid', 'all', Array.from({ length: 600 }, (_, i) => `s${i}`)).setIds).toHaveLength(MAX_REQUEST_SETS);
    expect(newRequestId()).toMatch(/^[0-9a-f]{24}$/);
  });
});
