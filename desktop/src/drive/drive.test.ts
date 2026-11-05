import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalStore } from '../store/localStore';
import { DriveState } from './state';
import { Publisher, type PublisherEvents } from './publisher';
import { Inbox } from './inbox';
import { DriveError, type DriveClient, type DriveFile } from '../../../lib/drive/client';
import {
  decodeJson,
  decodeJsonGz,
  encodeJson,
  historyFile,
  opsFile,
  SNAPSHOT_FILE,
  STATUS_FILE,
  type DriveSnapshot,
} from '../../../lib/drive/layout';

const SUB = '112233445566778899';
const ID = 'A'.repeat(20);

/** An app-data folder in memory. */
function fakeDrive() {
  const files = new Map<string, { name: string; bytes: Uint8Array }>();
  let n = 0;
  const bytes = (b: Uint8Array | string) =>
    typeof b === 'string' ? new TextEncoder().encode(b) : b;
  const drive: DriveClient = {
    list: async (prefix) =>
      [...files.entries()]
        .filter(([, f]) => !prefix || f.name.startsWith(prefix))
        .map(([id, f]): DriveFile => ({ id, name: f.name })),
    download: async (id) => {
      const f = files.get(id);
      if (!f) throw new DriveError(404, 'gone');
      return f.bytes;
    },
    create: async (name, body) => {
      const id = `f${++n}`;
      files.set(id, { name, bytes: bytes(body) });
      return { id, name };
    },
    update: async (id, body) => {
      const f = files.get(id);
      if (!f) throw new DriveError(404, 'gone');
      f.bytes = bytes(body);
      return { id, name: f.name };
    },
    remove: async (id) => {
      files.delete(id);
    },
  };
  const byName = (name: string) => [...files.values()].find((f) => f.name === name);
  return { drive, files, byName };
}

let root: string;
const events = (): PublisherEvents & { log: string[] } => {
  const log: string[] = [];
  return {
    log,
    published: () => log.push('published'),
    paused: (name) => log.push(`paused:${name}`),
    failed: (err) => log.push(`failed:${String(err)}`),
  };
};

async function setup() {
  const store = new LocalStore(root);
  await store.open(SUB);
  await store.applyLocal({
    type: 'create',
    id: ID,
    value: { setNumber: '10333', name: 'Barad-dur', status: 'planned', priority: 'high' },
  });
  await store.applyLocal({
    type: 'addHistory',
    setId: ID,
    row: { id: 'h'.repeat(20), date: '2026-11-01' },
  });
  const state = await DriveState.load(path.join(root, SUB));
  const f = fakeDrive();
  const ev = events();
  const publisher = new Publisher(
    f.drive,
    store,
    state,
    { id: 'me', name: 'PC-1' },
    'local',
    '0.1.0',
    ev
  );
  return { store, state, f, ev, publisher };
}

const snapshotOf = async (f: ReturnType<typeof fakeDrive>) =>
  (await decodeJsonGz(f.byName(SNAPSHOT_FILE)!.bytes)) as DriveSnapshot;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-drive-'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Publisher', () => {
  it('publishes the heartbeat, the snapshot and each history file', async () => {
    const { f, ev, publisher } = await setup();
    await publisher.start();
    await publisher.drainHistory();
    publisher.stop();
    const status = decodeJson(f.byName(STATUS_FILE)!.bytes) as { publisher: string; mode: string };
    expect(status).toMatchObject({ publisher: 'me', publisherName: 'PC-1', mode: 'local' });
    const snap = await snapshotOf(f);
    expect(snap.sets.map((s) => s.id)).toEqual([ID]);
    expect(JSON.stringify(snap)).not.toContain('userId');
    const rows = await decodeJsonGz(f.byName(historyFile(ID))!.bytes);
    expect(rows).toEqual([{ id: 'h'.repeat(20), date: '2026-11-01' }]);
    expect(ev.log).toContain('published');
  });

  it('sends a history file again only when it changed', async () => {
    const { store, f, publisher } = await setup();
    await publisher.start();
    await publisher.drainHistory();
    const update = vi.spyOn(f.drive, 'update');
    const create = vi.spyOn(f.drive, 'create');
    // Nothing new: nothing sent.
    (publisher as unknown as { historyQueue: Set<string> }).historyQueue.add(ID);
    await publisher.drainHistory();
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    await store.applyLocal({
      type: 'addHistory',
      setId: ID,
      row: { id: 'i'.repeat(20), date: '2026-11-02' },
    });
    await publisher.drainHistory();
    publisher.stop();
    expect(await decodeJsonGz(f.byName(historyFile(ID))!.bytes)).toHaveLength(2);
  });

  it('waits while another PC publishes, and takes over when it is gone', async () => {
    const { f, ev, publisher } = await setup();
    const other = {
      version: 1,
      publisher: 'other',
      publisherName: 'PC-2',
      heartbeatAt: new Date().toISOString(),
      mode: 'local',
      appVersion: '1',
    };
    await f.drive.create(STATUS_FILE, JSON.stringify(other), 'application/json');
    await publisher.start();
    expect(publisher.paused).toBe(true);
    expect(ev.log).toContain('paused:PC-2');
    expect(f.byName(SNAPSHOT_FILE)).toBeUndefined();
    // Its heartbeat goes stale: this PC publishes.
    f.byName(STATUS_FILE)!.bytes = encodeJson({
      ...other,
      heartbeatAt: '2020-01-01T00:00:00.000Z',
    });
    await (publisher as unknown as { heartbeat(): Promise<void> }).heartbeat();
    publisher.stop();
    expect(publisher.paused).toBe(false);
    expect(f.byName(SNAPSHOT_FILE)).toBeDefined();
  });

  it('publishes everything again when the folder was wiped', async () => {
    const { f, publisher } = await setup();
    await publisher.start();
    await publisher.drainHistory();
    f.files.clear();
    await (publisher as unknown as { heartbeat(): Promise<void> }).heartbeat();
    await publisher.drainHistory();
    publisher.stop();
    expect(f.byName(SNAPSHOT_FILE)).toBeDefined();
    expect(f.byName(STATUS_FILE)).toBeDefined();
    expect(f.byName(historyFile(ID))).toBeDefined();
  });
});

describe('Inbox', () => {
  const batch = (batchId: string, ops: unknown[]) => ({
    batchId,
    createdAt: '2026-11-05T10:00:00.000Z',
    ops,
  });

  it('applies a batch, names it in the snapshot, then deletes its file; never twice', async () => {
    const { store, state, f, publisher } = await setup();
    await publisher.start();
    const refreshes: unknown[] = [];
    const inbox = new Inbox(f.drive, store, state, publisher, {
      refresh: (op) => refreshes.push(op),
      failed: (err) => {
        throw err;
      },
    });
    const name = opsFile(Date.now(), 'batch-0001');
    await f.drive.create(
      name,
      JSON.stringify(
        batch('batch-0001', [
          { type: 'update', id: ID, fields: { priority: 'low' } },
          { type: 'update', id: ID, fields: { userId: 'x' } },
          { type: 'refresh', requestId: 'req-00000001', kind: 'prices', setIds: [ID] },
        ])
      ),
      'application/json'
    );
    await inbox.poll();
    expect(store.sets()[0]).toMatchObject({ priority: 'low' });
    const snap = await snapshotOf(f);
    expect(snap.applied).toEqual(['batch-0001']);
    expect(snap.rejected['batch-0001']).toEqual([
      { index: 1, reason: 'These fields cannot be changed: userId' },
    ]);
    expect(snap.sets[0]).toMatchObject({ priority: 'low' });
    expect(f.byName(name)).toBeUndefined();
    expect(refreshes).toEqual([
      { type: 'refresh', requestId: 'req-00000001', kind: 'prices', setIds: [ID] },
    ]);

    // The same batch again (a website retried): only its file goes.
    await f.drive.create(
      opsFile(Date.now(), 'batch-0001'),
      JSON.stringify(
        batch('batch-0001', [{ type: 'update', id: ID, fields: { priority: 'high' } }])
      ),
      'application/json'
    );
    await inbox.poll();
    expect(store.sets()[0]).toMatchObject({ priority: 'low' });
    expect(await f.drive.list('ops-')).toEqual([]);

    // A file that is no batch is refused whole, and removed.
    await f.drive.create(opsFile(Date.now(), 'batch-0002'), 'not json', 'application/json');
    await inbox.poll();
    expect((await snapshotOf(f)).rejected['batch-0002']).toEqual([
      { index: -1, reason: 'A batch must be an object' },
    ]);

    await inbox.reply('req-00000001', 'done');
    expect(decodeJson(f.byName('reply-req-00000001.json')!.bytes)).toMatchObject({
      requestId: 'req-00000001',
      status: 'done',
    });
    inbox.stop();
    publisher.stop();
    // Kept across a restart, so a batch is never applied twice.
    expect((await DriveState.load(path.join(root, SUB))).data.applied).toEqual([
      'batch-0001',
      'batch-0002',
    ]);
  });
});
