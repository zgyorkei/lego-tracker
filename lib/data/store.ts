// The desktop app's copy of one account's data, as a pure reducer: no I/O, no
// clocks (callers pass the time), so every rule can be tested.
// desktop/src/store/localStore.ts owns the files; src/data/firestoreSync.ts
// feeds it what Firestore says and pushes what changed here.
//
// Each set keeps three things:
//   value  what the app shows: the server's copy with unsynced local edits on top
//   base   the server's last confirmed copy (null: not on the server yet)
//   dirty  unsynced local edits, field -> revision
// A remote change replaces `base` and rebuilds `value` from it plus the dirty
// fields, so an unsynced local edit wins per field without comparing clocks.
// A push sends only dirty fields; its acknowledgement clears a field only if
// it was not edited again since it was sent. Deletes win both ways.
//
// Guards, because this copy is the backup when Firebase breaks:
//   - sets disappear only on a snapshot the server confirmed (fromCache false);
//   - a snapshot that would remove more than max(3, 10%) of the synced sets,
//     empty the copy, or that comes from another project, database or account,
//     is held for the user, and nothing is pushed while one is held; a cached
//     snapshot never clears a hold;
//   - (localStore) an empty store is never written over a non-empty one.
import { isSetUpdatableField } from './setFields';

/** A set as stored here: its Firestore fields with dates as ISO strings, never `userId`. */
export type SetRecord = { id: string } & Record<string, unknown>;

export interface StoredSet {
  value: SetRecord;
  base: SetRecord | null;
  dirty: Record<string, number>;
  /** Deleted here and not yet confirmed: a tombstone. Deletes win both ways. */
  deleted?: boolean;
  /** The delete reached the server; the tombstone waits for a snapshot without the set. */
  pushedDelete?: boolean;
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
  /** Where the held snapshot came from. */
  source: RemoteSource;
  /** different-source: where this copy came from (holds saved before 2026-11-05 lack it). */
  from?: RemoteSource | null;
  /**
   * different-source: the new source's server has answered. A snapshot from
   * the SDK's cache says nothing about it (a database that does not exist
   * yields an empty one), so until then the copy is not started again from it.
   * Mass-removal holds come from server snapshots only.
   */
  confirmed?: boolean;
  /** mass-removal: the synced sets the snapshot no longer has. */
  removeIds: string[];
  /** How many sets the held snapshot had (different-source: 0 until confirmed). */
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
  /** Revision counter for local edits. */
  rev: number;
  /** Price-history rows added here and not on the server yet, per set. */
  pendingHistory: Record<string, HistoryRow[]>;
  /** The revision of an unsynced local price-source change, or null. */
  priceSourcesDirty: number | null;
  /** The server has said what price sources it holds (null included). */
  priceSourcesSeen: boolean;
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
  pendingHistory: {},
  priceSourcesDirty: null,
  priceSourcesSeen: false,
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

/** The server's copy with these unsynced local edits on top. */
function overlay(base: SetRecord, value: SetRecord, dirty: Record<string, number>): SetRecord {
  if (Object.keys(dirty).length === 0) return base;
  const out: SetRecord = { ...base };
  for (const field of Object.keys(dirty)) {
    if (field in value) out[field] = value[field];
    else delete out[field];
  }
  return out;
}

/**
 * The dirty fields still unsynced once the server's copy is known: a field
 * the server already holds with the local value has landed (an acknowledgement
 * can be lost), and only fields the rules let an update change can be pushed
 * as one (a create the server confirmed keeps the server's create-only fields).
 */
function settleDirty(value: SetRecord, dirty: Record<string, number>, remote: SetRecord) {
  const out: Record<string, number> = {};
  for (const [field, rev] of Object.entries(dirty)) {
    if (!isSetUpdatableField(field)) continue;
    const same = field in value ? sameJson(value[field], remote[field]) : !(field in remote);
    if (!same) out[field] = rev;
  }
  return out;
}

const isSynced = (s: StoredSet) => s.base !== null && !s.deleted;

/** Applies what Firestore says the account's sets are, behind the guards. */
export function applyRemote(state: StoreState, snap: RemoteSetsSnapshot): ApplyResult {
  const remote = snap.sets.map(stripUserId);

  // Another project, database or account: never merged without the user.
  if (state.source && !sameSource(state.source, snap.source)) {
    const anySynced = Object.values(state.sets).some((s) => s.base !== null);
    if (anySynced) {
      const prev =
        state.held?.reason === 'different-source' && sameSource(state.held.source, snap.source)
          ? state.held
          : null;
      // Only the new source's server can confirm what it holds.
      const confirmed = !snap.fromCache || prev?.confirmed === true;
      const held: HeldSnapshot = prev
        ? {
            ...prev,
            from: prev.from ?? state.source,
            confirmed,
            remoteCount: snap.fromCache ? prev.remoteCount : remote.length,
          }
        : {
            reason: 'different-source',
            at: snap.at,
            source: snap.source,
            from: state.source,
            confirmed,
            removeIds: [],
            remoteCount: snap.fromCache ? 0 : remote.length,
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
    // A set created here that the server now has (its create may have landed
    // without an acknowledgement) is simply confirmed from here on.
    const dirty = prev ? settleDirty(prev.value, prev.dirty, r) : {};
    const value = prev ? overlay(r, prev.value, dirty) : r;
    if (!prev || !sameJson(prev.value, value)) changed.push(r.id);
    sets[r.id] = { value, base: r, dirty };
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
  const pendingHistory = { ...state.pendingHistory };
  for (const id of removed) {
    delete history[id];
    delete pendingHistory[id];
  }

  return {
    state: {
      ...state,
      source: snap.source,
      sets,
      history,
      pendingHistory,
      // Only the server decides a hold: a cached snapshot (going offline, say)
      // neither makes nor clears one, so nothing is pushed until the user answers.
      held: snap.fromCache ? state.held : held,
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
 * project, database or account (the next snapshot fills it), and is refused
 * until that source's server has answered; 'keep' keeps this copy and stops
 * asking, while nothing from the new source is merged.
 */
export function resolveHeld(state: StoreState, choice: 'delete' | 'keep'): ApplyResult {
  const held = state.held;
  if (!held) return { state, changed: [], removed: [] };

  if (held.reason === 'mass-removal') {
    const sets = { ...state.sets };
    const history = { ...state.history };
    const pendingHistory = { ...state.pendingHistory };
    if (choice === 'delete') {
      for (const id of held.removeIds) {
        delete sets[id];
        delete history[id];
        delete pendingHistory[id];
      }
      return {
        state: { ...state, sets, history, pendingHistory, held: null },
        changed: [],
        removed: held.removeIds,
      };
    }
    for (const id of held.removeIds) if (sets[id]) sets[id] = { ...sets[id], base: null };
    return { state: { ...state, sets, held: null }, changed: held.removeIds, removed: [] };
  }

  if (choice === 'delete') {
    // A source that never answered may not exist at all (a mistyped database).
    if (held.confirmed !== true) return { state, changed: [], removed: [] };
    const removed = Object.keys(state.sets);
    return {
      state: { ...emptyState(), source: held.source, readBudget: state.readBudget },
      changed: [],
      removed,
    };
  }
  return { state: { ...state, held: { ...held, dismissed: true } }, changed: [], removed: [] };
}

/**
 * The account's price-source list as the server has it (null: none stored).
 * An unsynced local change wins until it is pushed; one the server already
 * holds counts as pushed.
 */
export function applyRemotePriceSources(state: StoreState, list: unknown[] | null): StoreState {
  if (state.priceSourcesDirty !== null) {
    if (sameJson(state.priceSources, list))
      return { ...state, priceSourcesDirty: null, priceSourcesSeen: true };
    return state.priceSourcesSeen ? state : { ...state, priceSourcesSeen: true };
  }
  if (sameJson(state.priceSources, list) && state.priceSourcesSeen) return state;
  return { ...state, priceSources: list, priceSourcesSeen: true };
}

/** The sets the app shows, newest first (deleted ones left out). */
export function visibleSets(state: StoreState): SetRecord[] {
  return Object.values(state.sets)
    .filter((s) => !s.deleted)
    .map((s) => s.value)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}

// --- Local changes ----------------------------------------------------------

/** A change made in the app, applied here first. `at` is the caller's clock. */
export type LocalOp =
  | { type: 'create'; id: string; value: Record<string, unknown>; at: string }
  | { type: 'update'; id: string; fields: Record<string, unknown>; at: string }
  | { type: 'delete'; id: string }
  | { type: 'addHistory'; setId: string; row: HistoryRow }
  | { type: 'priceSources'; list: unknown[] };

export interface LocalResult extends ApplyResult {
  /** addHistory: the row to append to the set's history file. */
  historyAppend?: { setId: string; row: HistoryRow };
}

const unchanged = (state: StoreState): LocalResult => ({ state, changed: [], removed: [] });

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  const out = { ...map };
  delete out[key];
  return out;
}

export function applyLocal(state: StoreState, op: LocalOp): LocalResult {
  const rev = state.rev + 1;

  switch (op.type) {
    case 'create': {
      if (state.sets[op.id]) return unchanged(state);
      const value: SetRecord = stripUserId({
        ...op.value,
        id: op.id,
        createdAt: op.at,
        updatedAt: op.at,
        addedAt: typeof op.value.addedAt === 'string' ? op.value.addedAt : op.at,
      } as SetRecord);
      // base null is what makes it a create; no dirty fields needed.
      return {
        state: {
          ...state,
          rev,
          sets: { ...state.sets, [op.id]: { value, base: null, dirty: {} } },
        },
        changed: [op.id],
        removed: [],
      };
    }

    case 'update': {
      const prev = state.sets[op.id];
      if (!prev || prev.deleted) return unchanged(state);
      const value: SetRecord = { ...prev.value, updatedAt: op.at };
      const dirty = { ...prev.dirty };
      let any = false;
      for (const [field, v] of Object.entries(op.fields)) {
        // updatedAt is the server's time, set by every push; it is never dirty.
        if (!isSetUpdatableField(field) || field === 'updatedAt') continue;
        if (v === undefined) delete value[field];
        else value[field] = v;
        dirty[field] = rev;
        any = true;
      }
      if (!any) return unchanged(state);
      return {
        state: { ...state, rev, sets: { ...state.sets, [op.id]: { ...prev, value, dirty } } },
        changed: [op.id],
        removed: [],
      };
    }

    case 'delete': {
      const prev = state.sets[op.id];
      if (!prev || prev.deleted) return unchanged(state);
      const pendingHistory = without(state.pendingHistory, op.id);
      if (prev.base === null) {
        // Never on the server: nothing to tell it.
        return {
          state: {
            ...state,
            rev,
            sets: without(state.sets, op.id),
            history: without(state.history, op.id),
            pendingHistory,
          },
          changed: [],
          removed: [op.id],
        };
      }
      return {
        state: {
          ...state,
          rev,
          pendingHistory,
          sets: { ...state.sets, [op.id]: { ...prev, deleted: true, dirty: {} } },
        },
        changed: [],
        removed: [op.id],
      };
    }

    case 'addHistory': {
      const set = state.sets[op.setId];
      if (!set || set.deleted) return unchanged(state);
      const rows = state.pendingHistory[op.setId] ?? [];
      if (rows.some((r) => r.id === op.row.id)) return unchanged(state);
      return {
        state: {
          ...state,
          rev,
          pendingHistory: { ...state.pendingHistory, [op.setId]: [...rows, op.row] },
        },
        changed: [],
        removed: [],
        historyAppend: { setId: op.setId, row: op.row },
      };
    }

    case 'priceSources':
      return {
        state: { ...state, rev, priceSources: op.list, priceSourcesDirty: rev },
        changed: [],
        removed: [],
      };
  }
}

// --- Pushing ----------------------------------------------------------------

/** One write to Firestore, as planned from the copy. */
export type PushOp =
  | { kind: 'create'; id: string; data: Record<string, unknown>; revs: Record<string, number> }
  | {
      kind: 'update';
      id: string;
      fields: Record<string, unknown>;
      /** Dirty fields the set no longer has: deleted on the server. */
      removeFields: string[];
      revs: Record<string, number>;
    }
  | { kind: 'delete'; id: string }
  | { kind: 'history'; setId: string; row: HistoryRow }
  | { kind: 'priceSources'; list: unknown[]; rev: number };

/** A stable key per op, so one already in flight is not sent twice. */
export const pushKey = (op: PushOp) =>
  op.kind === 'history'
    ? `history:${op.setId}:${op.row.id}`
    : op.kind === 'priceSources'
      ? 'priceSources'
      : `${op.kind}:${op.id}`;

/**
 * What to send to Firestore now. Nothing while a snapshot is held (it may be
 * the wrong project or a damaged database). Creates wait for a server snapshot
 * (so a set the server already has is known), and a set's history rows wait
 * until the set is on the server.
 */
export function planPush(state: StoreState): PushOp[] {
  if (state.held) return [];
  const ops: PushOp[] = [];
  const serverSeen = state.lastRemoteAt !== null;

  for (const [id, s] of Object.entries(state.sets)) {
    if (s.deleted) {
      if (s.base !== null && !s.pushedDelete) ops.push({ kind: 'delete', id });
      continue;
    }
    if (s.base === null) {
      if (!serverSeen) continue;
      const data: Record<string, unknown> = { ...s.value };
      delete data.id;
      ops.push({ kind: 'create', id, data, revs: { ...s.dirty } });
      continue;
    }
    const fields: Record<string, unknown> = {};
    const removeFields: string[] = [];
    for (const field of Object.keys(s.dirty)) {
      if (!isSetUpdatableField(field) || field === 'updatedAt') continue;
      if (field in s.value && s.value[field] !== undefined) fields[field] = s.value[field];
      else removeFields.push(field);
    }
    if (Object.keys(fields).length || removeFields.length)
      ops.push({ kind: 'update', id, fields, removeFields, revs: { ...s.dirty } });
  }

  for (const [setId, rows] of Object.entries(state.pendingHistory)) {
    const set = state.sets[setId];
    if (!set || set.deleted || set.base === null) continue;
    for (const row of rows) ops.push({ kind: 'history', setId, row });
  }

  if (state.priceSourcesDirty !== null && state.priceSources)
    ops.push({ kind: 'priceSources', list: state.priceSources, rev: state.priceSourcesDirty });

  return ops;
}

/** Records that Firestore accepted a planned write. */
export function ackPush(state: StoreState, op: PushOp): StoreState {
  switch (op.kind) {
    case 'create': {
      const s = state.sets[op.id];
      if (!s || s.deleted || s.base !== null) return state;
      // Edits made while the create was in flight stay dirty: they go as an update.
      const dirty: Record<string, number> = {};
      for (const [f, rev] of Object.entries(s.dirty)) if (op.revs[f] !== rev) dirty[f] = rev;
      const base: SetRecord = { id: op.id, ...op.data };
      return { ...state, sets: { ...state.sets, [op.id]: { ...s, base, dirty } } };
    }
    case 'update': {
      const s = state.sets[op.id];
      if (!s || s.deleted || !s.base) return state;
      const dirty = { ...s.dirty };
      const base: SetRecord = { ...s.base };
      for (const [f, rev] of Object.entries(op.revs)) {
        if (dirty[f] !== rev) continue;
        delete dirty[f];
        if (f in op.fields) base[f] = op.fields[f];
        else delete base[f];
      }
      return { ...state, sets: { ...state.sets, [op.id]: { ...s, base, dirty } } };
    }
    case 'delete': {
      const s = state.sets[op.id];
      if (!s || !s.deleted) return state;
      return { ...state, sets: { ...state.sets, [op.id]: { ...s, pushedDelete: true } } };
    }
    case 'history': {
      const rows = state.pendingHistory[op.setId];
      if (!rows) return state;
      const left = rows.filter((r) => r.id !== op.row.id);
      return {
        ...state,
        pendingHistory: left.length
          ? { ...state.pendingHistory, [op.setId]: left }
          : without(state.pendingHistory, op.setId),
      };
    }
    case 'priceSources':
      return state.priceSourcesDirty === op.rev ? { ...state, priceSourcesDirty: null } : state;
  }
}

/** How many changes made here are not on the server yet. */
export function pendingCount(state: StoreState): number {
  let n = 0;
  for (const s of Object.values(state.sets)) {
    if (s.deleted) n += s.pushedDelete ? 0 : 1;
    else if (s.base === null || Object.keys(s.dirty).length) n += 1;
  }
  for (const rows of Object.values(state.pendingHistory)) n += rows.length;
  if (state.priceSourcesDirty !== null) n += 1;
  return n;
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
  /** Changes made here that are not on the server yet. */
  pending: number;
}

export function summarize(state: StoreState): StoreSummary {
  const synced = Object.entries(state.sets).filter(([, s]) => isSynced(s));
  const copying = new Set(historyWork(state).map((w) => w.setId));
  return {
    sets: Object.values(state.sets).filter((s) => !s.deleted).length,
    historiesComplete: synced.filter(([id]) => !copying.has(id)).length,
    historiesTotal: synced.length,
    historyRows: Object.values(state.history).reduce((n, c) => n + c.rows, 0),
    lastRemoteAt: state.lastRemoteAt,
    held: state.held,
    pending: pendingCount(state),
  };
}
