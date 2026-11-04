import { describe, expect, it } from 'vitest';
import { LOCAL_RUN_AFTER_FAILURES, quotaDay, shouldRunLocally } from './dailyRun';

describe('quotaDay', () => {
  it('starts the refresh day at 04:00 local', () => {
    expect(quotaDay(new Date(2026, 10, 5, 3, 59))).toBe('2026-11-04');
    expect(quotaDay(new Date(2026, 10, 5, 4, 0))).toBe('2026-11-05');
    expect(quotaDay(new Date(2026, 0, 1, 2, 0))).toBe('2025-12-31');
  });
});

describe('shouldRunLocally', () => {
  const base = {
    lastRunDay: '2026-11-04',
    day: '2026-11-05',
    failures: LOCAL_RUN_AFTER_FAILURES,
    firebaseProblem: true,
  };
  it('runs here after a few failures while Firebase has a problem', () => {
    expect(shouldRunLocally(base)).toBe(true);
  });
  it('does not run twice a day, too early, or when Firebase is merely slow', () => {
    expect(shouldRunLocally({ ...base, lastRunDay: '2026-11-05' })).toBe(false);
    expect(shouldRunLocally({ ...base, failures: LOCAL_RUN_AFTER_FAILURES - 1 })).toBe(false);
    expect(shouldRunLocally({ ...base, firebaseProblem: false })).toBe(false);
  });
});
