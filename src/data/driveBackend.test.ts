import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriveClient, DriveFile } from '../../lib/drive/client';
import {
  SNAPSHOT_FILE,
  STATUS_FILE,
  decodeJson,
  encodeJson,
  encodeJsonGz,
  historyFile,
  parseOpsFile,
  replyFile,
  type DriveSnapshot,
} from '../../lib/drive/layout';
import type { OpBatch } from '../../lib/data/ops';
import type { LegoSet } from '../types';
import { createDriveBackend, IDLE_MS, POLL_MS } from './driveBackend';
import type { DataError } from './types';

// The desktop's copy through Google Drive, against an in-memory folder.

const A = 'A'.repeat(20);
const SUB = '112233445566778899';

// Captured before the fake timers: gzip runs on zlib's thread pool, which only
// real time moves along (slowly on a busy machine).
const realSleep = (ms: number) =>
  new Promise<void>((r) => setImmediate(() => setTimeoutReal(r, ms)));
const setTimeoutReal = globalThis.setTimeout;

/**
 * Advances `ms` of fake time, then lets real async work finish: until `done()`
 * holds (up to 4 s of real time), or for a short real moment without one.
 */
async function after(ms = 0, done?: () => boolean) {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < (done ? 400 : 20); i++) {
    if (done?.()) return;
    await realSleep(5);
    await vi.advanceTimersByTimeAsync(0);
  }
}

function fakeDrive() {
  const files = new Map<string, DriveFile & { body: Uint8Array }>();
  let seq = 0;
  const bytes = (b: Uint8Array | string) =>
    typeof b === 'string' ? new TextEncoder().encode(b) : b;
  const client: DriveClient = {
    async list(prefix) {
      return [...files.values()]
        .filter((f) => !prefix || f.name.startsWith(prefix))
        .map(({ id, name, modifiedTime }) => ({ id, name, modifiedTime }));
    },
    async download(id) {
      const f = files.get(id);
      if (!f) throw new Error('gone');
      return f.body;
    },
    async create(name, body) {
      const id = `f${++seq}`;
      files.set(id, { id, name, body: bytes(body), modifiedTime: String(seq) });
      return { id, name };
    },
    async update(id, body) {
      const f = files.get(id)!;
      f.body = bytes(body);
      f.modifiedTime = String(++seq);
      return f;
    },
    async remove(id) {
      files.delete(id);
    },
  };
  const byName = (name: string) => [...files.values()].find((f) => f.name === name);
  return {
    client,
    files,
    /** The desktop writing a file (replaces one of the same name). */
    async publish(name: string, value: unknown, gz = false) {
      const body = gz ? await encodeJsonGz(value) : encodeJson(value);
      const f = byName(name);
      if (f) await client.update(f.id, body, 'application/octet-stream');
      else await client.create(name, body, 'application/octet-stream');
    },
    /** The ops files a website dropped, oldest first. */
    batches(): (OpBatch & { file: string })[] {
      return [...files.values()]
        .filter((f) => parseOpsFile(f.name))
        .map((f) => ({ ...(decodeJson(f.body) as OpBatch), file: f.id }));
    },
  };
}

const snapshot = (over: Partial<DriveSnapshot> = {}): DriveSnapshot => ({
  version: 1,
  publishedAt: new Date().toISOString(),
  publisher: 'pc-1',
  mode: 'both',
  sets: [{ id: A, name: 'Castle', setNumber: '10305', status: 'planned', priority: 'low' }],
  priceSources: [{ id: 'shop', name: 'Shop' }],
  applied: [],
  rejected: {},
  history: {},
  ...over,
});

const memoryStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

describe('the Drive backend', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });
  afterEach(() => vi.useRealTimers());

  function open(drive = fakeDrive(), storage = memoryStorage()) {
    const backend = createDriveBackend({
      sub: SUB,
      by: 'owner@example.com',
      client: drive.client,
      storage,
      page: null,
    });
    const seen: { sets: LegoSet[][]; errors: DataError[] } = { sets: [], errors: [] };
    const off = backend.subscribeSets(
      (s) => seen.sets.push(s),
      (e) => seen.errors.push(e)
    );
    return { backend, drive, storage, seen, off };
  }
  const last = (seen: { sets: LegoSet[][] }) => seen.sets[seen.sets.length - 1];

  it('shows the snapshot, an edit at once, and sends it after a second idle', async () => {
    const drive = fakeDrive();
    await drive.publish(SNAPSHOT_FILE, snapshot(), true);
    const { backend, seen, off } = open(drive);
    await after(0, () => seen.sets.length > 0);
    expect(last(seen).map((s) => s.name)).toEqual(['Castle']);

    await backend.updateSet(A, { name: 'Castle, edited', userId: 'x' } as Partial<LegoSet>);
    await backend.addSet({
      setNumber: '75192',
      name: 'Falcon',
      status: 'planned',
      priority: 'high',
    });
    expect(
      last(seen)
        .map((s) => s.name)
        .sort()
    ).toEqual(['Castle, edited', 'Falcon']);
    expect(drive.batches()).toHaveLength(0);

    await after(IDLE_MS, () => drive.batches().length > 0);
    const sent = drive.batches();
    expect(sent).toHaveLength(1);
    expect(sent[0].by).toBe('owner@example.com');
    // userId never travels, and only fields the rules let change do.
    expect(sent[0].ops[0]).toEqual({ type: 'update', id: A, fields: { name: 'Castle, edited' } });
    expect(sent[0].ops[1]).toMatchObject({ type: 'create', value: { name: 'Falcon' } });
    expect(JSON.stringify(sent[0])).not.toContain('userId');
    off();
  });

  it('keeps unsent changes across a reload while the PC is off, then sends them', async () => {
    const drive = fakeDrive();
    await drive.publish(SNAPSHOT_FILE, snapshot(), true);
    const storage = memoryStorage();
    const failing = { ...drive.client, create: async () => Promise.reject(new Error('offline')) };
    const first = createDriveBackend({ sub: SUB, by: null, client: failing, storage, page: null });
    const errors: DataError[] = [];
    const off1 = first.subscribeSets(
      () => {},
      (e) => errors.push(e)
    );
    await after(0);
    await first.deleteSet(A);
    await after(IDLE_MS, () => errors.length > 0);
    expect(errors.at(-1)?.code).toBe('drive-offline');
    off1();

    // A reload: the snapshot (still with the set) and the queued delete both come back.
    const { seen, off } = open(drive, storage);
    await after(0, () => seen.sets.length > 0 && drive.batches().length > 0);
    expect(last(seen)).toEqual([]);
    expect(drive.batches().map((b) => b.ops[0].type)).toEqual(['delete']);
    off();
  });

  it('drops a batch once the snapshot names it, and shows what the desktop refused', async () => {
    const drive = fakeDrive();
    await drive.publish(SNAPSHOT_FILE, snapshot(), true);
    const { backend, seen, off } = open(drive);
    await after(0, () => seen.sets.length > 0);
    await backend.updateSet(A, { priority: 'high' });
    await after(IDLE_MS, () => drive.batches().length > 0);
    const [b] = drive.batches();

    // The desktop applies it, refuses one op, publishes, deletes the file.
    drive.files.delete(b.file);
    await drive.publish(
      SNAPSHOT_FILE,
      snapshot({
        sets: [{ id: A, name: 'Castle', setNumber: '10305', status: 'planned', priority: 'high' }],
        applied: [b.batchId],
        rejected: { [b.batchId]: [{ index: 0, reason: 'Unknown set' }] },
      }),
      true
    );
    await after(POLL_MS, () => seen.errors.some((e) => e.code === 'rejected'));
    expect(last(seen)[0].priority).toBe('high');
    expect(seen.errors.map((e) => e.message)).toContain(
      'Your desktop did not apply 1 change: Unknown set'
    );
    off();
  });

  it('holds a long run back and sends it as one batch', async () => {
    const drive = fakeDrive();
    await drive.publish(SNAPSHOT_FILE, snapshot(), true);
    const { backend, seen, off } = open(drive);
    await after(0, () => seen.sets.length > 0);
    const release = backend.hold();
    for (let i = 0; i < 5; i++) {
      await backend.updateSet(A, { legoPriceHuf: 1000 + i } as Partial<LegoSet>);
      await after(IDLE_MS * 3);
    }
    expect(drive.batches()).toHaveLength(0);
    release();
    await after(0, () => drive.batches().length > 0);
    expect(drive.batches()).toHaveLength(1);
    expect(drive.batches()[0].ops).toHaveLength(5);
    off();
  });

  it('loads price history lazily and adds the rows still queued here', async () => {
    const drive = fakeDrive();
    const row = (id: string, date: string) => ({
      id,
      date,
      exchangeRate: 400,
      shopPrice: 1,
      shopPriceHuf: 400,
    });
    await drive.publish(
      SNAPSHOT_FILE,
      snapshot({ history: { [A]: { rows: 1, lastId: 'h'.repeat(20) } } }),
      true
    );
    await drive.publish(historyFile(A), [row('h'.repeat(20), '2026-01-01')], true);
    const { backend, seen, off } = open(drive);
    await after(0, () => seen.sets.length > 0);
    await backend.addPriceHistory(A, {
      date: '2026-02-01',
      exchangeRate: 400,
      shopPrice: 2,
      shopPriceHuf: 800,
    } as never);
    const rows = await backend.getPriceHistory(A);
    expect(rows.map((r) => r.date)).toEqual(['2026-01-01', '2026-02-01']);
    off();
  });

  it('says when the desktop has never shared its copy', async () => {
    const { seen, off } = open();
    await after(0, () => seen.errors.length > 0);
    expect(seen.errors.at(-1)?.code).toBe('drive-empty');
    off();
  });

  it('never seeds price sources from the website', async () => {
    const drive = fakeDrive();
    await drive.publish(SNAPSHOT_FILE, snapshot({ priceSources: null }), true);
    const backend = createDriveBackend({
      sub: SUB,
      by: null,
      client: drive.client,
      storage: memoryStorage(),
      page: null,
    });
    const got: [unknown, boolean][] = [];
    const off = backend.subscribePriceSources(
      (s, fromCache) => got.push([s, fromCache]),
      () => {}
    );
    await after(0, () => got.length > 0);
    expect(got.at(-1)).toEqual([null, true]);
    off();
  });

  describe('a refresh handed to the desktop', () => {
    const status = (at = new Date()) => ({
      version: 1,
      publisher: 'pc-1',
      publisherName: 'PC',
      heartbeatAt: at.toISOString(),
      mode: 'both',
      appVersion: '1',
    });

    it('is not offered while the desktop is not publishing', async () => {
      const drive = fakeDrive();
      await drive.publish(SNAPSHOT_FILE, snapshot(), true);
      await drive.publish(STATUS_FILE, status(new Date(Date.now() - 10 * 60 * 1000)));
      const { backend, seen, off } = open(drive);
      await after(0, () => seen.sets.length > 0);
      expect(await backend.delegateRefresh('all', [A])).toBe('unavailable');
      expect(drive.batches()).toHaveLength(0);
      off();
    });

    it('follows the reply until the desktop is done', async () => {
      const drive = fakeDrive();
      await drive.publish(SNAPSHOT_FILE, snapshot(), true);
      await drive.publish(STATUS_FILE, status());
      const { backend, seen, off } = open(drive);
      await after(0, () => seen.sets.length > 0);
      const outcome = backend.delegateRefresh('prices', [A]);
      await after(0);
      const op = drive.batches()[0].ops[0] as { type: string; requestId: string };
      expect(op).toMatchObject({ type: 'refresh', kind: 'prices', setIds: [A] });
      await drive.publish(replyFile(op.requestId), {
        requestId: op.requestId,
        status: 'running',
        at: '',
      });
      await after(5000);
      await drive.publish(replyFile(op.requestId), {
        requestId: op.requestId,
        status: 'done',
        at: '',
      });
      await after(5000);
      expect(await outcome).toBe('done');
      off();
    });

    it('withdraws a request the desktop has not started within a minute', async () => {
      const drive = fakeDrive();
      await drive.publish(SNAPSHOT_FILE, snapshot(), true);
      await drive.publish(STATUS_FILE, status());
      const { backend, seen, off } = open(drive);
      await after(0, () => seen.sets.length > 0);
      const outcome = backend.delegateRefresh('all', [A]);
      await after(70 * 1000);
      expect(await outcome).toBe('unavailable');
      // Withdrawn: the desktop will not run it after the website did the work.
      expect(drive.batches()).toHaveLength(0);
      off();
    });
  });
});
