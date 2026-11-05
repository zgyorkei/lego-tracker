import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { readJsonFile, writeFileAtomic } from '../store/files';
import { createDriveClient } from '../../../lib/drive/client';
import type { StorageMode } from '../../../lib/drive/layout';
import type { DriveWorkerStatus } from '../../../lib/drive/bridge';
import type { GoogleSession } from '../googleSession';
import type { LocalStore } from '../store/localStore';
import { DriveState } from './state';
import { Publisher } from './publisher';
import { Inbox, type RefreshOp } from './inbox';

// Runs the Drive mailbox (publisher.ts, inbox.ts) for the account whose copy
// is open, when Google Drive is on in the settings and the desktop's Google
// session (googleSession.ts) has the app-data permission for that account.
// Its state is what the page shows (lib/drive/bridge.ts).

const RETRY_MS = 60_000;

export class DriveWorker extends EventEmitter {
  private current: {
    sub: string;
    publisher: Publisher;
    inbox: Inbox;
  } | null = null;
  private starting: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private self: { id: string; name: string } | null = null;
  private value: DriveWorkerStatus = {
    state: 'off',
    account: null,
    lastPublishedAt: null,
    otherPublisher: null,
    detail: null,
  };

  constructor(
    private readonly store: LocalStore,
    private readonly session: GoogleSession,
    private readonly settings: () => { drive: boolean; mode: StorageMode },
    /** <userData>/drive-publisher.json: this install's id and name. */
    private readonly selfFile: string,
    private readonly appVersion: string
  ) {
    super();
    store.on('opened', () => void this.update());
    session.onChange(() => void this.update());
  }

  status(): DriveWorkerStatus {
    return this.value;
  }

  private set(patch: Partial<DriveWorkerStatus>) {
    this.value = { ...this.value, ...patch };
    this.emit('status', this.value);
  }

  /** Starts, stops or switches the mailbox to match the settings, session and open copy. */
  async update(): Promise<void> {
    const account = this.session.account();
    const sub = this.store.status().sub;
    const want = this.settings().drive && account?.drive && sub && sub === account.sub ? sub : null;
    if (this.current && this.current.sub !== want) this.stop();
    if (!this.settings().drive) return this.set({ state: 'off', account: null, detail: null });
    if (!account || !account.drive)
      return this.set({ state: 'not-connected', account: account?.email ?? null, detail: null });
    if (sub && sub !== account.sub)
      return this.set({ state: 'wrong-account', account: account.email, detail: null });
    if (!want) return this.set({ state: 'starting', account: account.email });
    if (this.current || this.starting === want) return;
    await this.start(want, account.email);
  }

  private async start(sub: string, email: string | null) {
    this.starting = sub;
    this.set({ state: 'starting', account: email, detail: null, otherPublisher: null });
    try {
      const dir = this.store.accountDir();
      if (!dir) throw new Error('No copy is open');
      const state = await DriveState.load(dir);
      const drive = createDriveClient((o) => this.session.accessToken(o));
      const publisher = new Publisher(
        drive,
        this.store,
        state,
        await this.identity(),
        this.settings().mode,
        this.appVersion,
        {
          published: (at) =>
            this.set({
              state: 'publishing',
              lastPublishedAt: at,
              otherPublisher: null,
              detail: null,
            }),
          paused: (name) => this.set({ state: 'paused', otherPublisher: name }),
          failed: (err) => this.failed(err),
        }
      );
      const inbox = new Inbox(drive, this.store, state, publisher, {
        refresh: (op) => this.emit('refresh', op),
        failed: (err) => this.failed(err),
      });
      await publisher.start();
      if (this.starting !== sub) {
        // Signed out (or switched) while starting.
        publisher.stop();
        return;
      }
      inbox.start();
      this.current = { sub, publisher, inbox };
      if (!publisher.paused) this.set({ state: 'publishing' });
    } catch (err) {
      this.failed(err);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.update();
      }, RETRY_MS);
    } finally {
      if (this.starting === sub) this.starting = null;
    }
  }

  stop(): void {
    this.starting = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.current?.inbox.stop();
    this.current?.publisher.stop();
    this.current = null;
  }

  /** How a refresh asked for over Drive went (the page reports it). */
  async reply(requestId: string, status: 'running' | 'done' | 'failed', error?: string) {
    await this.current?.inbox.reply(requestId, status, error);
  }

  private failed(err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('Google Drive:', err);
    this.set({ state: 'error', detail: detail.slice(0, 300) });
  }

  /** This install's id and the PC's name, made once. */
  private async identity() {
    if (this.self) return this.self;
    const saved = await readJsonFile<{ id?: string; name?: string }>(this.selfFile);
    this.self =
      saved?.id && /^[0-9a-f]{16,64}$/.test(saved.id)
        ? { id: saved.id, name: saved.name || os.hostname() }
        : { id: randomBytes(16).toString('hex'), name: os.hostname() };
    if (!saved?.id) await writeFileAtomic(this.selfFile, JSON.stringify(this.self));
    return this.self;
  }
}

export type { RefreshOp, DriveWorkerStatus };
