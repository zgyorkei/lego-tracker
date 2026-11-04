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
