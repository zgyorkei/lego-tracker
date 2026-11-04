// The desktop app's local store as the page sees it: the preload script
// exposes this as window.legoTrackerDesktop.store, and desktop/src/store/ipc.ts
// answers it in the main process. Only the app's own page can reach it, and
// the data is never served over HTTP.
import type {
  HistoryCursor,
  HistoryRow,
  LocalOp,
  PushOp,
  RemoteSetsSnapshot,
  SetRecord,
  StoreSummary,
} from './store';

/** A change from the page: the main process stamps the time. */
export type LocalChange =
  | Omit<Extract<LocalOp, { type: 'create' }>, 'at'>
  | Omit<Extract<LocalOp, { type: 'update' }>, 'at'>
  | Exclude<LocalOp, { type: 'create' } | { type: 'update' }>;

export type BackupKind = 'registries' | 'plannedList';

export interface StoreStatus extends StoreSummary {
  /** The Google account whose copy is open, or null before one is. */
  sub: string | null;
  /** The folder the copy lives in, to show the user. */
  dir: string | null;
  /** When the copy was last written to disk. */
  lastWrittenAt: string | null;
  /** The newest daily backup file. */
  lastBackupDay: string | null;
  /** Firestore reads spent on copying history today. */
  budget: { day: string; used: number; limit: number };
  /** The last failure writing the copy, if the latest write failed. */
  error: string | null;
}

export interface StoreChange {
  changed: string[];
  removed: string[];
  status: StoreStatus;
}

export interface HistoryPage {
  rows: HistoryRow[];
  /** No more rows after these. */
  done: boolean;
  /** Firestore reads the page cost. */
  reads: number;
  /** The local day the reads count against (YYYY-MM-DD). */
  day: string;
}

export interface DesktopStoreBridge {
  /** Opens (or switches to) the copy of this Google account. */
  open(googleSub: string): Promise<StoreStatus>;
  status(): Promise<StoreStatus>;
  applySets(snapshot: RemoteSetsSnapshot): Promise<StoreStatus>;
  putPriceSources(list: unknown[] | null): Promise<void>;
  historyWork(): Promise<{ setId: string; cursor: HistoryCursor | null }[]>;
  putHistoryPage(setId: string, page: HistoryPage): Promise<StoreStatus>;
  budgetLeft(day: string): Promise<number>;
  putBackup(kind: BackupKind, data: unknown): Promise<void>;
  resolveHeld(choice: 'delete' | 'keep'): Promise<StoreStatus>;
  /** Coalesced change events; returns the unsubscribe. */
  onChange(listener: (change: StoreChange) => void): () => void;

  // Local-first (Phase 3): the app reads and writes the copy; firestoreSync
  // pushes what changed.
  /** The sets the app shows, newest first. */
  sets(): Promise<SetRecord[]>;
  /** A set's price history, oldest first, including rows not on the server yet. */
  history(setId: string): Promise<HistoryRow[]>;
  priceSources(): Promise<{ list: unknown[] | null; seen: boolean }>;
  applyLocal(change: LocalChange): Promise<StoreStatus>;
  planPush(): Promise<PushOp[]>;
  ackPush(op: PushOp): Promise<StoreStatus>;
}

/** Google account ids are decimal digits; anything else never becomes a folder name. */
export const isGoogleSub = (sub: unknown): sub is string =>
  typeof sub === 'string' && /^[0-9]{1,64}$/.test(sub);

/** The local day for a time, YYYY-MM-DD, as the daily backups and read budget count it. */
export function localDay(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
