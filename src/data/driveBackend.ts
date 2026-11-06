import { newAutoId } from '../../lib/data/ids';
import {
  MAX_BATCH_BYTES,
  MAX_OPS_PER_BATCH,
  MAX_REQUEST_SETS,
  checkOp,
  type Op,
  type RefreshKind,
} from '../../lib/data/ops';
import { isSetUpdatableField } from '../../lib/data/setFields';
import { mergeHistory, type HistoryRow } from '../../lib/data/store';
import type { DriveClient, DriveFile } from '../../lib/drive/client';
import { DriveError } from '../../lib/drive/client';
import {
  LAYOUT_VERSION,
  OPS_PREFIX,
  REPLY_PREFIX,
  SNAPSHOT_FILE,
  STATUS_FILE,
  decodeJson,
  decodeJsonGz,
  historyFile,
  isFresh,
  opsFile,
  parseOpsFile,
  replyFile,
  type DriveReply,
  type DriveSnapshot,
  type DriveStatus,
} from '../../lib/drive/layout';
import { RUN_TIMEOUT_MS, type DelegateOutcome } from '../lib/desktopWorker';
import { toStoredSource } from '../lib/priceSources';
import { withSetDates } from '../lib/setDates';
import type { LegoSet, PriceHistory, PriceSource } from '../types';
import {
  describeRefusals,
  overlay,
  refusalsFor,
  stillPending,
  type OutboxBatch,
} from './driveOverlay';
import { SessionError, onWebSignOut } from './googleWebSession';
import { DataError, type DataBackend } from './types';

// The website's backend without Firebase (local-storage plan, Phase 6): the
// desktop's copy through the account's Google Drive app-data folder
// (lib/drive/layout.ts). The desktop publishes its sets as a snapshot; this
// side only drops batches of changes for it to apply. While the page is
// visible it polls the folder and downloads the snapshot when it changed;
// its own changes are kept here (and in localStorage, so they survive a
// reload and a PC that is off) and shown on top until the snapshot names them
// as applied. They go out after a second without further changes, or when the
// page is hidden; a long run holds them back and sends them as one batch.

/** Polling the folder while the page is visible. */
export const POLL_MS = 10 * 1000;
/** Changes go out after this long without another. */
export const IDLE_MS = 1000;
/** A refresh handed to the desktop is given up if it has not started by then. */
export const START_TIMEOUT_MS = 60 * 1000;
/** How often a website asks how its refresh is going. */
export const REPLY_POLL_MS = 5 * 1000;
/** Room left in a batch for its envelope. */
const BATCH_SOFT_BYTES = MAX_BATCH_BYTES - 16 * 1024;
const KEY_PREFIX = 'bt.drive.';
const outboxKey = (sub: string) => `${KEY_PREFIX}outbox.${sub}`;
const snapshotKey = (sub: string) => `${KEY_PREFIX}snapshot.${sub}`;

/** What the website also needs from the desktop beyond the data. */
export interface DriveBackend extends DataBackend {
  /** What the publishing desktop says about itself (status.json); null until known or when there is none. */
  subscribeStatus(onStatus: (status: DriveStatus | null) => void): () => void;
  /**
   * Hands a refresh to the desktop as a refresh op and follows its reply
   * file: "done" when it ran, "failed" or "unavailable" when the caller should
   * do it itself (the desktop is off, or did not start it within a minute).
   */
  delegateRefresh(kind: RefreshKind, setIds: string[]): Promise<DelegateOutcome>;
  /** Holds changes back, so a long run reaches the desktop as one batch; the returned release sends them. */
  hold(): () => void;
  /** Sends the changes gathered so far. */
  flush(): Promise<void>;
}

/** Whether the page is being looked at; the backend polls only then. */
export interface PageSignals {
  visible(): boolean;
  /** Calls back when the page is shown or hidden; returns the removal. */
  onChange(listener: (visible: boolean) => void): () => void;
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface DriveBackendOptions {
  /** The Google account (its sub); keys what this browser keeps. */
  sub: string;
  /** Named in each batch, for the record. */
  by: string | null;
  client: DriveClient;
  storage?: KeyValueStore | null;
  page?: PageSignals | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  idleMs?: number;
}

const browserStorage = (): KeyValueStore | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const browserPage = (): PageSignals | null =>
  typeof document === 'undefined'
    ? null
    : {
        visible: () => document.visibilityState === 'visible',
        onChange(listener) {
          const changed = () => listener(document.visibilityState === 'visible');
          const hidden = () => listener(false);
          document.addEventListener('visibilitychange', changed);
          window.addEventListener('pagehide', hidden);
          return () => {
            document.removeEventListener('visibilitychange', changed);
            window.removeEventListener('pagehide', hidden);
          };
        },
      };

// A signed-out browser keeps nothing of the account (googleWebSession.signOut).
onWebSignOut(() => {
  const store = browserStorage();
  if (!store || typeof localStorage === 'undefined') return;
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(KEY_PREFIX)) store.removeItem(key);
  } catch {
    // Storage blocked: nothing was kept either.
  }
});

const versionOf = (f: DriveFile) => `${f.id}:${f.modifiedTime ?? ''}:${f.size ?? ''}`;

function asSnapshot(value: unknown): DriveSnapshot | 'newer' | null {
  const s = value as DriveSnapshot | null;
  if (!s || typeof s !== 'object' || !Array.isArray(s.sets) || !Array.isArray(s.applied))
    return null;
  if (typeof s.version === 'number' && s.version > LAYOUT_VERSION) return 'newer';
  return s;
}

const asStatus = (value: unknown): DriveStatus | null => {
  const s = value as DriveStatus | null;
  return s && typeof s === 'object' && typeof s.heartbeatAt === 'string' ? s : null;
};

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A Drive or session failure as the set list shows it. */
function driveProblem(err: unknown): DataError {
  if (err instanceof SessionError)
    return new DataError(
      err.code === 'signed-out'
        ? 'You are signed out of Google. Sign in again to reach your desktop copy.'
        : err.message,
      err.code ?? 'session',
      err
    );
  if (err instanceof DriveError && (err.status === 401 || err.status === 403))
    return new DataError(
      'Google Drive refused access to the desktop copy. Sign out, sign in again and tick the Google Drive box.',
      'drive-refused',
      err
    );
  return new DataError(
    `Google Drive could not be reached (${messageOf(err)}). Showing the last copy; changes wait on this device.`,
    'drive-offline',
    err
  );
}

export function createDriveBackend(opts: DriveBackendOptions): DriveBackend {
  const {
    sub,
    by,
    client,
    storage = browserStorage(),
    page = browserPage(),
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    pollMs = POLL_MS,
    idleMs = IDLE_MS,
  } = opts;

  const read = <T>(key: string): T | null => {
    try {
      const raw = storage?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: unknown) => {
    try {
      storage?.setItem(key, JSON.stringify(value));
    } catch {
      // Quota or blocked storage: the copy in memory still works.
    }
  };

  let snapshot: DriveSnapshot | null = read<DriveSnapshot>(snapshotKey(sub));
  /** The snapshot was read from Drive in this page (not only from this browser's cache). */
  let confirmed = false;
  /** Drive was read and holds no snapshot: the desktop has never published. */
  let noSnapshot = false;
  let snapshotVersion: string | null = null;
  let status: DriveStatus | null = null;
  let statusVersion: string | null = null;
  let outbox: OutboxBatch[] = read<OutboxBatch[]>(outboxKey(sub)) ?? [];
  /** Batches being uploaded now (not persisted: a reload sends them again, applied once by batchId). */
  const sending = new Set<string>();
  /** Batches whose refusals were already shown. */
  const reported = new Set<string>();
  /** Batch ids this browser sent (for showing their refusals). */
  const mine = new Set<string>(outbox.map((b) => b.batchId));
  const historyCache = new Map<string, { sig: string; rows: HistoryRow[] }>();

  const setsListeners = new Set<{
    onSets: (s: LegoSet[]) => void;
    onError: (e: DataError) => void;
  }>();
  const sourceListeners = new Set<{
    onSources: (stored: PriceSource[] | null, fromCache: boolean) => void;
    onError: (e: unknown) => void;
  }>();
  const statusListeners = new Set<(s: DriveStatus | null) => void>();

  let previous = new Map<string, { sig: string; set: LegoSet }>();
  let lastListSig: string | null = null;
  let lastSourcesSig: string | null = null;
  let lastError: string | null = null;
  let held = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let polling = false;
  let offPage: (() => void) | null = null;

  const persist = () => write(outboxKey(sub), outbox);
  const subscribers = () => setsListeners.size + sourceListeners.size + statusListeners.size;

  // ---- what the listeners see -------------------------------------------------------------

  function deliver() {
    const view = overlay(snapshot, outbox);
    if (snapshot || noSnapshot) {
      const next = new Map<string, { sig: string; set: LegoSet }>();
      const list = view.sets.map((record) => {
        const sig = JSON.stringify(record);
        const old = previous.get(record.id);
        // Unchanged sets keep their object, so SetCard's memo holds.
        const keep =
          old && old.sig === sig ? old : { sig, set: withSetDates(record as unknown as LegoSet) };
        next.set(record.id, keep);
        return keep.set;
      });
      previous = next;
      const listSig = list.map((s) => next.get(s.id)!.sig).join('\n');
      // Only a changed list is delivered: delivering clears the list's error line.
      if (listSig !== lastListSig) {
        lastListSig = listSig;
        lastError = null;
        setsListeners.forEach((l) => l.onSets(list));
      }
    }
    const stored =
      Array.isArray(view.priceSources) && view.priceSources.length
        ? (view.priceSources as PriceSource[])
        : null;
    // The website never seeds a list of its own (the desktop's copy owns it), so
    // a missing list always reads as "not known yet".
    const fromCache = !confirmed || !stored;
    const sourcesSig = JSON.stringify([stored, fromCache]);
    if (sourcesSig !== lastSourcesSig && (snapshot || noSnapshot)) {
      lastSourcesSig = sourcesSig;
      sourceListeners.forEach((l) => l.onSources(stored, fromCache));
    }
  }

  function report(err: DataError) {
    if (err.message === lastError) return;
    lastError = err.message;
    setsListeners.forEach((l) => l.onError(err));
  }

  function reportRefusals() {
    const fresh = refusalsFor(snapshot, mine).filter((r) => !reported.has(r.batchId));
    fresh.forEach((r) => reported.add(r.batchId));
    const text = describeRefusals(fresh);
    if (text) report(new DataError(text, 'rejected'));
  }

  // ---- polling ----------------------------------------------------------------------------

  async function pollOnce() {
    const files = await client.list();
    const snapFile = files.find((f) => f.name === SNAPSHOT_FILE);
    const statusFile = files.find((f) => f.name === STATUS_FILE);

    if (statusFile) {
      const v = versionOf(statusFile);
      if (v !== statusVersion) {
        status = asStatus(decodeJson(await client.download(statusFile.id)));
        statusVersion = v;
        statusListeners.forEach((l) => l(status));
      }
    } else if (status || statusVersion === null) {
      status = null;
      statusVersion = '';
      statusListeners.forEach((l) => l(null));
    }

    if (snapFile) {
      const v = versionOf(snapFile);
      if (v !== snapshotVersion) {
        const s = asSnapshot(await decodeJsonGz(await client.download(snapFile.id)));
        if (s === 'newer') {
          report(
            new DataError(
              'Your desktop runs a newer Brick Tracker than this website knows. Update the website to read its copy.',
              'drive-newer'
            )
          );
          return;
        }
        if (s) {
          snapshot = s;
          snapshotVersion = v;
          write(snapshotKey(sub), s);
        }
      }
      confirmed = true;
      noSnapshot = false;
    } else {
      noSnapshot = true;
      confirmed = true;
    }

    if (snapshot) {
      const before = outbox.length;
      outbox = stillPending(outbox, snapshot.applied);
      if (outbox.length !== before) persist();
    }
    deliver();
    reportRefusals();
    if (noSnapshot && !snapshot)
      report(
        new DataError(
          "Your desktop has not shared its copy through Google Drive yet. In the desktop app's Settings, turn on 'Let my phone and website reach this PC's copy'.",
          'drive-empty'
        )
      );
    // Changes that could not go out before go now.
    if (outbox.some((b) => !b.sent)) await flush();
  }

  function schedule(delay: number) {
    clearTimeout(pollTimer);
    pollTimer = undefined;
    if (!subscribers() || (page && !page.visible())) return;
    pollTimer = setTimeout(() => void poll(), delay);
  }

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      await pollOnce();
    } catch (err) {
      deliver();
      report(driveProblem(err));
    } finally {
      polling = false;
      schedule(pollMs);
    }
  }

  function started() {
    if (subscribers() !== 1) return;
    offPage = page
      ? page.onChange((visible) => {
          if (visible) schedule(0);
          else {
            clearTimeout(pollTimer);
            void flush();
          }
        })
      : null;
    // What this browser already had shows at once.
    deliver();
    schedule(0);
  }

  function stopped() {
    if (subscribers()) return;
    clearTimeout(pollTimer);
    offPage?.();
    offPage = null;
  }

  // ---- changes ----------------------------------------------------------------------------

  function queue(op: Op) {
    const checked = checkOp(op);
    if ('reason' in checked) throw new DataError(`Not saved: ${checked.reason}`, 'invalid');
    let draft = outbox[outbox.length - 1];
    if (
      !draft ||
      draft.sent ||
      sending.has(draft.batchId) ||
      draft.ops.length >= MAX_OPS_PER_BATCH ||
      JSON.stringify(draft).length > BATCH_SOFT_BYTES
    ) {
      draft = {
        batchId: newAutoId(),
        createdAt: new Date(now()).toISOString(),
        ops: [],
        sent: false,
      };
      outbox.push(draft);
      mine.add(draft.batchId);
    }
    draft.ops.push(checked.op);
    persist();
    deliver();
    if (!held) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => void flush(), idleMs);
    }
  }

  async function upload(batch: OutboxBatch) {
    sending.add(batch.batchId);
    try {
      const body = JSON.stringify({
        batchId: batch.batchId,
        createdAt: batch.createdAt,
        by,
        ops: batch.ops,
      });
      await client.create(opsFile(now(), batch.batchId), body, 'application/json');
      batch.sent = true;
      persist();
    } finally {
      sending.delete(batch.batchId);
    }
  }

  async function flush() {
    clearTimeout(idleTimer);
    if (held) return;
    for (const batch of outbox.filter((b) => !b.sent && !sending.has(b.batchId) && b.ops.length)) {
      try {
        await upload(batch);
      } catch (err) {
        report(driveProblem(err));
        return;
      }
    }
  }

  const iso = () => new Date(now()).toISOString();

  // ---- the refresh handed to the desktop -------------------------------------------------

  async function readReply(requestId: string): Promise<DriveReply | null> {
    const name = replyFile(requestId);
    const f = (await client.list(REPLY_PREFIX)).find((x) => x.name === name);
    if (!f) return null;
    const r = decodeJson(await client.download(f.id)) as DriveReply | null;
    return r && typeof r.status === 'string' ? r : null;
  }

  /** Withdraws a batch the desktop has not picked up (its file is still there); false when it was. */
  async function withdraw(batchId: string): Promise<boolean> {
    const f = (await client.list(OPS_PREFIX)).find(
      (x) => parseOpsFile(x.name)?.batchId === batchId
    );
    if (!f) return false;
    await client.remove(f.id);
    outbox = outbox.filter((b) => b.batchId !== batchId);
    persist();
    return true;
  }

  return {
    capabilities: { registries: false, publicPlannedList: false, firestoreWorker: false },

    subscribeSets(onSets, onError) {
      const l = { onSets, onError };
      setsListeners.add(l);
      lastListSig = null;
      started();
      return () => {
        setsListeners.delete(l);
        stopped();
      };
    },

    async addSet(setData) {
      const value: Record<string, unknown> = {
        ...setData,
        addedAt: typeof setData.addedAt === 'string' ? setData.addedAt : iso(),
      };
      delete value.id;
      delete value.userId;
      queue({ type: 'create', id: newAutoId(), value });
    },

    async updateSet(id, updates) {
      // Only what the sets rule lets change; the desktop refuses anything else.
      const fields = Object.fromEntries(
        Object.entries(updates).filter(([k]) => isSetUpdatableField(k) && k !== 'updatedAt')
      );
      if (!Object.keys(fields).length) return;
      queue({ type: 'update', id, fields });
    },

    async deleteSet(id) {
      queue({ type: 'delete', id });
    },

    async addPriceHistory(setId, row) {
      queue({
        type: 'addHistory',
        setId,
        row: { ...(row as unknown as HistoryRow), id: newAutoId(), createdAt: iso() },
      });
    },

    async getPriceHistory(setId) {
      let rows: HistoryRow[] = [];
      const info = snapshot?.history?.[setId];
      if (info && info.rows > 0) {
        const sig = `${info.rows}:${info.lastId ?? ''}`;
        const cached = historyCache.get(setId);
        if (cached?.sig === sig) rows = cached.rows;
        else {
          try {
            const name = historyFile(setId);
            const f = (await client.list(name)).find((x) => x.name === name);
            if (f) {
              const decoded = await decodeJsonGz(await client.download(f.id));
              rows = Array.isArray(decoded) ? (decoded as HistoryRow[]) : [];
              historyCache.set(setId, { sig, rows });
            }
          } catch (err) {
            throw driveProblem(err);
          }
        }
      }
      const pending = overlay(snapshot, outbox).pendingHistory[setId] ?? [];
      return mergeHistory(rows, pending) as unknown as PriceHistory[];
    },

    subscribePriceSources(onSources, onError) {
      const l = { onSources, onError };
      sourceListeners.add(l);
      lastSourcesSig = null;
      started();
      return () => {
        sourceListeners.delete(l);
        stopped();
      };
    },

    async savePriceSources(sources) {
      queue({ type: 'priceSources', list: sources.map(toStoredSource) });
    },

    subscribeStatus(onStatus) {
      statusListeners.add(onStatus);
      onStatus(status);
      started();
      return () => {
        statusListeners.delete(onStatus);
        stopped();
      };
    },

    async delegateRefresh(kind, setIds) {
      if (!setIds.length || !isFresh(status, now())) return 'unavailable';
      const requestId = newAutoId();
      const batch: OutboxBatch = {
        batchId: newAutoId(),
        createdAt: iso(),
        ops: [{ type: 'refresh', requestId, kind, setIds: setIds.slice(0, MAX_REQUEST_SETS) }],
        sent: false,
      };
      // Its own batch, sent at once whatever is held: the desktop starts sooner.
      outbox.push(batch);
      mine.add(batch.batchId);
      persist();
      try {
        await upload(batch);
      } catch {
        outbox = outbox.filter((b) => b !== batch);
        persist();
        return 'unavailable';
      }
      const startBy = now() + START_TIMEOUT_MS;
      let runUntil: number | null = null;
      for (;;) {
        await sleep(REPLY_POLL_MS);
        let reply: DriveReply | null = null;
        try {
          reply = await readReply(requestId);
        } catch {
          // A missed poll is retried; the deadlines still apply.
        }
        if (reply?.status === 'done') return 'done';
        if (reply?.status === 'failed') return 'failed';
        if (reply?.status === 'running' && runUntil === null) runUntil = now() + RUN_TIMEOUT_MS;
        if (runUntil !== null) {
          if (now() > runUntil) return 'failed';
          continue;
        }
        if (now() > startBy) {
          // Not started: withdraw it so the desktop does not run it after the
          // website has done the work itself. If it was already picked up,
          // give the reply a little longer.
          if (await withdraw(batch.batchId).catch(() => false)) return 'unavailable';
          if (now() > startBy + 30 * 1000) return 'unavailable';
        }
      }
    },

    hold() {
      held++;
      clearTimeout(idleTimer);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        held = Math.max(0, held - 1);
        if (!held) void flush();
      };
    },

    flush,
  };
}
