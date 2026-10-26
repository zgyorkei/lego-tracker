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
import type { User } from 'firebase/auth';
import { db } from '../lib/firebase';
import { isDesktopApp } from '../lib/platform';
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
export async function scheduleDailyRun(uid: string, day: string, setIds: string[]): Promise<DailyRunAction> {
  const ref = doc(db, REFRESH_REQUESTS_COLLECTION, dailyRequestId(uid, day));
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const action = dailyRunAction(snap.exists() ? (snap.data() as RefreshRequest) : undefined);
    // A full replacement, so a retry starts clean (no stale claim or error).
    if (action === 'create' || action === 'retry') tx.set(ref, newRequest(uid, 'prices', setIds));
    return action;
  });
}

/**
 * The desktop app as the website's scraper (see src/lib/desktopWorker.ts).
 *
 * In the desktop app it keeps the heartbeat going and works through the
 * website's refresh requests with `run`. On the website it tracks whether the
 * desktop is online and offers `delegate`, which hands a refresh to it and
 * resolves "done" when the desktop did the work, or "failed" / "unavailable"
 * when the caller should fall back to its own (Gemini) path.
 *
 * Inert in Demo Mode and when signed out.
 */
export function useDesktopWorker(user: User | null, isDemoMode: boolean, run?: RunRefresh) {
  const active = Boolean(user) && !isDemoMode;
  const uid = user?.uid ?? null;

  // ---- Desktop role -------------------------------------------------------

  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    if (!active || !isDesktopApp || !uid) return;

    const beat = () =>
      setDoc(doc(db, DESKTOP_STATUS_COLLECTION, uid), { lastSeenAt: new Date().toISOString() }).catch((err) =>
        console.warn('Desktop heartbeat failed (is the desktopStatus rule in the Firebase store?)', err)
      );
    void beat();
    const timer = setInterval(() => void beat(), HEARTBEAT_MS);

    // One request at a time: the refresh drives a single browser tab.
    let queue: Promise<void> = Promise.resolve();
    const inFlight = new Set<string>();

    const handle = (id: string) => {
      const ref = doc(db, REFRESH_REQUESTS_COLLECTION, id);
      queue = queue.then(async () => {
        let claimed: RefreshRequest | null = null;
        try {
          claimed = await runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            const req = snap.data() as RefreshRequest | undefined;
            if (!shouldClaim(req)) return null;
            tx.update(ref, { status: 'running', claimedAt: new Date().toISOString() });
            return req!;
          });
        } catch (err) {
          console.warn('Could not claim refresh request', id, err);
        }
        if (!claimed) return;

        try {
          if (!runRef.current) throw new Error('The desktop app is not ready to refresh');
          await runRef.current(claimed.kind, claimed.setIds);
          await updateDoc(ref, { status: 'done', finishedAt: new Date().toISOString() });
        } catch (err) {
          console.error('Refresh request failed', id, err);
          await updateDoc(ref, {
            status: 'failed',
            finishedAt: new Date().toISOString(),
            error: String((err as Error)?.message || err).slice(0, 300),
          }).catch(() => {});
        }
      }).finally(() => inFlight.delete(id));
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
          if (inFlight.has(d.id) || !shouldClaim(d.data() as RefreshRequest)) return;
          inFlight.add(d.id);
          handle(d.id);
        });
      },
      (err) => console.warn('Refresh request subscription failed (is the refreshRequests rule in the Firebase store?)', err)
    );

    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [active, uid]);

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
      doc(db, DESKTOP_STATUS_COLLECTION, uid),
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
      if (!uid || isDesktopApp || setIds.length === 0 || !isDesktopOnline(lastSeenRef.current)) return 'unavailable';

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
