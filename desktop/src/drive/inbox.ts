import type { DriveClient } from '../../../lib/drive/client';
import {
  decodeJson,
  encodeJson,
  OPS_PREFIX,
  parseOpsFile,
  pendingBatches,
  remember,
  replyFile,
  type DriveReply,
} from '../../../lib/drive/layout';
import { validateOpBatch, type Op, type RejectedOp } from '../../../lib/data/ops';
import type { LocalStore } from '../store/localStore';
import type { Publisher } from './publisher';
import type { DriveState } from './state';

// Takes in the change batches a website (or phone) left in the Drive folder:
// every 15 s it lists the ops files, and for each batch not applied yet it
// checks it (lib/data/ops.ts), applies it to the copy, publishes the snapshot
// naming the batch (and any ops it refused), then deletes the file. A batch
// already applied is only deleted, so none applies twice. Refresh requests go
// to the page, which runs them; how each went is written as reply-*.json.

const POLL_MS = 15_000;

export type RefreshOp = Extract<Op, { type: 'refresh' }>;

export interface InboxEvents {
  refresh(op: RefreshOp): void;
  failed(err: unknown): void;
}

export class Inbox {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private stopped = false;

  constructor(
    private readonly drive: DriveClient,
    private readonly store: LocalStore,
    private readonly state: DriveState,
    private readonly publisher: Publisher,
    private readonly events: InboxEvents
  ) {}

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** Checks for batches now (and is what the timer runs). */
  async poll(): Promise<void> {
    // While another PC publishes, its inbox is the one that applies batches.
    if (this.busy || this.stopped || this.publisher.paused || !this.store.isOpen()) return;
    this.busy = true;
    try {
      const files = await this.drive.list(OPS_PREFIX);
      for (const f of files) {
        const p = parseOpsFile(f.name);
        if (p && this.state.data.applied.includes(p.batchId)) await this.drive.remove(f.id);
      }
      for (const f of pendingBatches(files, this.state.data.applied)) {
        if (this.stopped) break;
        await this.take(f.id, f.batchId);
      }
    } catch (err) {
      this.events.failed(err);
    } finally {
      this.busy = false;
    }
  }

  private async take(fileId: string, batchId: string) {
    let parsed: unknown = null;
    try {
      parsed = decodeJson(await this.drive.download(fileId));
    } catch {
      // Unreadable: refused whole below.
    }
    const checked = validateOpBatch(parsed);
    let rejected: RejectedOp[];
    if ('error' in checked || checked.batch.batchId !== batchId) {
      const reason = 'error' in checked ? checked.error : 'The batch id does not match its file';
      rejected = [{ index: -1, reason }];
    } else {
      const result = await this.store.applyOpsBatch(checked.batch);
      rejected = [...checked.batch.rejected, ...result.rejected].sort((a, b) => a.index - b.index);
      for (const op of result.refreshes) this.events.refresh(op);
    }
    this.state.data.applied = remember(this.state.data.applied, batchId);
    this.state.noteRejected(batchId, rejected);
    await this.state.save();
    // The snapshot names the batch before its file goes, so a website never
    // sees the change vanish in between.
    await this.publisher.publishNow();
    await this.drive.remove(fileId);
  }

  /** How a refresh a website asked for went. */
  reply(requestId: string, status: DriveReply['status'], error?: string): Promise<void> {
    const reply: DriveReply = {
      requestId,
      status,
      at: new Date().toISOString(),
      ...(error ? { error: error.slice(0, 300) } : {}),
    };
    return this.publisher.put(replyFile(requestId), encodeJson(reply), 'application/json');
  }
}
