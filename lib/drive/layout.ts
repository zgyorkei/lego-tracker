// The Google Drive mailbox between the desktop and the website (or phone), in
// the account's app-data folder (./client.ts). One writer per file kind:
//
//   desktop  snapshot.json.gz        the copy's sets and price sources, and
//                                    which change batches it has applied
//            status.json             heartbeat: who publishes, mode, version
//            history-<setId>.json.gz one set's price history, loaded lazily
//            reply-<requestId>.json  how a refresh asked for by a website went
//   website  ops-<ts>-<batchId>.json a batch of changes (lib/data/ops.ts)
//
// The desktop is the only writer of the snapshot: it applies each batch,
// publishes the snapshot naming the batch, then deletes the ops file, so a
// website can overlay any batch not yet named on the snapshot it has.
import type { RejectedOp } from '../data/ops';
import { BATCH_ID_RE } from '../data/ops';
import type { SetRecord } from '../data/store';

export const LAYOUT_VERSION = 1;
export const SNAPSHOT_FILE = 'snapshot.json.gz';
export const STATUS_FILE = 'status.json';
export const HISTORY_PREFIX = 'history-';
export const REPLY_PREFIX = 'reply-';
export const OPS_PREFIX = 'ops-';

export const historyFile = (setId: string) => `${HISTORY_PREFIX}${setId}.json.gz`;
export const replyFile = (requestId: string) => `${REPLY_PREFIX}${requestId}.json`;
export const opsFile = (at: number, batchId: string) => `${OPS_PREFIX}${at}-${batchId}.json`;

/** How often the publishing desktop writes status.json. */
export const HEARTBEAT_MS = 2 * 60 * 1000;
/** A publisher not heard from for this long is gone (another PC may take over). */
export const STALE_MS = 5 * 60 * 1000;
/** How many applied batch ids the snapshot keeps naming. */
export const MAX_APPLIED = 500;

export type StorageMode = 'local' | 'both';

export interface DriveSnapshot {
  version: typeof LAYOUT_VERSION;
  publishedAt: string;
  /** The publishing desktop's install id. */
  publisher: string;
  mode: StorageMode;
  /** The sets the app shows (no userId). */
  sets: SetRecord[];
  priceSources: unknown[] | null;
  /** Batches applied, oldest first (the newest MAX_APPLIED). */
  applied: string[];
  /** Ops refused, per batch id, for the website to show (the newest batches). */
  rejected: Record<string, RejectedOp[]>;
  /** Per set, what its history file holds, so a website knows when to load it again. */
  history: Record<string, { rows: number; lastId: string | null }>;
}

export interface DriveStatus {
  version: typeof LAYOUT_VERSION;
  publisher: string;
  /** A name for the PC, to say which one publishes. */
  publisherName: string;
  heartbeatAt: string;
  mode: StorageMode;
  appVersion: string;
}

export interface DriveReply {
  requestId: string;
  status: 'running' | 'done' | 'failed';
  at: string;
  error?: string;
}

const OPS_RE = /^ops-(\d{1,16})-([A-Za-z0-9_-]{8,64})\.json$/;

/** The time and batch id an ops file's name carries, or null for anything else. */
export function parseOpsFile(name: string): { at: number; batchId: string } | null {
  const m = OPS_RE.exec(name);
  if (!m || !BATCH_ID_RE.test(m[2])) return null;
  return { at: Number(m[1]), batchId: m[2] };
}

/** The set id a history file's name carries, or null. */
export function parseHistoryFile(name: string): string | null {
  const m = /^history-([A-Za-z0-9_-]{1,128})\.json\.gz$/.exec(name);
  return m ? m[1] : null;
}

/**
 * The ops files still to apply, oldest first: named like one, and not in
 * `applied` (a file can outlive its batch if deleting it failed).
 */
export function pendingBatches<F extends { name: string }>(
  files: F[],
  applied: readonly string[]
): (F & { at: number; batchId: string })[] {
  const done = new Set(applied);
  return files
    .map((f) => {
      const p = parseOpsFile(f.name);
      return p ? { ...f, ...p } : null;
    })
    .filter((f): f is F & { at: number; batchId: string } => !!f && !done.has(f.batchId))
    .sort((a, b) => a.at - b.at || a.batchId.localeCompare(b.batchId));
}

const ms = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Whether a publisher's heartbeat is recent (a clock a little ahead still counts). */
export function isFresh(status: Pick<DriveStatus, 'heartbeatAt'> | null, now = Date.now()) {
  const t = ms(status?.heartbeatAt);
  return t !== null && now - t < STALE_MS && t - now < STALE_MS;
}

/** Another PC is publishing to this folder now, so this one must not. */
export function anotherPublisher(
  status: Pick<DriveStatus, 'publisher' | 'heartbeatAt'> | null,
  self: string,
  now = Date.now()
): boolean {
  return !!status && status.publisher !== self && isFresh(status, now);
}

/** Keeps the newest `max` ids, oldest first, without repeats. */
export function remember(ids: readonly string[], id: string, max = MAX_APPLIED): string[] {
  const out = ids.filter((x) => x !== id);
  out.push(id);
  return out.slice(-max);
}

// gzip through the streams API, which browsers and Node (18+) both have.
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export const encodeJson = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
export const decodeJson = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder().decode(bytes));
export const encodeJsonGz = (value: unknown) =>
  pipe(encodeJson(value), new CompressionStream('gzip'));
export const decodeJsonGz = async (bytes: Uint8Array) =>
  decodeJson(await pipe(bytes, new DecompressionStream('gzip')));
