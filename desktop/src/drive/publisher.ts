import { DriveError, type DriveClient } from '../../../lib/drive/client';
import {
  anotherPublisher,
  decodeJson,
  encodeJson,
  encodeJsonGz,
  HEARTBEAT_MS,
  historyFile,
  LAYOUT_VERSION,
  parseHistoryFile,
  SNAPSHOT_FILE,
  STATUS_FILE,
  type DriveSnapshot,
  type DriveStatus,
  type StorageMode,
} from '../../../lib/drive/layout';
import type { HistoryRow } from '../../../lib/data/store';
import type { LocalStore } from '../store/localStore';
import type { DriveState } from './state';

// Publishes this PC's copy to the account's Drive app folder for the website
// and phone (lib/drive/layout.ts): the snapshot at most every 10 s after a
// change, status.json every 2 minutes, and each set's history file when it
// changed, one at a time. Another PC publishing to the same folder (its
// heartbeat fresh) pauses this one, so the snapshot keeps a single writer; a
// wiped folder is published again from scratch.

const SNAPSHOT_EVERY_MS = 10_000;
const HISTORY_EVERY_MS = 3_000;
const GZIP = 'application/gzip';
const JSON_TYPE = 'application/json';

export interface PublisherEvents {
  published(at: string): void;
  paused(otherName: string | null): void;
  failed(err: unknown): void;
}

export class Publisher {
  paused = false;
  private stopped = false;
  private lastPublish = 0;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private historyQueue = new Set<string>();
  private historyBusy = false;
  private publishing: Promise<void> = Promise.resolve();
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly drive: DriveClient,
    private readonly store: LocalStore,
    private readonly state: DriveState,
    private readonly self: { id: string; name: string },
    private readonly mode: StorageMode,
    private readonly appVersion: string,
    private readonly events: PublisherEvents
  ) {}

  async start(): Promise<void> {
    await this.syncFileIds();
    await this.checkOthers();
    if (!this.paused) {
      await this.writeStatus();
      await this.publishNow();
    }
    const onChange = () => this.schedule();
    const onHistory = (setId: string) => this.historyQueue.add(setId);
    this.store.on('change', onChange);
    this.store.on('history', onHistory);
    this.offs.push(
      () => this.store.off('change', onChange),
      () => this.store.off('history', onHistory)
    );
    this.queueAllHistory();
    this.timers.push(setInterval(() => void this.heartbeat(), HEARTBEAT_MS));
    this.timers.push(setInterval(() => void this.nextHistory(), HISTORY_EVERY_MS));
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    for (const off of this.offs) off();
  }

  /** Publishes after a change, at most every 10 s. */
  schedule(): void {
    if (this.stopped || this.snapshotTimer) return;
    const wait = Math.max(0, this.lastPublish + SNAPSHOT_EVERY_MS - Date.now());
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      void this.publishNow().catch((err) => this.events.failed(err));
    }, wait);
  }

  /** Publishes the snapshot now (after a batch was applied, say). */
  publishNow(): Promise<void> {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
    const run = async () => {
      if (this.stopped || this.paused || !this.store.isOpen()) return;
      const { sets, priceSources } = this.store.driveView();
      const history: DriveSnapshot['history'] = {};
      for (const [id, sig] of Object.entries(this.state.data.history)) {
        const [rows, lastId] = sig.split(':');
        history[id] = { rows: Number(rows) || 0, lastId: lastId || null };
      }
      const snapshot: DriveSnapshot = {
        version: LAYOUT_VERSION,
        publishedAt: new Date().toISOString(),
        publisher: this.self.id,
        mode: this.mode,
        sets,
        priceSources,
        applied: this.state.data.applied,
        rejected: this.state.data.rejected,
        history,
      };
      await this.put(SNAPSHOT_FILE, await encodeJsonGz(snapshot), GZIP);
      this.lastPublish = Date.now();
      this.events.published(snapshot.publishedAt);
    };
    this.publishing = this.publishing.then(run, run);
    return this.publishing;
  }

  /** Writes (or rewrites) a file by name, remembering its id; a file gone from the folder is made again. */
  async put(name: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    const id = this.state.data.fileIds[name];
    if (id) {
      try {
        await this.drive.update(id, bytes, mimeType);
        return;
      } catch (err) {
        if (!(err instanceof DriveError && err.status === 404)) throw err;
      }
    }
    const created = await this.drive.create(name, bytes, mimeType);
    this.state.data.fileIds[name] = created.id;
    await this.state.save();
  }

  private async heartbeat() {
    try {
      const wiped = await this.syncFileIds();
      await this.checkOthers();
      if (this.paused) return;
      await this.writeStatus();
      if (wiped) {
        // Someone cleared the folder: everything goes again.
        this.state.data.history = {};
        await this.state.save();
        this.queueAllHistory();
        await this.publishNow();
      }
    } catch (err) {
      this.events.failed(err);
    }
  }

  /** Reads the folder's file ids; true when the snapshot this PC wrote is gone. */
  private async syncFileIds(): Promise<boolean> {
    const files = await this.drive.list();
    const had = this.state.data.fileIds[SNAPSHOT_FILE];
    const ids: Record<string, string> = {};
    for (const f of files) {
      // Several files of one name (two PCs raced, say): keep the first.
      if (!ids[f.name]) ids[f.name] = f.id;
    }
    this.state.data.fileIds = ids;
    // A history file not in the folder (wiped, or never made) is published again.
    for (const setId of Object.keys(this.state.data.history)) {
      if (!ids[historyFile(setId)]) delete this.state.data.history[setId];
    }
    // History files whose sets are gone are removed (a few per heartbeat).
    const visible = new Set(
      this.store.isOpen() ? this.store.driveView().sets.map((s) => s.id) : []
    );
    for (const f of files.filter((x) => parseHistoryFile(x.name)).slice(0, 20)) {
      const setId = parseHistoryFile(f.name);
      if (setId && this.store.isOpen() && !visible.has(setId)) {
        await this.drive.remove(f.id);
        delete this.state.data.fileIds[f.name];
        delete this.state.data.history[setId];
      }
    }
    await this.state.save();
    return !!had && !ids[SNAPSHOT_FILE];
  }

  /** Pauses while another PC's heartbeat is fresh; resumes when it is gone. */
  private async checkOthers() {
    const id = this.state.data.fileIds[STATUS_FILE];
    let status: DriveStatus | null = null;
    if (id) {
      try {
        status = decodeJson(await this.drive.download(id)) as DriveStatus;
      } catch (err) {
        if (!(err instanceof DriveError && err.status === 404)) throw err;
      }
    }
    const other = anotherPublisher(status, this.self.id);
    if (other && !this.paused) {
      this.paused = true;
      this.events.paused(status?.publisherName ?? null);
    } else if (!other && this.paused) {
      this.paused = false;
      this.queueAllHistory();
      await this.publishNow();
    }
  }

  private writeStatus() {
    const status: DriveStatus = {
      version: LAYOUT_VERSION,
      publisher: this.self.id,
      publisherName: this.self.name,
      heartbeatAt: new Date().toISOString(),
      mode: this.mode,
      appVersion: this.appVersion,
    };
    return this.put(STATUS_FILE, encodeJson(status), JSON_TYPE);
  }

  private queueAllHistory() {
    if (!this.store.isOpen()) return;
    for (const s of this.store.driveView().sets) this.historyQueue.add(s.id);
  }

  /** Publishes every waiting history file now, one after another. */
  async drainHistory(): Promise<void> {
    while (this.historyQueue.size && !this.stopped && !this.paused) {
      const before = this.historyQueue.size;
      await this.nextHistory();
      if (this.historyQueue.size === before) break; // it failed; the timer tries again
    }
  }

  /** One set's history file, if it changed since it was last published. */
  private async nextHistory() {
    if (this.historyBusy || this.paused || this.stopped || !this.store.isOpen()) return;
    const [setId] = this.historyQueue;
    if (!setId) return;
    this.historyBusy = true;
    try {
      const rows: HistoryRow[] = await this.store.history(setId);
      const sig = `${rows.length}:${rows.length ? rows[rows.length - 1].id : ''}`;
      if (rows.length && this.state.data.history[setId] !== sig) {
        await this.put(historyFile(setId), await encodeJsonGz(rows), GZIP);
        this.state.data.history[setId] = sig;
        await this.state.save();
        // The snapshot says how far each history file goes.
        this.schedule();
      }
      this.historyQueue.delete(setId);
    } catch (err) {
      this.events.failed(err);
    } finally {
      this.historyBusy = false;
    }
  }
}
