import { useCallback, useEffect, useRef, useState } from 'react';
import { firebaseConfig } from '../lib/firebaseConfig';
import { isDesktopApp } from '../lib/platform';
import { startFirestoreMirror, type Mirror } from '../data/firestoreMirror';
import type { SessionUser } from '../data/types';
import type { StoreStatus } from '../../lib/data/storeBridge';

/**
 * Desktop app only: keeps a copy of the signed-in account's Firestore data on
 * this PC (src/data/firestoreMirror.ts) and reports how far it is. Inert on
 * the website, in Demo Mode, and without a Google sign-in.
 */
export function useLocalBackup(user: SessionUser, isDemoMode: boolean) {
  const store = typeof window !== 'undefined' ? window.legoTrackerDesktop?.store : undefined;
  const available = isDesktopApp && Boolean(store) && Boolean(firebaseConfig);
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mirror = useRef<Mirror | null>(null);

  const uid = user?.uid ?? null;
  const sub = user?.googleSub ?? null;

  useEffect(() => {
    if (!available || !store || !firebaseConfig || isDemoMode || !uid || !sub) {
      setStatus(null);
      return;
    }
    const offChange = store.onChange((change) => setStatus(change.status));
    mirror.current = startFirestoreMirror({
      store,
      uid,
      googleSub: sub,
      source: {
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId,
        uid,
      },
      onStatus: setStatus,
      onError: setError,
    });
    return () => {
      mirror.current?.stop();
      mirror.current = null;
      offChange();
    };
  }, [available, store, uid, sub, isDemoMode]);

  const resolveHeld = useCallback(
    async (choice: 'delete' | 'keep') => {
      if (!store) return;
      try {
        setStatus(await store.resolveHeld(choice));
        // Starting again from a new project needs the latest snapshot applied.
        await mirror.current?.resync();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [store]
  );

  return { active: available && !isDemoMode && Boolean(uid && sub), status, error, resolveHeld };
}

export type LocalBackupState = ReturnType<typeof useLocalBackup>;
