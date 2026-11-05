// Changes a website (or phone) hands the desktop through the Google Drive
// mailbox (lib/drive/layout.ts): a batch of ops in one ops-*.json file. The
// desktop checks every batch here before anything is applied. "On this PC
// only" there are no Firestore rules behind it, so the desktop is the
// authority: the checks mirror the rules' shapes and caps (firestore.rules),
// and anything they refuse is reported back per op, not applied.
import { isAutoId, isValidDocId } from './ids';
import { isSetUpdatableField } from './setFields';
import { applyLocal, type HistoryRow, type LocalOp, type StoreState } from './store';
import { SET_NUMBER_RE } from '../setNumber';

/** Same cap as the refreshRequests rule (src/lib/desktopWorker.ts MAX_REQUEST_SETS). */
export const MAX_REQUEST_SETS = 500;
export const MAX_OPS_PER_BATCH = 200;
export const MAX_BATCH_BYTES = 512 * 1024;
const MAX_SET_JSON = 200 * 1024;
const MAX_SOURCES = 15;
const MAX_HISTORY_KEYS = 64;

export type RefreshKind = 'all' | 'details' | 'prices';

export type Op =
  | { type: 'create'; id: string; value: Record<string, unknown> }
  | { type: 'update'; id: string; fields: Record<string, unknown> }
  | { type: 'delete'; id: string }
  | { type: 'addHistory'; setId: string; row: HistoryRow }
  | { type: 'priceSources'; list: unknown[] }
  /** Asks the desktop to refresh these sets; its answer comes as reply-<requestId>.json. */
  | { type: 'refresh'; requestId: string; kind: RefreshKind; setIds: string[] };

export interface OpBatch {
  /** Unique per batch, so a batch applied once is never applied again. */
  batchId: string;
  /** When the website made it (ISO). */
  createdAt: string;
  /** The website's signed-in account, for the record only. */
  by?: string | null;
  ops: Op[];
}

export interface RejectedOp {
  index: number;
  reason: string;
}

/** A batch as checked: the ops that may be applied, and why the others may not. */
export interface CheckedBatch {
  batchId: string;
  createdAt: string;
  ops: { index: number; op: Op }[];
  rejected: RejectedOp[];
}

export const BATCH_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const STATUSES = ['planned', 'ordered'];
const PRIORITIES = ['low', 'medium', 'high'];
const KINDS: RefreshKind[] = ['all', 'details', 'prices'];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const isShortString = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const jsonSize = (v: unknown) => JSON.stringify(v).length;

/** The checks the sets rule makes of a field it reads (isValidSet). */
function checkSetFields(f: Record<string, unknown>): string | null {
  if ('status' in f && !STATUSES.includes(f.status as string)) return 'Unknown status';
  if ('priority' in f && !PRIORITIES.includes(f.priority as string)) return 'Unknown priority';
  if ('name' in f && f.name !== null && !(typeof f.name === 'string' && f.name.length <= 200))
    return 'A set name is at most 200 characters';
  return null;
}

/** A history row: a date, a numeric rate, and each price as both columns (<id>Price, <id>PriceHuf). */
function checkHistoryRow(row: unknown): string | null {
  if (!isPlainObject(row)) return 'A history row must be an object';
  if (!isAutoId(row.id)) return 'A history row needs a Firestore-style id';
  if (!isShortString(row.date, 32)) return 'A history row needs a date of at most 32 characters';
  if ('exchangeRate' in row && typeof row.exchangeRate !== 'number')
    return 'The exchange rate must be a number';
  if (Object.keys(row).length > MAX_HISTORY_KEYS) return 'A history row has too many fields';
  for (const [k, v] of Object.entries(row)) {
    const m = /^(.+?)Price(Huf)?$/.exec(k);
    if (!m) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${k} must be a number`;
    // Only the HUF column is comparable across sources; a writer writes both.
    const other = m[2] ? `${m[1]}Price` : `${m[1]}PriceHuf`;
    if (typeof row[other] !== 'number') return `${k} needs ${other} too`;
  }
  return null;
}

function checkPriceSources(list: unknown): string | null {
  if (!Array.isArray(list) || list.length > MAX_SOURCES)
    return `Price sources are a list of at most ${MAX_SOURCES}`;
  for (const s of list) {
    if (!isPlainObject(s) || !isShortString(s.id, 40) || !isShortString(s.name, 100))
      return 'Each price source needs an id and a name';
    if (s.urlTemplate !== undefined && !isShortString(s.urlTemplate, 1000))
      return 'A price source address is at most 1000 characters';
  }
  if (jsonSize(list) > MAX_SET_JSON) return 'The price-source list is too large';
  return null;
}

/** One op, cleaned, or why it is refused. */
export function checkOp(input: unknown): { op: Op } | { reason: string } {
  if (!isPlainObject(input)) return { reason: 'An op must be an object' };
  switch (input.type) {
    case 'create': {
      if (!isAutoId(input.id)) return { reason: 'A new set needs a Firestore-style id' };
      const v = input.value;
      if (!isPlainObject(v) || jsonSize(v) > MAX_SET_JSON)
        return { reason: 'A new set must be an object under 200 KB' };
      if (typeof v.setNumber !== 'string' || !SET_NUMBER_RE.test(v.setNumber))
        return { reason: 'A set number is 1 to 20 letters, digits or hyphens' };
      if (!STATUSES.includes(v.status as string)) return { reason: 'Unknown status' };
      if (!PRIORITIES.includes(v.priority as string)) return { reason: 'Unknown priority' };
      // The create rule reads `name`, and a rule reading a missing field denies.
      if (!('name' in v)) return { reason: 'A new set needs a name (null is allowed)' };
      const bad = checkSetFields(v);
      if (bad) return { reason: bad };
      // userId is never stored here; the pusher writes the signed-in uid.
      const value = { ...v };
      delete value.userId;
      delete value.id;
      return { op: { type: 'create', id: input.id, value } };
    }
    case 'update': {
      if (!isValidDocId(input.id)) return { reason: 'Unknown set' };
      const f = input.fields;
      if (!isPlainObject(f) || jsonSize(f) > MAX_SET_JSON)
        return { reason: 'A change must be an object under 200 KB' };
      const notAllowed = Object.keys(f).filter((k) => !isSetUpdatableField(k) || k === 'updatedAt');
      if (notAllowed.length)
        return { reason: `These fields cannot be changed: ${notAllowed.join(', ')}` };
      if (!Object.keys(f).length) return { reason: 'A change needs at least one field' };
      const bad = checkSetFields(f);
      if (bad) return { reason: bad };
      return { op: { type: 'update', id: input.id, fields: { ...f } } };
    }
    case 'delete':
      if (!isValidDocId(input.id)) return { reason: 'Unknown set' };
      return { op: { type: 'delete', id: input.id } };
    case 'addHistory': {
      if (!isValidDocId(input.setId)) return { reason: 'Unknown set' };
      const bad = checkHistoryRow(input.row);
      if (bad) return { reason: bad };
      return {
        op: { type: 'addHistory', setId: input.setId, row: { ...(input.row as HistoryRow) } },
      };
    }
    case 'priceSources': {
      const bad = checkPriceSources(input.list);
      if (bad) return { reason: bad };
      return { op: { type: 'priceSources', list: [...(input.list as unknown[])] } };
    }
    case 'refresh': {
      if (typeof input.requestId !== 'string' || !REQUEST_ID_RE.test(input.requestId))
        return { reason: 'A refresh needs a request id' };
      if (!KINDS.includes(input.kind as RefreshKind)) return { reason: 'Unknown refresh kind' };
      const ids = input.setIds;
      if (!Array.isArray(ids) || !ids.length || ids.length > MAX_REQUEST_SETS)
        return { reason: `A refresh names 1 to ${MAX_REQUEST_SETS} sets` };
      if (!ids.every(isValidDocId)) return { reason: 'A refresh names an unknown set' };
      return {
        op: {
          type: 'refresh',
          requestId: input.requestId,
          kind: input.kind as RefreshKind,
          setIds: [...new Set(ids as string[])],
        },
      };
    }
    default:
      return { reason: 'Unknown op' };
  }
}

/**
 * Checks a batch as read from an ops file. A batch that is not one at all
 * (wrong shape, too large) is refused whole; otherwise each op stands or falls
 * on its own, so one bad op does not lose the rest.
 */
export function validateOpBatch(input: unknown): { batch: CheckedBatch } | { error: string } {
  if (!isPlainObject(input)) return { error: 'A batch must be an object' };
  if (typeof input.batchId !== 'string' || !BATCH_ID_RE.test(input.batchId))
    return { error: 'A batch needs an id of 8 to 64 letters, digits, - or _' };
  if (!isShortString(input.createdAt, 40)) return { error: 'A batch needs its creation time' };
  if (!Array.isArray(input.ops) || !input.ops.length || input.ops.length > MAX_OPS_PER_BATCH)
    return { error: `A batch holds 1 to ${MAX_OPS_PER_BATCH} ops` };
  if (jsonSize(input) > MAX_BATCH_BYTES) return { error: 'A batch is larger than 512 KB' };
  const batch: CheckedBatch = {
    batchId: input.batchId,
    createdAt: input.createdAt,
    ops: [],
    rejected: [],
  };
  input.ops.forEach((raw, index) => {
    const r = checkOp(raw);
    if ('op' in r) batch.ops.push({ index, op: r.op });
    else batch.rejected.push({ index, reason: r.reason });
  });
  return { batch };
}

export interface OpsResult {
  state: StoreState;
  changed: string[];
  removed: string[];
  /** History rows to append to their sets' files, in order. */
  historyAppends: { setId: string; row: HistoryRow }[];
  /** Refreshes to run (they change nothing by themselves). */
  refreshes: Extract<Op, { type: 'refresh' }>[];
  /** Ops that passed the checks but could not apply here (an unknown set, say). */
  rejected: RejectedOp[];
}

/**
 * Applies a checked batch to the copy, as local changes (so with Firebase
 * they are pushed like any other). `at` is the time to stamp, the desktop's.
 */
export function applyOps(state: StoreState, batch: CheckedBatch, at: string): OpsResult {
  const out: OpsResult = {
    state,
    changed: [],
    removed: [],
    historyAppends: [],
    refreshes: [],
    rejected: [],
  };
  for (const { index, op } of batch.ops) {
    if (op.type === 'refresh') {
      out.refreshes.push(op);
      continue;
    }
    const local: LocalOp =
      op.type === 'create' || op.type === 'update' ? { ...op, at } : (op as LocalOp);
    const exists = (id: string) => !!out.state.sets[id] && !out.state.sets[id].deleted;
    if (op.type === 'create' && out.state.sets[op.id]) {
      out.rejected.push({ index, reason: 'A set with this id already exists' });
      continue;
    }
    if ((op.type === 'update' || op.type === 'delete') && !exists(op.id)) {
      out.rejected.push({ index, reason: 'Unknown set' });
      continue;
    }
    if (op.type === 'addHistory' && !exists(op.setId)) {
      out.rejected.push({ index, reason: 'Unknown set' });
      continue;
    }
    const r = applyLocal(out.state, local);
    out.state = r.state;
    out.changed.push(...r.changed);
    out.removed.push(...r.removed);
    if (r.historyAppend) out.historyAppends.push(r.historyAppend);
  }
  return out;
}
