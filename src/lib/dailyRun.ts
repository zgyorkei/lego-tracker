// The desktop app's daily 4AM refresh: which "refresh day" it is, and when
// to run it here without Firebase.

/**
 * The refresh day for a time: it starts at 04:00 local, so 00:00-03:59 still
 * counts as the previous day. The run therefore fires at 4AM, or on the first
 * check after it if the PC was off then.
 */
export function quotaDay(now: Date): string {
  const shifted = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

/** Failed attempts at the shared request (one a minute) before the run happens here instead. */
export const LOCAL_RUN_AFTER_FAILURES = 3;

/**
 * The run is normally a shared request in Firestore, so several desktops run
 * it once. While Firebase is failing, that request cannot be made; after a
 * few failed attempts the run happens on this PC alone, guarded by the day it
 * last ran here, so the prices still refresh.
 */
export function shouldRunLocally(opts: {
  lastRunDay: string;
  day: string;
  failures: number;
  firebaseProblem: boolean;
}): boolean {
  return (
    opts.lastRunDay !== opts.day &&
    opts.firebaseProblem &&
    opts.failures >= LOCAL_RUN_AFTER_FAILURES
  );
}
