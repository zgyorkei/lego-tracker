import { useState, useEffect, useCallback } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  orderBy,
  getDocs
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { LegoSet, PriceHistory } from '../types';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

/**
 * Logs a Firestore failure and returns a plain-language message for the UI.
 *
 * Deliberately does NOT throw. The previous version threw a JSON blob, which
 * (a) embedded the user's email and uid into an Error message that could reach
 * any log sink, and (b) was thrown from inside an onSnapshot error callback,
 * where nothing can catch it -- it became an unhandled rejection that the
 * ErrorBoundary cannot intercept either, since boundaries only catch errors
 * raised during render/lifecycle.
 */
function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): string {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Firestore error', { operationType, path, message });

  const code = (error as { code?: string } | null)?.code;
  if (code === 'permission-denied') {
    return 'You do not have access to this data. Try signing out and back in.';
  }
  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return 'Cannot reach the database right now. Showing cached data if available.';
  }
  return `Something went wrong while trying to ${operationType} data. Please try again.`;
}

export function useSets() {
  const [sets, setSets] = useState<LegoSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState(auth.currentUser);

  useEffect(() => {
    return auth.onAuthStateChanged((u) => {
      setUser(u);
      if (!u) {
        setSets([]);
        setError(null);
        setLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'sets'), 
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const setsData: LegoSet[] = [];
      snapshot.forEach((doc) => {
        setsData.push({ id: doc.id, ...doc.data() } as LegoSet);
      });
      setSets(setsData);
      setError(null);
      setLoading(false);
    }, (err) => {
      // Fallback to cached sets if the live query fails.
      try {
        const cached = localStorage.getItem('cachedSets');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setSets(parsed);
          }
        }
      } catch (e) {
        console.warn('Could not restore cached sets', e);
      }

      setLoading(false);
      setError(handleFirestoreError(err, OperationType.LIST, 'sets'));
    });

    return () => unsubscribe();
  }, [user]);

  // All CRUD wrappers are useCallback'd so they keep a stable identity across
  // renders. Without this, memoising SetCard achieves nothing: every render of
  // App would hand every card brand-new function props.
  //
  // They surface a message via setError and then re-throw, so an awaiting
  // caller can branch on failure while the UI still gets something to display.

  const addSet = useCallback(async (setData: Partial<LegoSet>) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'sets'), {
        ...setData,
        userId: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setError(null);
    } catch (err) {
      const message = handleFirestoreError(err, OperationType.CREATE, 'sets');
      setError(message);
      throw new Error(message);
    }
  }, [user]);

  const updateSet = useCallback(async (id: string, updates: Partial<LegoSet>) => {
    try {
      const setRef = doc(db, 'sets', id);
      await updateDoc(setRef, {
        ...updates,
        updatedAt: serverTimestamp(),
      });
      setError(null);
    } catch (err) {
      const message = handleFirestoreError(err, OperationType.UPDATE, `sets/${id}`);
      setError(message);
      throw new Error(message);
    }
  }, []);

  const deleteSet = useCallback(async (id: string) => {
    try {
      await deleteDoc(doc(db, 'sets', id));
      setError(null);
    } catch (err) {
      const message = handleFirestoreError(err, OperationType.DELETE, `sets/${id}`);
      setError(message);
      throw new Error(message);
    }
  }, []);

  const addPriceHistory = useCallback(async (setId: string, history: PriceHistory) => {
    try {
      await addDoc(collection(db, 'sets', setId, 'priceHistory'), {
        ...history,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      const message = handleFirestoreError(
        err,
        OperationType.CREATE,
        `sets/${setId}/priceHistory`
      );
      setError(message);
      throw new Error(message);
    }
  }, []);

  const getPriceHistory = useCallback(async (setId: string): Promise<PriceHistory[]> => {
    try {
      const q = query(
        collection(db, 'sets', setId, 'priceHistory'),
        orderBy('date', 'asc')
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PriceHistory));
    } catch (err) {
      // Read-only and non-critical: surface it but return empty rather than
      // throwing, so a history-fetch failure cannot break the card.
      setError(handleFirestoreError(err, OperationType.GET, `sets/${setId}/priceHistory`));
      return [];
    }
  }, []);

  return {
    sets,
    loading,
    error,
    addSet,
    updateSet,
    deleteSet,
    addPriceHistory,
    getPriceHistory,
    user,
  };
}
