import { useCallback, useEffect, useRef, useState } from 'react';
import { firebaseConfig } from '../lib/firebaseConfig';
import { desktopFirebaseMissing, desktopMode, isDesktopApp } from '../lib/platform';
import { type Health } from '../lib/dataHealth';
import { syncSummary } from '../lib/localBackupText';
import { startFirestoreSync, type Sync } from '../data/firestoreSync';
import type { SessionUser } from '../data/types';
import type { HeldChoice, StoreStatus } from '../../lib/data/storeBridge';

/**
 * Desktop app only: keeps the copy on this PC (which the app reads and writes)
 * and Firestore in step, and reports how that is going. "On this PC only"
 * there is nothing to sync: it follows the copy's status alone. Inert on the
 * website, in Demo Mode, and without a Google sign-in.
 */
export function useDesktopSync(user: SessionUser, isDemoMode: boolean) {
  const bridge = typeof window !== 'undefined' ? window.legoTrackerDesktop : undefined;
  const store = bridge?.store;
  const available = isDesktopApp && Boolean(store);
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [health, setHealth] = useState<Health>({ kind: 'ok' });
  const sync = useRef<Sync | null>(null);

  const uid = user?.uid ?? null;
  const sub = user?.googleSub ?? null;
  const active = available && !isDemoMode && Boolean(uid && sub);
  const mode = desktopMode ?? 'both';

  useEffect(() => {
    if (!active || !store || !uid || !sub) {
      setStatus(null);
      setHealth({ kind: 'ok' });
      return;
    }
    if (!firebaseConfig) {
      // On this PC only (or Firebase chosen with no project saved, which is
      // a problem to fix in Settings): no sync, just the copy's status.
      let stopped = false;
      setHealth(desktopFirebaseMissing ? { kind: 'not-configured' } : { kind: 'ok' });
      store.open(sub).then(
        (s) => {
          if (!stopped) setStatus(s);
        },
        (err) => console.error('Could not open the copy on this PC', err)
      );
      const off = store.onChange((change) => setStatus(change.status));
      return () => {
        stopped = true;
        off();
      };
    }
    sync.current = startFirestoreSync({
      store,
      uid,
      googleSub: sub,
      source: {
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId,
        uid,
      },
      onStatus: setStatus,
      onHealth: setHealth,
    });
    return () => {
      sync.current?.stop();
      sync.current = null;
    };
  }, [active, store, uid, sub]);

  // The tray icon's tooltip follows the sync state.
  useEffect(() => {
    if (!active) return;
    bridge?.setTrayStatus?.(syncSummary(status, health, mode));
  }, [active, bridge, status, health, mode]);

  const resolveHeld = useCallback(
    async (choice: HeldChoice) => {
      if (!store) return;
      setStatus(await store.resolveHeld(choice));
      // Starting again from (or uploading to) a new source needs its latest
      // snapshot applied: its sets come in, and what is to upload is planned.
      await sync.current?.resync();
    },
    [store]
  );
  const retryNow = useCallback(() => sync.current?.retryNow(), []);
  const setAccountRefused = useCallback(() => sync.current?.setAccountRefused(), []);

  return { active, mode, status, health, resolveHeld, retryNow, setAccountRefused };
}

export type DesktopSyncState = ReturnType<typeof useDesktopSync>;
