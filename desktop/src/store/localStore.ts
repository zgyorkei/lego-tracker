import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {
  ackPush,
  applyLocal,
  applyRemote,
  applyRemotePriceSources,
  budgetLeft,
  emptyState,
  HISTORY_READ_BUDGET,
  historyWork,
  mergeHistory,
  noteHistoryPage,
  planPush,
  resolveHeld,
  spendReads,
  summarize,
  uploadHeld,
  visibleSets,
  type ApplyResult,
  type HistoryRow,
  type LocalOp,
  type LocalPlannedList,
  type PushOp,
  type RemoteSetsSnapshot,
  type RemoteSource,
  type SetRecord,
  type StoreState,
} from '../../../lib/data/store';
import {
  isGoogleSub,
  localDay,
  type BackupKind,
  type HistoryPage,
  type LocalChange,
  type StoreChange,
  type StoreStatus,
} from '../../../lib/data/storeBridge';
import { isAutoId, isValidDocId } from '../../../lib/data/ids';
import { applyOps, type CheckedBatch, type OpsResult } from '../../../lib/data/ops';
import {
  plannedListResponse,
  type PayloadSet,
  type PayloadSource,
  type PlannedListResponse,
} from '../../../lib/plannedListPayload';
import { readJsonFile, rotateDailyBackup, writeFileAtomic, writeFileAtomicSync } from './files';

// The desktop app's copy of the signed-in account's data, one folder per
// Google account under <userData>/data/<sub>/:
//
//   state.json            sets, price sources, sync and backfill state (lib/data/store.ts)
//   history/<setId>.json  each set's price history, oldest first
//   backup/state-<day>.bak  the last 7 days of state.json
//   backup/registries.json, backup/plannedList.json  read-only copies of what is shared
//
// It also answers the local Planned Sets route (plannedListResponse), the one
// thing served over HTTP, read-only and only for a list's token.
//
// The reducer decides what changes; this class only keeps it on disk and
// tells the page. Never imports Electron, so it is tested under plain Node.

const PERSIST_DEBOUNCE_MS = 1000;
const CHANGE_COALESCE_MS = 150;
const MAX_SETS = 5000;
const MAX_HISTORY_ROWS_PER_PAGE = 1000;
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const BACKUP_KINDS: readonly BackupKind[] = ['registries', 'plannedList'];

const isShortString = (v: unknown, max = 200): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;

const isSource = (s: unknown): s is RemoteSource =>
  isPlainObject(s) &&
  isShortString(s.projectId) &&
  isShortString(s.databaseId) &&
  isShortString(s.uid);

/** Checks what the page sends: it is the app's own page, but it never gets to pick paths. */
function checkSnapshot(snap: RemoteSetsSnapshot): void {
  if (!isSource(snap?.source)) throw new Error('Snapshot source is missing');
  if (typeof snap.fromCache !== 'boolean') throw new Error('Snapshot fromCache is missing');
  if (!Array.isArray(snap.sets) || snap.sets.length > MAX_SETS)
    throw new Error('Snapshot sets are not a list of at most 5000');
  for (const set of snap.sets) {
    if (!set || typeof set !== 'object' || !isValidDocId(set.id))
      throw new Error('Snapshot has a set with an invalid id');
  }
}

const MAX_SET_JSON = 200 * 1024;
const STATUSES = ['planned', 'ordered'];
const PRIORITIES = ['low', 'medium', 'high'];
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A change from the page, checked against what the Firestore rules accept for
 * sets and history (firestore.rules), so a change made here never becomes a
 * write the rules refuse forever.
 */
function checkLocalChange(change: LocalChange, sets: Record<string, unknown>): void {
  switch (change?.type) {
    case 'create': {
      if (!isAutoId(change.id)) throw new Error('A new set needs a Firestore-style id');
      const v = change.value;
      if (!isPlainObject(v) || JSON.stringify(v).length > MAX_SET_JSON)
        throw new Error('A new set must be an object under 200 KB');
      if (typeof v.setNumber !== 'string' || !v.setNumber || v.setNumber.length > 20)
        throw new Error('A set number is 1 to 20 characters');
      if (!STATUSES.includes(v.status as string)) throw new Error('Unknown status');
      if (!PRIORITIES.includes(v.priority as string)) throw new Error('Unknown priority');
      // The create rule reads `name`, and a rule reading a missing field denies.
      if (!('name' in v)) throw new Error('A new set needs a name (null is allowed)');
      if (v.name !== null && (typeof v.name !== 'string' || v.name.length > 200))
        throw new Error('A set name is at most 200 characters');
      return;
    }
    case 'update': {
      if (!isValidDocId(change.id) || !sets[change.id]) throw new Error('Unknown set');
      const f = change.fields;
      if (!isPlainObject(f) || JSON.stringify(f).length > MAX_SET_JSON)
        throw new Error('A change must be an object under 200 KB');
      if ('status' in f && !STATUSES.includes(f.status as string))
        throw new Error('Unknown status');
      if ('priority' in f && !PRIORITIES.includes(f.priority as string))
        throw new Error('Unknown priority');
      if (f.name != null && (typeof f.name !== 'string' || f.name.length > 200))
        throw new Error('A set name is at most 200 characters');
      return;
    }
    case 'delete':
      if (!isValidDocId(change.id)) throw new Error('Unknown set');
      return;
    case 'addHistory': {
      if (!isValidDocId(change.setId) || !sets[change.setId]) throw new Error('Unknown set');
      const r = change.row;
      if (
        !isPlainObject(r) ||
        !isValidDocId(r.id) ||
        typeof r.date !== 'string' ||
        r.date.length > 32
      )
        throw new Error('A history row needs an id and a date of at most 32 characters');
      if (Object.keys(r).length > 60) throw new Error('A history row has too many fields');
      return;
    }
    case 'priceSources':
      if (!Array.isArray(change.list) || change.list.length > 15)
        throw new Error('Price sources are a list of at most 15');
      return;
    default:
      throw new Error('Unknown change');
  }
}

const PUSH_KINDS = ['create', 'update', 'delete', 'history', 'priceSources'];

/** generatePlannedListToken's shape: 24 hex characters. */
const LOCAL_LIST_TOKEN_RE = /^[0-9a-f]{24}$/;

function checkPlannedList(list: unknown): LocalPlannedList | null {
  if (list === null) return null;
  const l = list as Partial<LocalPlannedList> | undefined;
  if (!l || typeof l.token !== 'string' || !LOCAL_LIST_TOKEN_RE.test(l.token))
    throw new Error('A planned list needs a 24-character token');
  if (!isShortString(l.title, 100)) throw new Error('A planned list title is 1 to 100 characters');
  if (!isShortString(l.createdAt, 40)) throw new Error('A planned list needs its creation time');
  return { token: l.token, title: l.title, createdAt: l.createdAt };
}

/** The Firestore planned list's token and title, from its backup document. */
function sharedListOf(data: unknown): { token: string; title: string } | null {
  if (!isPlainObject(data) || typeof data.id !== 'string' || !data.id) return null;
  const title = typeof data.title === 'string' && data.title ? data.title : 'Planned sets';
  return { token: data.id, title };
}

/** The price sources the list names, as far as they have the fields it reads. */
const listSources = (list: unknown[] | null): PayloadSource[] =>
  (list ?? []).filter(
    (s): s is PayloadSource =>
      isPlainObject(s) &&
      typeof s.id === 'string' &&
      typeof s.name === 'string' &&
      typeof s.currency === 'string'
  );

/** The sets the app shows: a deleted set waiting for Firestore's confirmation is not one. */
const shownSets = (state: StoreState) => Object.values(state.sets).filter((s) => !s.deleted).length;

function checkHistoryRows(rows: HistoryRow[]): void {
  if (!Array.isArray(rows) || rows.length > MAX_HISTORY_ROWS_PER_PAGE)
    throw new Error('History page is not a list of at most 1000 rows');
  for (const r of rows) {
    if (!r || !isValidDocId(r.id) || !isShortString(r.date, 40))
      throw new Error('History page has an invalid row');
  }
}

export class LocalStore extends EventEmitter {
  private sub: string | null = null;
  private state: StoreState = emptyState();
  /** How many sets the copy on disk shows (the empty-over-non-empty guard). */
  private setsOnDisk = 0;
  /** The user emptied the copy (deleted the last sets, or answered "delete"). */
  private allowEmptyOnce = false;
  private unsaved = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private historyQueue: Promise<unknown> = Promise.resolve();
  private changes = { changed: new Set<string>(), removed: new Set<string>() };
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWrittenAt: string | null = null;
  private lastBackupDay: string | null = null;
  private error: string | null = null;
  /** The Firestore planned list's token and title, from its backup (Firebase + copy). */
  private sharedList: { token: string; title: string } | null = null;

  constructor(
    private readonly root: string,
    private readonly now: () => Date = () => new Date()
  ) {
    super();
  }

  private get dir() {
    if (!this.sub) throw new Error('No local copy is open');
    return path.join(this.root, this.sub);
  }
  private get stateFile() {
    return path.join(this.dir, 'state.json');
  }
  private historyFile(setId: string) {
    return path.join(this.dir, 'history', `${setId}.json`);
  }
  private get backupDir() {
    return path.join(this.dir, 'backup');
  }

  /** Opens the copy of a Google account, writing out the one open before. */
  async open(sub: string): Promise<StoreStatus> {
    if (!isGoogleSub(sub)) throw new Error('Not a Google account id');
    if (this.sub === sub) return this.status();
    await this.flush();
    this.sub = sub;
    const loaded = await readJsonFile<StoreState>(this.stateFile);
    this.state = loaded?.version === 1 ? { ...emptyState(), ...loaded } : emptyState();
    this.setsOnDisk = loaded?.version === 1 ? shownSets(this.state) : 0;
    this.unsaved = false;
    this.error = null;
    await fs.promises.mkdir(path.join(this.dir, 'history'), { recursive: true });
    this.lastBackupDay = await rotateDailyBackup(
      this.stateFile,
      this.backupDir,
      localDay(this.now())
    );
    this.sharedList = sharedListOf(
      await readJsonFile<unknown>(path.join(this.backupDir, 'plannedList.json'))
    );
    // The Drive worker (desktop/src/drive) follows the open account.
    this.emit('opened', sub);
    return this.status();
  }

  /** The open account's folder, for files kept beside the copy (drive.json). */
  accountDir(): string | null {
    return this.sub ? this.dir : null;
  }

  /** What the Drive snapshot publishes: the sets the app shows and the price sources. */
  driveView(): { sets: SetRecord[]; priceSources: unknown[] | null } {
    this.requireOpen();
    return { sets: visibleSets(this.state), priceSources: this.state.priceSources };
  }

  /**
   * A batch of changes from the website (through Drive), checked by
   * validateOpBatch: applied as local changes, history rows written to their
   * files. Returns what could not apply here and the refreshes it asks for.
   */
  applyOpsBatch(batch: CheckedBatch): Promise<Pick<OpsResult, 'rejected' | 'refreshes'>> {
    const run = async () => {
      this.requireOpen();
      const result = applyOps(this.state, batch, this.now().toISOString());
      for (const { setId, row } of result.historyAppends) {
        const file = this.historyFile(setId);
        const existing = (await readJsonFile<HistoryRow[]>(file)) ?? [];
        await writeFileAtomic(file, JSON.stringify(mergeHistory(existing, [row])));
        this.emit('history', setId);
      }
      // The owner's own deletes, each one named in the batch (unlike a server
      // snapshot, where a missing set may be a wrong or damaged database): they
      // may empty the copy without asking, as deletes in the app do. The daily
      // backups and the set-aside history are there if it was a mistake.
      if (result.removed.length && shownSets(result.state) === 0) this.allowEmptyOnce = true;
      if (result.state !== this.state)
        this.commit({ state: result.state, changed: result.changed, removed: result.removed });
      return { rejected: result.rejected, refreshes: result.refreshes };
    };
    const result = this.historyQueue.then(run, run);
    this.historyQueue = result.catch(() => {});
    return result;
  }

  isOpen() {
    return this.sub !== null;
  }

  private requireOpen() {
    if (!this.sub) throw new Error('No local copy is open');
  }

  applySets(snap: RemoteSetsSnapshot): StoreStatus {
    checkSnapshot(snap);
    // The time is this process's, not the page's.
    this.commit(applyRemote(this.state, { ...snap, at: this.now().toISOString() }));
    return this.status();
  }

  putPriceSources(list: unknown[] | null, source?: unknown): void {
    if (list !== null && (!Array.isArray(list) || list.length > 50))
      throw new Error('Price sources are not a list of at most 50');
    if (source !== undefined && !isSource(source))
      throw new Error('Price sources need their source');
    this.requireOpen();
    const next = applyRemotePriceSources(this.state, list, source);
    if (next !== this.state) {
      this.state = next;
      this.schedulePersist();
    }
  }

  historyWork() {
    this.requireOpen();
    return historyWork(this.state);
  }

  budgetLeft(day: string): number {
    return budgetLeft(this.state, day);
  }

  /** Adds a page of copied history rows to the set's file and moves its cursor on. */
  putHistoryPage(setId: string, page: HistoryPage): Promise<StoreStatus> {
    const run = async () => {
      if (!isValidDocId(setId) || !this.state.sets[setId]) throw new Error('Unknown set');
      checkHistoryRows(page.rows);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(page.day)) throw new Error('Invalid day');
      const reads = Math.max(0, Math.min(Number(page.reads) || 0, MAX_HISTORY_ROWS_PER_PAGE + 1));

      if (page.rows.length) {
        const file = this.historyFile(setId);
        const existing = (await readJsonFile<HistoryRow[]>(file)) ?? [];
        await writeFileAtomic(file, JSON.stringify(mergeHistory(existing, page.rows)));
        this.emit('history', setId);
      }
      const last = page.rows.length ? page.rows[page.rows.length - 1] : null;
      this.state = spendReads(
        noteHistoryPage(this.state, setId, {
          last: last ? { date: last.date, id: last.id } : null,
          rows: page.rows.length,
          done: page.done === true,
        }),
        page.day,
        reads
      );
      this.schedulePersist();
      this.queueChange([], []);
      return this.status();
    };
    const result = this.historyQueue.then(run, run);
    this.historyQueue = result.catch(() => {});
    return result;
  }

  async putBackup(kind: BackupKind, data: unknown): Promise<void> {
    if (!BACKUP_KINDS.includes(kind)) throw new Error('Unknown backup');
    const json = JSON.stringify(data ?? null);
    if (json.length > MAX_BACKUP_BYTES) throw new Error('Backup too large');
    await writeFileAtomic(path.join(this.backupDir, `${kind}.json`), json);
    if (kind === 'plannedList') this.sharedList = sharedListOf(data);
  }

  /** The planned list published from this PC ("On this PC only"), if any. */
  plannedList(): LocalPlannedList | null {
    this.requireOpen();
    return this.state.plannedList ?? null;
  }

  /** Creates (or, with null, deletes) the planned list published from this PC. */
  setPlannedList(list: unknown): StoreStatus {
    this.requireOpen();
    this.state = { ...this.state, plannedList: checkPlannedList(list) };
    this.schedulePersist();
    this.queueChange([], []);
    return this.status();
  }

  /**
   * GET /api/planned-sets/:token from this PC: the list published from here,
   * or the Firestore one (by its backed-up token), built from the sets as they
   * are now. Null for any other token, so the route can try Firestore.
   */
  plannedListResponse(token: string): PlannedListResponse | null {
    if (!this.sub) return null;
    const own = this.state.plannedList;
    const list =
      own && own.token === token
        ? own
        : this.sharedList && this.sharedList.token === token
          ? this.sharedList
          : null;
    if (!list) return null;
    return plannedListResponse(
      list.title,
      this.lastWrittenAt,
      visibleSets(this.state) as unknown as PayloadSet[],
      listSources(this.state.priceSources)
    );
  }

  /** The sets the app shows, newest first. */
  sets(): SetRecord[] {
    this.requireOpen();
    return visibleSets(this.state);
  }

  /** A set's price history, oldest first (rows not on the server yet included). */
  async history(setId: string): Promise<HistoryRow[]> {
    this.requireOpen();
    if (!isValidDocId(setId)) throw new Error('Unknown set');
    await this.historyQueue;
    return (await readJsonFile<HistoryRow[]>(this.historyFile(setId))) ?? [];
  }

  priceSources(): { list: unknown[] | null; seen: boolean } {
    this.requireOpen();
    return { list: this.state.priceSources, seen: this.state.priceSourcesSeen };
  }

  /** A change made in the app: applied here first, pushed by firestoreSync. */
  applyLocal(change: LocalChange): Promise<StoreStatus> {
    const run = async () => {
      this.requireOpen();
      checkLocalChange(change, this.state.sets);
      const at = this.now().toISOString();
      const op = (
        change.type === 'create' || change.type === 'update' ? { ...change, at } : change
      ) as LocalOp;
      const result = applyLocal(this.state, op);
      if (result.historyAppend) {
        const { setId, row } = result.historyAppend;
        const file = this.historyFile(setId);
        const existing = (await readJsonFile<HistoryRow[]>(file)) ?? [];
        await writeFileAtomic(file, JSON.stringify(mergeHistory(existing, [row])));
        this.emit('history', setId);
      }
      // Deleting the last sets is the user's choice: the copy may be empty now.
      if (change.type === 'delete' && result.removed.length && shownSets(result.state) === 0)
        this.allowEmptyOnce = true;
      this.commit(result);
      return this.status();
    };
    // Shares the history queue: a history file is only ever written by one task at a time.
    const result = this.historyQueue.then(run, run);
    this.historyQueue = result.catch(() => {});
    return result;
  }

  planPush(): PushOp[] {
    this.requireOpen();
    return planPush(this.state);
  }

  /** Firestore accepted a planned write. */
  ackPush(op: PushOp): StoreStatus {
    this.requireOpen();
    if (!op || !PUSH_KINDS.includes(op.kind)) throw new Error('Unknown push');
    const next = ackPush(this.state, op);
    if (next !== this.state) {
      this.state = next;
      this.schedulePersist();
      this.queueChange([], []);
    }
    return this.status();
  }

  resolveHeld(choice: 'delete' | 'keep'): StoreStatus {
    if (choice !== 'delete' && choice !== 'keep') throw new Error('Unknown choice');
    const result = resolveHeld(this.state, choice);
    // Refused (a source that never answered) or nothing held: the guard stays.
    if (result.state === this.state) return this.status();
    // The user asked for it, so an empty copy may replace the one on disk.
    if (choice === 'delete') this.allowEmptyOnce = true;
    this.commit(result);
    return this.status();
  }

  /**
   * "Upload": this copy goes to the source its held snapshot came from, price
   * history included (uploadHeld in lib/data/store.ts). Refused, with nothing
   * changed, until that source's server has answered.
   */
  uploadHeld(): Promise<StoreStatus> {
    const run = async () => {
      this.requireOpen();
      const history: Record<string, HistoryRow[]> = {};
      for (const [id, s] of Object.entries(this.state.sets)) {
        if (s.deleted) continue;
        const rows = await readJsonFile<HistoryRow[]>(this.historyFile(id));
        if (Array.isArray(rows) && rows.length) history[id] = rows;
      }
      const result = uploadHeld(this.state, history);
      if (result.state !== this.state) this.commit(result);
      return this.status();
    };
    // Shares the history queue, so no history file changes while it is read.
    const result = this.historyQueue.then(run, run);
    this.historyQueue = result.catch(() => {});
    return result;
  }

  status(): StoreStatus {
    const day = localDay(this.now());
    return {
      ...summarize(this.state),
      sub: this.sub,
      dir: this.sub ? this.dir : null,
      lastWrittenAt: this.lastWrittenAt,
      lastBackupDay: this.lastBackupDay,
      budget: {
        day,
        used: HISTORY_READ_BUDGET - budgetLeft(this.state, day),
        limit: HISTORY_READ_BUDGET,
      },
      error: this.error,
    };
  }

  /** Writes anything pending now. */
  async flush(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (this.unsaved) await this.persist();
    await this.writing;
  }

  /** The last write as the app quits: synchronous, so it completes before the process ends. */
  flushSync(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (!this.unsaved || !this.sub || !this.mayWrite()) return;
    try {
      writeFileAtomicSync(this.stateFile, JSON.stringify(this.state));
      this.markWritten();
    } catch (err) {
      console.error('Local store: final write failed', err);
    }
  }

  private commit(result: ApplyResult) {
    this.state = result.state;
    if (result.removed.length) void this.setAsideHistory(result.removed);
    this.schedulePersist();
    this.queueChange(result.changed, result.removed);
  }

  /** History of removed sets is moved aside, not deleted: removals can be mistakes. */
  private async setAsideHistory(setIds: string[]) {
    const aside = path.join(this.dir, 'history', 'removed');
    for (const id of setIds) {
      const file = this.historyFile(id);
      if (!fs.existsSync(file)) continue;
      await fs.promises.mkdir(aside, { recursive: true });
      await fs.promises
        .rename(file, path.join(aside, `${id}-${Date.now()}.json`))
        .catch((err) => console.warn('Local store: could not set aside history', id, err));
    }
  }

  private schedulePersist() {
    this.unsaved = true;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * The empty-over-non-empty guard: a copy that shows sets is never replaced by
   * one that shows none, unless the user emptied it. Deleted sets waiting for
   * Firestore's confirmation do not count either way: they are deletions the
   * user already made, and the confirming snapshot drops them.
   */
  private mayWrite(): boolean {
    if (shownSets(this.state) === 0 && this.setsOnDisk > 0 && !this.allowEmptyOnce) {
      this.error = `Did not replace the copy of ${this.setsOnDisk} sets on this PC with an empty one.`;
      console.error(`Local store: ${this.error}`);
      return false;
    }
    return true;
  }

  private markWritten() {
    this.setsOnDisk = shownSets(this.state);
    this.allowEmptyOnce = false;
    this.unsaved = false;
    this.lastWrittenAt = this.now().toISOString();
    this.error = null;
  }

  private persist(): Promise<void> {
    const write = async () => {
      if (!this.sub || !this.unsaved) return;
      try {
        if (!this.mayWrite()) return;
        const json = JSON.stringify(this.state);
        try {
          // Yesterday's file becomes the day's backup before today's first write.
          this.lastBackupDay = await rotateDailyBackup(
            this.stateFile,
            this.backupDir,
            localDay(this.now())
          );
          await writeFileAtomic(this.stateFile, json);
          this.markWritten();
        } catch (err) {
          this.error = `Could not write the copy on this PC: ${err instanceof Error ? err.message : String(err)}`;
          console.error('Local store:', err);
        }
      } finally {
        // The page's status was sent before this write: send it again, so
        // "saved on this PC" and a refused or failed write reach the page.
        this.queueChange([], []);
      }
    };
    this.writing = this.writing.then(write, write);
    return this.writing;
  }

  private queueChange(changed: string[], removed: string[]) {
    for (const id of changed) this.changes.changed.add(id);
    for (const id of removed) this.changes.removed.add(id);
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      const change: StoreChange = {
        changed: [...this.changes.changed],
        removed: [...this.changes.removed],
        status: this.status(),
      };
      this.changes = { changed: new Set(), removed: new Set() };
      this.emit('change', change);
    }, CHANGE_COALESCE_MS);
  }
}
