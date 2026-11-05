// The desktop's Google Drive mailbox as the page sees it: the preload script
// exposes this as window.legoTrackerDesktop.drive, the main process
// (desktop/src/drive/worker.ts) answers. The page never gets a Drive token;
// it sees the state, starts the connection, and runs the refreshes asked for.
import type { Op } from '../data/ops';

export type DriveWorkerState =
  | 'off'
  | 'not-connected'
  | 'wrong-account'
  | 'starting'
  | 'publishing'
  | 'paused'
  | 'error';

export interface DriveWorkerStatus {
  state: DriveWorkerState;
  /** The Google account Drive is connected with. */
  account: string | null;
  lastPublishedAt: string | null;
  /** paused: the PC that publishes instead. */
  otherPublisher: string | null;
  /** error: what Google Drive said. */
  detail: string | null;
}

export type DriveRefresh = Extract<Op, { type: 'refresh' }>;
export type DriveReplyStatus = 'running' | 'done' | 'failed';

export interface DesktopDriveBridge {
  status(): Promise<DriveWorkerStatus>;
  onStatus(listener: (status: DriveWorkerStatus) => void): () => void;
  /** Runs the Google sign-in with the Drive permission (for this copy's account). */
  connect(): Promise<DriveWorkerStatus>;
  /** Refreshes asked for before the page was listening; from then on they come by onRefresh. */
  takeRefreshes(): Promise<DriveRefresh[]>;
  onRefresh(listener: (refresh: DriveRefresh) => void): () => void;
  reply(requestId: string, status: DriveReplyStatus, error?: string): Promise<void>;
}
