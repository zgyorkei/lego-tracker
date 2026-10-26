import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  collection,
  query,
  where,
  limit,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../lib/firebase';
import {
  PLANNED_LISTS_COLLECTION,
  buildPlannedListPurchases,
  buildPlannedListSets,
  generatePlannedListToken,
  stableStringify,
} from '../lib/plannedList';
import { LegoSet, PlannedList, PriceSource } from '../types';

// Batch price refreshes update sets one after another; waiting for things to
// settle turns a burst of snapshots into a single write.
const SYNC_DEBOUNCE_MS = 3000;

/**
 * Owns the user's published planned list: a world-readable snapshot of every
 * planned set, and of the purchases (for BrickBudget to book as expenses),
 * served to other applications by GET /api/planned-sets/:token.
 *
 * The server has no Firestore credentials, so it cannot read the private sets
 * collection itself. Instead this hook keeps the public copy current from the
 * client, which is where every set change originates anyway.
 *
 * `ready` must stay false until the sets have actually loaded. Otherwise the
 * empty initial array would be synced and wipe the published list.
 */
export function usePlannedList(
  user: User | null,
  sets: LegoSet[],
  priceSources: PriceSource[],
  ready: boolean
) {
  const [list, setList] = useState<PlannedList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setList(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, PLANNED_LISTS_COLLECTION),
      where('userId', '==', user.uid),
      limit(1)
    );
    return onSnapshot(
      q,
      (snap) => {
        const d = snap.docs[0];
        setList(d ? ({ id: d.id, ...d.data() } as PlannedList) : null);
        setLoading(false);
      },
      (err) => {
        console.error('Planned list subscription failed', err);
        setError('Could not load the planned list.');
        setLoading(false);
      }
    );
  }, [user]);

  const payload = useMemo(() => buildPlannedListSets(sets, priceSources), [sets, priceSources]);
  const purchases = useMemo(() => buildPlannedListPurchases(sets), [sets]);
  const payloadSig = useMemo(() => stableStringify({ sets: payload, purchases }), [payload, purchases]);

  // Purchases go in a write of their own: a Firestore rule that predates them
  // rejects the field, and that must not stop the planned sets from syncing.
  const writePurchases = useCallback(
    async (listId: string) => {
      try {
        await updateDoc(doc(db, PLANNED_LISTS_COLLECTION, listId), { purchases });
        return true;
      } catch (err) {
        console.error('Publishing purchases failed (is the plannedLists rule in the Firebase store current?)', err);
        setError('The planned sets are synced, but the purchases could not be published: the Firestore rules need updating.');
        return false;
      }
    },
    [purchases]
  );

  // Signature of what this device last wrote (or first saw) for the current
  // list. Syncing is driven by local payload changes only, never by the list
  // doc changing underneath us: two devices with different price sources
  // would otherwise rewrite each other's version in a loop.
  const lastSynced = useRef<{ listId: string; sig: string } | null>(null);

  const write = useCallback(
    async (listId: string) => {
      setBusy(true);
      try {
        await updateDoc(doc(db, PLANNED_LISTS_COLLECTION, listId), {
          sets: payload,
          updatedAt: new Date().toISOString(),
        });
        lastSynced.current = { listId, sig: payloadSig };
        setError(null);
        await writePurchases(listId);
      } catch (err) {
        console.error('Planned list sync failed', err);
        setError('Could not sync the planned list. Please try again.');
      } finally {
        setBusy(false);
      }
    },
    [payload, payloadSig, writePurchases]
  );

  useEffect(() => {
    if (!list || !ready) return;
    if (lastSynced.current?.listId !== list.id) {
      lastSynced.current = { listId: list.id, sig: stableStringify({ sets: list.sets ?? [], purchases: list.purchases ?? [] }) };
    }
    if (lastSynced.current.sig === payloadSig) return;

    const timer = setTimeout(() => void write(list.id), SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [list, ready, payloadSig, write]);

  const createList = useCallback(async () => {
    if (!user || !ready) return;
    setBusy(true);
    try {
      const token = generatePlannedListToken();
      const now = new Date().toISOString();
      await setDoc(doc(db, PLANNED_LISTS_COLLECTION, token), {
        userId: user.uid,
        title: 'Planned sets',
        sets: payload,
        createdAt: now,
        updatedAt: now,
      });
      lastSynced.current = { listId: token, sig: payloadSig };
      setError(null);
      await writePurchases(token);
    } catch (err) {
      console.error('Planned list create failed', err);
      setError('Could not create the planned list. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [user, ready, payload, payloadSig, writePurchases]);

  const deleteList = useCallback(async () => {
    if (!list) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, PLANNED_LISTS_COLLECTION, list.id));
      lastSynced.current = null;
      setError(null);
    } catch (err) {
      console.error('Planned list delete failed', err);
      setError('Could not delete the planned list. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [list]);

  const syncNow = useCallback(async () => {
    if (list && ready) await write(list.id);
  }, [list, ready, write]);

  return {
    list,
    loading,
    busy,
    error,
    ready,
    plannedCount: payload.length,
    purchaseCount: purchases.length,
    createList,
    deleteList,
    syncNow,
  };
}

export type PlannedListState = ReturnType<typeof usePlannedList>;
