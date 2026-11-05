import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalStore } from './localStore';
import {
  emptyState,
  type RemoteSetsSnapshot,
  type SetRecord,
  type StoreState,
} from '../../../lib/data/store';
import type { StoreChange } from '../../../lib/data/storeBridge';
import { validateOpBatch } from '../../../lib/data/ops';

const SUB = '112233445566778899';
const SRC = { projectId: 'p', databaseId: '(default)', uid: 'u1' };
const set = (id: string, extra: Record<string, unknown> = {}): SetRecord => ({
  id,
  userId: 'u1',
  setNumber: id,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});
const snap = (sets: SetRecord[], fromCache = false): RemoteSetsSnapshot => ({
  source: SRC,
  fromCache,
  sets,
  at: 'ignored',
});

let root: string;
let day: string;
const store = () => new LocalStore(root, () => new Date(`${day}T12:00:00`));
const stateOnDisk = () => JSON.parse(fs.readFileSync(path.join(root, SUB, 'state.json'), 'utf8'));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-store-'));
  day = '2026-11-04';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('LocalStore', () => {
  it('refuses anything but a Google account id as the folder', async () => {
    for (const bad of ['../x', 'abc', '', '1/2']) {
      await expect(store().open(bad)).rejects.toThrow('Not a Google account id');
    }
  });

  it('keeps the sets on disk, without userId, and reads them back', async () => {
    const s = store();
    await s.open(SUB);
    s.applySets(snap([set('a'), set('b')]));
    await s.flush();
    const disk = stateOnDisk();
    expect(Object.keys(disk.sets).sort()).toEqual(['a', 'b']);
    expect(disk.sets.a.value).not.toHaveProperty('userId');
    // The main process's time, not the page's.
    expect(disk.lastRemoteAt).toBe(new Date(`${day}T12:00:00`).toISOString());

    const again = store();
    expect((await again.open(SUB)).sets).toBe(2);
  });

  it('checks what the page sends', async () => {
    const s = store();
    await s.open(SUB);
    expect(() => s.applySets(snap([set('../evil')]))).toThrow('invalid id');
    expect(() => s.applySets({ ...snap([]), source: { ...SRC, uid: '' } })).toThrow('source');
    await expect(s.putHistoryPage('nope', { rows: [], done: true, reads: 1, day })).rejects.toThrow(
      'Unknown set'
    );
    await expect(s.putBackup('../x' as never, {})).rejects.toThrow('Unknown backup');
    expect(() => s.resolveHeld('maybe' as never)).toThrow('Unknown choice');
  });

  it('holds a snapshot that would empty the copy, and empties it only when asked', async () => {
    const s = store();
    await s.open(SUB);
    s.applySets(snap([set('a'), set('b')]));
    await s.flush();
    const held = s.applySets(snap([]));
    expect(held.held?.reason).toBe('mass-removal');
    await s.flush();
    expect(Object.keys(stateOnDisk().sets)).toHaveLength(2);

    const done = s.resolveHeld('delete');
    expect(done.sets).toBe(0);
    await s.flush();
    expect(stateOnDisk().sets).toEqual({});
    expect(s.status().error).toBeNull();
  });

  it('starts again from another account only when the user says so', async () => {
    const s = store();
    await s.open(SUB);
    s.applySets(snap([set('a')]));
    await s.flush();
    const held = s.applySets({ ...snap([set('z')]), source: { ...SRC, uid: 'u2' } });
    expect(held.held?.reason).toBe('different-source');
    s.resolveHeld('delete');
    await s.flush();
    expect(stateOnDisk().sets).toEqual({});
    s.applySets({ ...snap([set('z')]), source: { ...SRC, uid: 'u2' } });
    await s.flush();
    expect(Object.keys(stateOnDisk().sets)).toEqual(['z']);
  });

  it('keeps the empty-copy guard when starting again from an unanswered source is refused', async () => {
    const s = store();
    await s.open(SUB);
    s.applySets(snap([set('a'), set('b')]));
    await s.flush();
    // A mistyped database: only the SDK's empty cache, never the server.
    const wrong = { ...SRC, databaseId: 'no-such-database' };
    const held = s.applySets({ ...snap([], true), source: wrong });
    expect(held.held).toMatchObject({ reason: 'different-source', confirmed: false });
    const after = s.resolveHeld('delete');
    expect(after.sets).toBe(2);
    expect(after.held?.reason).toBe('different-source');
    // Had the refusal unlocked the guard, a bug emptying the state could write now.
    (s as unknown as { state: StoreState }).state = { ...emptyState(), source: SRC };
    s.putPriceSources([{ id: 'x' }]);
    await s.flush();
    expect(Object.keys(stateOnDisk().sets)).toEqual(['a', 'b']);
  });

  it('tells the page when the copy has been written, and when a write was refused', async () => {
    const s = store();
    await s.open(SUB);
    const statuses: StoreChange['status'][] = [];
    s.on('change', (c: StoreChange) => statuses.push(c.status));
    s.applySets(snap([set('a')]));
    await s.flush();
    await new Promise((r) => setTimeout(r, 300));
    expect(statuses[statuses.length - 1]?.lastWrittenAt).toBe(
      new Date(`${day}T12:00:00`).toISOString()
    );

    (s as unknown as { state: StoreState }).state = { ...emptyState(), source: SRC };
    s.putPriceSources([{ id: 'x' }]);
    await s.flush();
    await new Promise((r) => setTimeout(r, 300));
    expect(statuses[statuses.length - 1]?.error).toMatch(/Did not replace the copy of 1 sets/);
  });

  it('serves the planned list from this PC, built from the sets as they are now', async () => {
    const s = store();
    expect(s.plannedListResponse('f'.repeat(24))).toBeNull();
    await s.open(SUB);
    s.applySets(
      snap([
        set('a', {
          status: 'planned',
          priority: 'high',
          setNumber: '10333',
          name: 'Barad-dur',
          marketPrices: { shop: { price: 10, priceHuf: 4000 } },
        }),
        set('b', {
          status: 'ordered',
          priority: 'low',
          setNumber: '10316',
          orderedDate: '2026-03-01T00:00:00.000Z',
          orderedPriceHuf: 5000,
        }),
      ])
    );
    s.putPriceSources([{ id: 'shop', name: 'Shop', currency: 'EUR' }, { bad: true }]);
    const token = 'f'.repeat(24);
    expect(() => s.setPlannedList({ token: '../x', title: 't', createdAt: 'x' })).toThrow('token');
    s.setPlannedList({ token, title: 'Planned sets', createdAt: '2026-11-05T00:00:00.000Z' });
    expect(s.plannedList()?.token).toBe(token);

    const answer = s.plannedListResponse(token);
    expect(answer).toMatchObject({ title: 'Planned sets', count: 1 });
    expect(answer?.sets).toEqual([
      expect.objectContaining({
        id: 'a',
        setNumber: '10333',
        prices: [expect.objectContaining({ sourceId: 'shop', priceHuf: 4000 })],
      }),
    ]);
    expect(answer?.purchases).toEqual([
      expect.objectContaining({ id: 'b', purchasedOn: '2026-03-01', priceHuf: 5000 }),
    ]);
    expect(JSON.stringify(answer)).not.toContain('userId');
    expect(s.plannedListResponse('e'.repeat(24))).toBeNull();

    // The Firestore list (Firebase + copy) is answered by its backed-up token too.
    await s.putBackup('plannedList', { id: 'shared-token-1234567', title: 'Mine', userId: 'u1' });
    expect(s.plannedListResponse('shared-token-1234567')?.title).toBe('Mine');
    s.setPlannedList(null);
    expect(s.plannedListResponse(token)).toBeNull();
  });

  it('uploads a copy kept on this PC only, with its history, once the project has answered', async () => {
    const s = store();
    await s.open(SUB);
    const id = 'A'.repeat(20);
    await s.applyLocal({
      type: 'create',
      id,
      value: { setNumber: '10333', name: 'x', status: 'planned', priority: 'low' },
    });
    await s.applyLocal({ type: 'addHistory', setId: id, row: { id: 'h1', date: '2026-01-01' } });
    const held = s.applySets(snap([set('z')]));
    expect(held.held).toMatchObject({ reason: 'different-source', from: null, confirmed: true });

    const after = await s.uploadHeld();
    expect(after.held).toBeNull();
    expect(after.sets).toBe(1);
    // The sync applies the project's snapshot again (resync): its set comes
    // in, and the create goes first; the history once the set is on the server.
    expect(s.applySets(snap([set('z')])).sets).toBe(2);
    expect(s.planPush().map((o) => o.kind)).toEqual(['create']);
    await s.flush();
    expect(stateOnDisk().source).toEqual(SRC);
  });

  it('never writes an empty copy over a non-empty one by itself (last line of defence)', async () => {
    const s = store();
    await s.open(SUB);
    s.applySets(snap([set('a'), set('b')]));
    await s.flush();
    // The reducer never empties a copy without asking; force it, as a bug would.
    (s as unknown as { state: StoreState }).state = { ...emptyState(), source: SRC };
    s.putPriceSources([{ id: 'x' }]);
    await s.flush();
    expect(Object.keys(stateOnDisk().sets)).toEqual(['a', 'b']);
    expect(s.status().error).toMatch(/Did not replace the copy of 2 sets/);
  });

  it('copies history in pages, merging rows and spending the read budget', async () => {
    const s = store();
    await s.open(SUB);
    s.applySets(snap([set('a', { lastPricesRefreshTime: 5 })]));
    expect(s.historyWork()).toEqual([{ setId: 'a', cursor: null }]);

    await s.putHistoryPage('a', {
      rows: [
        { id: 'h1', date: '2026-01-01' },
        { id: 'h2', date: '2026-01-02' },
      ],
      done: false,
      reads: 2,
      day,
    });
    const st = await s.putHistoryPage('a', {
      rows: [
        { id: 'h2', date: '2026-01-02' },
        { id: 'h3', date: '2026-01-03' },
      ],
      done: true,
      reads: 2,
      day,
    });
    const rows = JSON.parse(fs.readFileSync(path.join(root, SUB, 'history', 'a.json'), 'utf8'));
    expect(rows.map((r: { id: string }) => r.id)).toEqual(['h1', 'h2', 'h3']);
    expect(st.historiesComplete).toBe(1);
    expect(st.budget).toMatchObject({ day, used: 4, limit: 10_000 });
    expect(s.historyWork()).toEqual([]);
    await expect(
      s.putHistoryPage('a', { rows: [{ id: '../x', date: 'd' }], done: true, reads: 1, day })
    ).rejects.toThrow('invalid row');
  });

  it('sets the history of a removed set aside instead of deleting it', async () => {
    const s = store();
    await s.open(SUB);
    s.applySets(snap([set('a'), set('b'), set('c')]));
    await s.putHistoryPage('a', { rows: [{ id: 'h1', date: 'd' }], done: true, reads: 1, day });
    s.applySets(snap([set('b'), set('c')]));
    await s.flush();
    await new Promise((r) => setTimeout(r, 50));
    const historyDir = path.join(root, SUB, 'history');
    expect(fs.existsSync(path.join(historyDir, 'a.json'))).toBe(false);
    expect(fs.readdirSync(path.join(historyDir, 'removed'))[0]).toMatch(/^a-\d+\.json$/);
  });

  it('keeps the shared data as read-only backups', async () => {
    const s = store();
    await s.open(SUB);
    await s.putBackup('registries', [{ id: 'r1', reservations: [] }]);
    await s.putBackup('plannedList', { id: 't', sets: [] });
    const dir = path.join(root, SUB, 'backup');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'registries.json'), 'utf8'))).toEqual([
      { id: 'r1', reservations: [] },
    ]);
    expect(fs.existsSync(path.join(dir, 'plannedList.json'))).toBe(true);
  });

  it("backs yesterday's copy up before the day's first write", async () => {
    const s = store();
    await s.open(SUB);
    s.applySets(snap([set('a')]));
    await s.flush();
    day = '2026-11-05';
    s.applySets(snap([set('a'), set('b')]));
    await s.flush();
    const bak = JSON.parse(
      fs.readFileSync(path.join(root, SUB, 'backup', 'state-2026-11-05.bak'), 'utf8')
    );
    expect(Object.keys(bak.sets)).toEqual(['a']);
    expect(Object.keys(stateOnDisk().sets).sort()).toEqual(['a', 'b']);
  });

  it('tells the page about changes, coalesced', async () => {
    const s = store();
    await s.open(SUB);
    const events: StoreChange[] = [];
    s.on('change', (c) => events.push(c));
    s.applySets(snap([set('a')]));
    s.applySets(snap([set('a'), set('b')]));
    await new Promise((r) => setTimeout(r, 300));
    expect(events).toHaveLength(1);
    expect(events[0].changed.sort()).toEqual(['a', 'b']);
    expect(events[0].status.sets).toBe(2);
  });

  it('writes what is pending synchronously as the app quits', async () => {
    const s = store();
    await s.open(SUB);
    s.applySets(snap([set('a')]));
    s.flushSync();
    expect(Object.keys(stateOnDisk().sets)).toEqual(['a']);
  });
});

describe('LocalStore, local first', () => {
  const NEW_ID = 'abcdefghij0123456789';
  const newSet = { setNumber: '10333', status: 'planned', priority: 'high', name: 'New' };

  it('checks changes against what the rules accept', async () => {
    const s = store();
    await s.open(SUB);
    s.applySets(snap([set('a')]));
    await expect(s.applyLocal({ type: 'create', id: 'short', value: newSet })).rejects.toThrow(
      'Firestore-style id'
    );
    await expect(
      s.applyLocal({ type: 'create', id: NEW_ID, value: { ...newSet, status: 'wanted' } })
    ).rejects.toThrow('status');
    await expect(
      s.applyLocal({ type: 'create', id: NEW_ID, value: { ...newSet, setNumber: 'x'.repeat(21) } })
    ).rejects.toThrow('set number');
    await expect(
      s.applyLocal({ type: 'update', id: 'missing', fields: { name: 'x' } })
    ).rejects.toThrow('Unknown set');
    await expect(
      s.applyLocal({ type: 'update', id: 'a', fields: { priority: 'urgent' } })
    ).rejects.toThrow('priority');
    await expect(
      s.applyLocal({ type: 'addHistory', setId: 'a', row: { id: '../x', date: 'd' } })
    ).rejects.toThrow('history row');
    await expect(
      s.applyLocal({ type: 'priceSources', list: new Array(16).fill({}) })
    ).rejects.toThrow('at most 15');
    expect(() => s.ackPush({ kind: 'nope' } as never)).toThrow('Unknown push');
  });

  it('keeps local changes across a restart and plans their push', async () => {
    const s = store();
    await s.open(SUB);
    s.applySets(snap([set('a'), set('b')]));
    await s.applyLocal({ type: 'create', id: NEW_ID, value: newSet });
    await s.applyLocal({ type: 'update', id: 'a', fields: { name: 'Renamed' } });
    await s.applyLocal({ type: 'delete', id: 'b' });
    await s.applyLocal({
      type: 'addHistory',
      setId: 'a',
      row: { id: 'h-local', date: '2026-11-05' },
    });
    expect(s.status().pending).toBe(4);
    await s.flush();

    const again = store();
    await again.open(SUB);
    expect(
      again
        .sets()
        .map((x) => x.id)
        .sort()
    ).toEqual(['a', NEW_ID].sort());
    expect(again.sets().find((x) => x.id === 'a')?.name).toBe('Renamed');
    expect((await again.history('a')).map((r) => r.id)).toEqual(['h-local']);
    const kinds = again
      .planPush()
      .map((o) => o.kind)
      .sort();
    expect(kinds).toEqual(['create', 'delete', 'history', 'update']);
  });

  it('clears what Firestore acknowledged', async () => {
    const s = store();
    await s.open(SUB);
    s.applySets(snap([set('a')]));
    await s.applyLocal({ type: 'update', id: 'a', fields: { name: 'Renamed' } });
    const [op] = s.planPush();
    expect(s.ackPush(op).pending).toBe(0);
    expect(s.planPush()).toEqual([]);
  });

  it('saves the copy empty when the user deletes the last set, and it stays empty', async () => {
    const s = store();
    await s.open(SUB);
    await s.applyLocal({ type: 'create', id: NEW_ID, value: newSet });
    await s.flush();
    expect(Object.keys(stateOnDisk().sets)).toEqual([NEW_ID]);
    await s.applyLocal({ type: 'delete', id: NEW_ID });
    await s.flush();
    expect(stateOnDisk().sets).toEqual({});
    expect(s.status().error).toBeNull();

    const again = store();
    expect((await again.open(SUB)).sets).toBe(0);
    // The choice was used up: a bug emptying a copy that shows sets is refused again.
    await again.applyLocal({ type: 'create', id: NEW_ID, value: newSet });
    await again.flush();
    (again as unknown as { state: StoreState }).state = emptyState();
    again.putPriceSources([{ id: 'x' }]);
    await again.flush();
    expect(Object.keys(stateOnDisk().sets)).toEqual([NEW_ID]);
    expect(again.status().error).toMatch(/Did not replace the copy of 1 sets/);
  }, 20_000);

  it('with Firebase, writes the copy empty once Firestore confirms the last deletes', async () => {
    const s = store();
    await s.open(SUB);
    s.applySets(snap([set('a'), set('b')]));
    await s.flush();
    await s.applyLocal({ type: 'delete', id: 'a' });
    await s.applyLocal({ type: 'delete', id: 'b' });
    for (const op of s.planPush()) s.ackPush(op);
    await s.flush();
    // The snapshot that confirms the deletes drops them; nothing to ask about.
    expect(s.applySets(snap([])).held).toBeNull();
    await s.flush();
    expect(stateOnDisk().sets).toEqual({});
    expect(s.status().error).toBeNull();
  }, 20_000);

  it('saves the copy empty when a Drive batch deletes the last sets', async () => {
    const s = store();
    await s.open(SUB);
    await s.applyLocal({ type: 'create', id: NEW_ID, value: newSet });
    await s.flush();
    const checked = validateOpBatch({
      batchId: 'batch-0001',
      createdAt: '2026-11-05T10:00:00.000Z',
      ops: [{ type: 'delete', id: NEW_ID }],
    });
    if (!('batch' in checked)) throw new Error(checked.error);
    expect((await s.applyOpsBatch(checked.batch)).rejected).toEqual([]);
    await s.flush();
    expect(stateOnDisk().sets).toEqual({});
    expect(s.status().error).toBeNull();
  }, 20_000);

  it('reports whether the server has said what price sources it holds', async () => {
    const s = store();
    await s.open(SUB);
    expect(s.priceSources()).toEqual({ list: null, seen: false });
    s.putPriceSources(null);
    expect(s.priceSources()).toEqual({ list: null, seen: true });
    await s.applyLocal({ type: 'priceSources', list: [{ id: 'x' }] });
    expect(s.priceSources().list).toEqual([{ id: 'x' }]);
  });
});
