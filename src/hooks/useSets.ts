import { useState, useEffect } from 'react';
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
import { LegoSet, PriceHistory, Status, Priority } from '../types';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function useSets() {
  const [sets, setSets] = useState<LegoSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(auth.currentUser);

  useEffect(() => {
    return auth.onAuthStateChanged((u) => {
      setUser(u);
      if (!u) {
        setSets([]);
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
      setLoading(false);
    }, (error) => {
      // Fallback to cached sets if fetch fails
      try {
        const cached = localStorage.getItem('cachedSets');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
                setSets(parsed);
            }
        }
      } catch (e) {}
      
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'sets');
    });

    return () => unsubscribe();
  }, [user]);

  const addSet = async (setData: Partial<LegoSet>) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'sets'), {
        ...setData,
        userId: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'sets');
    }
  };

  const updateSet = async (id: string, updates: Partial<LegoSet>) => {
    try {
      const setRef = doc(db, 'sets', id);
      await updateDoc(setRef, {
        ...updates,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `sets/${id}`);
    }
  };

  const deleteSet = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'sets', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `sets/${id}`);
    }
  };

  const addPriceHistory = async (setId: string, history: PriceHistory) => {
    try {
      await addDoc(collection(db, 'sets', setId, 'priceHistory'), {
        ...history,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `sets/${setId}/priceHistory`);
    }
  };
  
  const getPriceHistory = async (setId: string) => {
    try {
       const q = query(
        collection(db, 'sets', setId, 'priceHistory'),
        orderBy('date', 'asc')
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PriceHistory));
    } catch (error) {
       handleFirestoreError(error, OperationType.GET, `sets/${setId}/priceHistory`);
       return [];
    }
  }

  return { sets, loading, addSet, updateSet, deleteSet, addPriceHistory, getPriceHistory, user };
}
