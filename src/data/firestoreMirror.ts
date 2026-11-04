import {
  collection,
  doc,
  documentId,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import { getDb } from '../lib/firebase';
import type { HistoryRow, RemoteSetsSnapshot, RemoteSource, SetRecord } from '../../lib/data/store';
import { localDay, type DesktopStoreBridge, type StoreStatus } from '../../lib/data/storeBridge';
import { historyRowFromDoc, setFromDoc, setsQuery } from './firestoreBackend';

// Desktop only, Phase 2 of the local-storage plan: keeps a copy of what
// Firestore holds for the signed-in account in the desktop app's local store
// (desktop/src/store). Pull only: nothing here writes to Firestore, and the
// app itself still reads and writes Firestore as before.
//
// Sets and price sources follow live. Price history is copied in pages within
// a daily read budget (lib/data/store.ts), oldest first and resumable, and
// again for sets refreshed since. Registries (with reservations) and the
// planned list are backed up as they are, a few times a day.

const HISTORY_PAGE = 200;
const HISTORY_PAUSE_MS = 250;
const HISTORY_RETRY_MS = 60 * 60 * 1000;
const SHARED_BACKUP_MS = 6 * 60 * 60 * 1000;

export interface MirrorOptions {
  store: DesktopStoreBridge;
  uid: string;
  googleSub: string;
  source: RemoteSource;
  onStatus: (status: StoreStatus) => void;
  onError: (message: string | null) => void;
}

export interface Mirror {
  stop(): void;
  /** Applies the last server snapshot again (after the user answered a held one). */
  resync(): Promise<void>;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function startFirestoreMirror(opts: MirrorOptions): Mirror {
  const { store, uid, source, onStatus, onError } = opts;
  const db = getDb();
  const unsubscribers: (() => void)[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];
  let stopped = false;
  let lastServerSnapshot: RemoteSetsSnapshot | null = null;
  let historyRunning = false;
  let historyTimer: ReturnType<typeof setTimeout> | null = null;

  const fail = (what: string) => (err: unknown) => {
    if (stopped) return;
    console.error(`Local copy: ${what}`, err);
    onError(`${what}: ${messageOf(err)}`);
  };

  async function pullHistory() {
    if (historyRunning || stopped) return;
    historyRunning = true;
    try {
      for (;;) {
        if (stopped) break;
        const day = localDay(new Date());
        const left = await store.budgetLeft(day);
        if (left <= 0) break;
        const work = await store.historyWork();
        if (!work.length) break;
        const { setId, cursor } = work[0];

        const size = Math.min(HISTORY_PAGE, left);
        const constraints: QueryConstraint[] = [
          orderBy('date', 'asc'),
          orderBy(documentId(), 'asc'),
        ];
        if (cursor?.lastDate && cursor.lastId)
          constraints.push(startAfter(cursor.lastDate, cursor.lastId));
        constraints.push(limit(size));
        const snap = await getDocs(
          query(collection(db, 'sets', setId, 'priceHistory'), ...constraints)
        );
        const rows = snap.docs.map((d) => historyRowFromDoc(d) as unknown as HistoryRow);
        onStatus(
          await store.putHistoryPage(setId, {
            rows,
            done: rows.length < size,
            // A query costs at least one read, even when it finds nothing.
            reads: Math.max(1, rows.length),
            day,
          })
        );
        await new Promise((r) => setTimeout(r, HISTORY_PAUSE_MS));
      }
      onError(null);
    } catch (err) {
      fail('Copying price history failed')(err);
    } finally {
      historyRunning = false;
    }
  }

  const scheduleHistory = () => {
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(() => void pullHistory(), 2000);
  };

  async function backupShared() {
    try {
      const registries = await getDocs(
        query(collection(db, 'registries'), where('userId', '==', uid))
      );
      const withReservations = await Promise.all(
        registries.docs.map(async (r) => {
          const res = await getDocs(collection(db, 'registries', r.id, 'reservations'));
          return {
            id: r.id,
            ...r.data(),
            reservations: res.docs.map((x) => ({ id: x.id, ...x.data() })),
          };
        })
      );
      await store.putBackup('registries', withReservations);

      const lists = await getDocs(
        query(collection(db, 'plannedLists'), where('userId', '==', uid), limit(1))
      );
      const list = lists.docs[0];
      await store.putBackup('plannedList', list ? { id: list.id, ...list.data() } : null);
    } catch (err) {
      fail('Backing up registries and the planned list failed')(err);
    }
  }

  async function apply(snapshot: RemoteSetsSnapshot) {
    try {
      onStatus(await store.applySets(snapshot));
    } catch (err) {
      fail('Copying the sets failed')(err);
    }
  }

  void (async () => {
    try {
      onStatus(await store.open(opts.googleSub));
    } catch (err) {
      fail('Opening the copy on this PC failed')(err);
      return;
    }
    if (stopped) return;

    unsubscribers.push(
      onSnapshot(
        setsQuery(uid),
        // Metadata changes too: the copy needs to hear when a cached answer is
        // confirmed by the server, because only then may sets be removed.
        { includeMetadataChanges: true },
        (snap) => {
          const snapshot: RemoteSetsSnapshot = {
            source,
            fromCache: snap.metadata.fromCache,
            sets: snap.docs.map((d) => setFromDoc(d) as unknown as SetRecord),
            at: new Date().toISOString(),
          };
          if (!snapshot.fromCache) lastServerSnapshot = snapshot;
          void apply(snapshot).then(() => {
            if (!snapshot.fromCache) scheduleHistory();
          });
        },
        fail('Following the sets failed')
      )
    );

    unsubscribers.push(
      onSnapshot(
        doc(db, 'userSettings', uid),
        (snap) => {
          // A cache-only "no settings" says nothing about the server.
          if (snap.metadata.fromCache && !snap.exists()) return;
          const list = snap.data()?.priceSources;
          void store
            .putPriceSources(Array.isArray(list) ? list : null)
            .catch(fail('Copying the price sources failed'));
        },
        fail('Following the price sources failed')
      )
    );

    void backupShared();
    timers.push(setInterval(() => void backupShared(), SHARED_BACKUP_MS));
    // Picks the history copy up again once a new day's budget starts.
    timers.push(setInterval(() => void pullHistory(), HISTORY_RETRY_MS));
  })();

  return {
    stop() {
      stopped = true;
      for (const u of unsubscribers) u();
      for (const t of timers) clearInterval(t);
      if (historyTimer) clearTimeout(historyTimer);
    },
    async resync() {
      if (lastServerSnapshot) await apply({ ...lastServerSnapshot, at: new Date().toISOString() });
      scheduleHistory();
    },
  };
}
