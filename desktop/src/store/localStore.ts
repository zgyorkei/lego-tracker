import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyRemote,
  applyRemotePriceSources,
  budgetLeft,
  emptyState,
  HISTORY_READ_BUDGET,
  historyWork,
  mergeHistory,
  noteHistoryPage,
  resolveHeld,
  spendReads,
  summarize,
  type ApplyResult,
  type HistoryRow,
  type RemoteSetsSnapshot,
  type StoreState,
} from '../../../lib/data/store';
import {
  isGoogleSub,
  localDay,
  type BackupKind,
  type HistoryPage,
  type StoreChange,
  type StoreStatus,
} from '../../../lib/data/storeBridge';
import { isValidDocId } from '../../../lib/data/ids';
import { readJsonFile, rotateDailyBackup, writeFileAtomic, writeFileAtomicSync } from './files';

// The desktop app's copy of the signed-in account's data, one folder per
// Google account under <userData>/data/<sub>/:
//
//   state.json            sets, price sources, sync and backfill state (lib/data/store.ts)
//   history/<setId>.json  each set's price history, oldest first
//   backup/state-<day>.bak  the last 7 days of state.json
//   backup/registries.json, backup/plannedList.json  read-only copies of what is shared
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

/** Checks what the page sends: it is the app's own page, but it never gets to pick paths. */
function checkSnapshot(snap: RemoteSetsSnapshot): void {
  const s = snap?.source;
  if (!s || !isShortString(s.projectId) || !isShortString(s.databaseId) || !isShortString(s.uid))
    throw new Error('Snapshot source is missing');
  if (typeof snap.fromCache !== 'boolean') throw new Error('Snapshot fromCache is missing');
  if (!Array.isArray(snap.sets) || snap.sets.length > MAX_SETS)
    throw new Error('Snapshot sets are not a list of at most 5000');
  for (const set of snap.sets) {
    if (!set || typeof set !== 'object' || !isValidDocId(set.id))
      throw new Error('Snapshot has a set with an invalid id');
  }
}

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
  /** How many sets the copy on disk holds (the empty-over-non-empty guard). */
  private setsOnDisk = 0;
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
    this.setsOnDisk = loaded?.version === 1 ? Object.keys(this.state.sets).length : 0;
    this.unsaved = false;
    this.error = null;
    await fs.promises.mkdir(path.join(this.dir, 'history'), { recursive: true });
    this.lastBackupDay = await rotateDailyBackup(
      this.stateFile,
      this.backupDir,
      localDay(this.now())
    );
    return this.status();
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

  putPriceSources(list: unknown[] | null): void {
    if (list !== null && (!Array.isArray(list) || list.length > 50))
      throw new Error('Price sources are not a list of at most 50');
    this.requireOpen();
    const next = applyRemotePriceSources(this.state, list);
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
  }

  resolveHeld(choice: 'delete' | 'keep'): StoreStatus {
    if (choice !== 'delete' && choice !== 'keep') throw new Error('Unknown choice');
    const result = resolveHeld(this.state, choice);
    // The user asked for it, so an empty copy may replace the one on disk.
    if (choice === 'delete') this.allowEmptyOnce = true;
    this.commit(result);
    return this.status();
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

  /** The empty-over-non-empty guard. */
  private mayWrite(): boolean {
    const count = Object.keys(this.state.sets).length;
    if (count === 0 && this.setsOnDisk > 0 && !this.allowEmptyOnce) {
      this.error = `Did not replace the copy of ${this.setsOnDisk} sets on this PC with an empty one.`;
      console.error(`Local store: ${this.error}`);
      return false;
    }
    return true;
  }

  private markWritten() {
    this.setsOnDisk = Object.keys(this.state.sets).length;
    this.allowEmptyOnce = false;
    this.unsaved = false;
    this.lastWrittenAt = this.now().toISOString();
    this.error = null;
  }

  private persist(): Promise<void> {
    const write = async () => {
      if (!this.sub || !this.unsaved) return;
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
