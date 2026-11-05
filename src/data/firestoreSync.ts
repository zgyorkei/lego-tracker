import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  documentId,
  getDoc,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryConstraint,
  type UpdateData,
} from 'firebase/firestore';
import { getDb } from '../lib/firebase';
import { classifyFirebaseError, isProblem, type Health } from '../lib/dataHealth';
import { onMissingDatabase } from '../lib/firestoreLog';
import {
  pushKey,
  type HistoryRow,
  type PushOp,
  type RemoteSetsSnapshot,
  type RemoteSource,
  type SetRecord,
} from '../../lib/data/store';
import { localDay, type DesktopStoreBridge, type StoreStatus } from '../../lib/data/storeBridge';
import { historyRowFromDoc, setFromDoc, setsQuery } from './firestoreBackend';

// Desktop only (local-storage plan, Phase 3). The app reads and writes the
// copy on this PC (localBackend.ts); this keeps that copy and Firestore in
// step, both ways:
//   pull  sets and price sources follow live; price history is copied in
//         pages within a daily read budget; registries (with reservations)
//         and the planned list are backed up a few times a day;
//   push  whatever changed here (planPush in lib/data/store.ts), a few writes
//         at a time, each acknowledged back to the copy.
// Firestore's own offline cache is not used: the copy on this PC is the one
// that survives a restart, so the SDK keeps its default memory cache. When the
// SDK thinks it is offline, a plain getDocs answers from that cache, often
// empty, so the copies read here come from the server or fail.

const HISTORY_PAGE = 200;
const HISTORY_PAUSE_MS = 250;
const HISTORY_RETRY_MS = 60 * 60 * 1000;
const SHARED_BACKUP_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const PUSH_DEBOUNCE_MS = 500;
const MAX_IN_FLIGHT = 4;
// An upload ("On this PC only" to Firebase) brings hundreds of history rows:
// from this many on they go in batched writes, this many rows per batch.
const HISTORY_BATCH_FROM = 20;
const HISTORY_BATCH_SIZE = 200;

export interface SyncOptions {
  store: DesktopStoreBridge;
  uid: string;
  googleSub: string;
  source: RemoteSource;
  onStatus: (status: StoreStatus) => void;
  onHealth: (health: Health) => void;
}

export interface Sync {
  stop(): void;
  /** Reconnects and pushes now (the banner's "Retry now"). */
  retryNow(): void;
  /** Applies the last server snapshot again (after the user answered a held one). */
  resync(): Promise<void>;
  /** The allowlist refused this account: stop talking to Firebase until a retry. */
  setAccountRefused(): void;
}

const withoutUndefined = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export function startFirestoreSync(opts: SyncOptions): Sync {
  const { store, uid, source, onStatus } = opts;
  const db = getDb();
  let stopped = false;
  let health: Health = { kind: navigator.onLine ? 'ok' : 'offline' };
  let refused = false;
  let listeners: (() => void)[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];
  let lastServerSnapshot: RemoteSetsSnapshot | null = null;
  /** Firestore said its database does not exist (its warning), until it answers. */
  let missingDatabase: string | null = null;

  const setHealth = (next: Health) => {
    if (stopped) return;
    // To everything else a missing database looks like being offline.
    const h: Health =
      missingDatabase && (next.kind === 'ok' || next.kind === 'offline')
        ? { kind: 'database-missing', detail: missingDatabase }
        : next;
    if (h.kind === health.kind && h.detail === health.detail) return;
    health = h;
    opts.onHealth(h);
  };
  opts.onHealth(health);

  const offMissingDatabase = onMissingDatabase((_id, message) => {
    missingDatabase = message;
    setHealth({ kind: 'database-missing', detail: message });
  });
  /** Firestore answered, so its database exists. */
  const databaseAnswered = () => {
    missingDatabase = null;
  };

  const report = (what: string) => (err: unknown) => {
    if (stopped) return;
    const h = classifyFirebaseError(err);
    console.error(`Sync: ${what}`, err);
    setHealth(h.kind === 'unknown' ? { kind: 'unknown', detail: `${what}: ${h.detail}` } : h);
    scheduleRetry();
  };

  // ---- Pull ---------------------------------------------------------------

  async function apply(snapshot: RemoteSetsSnapshot) {
    try {
      onStatus(await store.applySets(snapshot));
    } catch (err) {
      console.error('Sync: could not apply a snapshot', err);
    }
  }

  let historyRunning = false;
  let historyTimer: ReturnType<typeof setTimeout> | null = null;
  async function pullHistory() {
    if (historyRunning || stopped || refused) return;
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
        // From the server: a cached empty page would mark the copy complete.
        const snap = await getDocsFromServer(
          query(collection(db, 'sets', setId, 'priceHistory'), ...constraints)
        );
        const rows = snap.docs.map((d) => historyRowFromDoc(d) as unknown as HistoryRow);
        onStatus(
          await store.putHistoryPage(setId, {
            rows,
            done: rows.length < size,
            reads: Math.max(1, rows.length),
            day,
          })
        );
        await new Promise((r) => setTimeout(r, HISTORY_PAUSE_MS));
      }
    } catch (err) {
      report('Copying price history failed')(err);
    } finally {
      historyRunning = false;
    }
  }
  const scheduleHistory = () => {
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(() => void pullHistory(), 2000);
  };

  async function backupShared() {
    if (refused) return;
    try {
      // From the server: cached empty answers would overwrite the backups.
      const registries = await getDocsFromServer(
        query(collection(db, 'registries'), where('userId', '==', uid))
      );
      const withReservations = await Promise.all(
        registries.docs.map(async (r) => {
          const res = await getDocsFromServer(collection(db, 'registries', r.id, 'reservations'));
          return {
            id: r.id,
            ...r.data(),
            reservations: res.docs.map((x) => ({ id: x.id, ...x.data() })),
          };
        })
      );
      await store.putBackup('registries', withReservations);
      const lists = await getDocsFromServer(
        query(collection(db, 'plannedLists'), where('userId', '==', uid), limit(1))
      );
      const list = lists.docs[0];
      await store.putBackup('plannedList', list ? { id: list.id, ...list.data() } : null);
    } catch (err) {
      report('Backing up registries and the planned list failed')(err);
    }
  }

  function connect() {
    for (const off of listeners) off();
    listeners = [];
    if (stopped || refused) return;

    listeners.push(
      onSnapshot(
        setsQuery(uid),
        // Metadata changes too: only a snapshot the server confirmed may
        // remove sets, so the copy has to hear when a cached one is confirmed.
        { includeMetadataChanges: true },
        (snap) => {
          const snapshot: RemoteSetsSnapshot = {
            source,
            fromCache: snap.metadata.fromCache,
            sets: snap.docs.map((d) => setFromDoc(d) as unknown as SetRecord),
            at: new Date().toISOString(),
          };
          if (!snapshot.fromCache) {
            lastServerSnapshot = snapshot;
            databaseAnswered();
            if (health.kind !== 'ok' && !refused) setHealth({ kind: 'ok' });
          }
          void apply(snapshot).then(() => {
            if (snapshot.fromCache) return;
            scheduleHistory();
            schedulePush();
          });
        },
        report('Following the sets failed')
      )
    );

    listeners.push(
      onSnapshot(
        doc(db, 'userSettings', uid),
        (snap) => {
          // A cache-only "no settings" says nothing about the server.
          if (snap.metadata.fromCache && !snap.exists()) return;
          const list = snap.data()?.priceSources;
          void store
            .putPriceSources(Array.isArray(list) ? list : null, source)
            .catch((err) => console.error('Sync: could not copy price sources', err));
        },
        report('Following the price sources failed')
      )
    );
  }

  // ---- Push ---------------------------------------------------------------

  const inFlight = new Set<string>();
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let pushing = false;

  function schedulePush() {
    if (stopped || refused) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void pushRound(), PUSH_DEBOUNCE_MS);
  }

  type HistoryOp = Extract<PushOp, { kind: 'history' }>;
  const historyRef = (op: HistoryOp) => doc(db, 'sets', op.setId, 'priceHistory', op.row.id);
  // Rows are create-only, and the rules want createdAt to be the server's time.
  const historyData = (op: HistoryOp) => {
    const row: Record<string, unknown> = { ...op.row };
    delete row.id;
    return withoutUndefined({ ...row, createdAt: serverTimestamp() });
  };

  async function write(op: PushOp): Promise<void> {
    switch (op.kind) {
      case 'create':
        // The rules want createdAt to be the server's time and userId the
        // signer's; addedAt keeps the date the set was added here.
        await setDoc(
          doc(db, 'sets', op.id),
          withoutUndefined({
            ...op.data,
            userId: uid,
            addedAt: op.data.addedAt ?? op.data.createdAt,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
        return;
      case 'update': {
        // The rules want updatedAt to be the server's time on every update.
        const fields: UpdateData<DocumentData> = { ...op.fields, updatedAt: serverTimestamp() };
        for (const f of op.removeFields) fields[f] = deleteField();
        await updateDoc(doc(db, 'sets', op.id), fields);
        return;
      }
      case 'delete':
        await deleteDoc(doc(db, 'sets', op.id));
        return;
      case 'history': {
        const ref = historyRef(op);
        try {
          await setDoc(ref, historyData(op));
        } catch (err) {
          // Rows cannot be overwritten (no update rule), so a row that landed
          // before its acknowledgement was lost is refused: check it is there.
          if (
            (err as { code?: string })?.code === 'permission-denied' &&
            (await getDoc(ref)).exists()
          )
            return;
          throw err;
        }
        return;
      }
      case 'priceSources':
        await setDoc(doc(db, 'userSettings', uid), {
          priceSources: op.list,
          updatedAt: new Date().toISOString(),
        });
        return;
    }
  }

  async function pushRound() {
    if (pushing || stopped || refused) return;
    pushing = true;
    try {
      const ops = (await store.planPush()).filter((op) => !inFlight.has(pushKey(op)));
      let failed = false;
      const send = async (op: PushOp) => {
        try {
          await write(op);
          onStatus(await store.ackPush(op));
        } catch (err) {
          failed = true;
          report('Sending a change to Firebase failed')(err);
        }
      };
      // planPush lists a set's rows only once the set is on the server, so a
      // batch never holds a row whose set is still to be created.
      const history = ops.filter((op): op is HistoryOp => op.kind === 'history');
      const batched = history.length >= HISTORY_BATCH_FROM ? history : [];
      const queue = ops.filter((op) => !batched.includes(op as HistoryOp));
      const worker = async () => {
        for (let op = queue.shift(); op && !stopped; op = queue.shift()) {
          const key = pushKey(op);
          inFlight.add(key);
          try {
            await send(op);
          } finally {
            inFlight.delete(key);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, queue.length) }, worker));

      for (let i = 0; i < batched.length && !stopped; i += HISTORY_BATCH_SIZE) {
        const chunk = batched.slice(i, i + HISTORY_BATCH_SIZE);
        const keys = chunk.map(pushKey);
        for (const k of keys) inFlight.add(k);
        try {
          const batch = writeBatch(db);
          for (const op of chunk) batch.set(historyRef(op), historyData(op));
          await batch.commit();
          for (const op of chunk) onStatus(await store.ackPush(op));
        } catch (err) {
          // One refused row fails the whole batch (a row that landed before,
          // say): send this chunk row by row, which checks for those.
          console.warn('Sync: a history batch was refused; sending its rows one by one', err);
          for (const op of chunk) if (!stopped) await send(op);
        } finally {
          for (const k of keys) inFlight.delete(k);
        }
      }
      if (!failed && ops.length) databaseAnswered();
      if (!failed && ops.length && isProblem(health) && !refused) setHealth({ kind: 'ok' });
    } catch (err) {
      console.error('Sync: push round failed', err);
    } finally {
      pushing = false;
    }
  }

  // ---- Retries --------------------------------------------------------------

  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleRetry() {
    if (retryTimer || stopped) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      retryNow();
    }, RETRY_MS);
  }

  function retryNow() {
    if (stopped) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    if (refused) {
      refused = false;
      setHealth({ kind: navigator.onLine ? 'ok' : 'offline' });
    }
    connect();
    schedulePush();
    scheduleHistory();
  }

  const onOnline = () => {
    setHealth({ kind: 'ok' });
    retryNow();
  };
  const onOffline = () => setHealth({ kind: 'offline' });
  const onFocus = () => {
    if (isProblem(health)) retryNow();
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('focus', onFocus);

  // Local changes trigger a push; acknowledgements trigger one too, which
  // finds nothing left and stops.
  const offChange = store.onChange((change) => {
    onStatus(change.status);
    if (change.status.pending > 0) schedulePush();
  });

  void (async () => {
    try {
      onStatus(await store.open(opts.googleSub));
    } catch (err) {
      console.error('Sync: could not open the copy on this PC', err);
      return;
    }
    if (stopped) return;
    connect();
    void backupShared();
    timers.push(setInterval(() => void backupShared(), SHARED_BACKUP_MS));
    timers.push(setInterval(() => void pullHistory(), HISTORY_RETRY_MS));
  })();

  return {
    stop() {
      stopped = true;
      for (const off of listeners) off();
      for (const t of timers) clearInterval(t);
      if (historyTimer) clearTimeout(historyTimer);
      if (pushTimer) clearTimeout(pushTimer);
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', onFocus);
      offChange();
      offMissingDatabase();
    },
    retryNow,
    async resync() {
      if (lastServerSnapshot) await apply({ ...lastServerSnapshot, at: new Date().toISOString() });
      scheduleHistory();
      schedulePush();
    },
    setAccountRefused() {
      refused = true;
      for (const off of listeners) off();
      listeners = [];
      setHealth({ kind: 'account-refused' });
    },
  };
}
