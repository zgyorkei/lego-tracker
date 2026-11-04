import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDb } from '../lib/firebase';
import { OperationType, toDataError } from '../lib/dataErrors';
import { toStoredSource } from '../lib/priceSources';
import { withSetDates } from '../lib/setDates';
import type { LegoSet, PriceHistory, PriceSource } from '../types';
import { withIsoDates } from '../../lib/data/timestamps';
import type { DataBackend } from './types';

const SETTINGS_COLLECTION = 'userSettings';

/** One user's data in Firestore: sets/, sets/{id}/priceHistory and userSettings/{uid}. */
export function createFirestoreBackend(uid: string): DataBackend {
  const db = getDb();

  return {
    capabilities: { registries: true, publicPlannedList: true, firestoreWorker: true },

    subscribeSets(onSets, onError) {
      const q = query(
        collection(db, 'sets'),
        where('userId', '==', uid),
        orderBy('createdAt', 'desc')
      );
      return onSnapshot(
        q,
        (snapshot) => {
          const sets: LegoSet[] = [];
          snapshot.forEach((d) => {
            // createdAt/updatedAt arrive as Timestamps; the app works with ISO
            // strings. 'estimate' gives a set that was just added its local time
            // until the server's lands, rather than null.
            const data = d.data({ serverTimestamps: 'estimate' });
            sets.push(withSetDates({ id: d.id, ...data } as LegoSet));
          });
          onSets(sets);
        },
        (err) => onError(toDataError(err, OperationType.LIST, 'sets'))
      );
    },

    async addSet(setData) {
      try {
        await addDoc(collection(db, 'sets'), {
          ...setData,
          userId: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        throw toDataError(err, OperationType.CREATE, 'sets');
      }
    },

    async updateSet(id, updates) {
      try {
        await updateDoc(doc(db, 'sets', id), { ...updates, updatedAt: serverTimestamp() });
      } catch (err) {
        throw toDataError(err, OperationType.UPDATE, `sets/${id}`);
      }
    },

    async deleteSet(id) {
      try {
        await deleteDoc(doc(db, 'sets', id));
      } catch (err) {
        throw toDataError(err, OperationType.DELETE, `sets/${id}`);
      }
    },

    async addPriceHistory(setId, row) {
      try {
        await addDoc(collection(db, 'sets', setId, 'priceHistory'), {
          ...row,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        throw toDataError(err, OperationType.CREATE, `sets/${setId}/priceHistory`);
      }
    },

    async getPriceHistory(setId) {
      try {
        const q = query(collection(db, 'sets', setId, 'priceHistory'), orderBy('date', 'asc'));
        const snapshot = await getDocs(q);
        // createdAt is a serverTimestamp(); 'date' is already a string.
        return snapshot.docs.map(
          (d) => withIsoDates({ id: d.id, ...d.data() }, ['createdAt']) as PriceHistory
        );
      } catch (err) {
        throw toDataError(err, OperationType.GET, `sets/${setId}/priceHistory`);
      }
    },

    subscribePriceSources(onSources, onError) {
      return onSnapshot(
        doc(db, SETTINGS_COLLECTION, uid),
        (snap) => {
          const stored = snap.data()?.priceSources;
          onSources(
            Array.isArray(stored) && stored.length > 0 ? (stored as PriceSource[]) : null,
            snap.metadata.fromCache
          );
        },
        onError
      );
    },

    async savePriceSources(sources) {
      await setDoc(doc(db, SETTINGS_COLLECTION, uid), {
        priceSources: sources.map(toStoredSource),
        updatedAt: new Date().toISOString(),
      });
    },
  };
}
