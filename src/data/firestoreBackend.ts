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
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb } from '../lib/firebase';
import { OperationType, toDataError } from '../lib/dataErrors';
import { onMissingDatabase } from '../lib/firestoreLog';
import { toStoredSource } from '../lib/priceSources';
import { withSetDates } from '../lib/setDates';
import type { LegoSet, PriceHistory, PriceSource } from '../types';
import { withIsoDates } from '../../lib/data/timestamps';
import { DataError, type DataBackend } from './types';

const SETTINGS_COLLECTION = 'userSettings';

/**
 * A set document as the app uses it. createdAt/updatedAt arrive as
 * Timestamps; the app works with ISO strings. 'estimate' gives a set that was
 * just added its local time until the server's lands, rather than null.
 */
export function setFromDoc(d: QueryDocumentSnapshot): LegoSet {
  return withSetDates({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) } as LegoSet);
}

/** A price-history row as the app uses it: createdAt is a serverTimestamp(), 'date' a string. */
export function historyRowFromDoc(d: QueryDocumentSnapshot): PriceHistory {
  return withIsoDates({ id: d.id, ...d.data() }, ['createdAt']) as PriceHistory;
}

/** The query every reader of the account's sets uses, so the SDK shares one listener. */
export const setsQuery = (uid: string) =>
  query(collection(getDb(), 'sets'), where('userId', '==', uid), orderBy('createdAt', 'desc'));

/** One user's data in Firestore: sets/, sets/{id}/priceHistory and userSettings/{uid}. */
export function createFirestoreBackend(uid: string): DataBackend {
  const db = getDb();

  return {
    capabilities: { registries: true, publicPlannedList: true, firestoreWorker: true },

    subscribeSets(onSets, onError) {
      // Firestore only logs a missing database and serves its empty cache, so
      // without this the collection would just look empty (firestoreLog.ts).
      let missing = false;
      const offMissing = onMissingDatabase((id) => {
        if (missing) return;
        missing = true;
        onError(
          new DataError(
            `The Firestore database "${id}" was not found. Check the database name in the Firebase config.`,
            'not-found'
          )
        );
      });
      const off = onSnapshot(
        setsQuery(uid),
        (snapshot) => {
          // While the database is missing, a cached snapshot says nothing.
          if (missing && snapshot.metadata.fromCache) return;
          missing = false;
          const sets: LegoSet[] = [];
          snapshot.forEach((d) => {
            sets.push(setFromDoc(d));
          });
          onSets(sets);
        },
        (err) => onError(toDataError(err, OperationType.LIST, 'sets'))
      );
      return () => {
        offMissing();
        off();
      };
    },

    async addSet(setData) {
      try {
        await addDoc(collection(db, 'sets'), {
          ...setData,
          userId: uid,
          // createdAt must be the server's time (the create rule checks it);
          // addedAt keeps the date the set was really added, so an uploaded
          // local collection keeps its order.
          addedAt: typeof setData.addedAt === 'string' ? setData.addedAt : new Date().toISOString(),
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
        return snapshot.docs.map(historyRowFromDoc);
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
