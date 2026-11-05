import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { AuthUser } from '../data/types';
import { getDb } from '../lib/firebase';
import { desktopConfig, isDesktopApp } from '../lib/platform';
import type { DesktopDriveBridge, DriveRefresh } from '../../lib/drive/bridge';
import {
  CLAIM_TIMEOUT_MS,
  DESKTOP_STATUS_COLLECTION,
  HEARTBEAT_MS,
  REFRESH_REQUESTS_COLLECTION,
  RUN_TIMEOUT_MS,
  canCancel,
  dailyRequestId,
  dailyRunAction,
  isDesktopOnline,
  newRequest,
  newRequestId,
  outcomeFor,
  shouldClaim,
  type DailyRunAction,
  type DelegateOutcome,
  type RefreshKind,
  type RefreshRequest,
} from '../lib/desktopWorker';

/** Runs one claimed request on the desktop. Resolves when the refresh has finished. */
export type RunRefresh = (kind: RefreshKind, setIds: string[]) => Promise<void>;

/**
 * Desktop scheduler: makes sure today's 4AM refresh exists as a request (see
 * dailyRunAction). The worker in whichever desktop claims it first runs it, so
 * with several machines signed in it runs once. "done" means some desktop
 * finished today's run and the caller can stop checking for the day.
 */
export async function scheduleDailyRun(
  uid: string,
  day: string,
  setIds: string[]
): Promise<DailyRunAction> {
  const db = getDb();
  const ref = doc(db, REFRESH_REQUESTS_COLLECTION, dailyRequestId(uid, day));
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const action = dailyRunAction(snap.exists() ? (snap.data() as RefreshRequest) : undefined);
    // A full replacement, so a retry starts clean (no stale claim or error).
    if (action === 'create' || action === 'retry') tx.set(ref, newRequest(uid, 'prices', setIds));
    return action;
  });
}

/** One refresh for the desktop to run, from whichever channel asked. */
interface RefreshJob {
  kind: RefreshKind;
  setIds: string[];
  /** Takes the job (a Firestore claim); false: another desktop has it, or it lapsed. */
  claim(): Promise<boolean>;
  finish(outcome: 'done' | 'failed', error?: string): Promise<void>;
}

/** Where refresh jobs come from: the website's Firestore requests, or Drive ops. */
interface WorkerChannel {
  /** Starts delivering jobs; returns the stop. */
  start(submit: (job: RefreshJob) => void): () => void;
}

/** Today's protocol: heartbeat in desktopStatus, claims on refreshRequests. */
function firestoreChannel(uid: string): WorkerChannel {
  return {
    start(submit) {
      const db = getDb();
      const beat = () =>
        setDoc(doc(db, DESKTOP_STATUS_COLLECTION, uid), {
          lastSeenAt: new Date().toISOString(),
        }).catch((err) =>
          console.warn(
            'Desktop heartbeat failed (is the desktopStatus rule in the Firebase store?)',
            err
          )
        );
      void beat();
      const timer = setInterval(() => void beat(), HEARTBEAT_MS);
      const inFlight = new Set<string>();

      const job = (id: string, req: RefreshRequest): RefreshJob => {
        const ref = doc(db, REFRESH_REQUESTS_COLLECTION, id);
        return {
          kind: req.kind,
          setIds: req.setIds,
          async claim() {
            try {
              return await runTransaction(db, async (tx) => {
                const snap = await tx.get(ref);
                if (!shouldClaim(snap.data() as RefreshRequest | undefined)) return false;
                tx.update(ref, { status: 'running', claimedAt: new Date().toISOString() });
                return true;
              });
            } catch (err) {
              console.warn('Could not claim refresh request', id, err);
              return false;
            } finally {
              inFlight.delete(id);
            }
          },
          async finish(outcome, error) {
            await updateDoc(ref, {
              status: outcome,
              finishedAt: new Date().toISOString(),
              ...(error ? { error: error.slice(0, 300) } : {}),
            });
          },
        };
      };

      const pending = query(
        collection(db, REFRESH_REQUESTS_COLLECTION),
        where('userId', '==', uid),
        where('status', '==', 'pending')
      );
      const unsubscribe = onSnapshot(
        pending,
        (snap) => {
          snap.docs.forEach((d) => {
            const req = d.data() as RefreshRequest;
            if (inFlight.has(d.id) || !shouldClaim(req)) return;
            inFlight.add(d.id);
            submit(job(d.id, req));
          });
        },
        (err) =>
          console.warn(
            'Refresh request subscription failed (is the refreshRequests rule in the Firebase store?)',
            err
          )
      );
      return () => {
        clearInterval(timer);
        unsubscribe();
      };
    },
  };
}

/**
 * Refreshes a website asked for through the Google Drive mailbox (the main
 * process reads them, desktop/src/drive/inbox.ts); each one's progress goes
 * back as a reply file. This desktop is the only one reading them.
 */
function driveChannel(drive: DesktopDriveBridge): WorkerChannel {
  return {
    start(submit) {
      let stopped = false;
      const take = (r: DriveRefresh) => {
        if (stopped) return;
        submit({
          kind: r.kind,
          setIds: r.setIds,
          async claim() {
            await drive.reply(r.requestId, 'running').catch(() => {});
            return true;
          },
          finish: (outcome, error) => drive.reply(r.requestId, outcome, error),
        });
      };
      void drive.takeRefreshes().then(
        (list) => list.forEach(take),
        () => {}
      );
      const off = drive.onRefresh(take);
      return () => {
        stopped = true;
        off();
      };
    },
  };
}

/**
 * The desktop app as the website's scraper (see src/lib/desktopWorker.ts).
 *
 * In the desktop app it works through the refreshes the website asks for
 * with `run`, one at a time whichever channel they come by: Firestore
 * requests (with Firebase; it also keeps the heartbeat going) and the Google
 * Drive mailbox (`driveUser`, when Drive is on). On the website it tracks
 * whether the desktop is online and offers `delegate`, which hands a refresh
 * to it and resolves "done" when the desktop did the work, or "failed" /
 * "unavailable" when the caller should fall back to its own (Gemini) path.
 *
 * Inert in Demo Mode and when signed out.
 */
export function useDesktopWorker(
  user: AuthUser | null,
  isDemoMode: boolean,
  run?: RunRefresh,
  { driveUser = null }: { driveUser?: AuthUser | null } = {}
) {
  const active = Boolean(user) && !isDemoMode;
  const uid = user?.uid ?? null;

  // ---- Desktop role -------------------------------------------------------

  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  const drive = isDesktopApp ? window.legoTrackerDesktop?.drive : undefined;
  const driveActive = Boolean(drive && driveUser && desktopConfig?.storage?.drive) && !isDemoMode;

  useEffect(() => {
    if (!isDesktopApp) return;
    const channels: WorkerChannel[] = [];
    if (active && uid) channels.push(firestoreChannel(uid));
    if (driveActive && drive) channels.push(driveChannel(drive));
    if (!channels.length) return;

    // One refresh at a time, whichever channel asked: it drives a single browser tab.
    let queue: Promise<void> = Promise.resolve();
    const submit = (job: RefreshJob) => {
      queue = queue.then(async () => {
        if (!(await job.claim())) return;
        try {
          if (!runRef.current) throw new Error('The desktop app is not ready to refresh');
          await runRef.current(job.kind, job.setIds);
          await job.finish('done');
        } catch (err) {
          console.error('Refresh request failed', err);
          await job.finish('failed', String((err as Error)?.message || err)).catch(() => {});
        }
      });
    };
    const stops = channels.map((c) => c.start(submit));
    return () => stops.forEach((stop) => stop());
  }, [active, uid, driveActive, drive]);
  // ---- Website role -------------------------------------------------------

  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const lastSeenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active || isDesktopApp || !uid) {
      setLastSeenAt(null);
      lastSeenRef.current = null;
      return;
    }
    return onSnapshot(
      doc(getDb(), DESKTOP_STATUS_COLLECTION, uid),
      (snap) => {
        const seen = (snap.data()?.lastSeenAt as string | undefined) ?? null;
        lastSeenRef.current = seen;
        setLastSeenAt(seen);
      },
      () => {
        // Rule not deployed yet, or offline: behave as if there is no desktop.
        lastSeenRef.current = null;
        setLastSeenAt(null);
      }
    );
  }, [active, uid]);

  // Stable identity: SetCard is memoised and receives this as a prop.
  const delegate = useCallback(
    async (kind: RefreshKind, setIds: string[]): Promise<DelegateOutcome> => {
      if (!uid || isDesktopApp || setIds.length === 0 || !isDesktopOnline(lastSeenRef.current))
        return 'unavailable';

      const db = getDb();
      const ref = doc(db, REFRESH_REQUESTS_COLLECTION, newRequestId());
      try {
        await setDoc(ref, newRequest(uid, kind, setIds));
      } catch (err) {
        console.warn('Could not hand the refresh to the desktop app; using the web route', err);
        return 'unavailable';
      }

      const outcome = await new Promise<DelegateOutcome>((resolve) => {
        let settled = false;
        let runTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = (o: DelegateOutcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(claimTimer);
          clearTimeout(runTimer);
          unsubscribe();
          resolve(o);
        };

        const unsubscribe = onSnapshot(
          ref,
          (snap) => {
            const req = snap.data() as RefreshRequest | undefined;
            const o = outcomeFor(req?.status);
            if (o) return finish(o);
            if (req?.status === 'running' && !runTimer) {
              clearTimeout(claimTimer);
              runTimer = setTimeout(() => finish('failed'), RUN_TIMEOUT_MS);
            }
          },
          () => finish('unavailable')
        );

        // Not claimed in time: cancel, so the desktop cannot start it after
        // the caller has moved on to the web route. If the desktop claimed it
        // in the meantime, the transaction leaves it alone and waiting goes on.
        // Declared after the subscription it is cleared from: Firestore never
        // calls a snapshot listener synchronously, so finish() cannot run first.
        const claimTimer = setTimeout(async () => {
          try {
            const cancelled = await runTransaction(db, async (tx) => {
              const snap = await tx.get(ref);
              if (!canCancel(snap.data() as RefreshRequest | undefined)) return false;
              tx.update(ref, { status: 'cancelled', finishedAt: new Date().toISOString() });
              return true;
            });
            if (cancelled) finish('unavailable');
          } catch {
            finish('unavailable');
          }
        }, CLAIM_TIMEOUT_MS);
      });

      // The request has served its purpose; the results are in the sets.
      await deleteDoc(ref).catch(() => {});
      return outcome;
    },
    [uid]
  );

  return {
    /** Website only: whether a refresh would currently go to the desktop app. */
    desktopOnline: !isDesktopApp && isDesktopOnline(lastSeenAt),
    delegate,
  };
}
