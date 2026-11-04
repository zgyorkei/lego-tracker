import { useCallback, useEffect, useRef, useState } from 'react';
import { firebaseConfig } from '../lib/firebaseConfig';
import { isDesktopApp } from '../lib/platform';
import { type Health } from '../lib/dataHealth';
import { syncSummary } from '../lib/localBackupText';
import { startFirestoreSync, type Sync } from '../data/firestoreSync';
import type { SessionUser } from '../data/types';
import type { StoreStatus } from '../../lib/data/storeBridge';

/**
 * Desktop app only: keeps the copy on this PC (which the app reads and writes)
 * and Firestore in step, and reports how that is going. Inert on the website,
 * in Demo Mode, and without a Google sign-in.
 */
export function useDesktopSync(user: SessionUser, isDemoMode: boolean) {
  const bridge = typeof window !== 'undefined' ? window.legoTrackerDesktop : undefined;
  const store = bridge?.store;
  const available = isDesktopApp && Boolean(store) && Boolean(firebaseConfig);
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [health, setHealth] = useState<Health>({ kind: 'ok' });
  const sync = useRef<Sync | null>(null);

  const uid = user?.uid ?? null;
  const sub = user?.googleSub ?? null;
  const active = available && !isDemoMode && Boolean(uid && sub);

  useEffect(() => {
    if (!active || !store || !firebaseConfig || !uid || !sub) {
      setStatus(null);
      setHealth({ kind: 'ok' });
      return;
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
    bridge?.setTrayStatus?.(syncSummary(status, health));
  }, [active, bridge, status, health]);

  const resolveHeld = useCallback(
    async (choice: 'delete' | 'keep') => {
      if (!store) return;
      setStatus(await store.resolveHeld(choice));
      // Starting again from a new project needs the latest snapshot applied.
      await sync.current?.resync();
    },
    [store]
  );
  const retryNow = useCallback(() => sync.current?.retryNow(), []);
  const setAccountRefused = useCallback(() => sync.current?.setAccountRefused(), []);

  return { active, status, health, resolveHeld, retryNow, setAccountRefused };
}

export type DesktopSyncState = ReturnType<typeof useDesktopSync>;
