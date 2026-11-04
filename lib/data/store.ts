// The desktop app's local copy of one account's data, as a pure reducer: no
// I/O, no clocks (callers pass the time), so every guard can be tested.
// desktop/src/store/localStore.ts owns the files; src/data/firestoreMirror.ts
// feeds it what Firestore says.
//
// Each set keeps three things:
//   value  what the app shows: the server's copy with unsynced local edits on top
//   base   the server's last confirmed copy (null: never confirmed by the server)
//   dirty  unsynced local edits, field -> revision (written from Phase 3 on)
// A remote change replaces `base` and rebuilds `value` from it plus the dirty
// fields, so an unsynced local edit wins per field without comparing clocks.
//
// Guards, because this copy is the backup when Firebase breaks:
//   - sets disappear only on a snapshot the server confirmed (fromCache false);
//   - a snapshot that would remove more than max(3, 10%) of the synced sets,
//     or that comes from another project or account, is held for the user;
//   - (localStore) an empty store is never written over a non-empty one.

/** A set as stored here: its Firestore fields with dates as ISO strings, never `userId`. */
export type SetRecord = { id: string } & Record<string, unknown>;

export interface StoredSet {
  value: SetRecord;
  base: SetRecord | null;
  dirty: Record<string, number>;
  /** Deleted here and not yet confirmed: a tombstone. Deletes win both ways. */
  deleted?: boolean;
}

/** Where the server copy came from. A different one is never merged silently. */
export interface RemoteSource {
  projectId: string;
  databaseId: string;
  uid: string;
}

export interface HeldSnapshot {
  reason: 'mass-removal' | 'different-source';
  /** When it was first held. */
  at: string;
  source: RemoteSource;
  /** mass-removal: the synced sets the snapshot no longer has. */
  removeIds: string[];
  /** How many sets the held snapshot had. */
  remoteCount: number;
  /** different-source: the user chose to keep this copy, so stop asking. */
  dismissed?: boolean;
}

/** How far a set's price history has been copied. */
export interface HistoryCursor {
  /** The last row copied, in the order rows are read: date, then id. */
  lastDate: string | null;
  lastId: string | null;
  rows: number;
  /** All rows up to `checkedFor` are copied. */
  complete: boolean;
  /** The set's lastPricesRefreshTime when the copy last completed. */
  checkedFor: number | null;
}

export interface StoreState {
  version: 1;
  source: RemoteSource | null;
  sets: Record<string, StoredSet>;
  priceSources: unknown[] | null;
  /** The last snapshot the server confirmed. */
  lastRemoteAt: string | null;
  held: HeldSnapshot | null;
  history: Record<string, HistoryCursor>;
  /** Firestore reads spent on copying history, per local day. */
  readBudget: { day: string; used: number };
  /** Revision counter for local edits (from Phase 3 on). */
  rev: number;
}

export const emptyState = (): StoreState => ({
  version: 1,
  source: null,
  sets: {},
  priceSources: null,
  lastRemoteAt: null,
  held: null,
  history: {},
  readBudget: { day: '', used: 0 },
  rev: 0,
});

/** What Firestore said about the account's sets: the full list. */
export interface RemoteSetsSnapshot {
  source: RemoteSource;
  /** From the SDK's cache: may be stale, and says nothing about removals. */
  fromCache: boolean;
  sets: SetRecord[];
  at: string;
}

export interface ApplyResult {
  state: StoreState;
  /** Sets whose shown value changed or appeared. */
  changed: string[];
  /** Sets that are gone. */
  removed: string[];
}

export const sameSource = (a: RemoteSource | null, b: RemoteSource | null) =>
  !!a && !!b && a.projectId === b.projectId && a.databaseId === b.databaseId && a.uid === b.uid;

/** More than this many removals in one snapshot is held for the user. */
export const removalLimit = (syncedCount: number) => Math.max(3, Math.ceil(syncedCount / 10));

// The uid belongs to the Firebase project, not to this copy: the pusher writes
// the current one (Phase 3), so a copy moves between projects cleanly.
const stripUserId = (s: SetRecord): SetRecord => {
  const out: SetRecord = { ...s };
  delete out.userId;
  return out;
};

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The server's copy with this set's unsynced local edits on top. */
function overlay(base: SetRecord, prev: StoredSet | undefined): SetRecord {
  if (!prev || Object.keys(prev.dirty).length === 0) return base;
  const out: SetRecord = { ...base };
  for (const field of Object.keys(prev.dirty)) {
    if (field in prev.value) out[field] = prev.value[field];
    else delete out[field];
  }
  return out;
}

const isSynced = (s: StoredSet) => s.base !== null && !s.deleted;

/** Applies what Firestore says the account's sets are, behind the guards. */
export function applyRemote(state: StoreState, snap: RemoteSetsSnapshot): ApplyResult {
  const remote = snap.sets.map(stripUserId);

  // Another project or account: never merged without the user.
  if (state.source && !sameSource(state.source, snap.source)) {
    const anySynced = Object.values(state.sets).some((s) => s.base !== null);
    if (anySynced) {
      const held: HeldSnapshot =
        state.held?.reason === 'different-source' && sameSource(state.held.source, snap.source)
          ? { ...state.held, remoteCount: remote.length }
          : {
              reason: 'different-source',
              at: snap.at,
              source: snap.source,
              removeIds: [],
              remoteCount: remote.length,
            };
      return { state: { ...state, held }, changed: [], removed: [] };
    }
  }

  const sets: Record<string, StoredSet> = { ...state.sets };
  const changed: string[] = [];
  const remoteIds = new Set<string>();

  for (const r of remote) {
    remoteIds.add(r.id);
    const prev = sets[r.id];
    if (prev?.deleted) {
      // Deleted here, not yet confirmed: the delete wins; keep the server copy as base.
      sets[r.id] = { ...prev, base: r };
      continue;
    }
    const value = overlay(r, prev);
    if (!prev || !sameJson(prev.value, value)) changed.push(r.id);
    sets[r.id] = { value, base: r, dirty: prev?.dirty ?? {} };
  }

  // Sets the server no longer has. Sets never confirmed by the server (created
  // here, Phase 3) are not the server's to remove.
  const missing = Object.keys(sets).filter((id) => sets[id].base !== null && !remoteIds.has(id));
  const confirmedDeletes = missing.filter((id) => sets[id].deleted);
  const removals = missing.filter((id) => !sets[id].deleted);

  let held: HeldSnapshot | null = null;
  const removed: string[] = [];
  if (!snap.fromCache) {
    // A tombstone the server no longer has is a confirmed delete: drop it.
    for (const id of confirmedDeletes) {
      delete sets[id];
      removed.push(id);
    }
    const synced = Object.values(state.sets).filter(isSynced).length;
    // Emptying the copy is always asked about, however small it is.
    const emptiesCopy = removals.length > 0 && removals.length === synced;
    if (removals.length > removalLimit(synced) || emptiesCopy) {
      held = {
        reason: 'mass-removal',
        at:
          state.held?.reason === 'mass-removal' && sameJson(state.held.removeIds, removals)
            ? state.held.at
            : snap.at,
        source: snap.source,
        removeIds: removals,
        remoteCount: remote.length,
      };
    } else {
      for (const id of removals) {
        delete sets[id];
        removed.push(id);
      }
    }
  }

  const history = { ...state.history };
  for (const id of removed) delete history[id];

  return {
    state: {
      ...state,
      source: snap.source,
      sets,
      history,
      held,
      lastRemoteAt: snap.fromCache ? state.lastRemoteAt : snap.at,
    },
    changed,
    removed,
  };
}

/**
 * The user's answer to a held snapshot.
 *
 * mass-removal: 'delete' removes those sets here too; 'keep' keeps them as
 * copies the server has not confirmed (from Phase 3 on they are uploaded
 * again), so later snapshots no longer try to remove them.
 *
 * different-source: 'delete' drops this copy and starts again from the new
 * project or account (the next snapshot fills it); 'keep' keeps this copy and
 * stops asking, while nothing from the new source is merged.
 */
export function resolveHeld(state: StoreState, choice: 'delete' | 'keep'): ApplyResult {
  const held = state.held;
  if (!held) return { state, changed: [], removed: [] };

  if (held.reason === 'mass-removal') {
    const sets = { ...state.sets };
    const history = { ...state.history };
    if (choice === 'delete') {
      for (const id of held.removeIds) {
        delete sets[id];
        delete history[id];
      }
      return {
        state: { ...state, sets, history, held: null },
        changed: [],
        removed: held.removeIds,
      };
    }
    for (const id of held.removeIds) if (sets[id]) sets[id] = { ...sets[id], base: null };
    return { state: { ...state, sets, held: null }, changed: held.removeIds, removed: [] };
  }

  if (choice === 'delete') {
    const removed = Object.keys(state.sets);
    return {
      state: { ...emptyState(), source: held.source, readBudget: state.readBudget },
      changed: [],
      removed,
    };
  }
  return { state: { ...state, held: { ...held, dismissed: true } }, changed: [], removed: [] };
}

/** The account's price-source list as the server has it (null: none stored). */
export function applyRemotePriceSources(state: StoreState, list: unknown[] | null): StoreState {
  return sameJson(state.priceSources, list) ? state : { ...state, priceSources: list };
}

/** The sets the app shows, newest first (deleted ones left out). */
export function visibleSets(state: StoreState): SetRecord[] {
  return Object.values(state.sets)
    .filter((s) => !s.deleted)
    .map((s) => s.value)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}

// --- Price history ----------------------------------------------------------

/** One price-history row: `date` plus per-source price columns. */
export type HistoryRow = { id: string; date: string } & Record<string, unknown>;

const byDateThenId = (a: HistoryRow, b: HistoryRow) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Rows are append-only: the union by id, oldest first. A row already held is kept as it is. */
export function mergeHistory(existing: HistoryRow[], incoming: HistoryRow[]): HistoryRow[] {
  const byId = new Map(existing.map((r) => [r.id, r]));
  for (const r of incoming) if (!byId.has(r.id)) byId.set(r.id, r);
  return [...byId.values()].sort(byDateThenId);
}

const asNumber = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The sets whose history still needs copying, most urgent first: never
 * started, then unfinished, then ones refreshed since their copy completed.
 */
export function historyWork(state: StoreState): { setId: string; cursor: HistoryCursor | null }[] {
  const rank = (c: HistoryCursor | undefined) => (!c ? 0 : !c.complete ? 1 : 2);
  return Object.entries(state.sets)
    .filter(([, s]) => s.base !== null && !s.deleted)
    .map(([setId, s]) => ({ setId, cursor: state.history[setId], s }))
    .filter(({ cursor, s }) => {
      if (!cursor || !cursor.complete) return true;
      const refreshed = asNumber(s.value.lastPricesRefreshTime);
      return refreshed !== null && refreshed !== cursor.checkedFor;
    })
    .sort((a, b) => rank(a.cursor) - rank(b.cursor))
    .map(({ setId, cursor }) => ({ setId, cursor: cursor ?? null }));
}

/**
 * Records a page of copied rows. `done` means the page was the last one: the
 * cursor is complete for the set's current lastPricesRefreshTime.
 */
export function noteHistoryPage(
  state: StoreState,
  setId: string,
  page: { last: { date: string; id: string } | null; rows: number; done: boolean }
): StoreState {
  const set = state.sets[setId];
  if (!set) return state;
  const prev = state.history[setId];
  const cursor: HistoryCursor = {
    lastDate: page.last?.date ?? prev?.lastDate ?? null,
    lastId: page.last?.id ?? prev?.lastId ?? null,
    rows: (prev?.rows ?? 0) + page.rows,
    complete: page.done,
    checkedFor: page.done ? asNumber(set.value.lastPricesRefreshTime) : (prev?.checkedFor ?? null),
  };
  return { ...state, history: { ...state.history, [setId]: cursor } };
}

/** History copying may spend this many Firestore reads per day (Spark: 50,000 for everything). */
export const HISTORY_READ_BUDGET = 10_000;

export function budgetLeft(state: StoreState, day: string, limit = HISTORY_READ_BUDGET): number {
  return state.readBudget.day === day ? Math.max(0, limit - state.readBudget.used) : limit;
}

export function spendReads(state: StoreState, day: string, reads: number): StoreState {
  const used = (state.readBudget.day === day ? state.readBudget.used : 0) + reads;
  return { ...state, readBudget: { day, used } };
}

// --- Status -----------------------------------------------------------------

export interface StoreSummary {
  sets: number;
  /** Synced sets whose history copy is complete. */
  historiesComplete: number;
  historiesTotal: number;
  historyRows: number;
  lastRemoteAt: string | null;
  held: HeldSnapshot | null;
}

export function summarize(state: StoreState): StoreSummary {
  const synced = Object.entries(state.sets).filter(([, s]) => isSynced(s));
  const pending = new Set(historyWork(state).map((w) => w.setId));
  return {
    sets: Object.values(state.sets).filter((s) => !s.deleted).length,
    historiesComplete: synced.filter(([id]) => !pending.has(id)).length,
    historiesTotal: synced.length,
    historyRows: Object.values(state.history).reduce((n, c) => n + c.rows, 0),
    lastRemoteAt: state.lastRemoteAt,
    held: state.held,
  };
}
