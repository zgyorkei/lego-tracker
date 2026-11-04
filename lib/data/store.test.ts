import { describe, expect, it } from 'vitest';
import {
  applyRemote,
  applyRemotePriceSources,
  budgetLeft,
  emptyState,
  historyWork,
  mergeHistory,
  noteHistoryPage,
  removalLimit,
  resolveHeld,
  spendReads,
  summarize,
  visibleSets,
  type RemoteSource,
  type SetRecord,
  type StoreState,
} from './store';

const SRC: RemoteSource = { projectId: 'p', databaseId: '(default)', uid: 'u1' };
const set = (id: string, extra: Record<string, unknown> = {}): SetRecord => ({
  id,
  userId: 'u1',
  setNumber: id,
  name: `Set ${id}`,
  createdAt: `2026-01-${id.padStart(2, '0')}T00:00:00.000Z`,
  ...extra,
});
const snap = (
  sets: SetRecord[],
  opts: { fromCache?: boolean; source?: RemoteSource; at?: string } = {}
) => ({
  source: opts.source ?? SRC,
  fromCache: opts.fromCache ?? false,
  sets,
  at: opts.at ?? '2026-11-04T10:00:00.000Z',
});
const ids = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
const withSets = (n: number): StoreState =>
  applyRemote(emptyState(), snap(ids(n).map((i) => set(i)))).state;

describe('applyRemote', () => {
  it('stores the sets without userId, as both value and base', () => {
    const { state, changed } = applyRemote(emptyState(), snap([set('1')]));
    expect(changed).toEqual(['1']);
    expect(state.sets['1'].value).not.toHaveProperty('userId');
    expect(state.sets['1'].base).toEqual(state.sets['1'].value);
    expect(state.source).toEqual(SRC);
    expect(state.lastRemoteAt).toBe('2026-11-04T10:00:00.000Z');
  });

  it('reports only sets whose value changed', () => {
    const s1 = withSets(2);
    const { changed } = applyRemote(s1, snap([set('1'), set('2', { name: 'Renamed' })]));
    expect(changed).toEqual(['2']);
  });

  it('keeps unsynced local edits on top of the server copy, per field', () => {
    const s1 = withSets(1);
    const local: StoreState = {
      ...s1,
      sets: {
        '1': {
          ...s1.sets['1'],
          value: { ...s1.sets['1'].value, name: 'Mine' },
          dirty: { name: 3 },
        },
      },
    };
    const { state } = applyRemote(local, snap([set('1', { name: 'Theirs', priority: 'high' })]));
    expect(state.sets['1'].value).toMatchObject({ name: 'Mine', priority: 'high' });
    expect(state.sets['1'].base).toMatchObject({ name: 'Theirs' });
    expect(state.sets['1'].dirty).toEqual({ name: 3 });
  });

  it('never removes sets on a snapshot from the cache', () => {
    const { state, removed } = applyRemote(withSets(5), snap([], { fromCache: true }));
    expect(removed).toEqual([]);
    expect(Object.keys(state.sets)).toHaveLength(5);
    expect(state.held).toBeNull();
    expect(state.lastRemoteAt).toBe('2026-11-04T10:00:00.000Z');
  });

  it('removes a few sets the server no longer has', () => {
    const { state, removed } = applyRemote(withSets(5), snap(ids(2).map((i) => set(i))));
    expect(removed.sort()).toEqual(['3', '4', '5']);
    expect(Object.keys(state.sets).sort()).toEqual(['1', '2']);
    expect(state.held).toBeNull();
  });

  it('holds a snapshot that would remove more than max(3, 10%) of the synced sets', () => {
    expect(removalLimit(5)).toBe(3);
    expect(removalLimit(300)).toBe(30);
    const { state, removed } = applyRemote(withSets(5), snap([set('1')]));
    expect(removed).toEqual([]);
    expect(Object.keys(state.sets)).toHaveLength(5);
    expect(state.held).toMatchObject({
      reason: 'mass-removal',
      removeIds: ['2', '3', '4', '5'],
      remoteCount: 1,
    });

    const big = applyRemote(withSets(300), snap(ids(270).map((i) => set(i))));
    expect(big.removed).toHaveLength(30);
    expect(big.state.held).toBeNull();
    const tooMany = applyRemote(withSets(300), snap(ids(269).map((i) => set(i))));
    expect(tooMany.removed).toEqual([]);
    expect(tooMany.state.held?.removeIds).toHaveLength(31);
  });

  it('holds a snapshot that would empty the copy, however small', () => {
    const { state, removed } = applyRemote(withSets(2), snap([]));
    expect(removed).toEqual([]);
    expect(state.held).toMatchObject({ reason: 'mass-removal', removeIds: ['1', '2'] });
  });

  it('still applies changes from a snapshot whose removals are held', () => {
    const { state } = applyRemote(withSets(5), snap([set('1', { name: 'New name' })]));
    expect(state.sets['1'].value.name).toBe('New name');
  });

  it('holds everything from another project or account', () => {
    const other = { ...SRC, uid: 'u2' };
    const s1 = withSets(3);
    const { state, changed, removed } = applyRemote(s1, snap([set('9')], { source: other }));
    expect(changed).toEqual([]);
    expect(removed).toEqual([]);
    expect(state.sets).toEqual(s1.sets);
    expect(state.source).toEqual(SRC);
    expect(state.held).toMatchObject({ reason: 'different-source', source: other, remoteCount: 1 });

    const otherDb = applyRemote(s1, snap([], { source: { ...SRC, databaseId: 'named' } }));
    expect(otherDb.state.held?.reason).toBe('different-source');
  });

  it('adopts a new source when nothing here came from the old one', () => {
    const { state } = applyRemote(
      { ...emptyState(), source: SRC },
      snap([set('1')], { source: { ...SRC, uid: 'u2' } })
    );
    expect(state.held).toBeNull();
    expect(state.source?.uid).toBe('u2');
    expect(state.sets['1']).toBeDefined();
  });

  it('lets a local delete win, and drops the tombstone once the server confirms it', () => {
    const s1 = withSets(2);
    const tomb: StoreState = {
      ...s1,
      sets: { ...s1.sets, '1': { ...s1.sets['1'], deleted: true } },
    };
    const stillThere = applyRemote(tomb, snap([set('1', { name: 'Edited elsewhere' }), set('2')]));
    expect(stillThere.state.sets['1'].deleted).toBe(true);
    expect(visibleSets(stillThere.state).map((s) => s.id)).toEqual(['2']);
    const gone = applyRemote(stillThere.state, snap([set('2')]));
    expect(gone.removed).toEqual(['1']);
    expect(gone.state.sets['1']).toBeUndefined();
  });

  it('never removes a set the server has not confirmed', () => {
    const local: StoreState = {
      ...withSets(1),
      sets: {
        ...withSets(1).sets,
        mine: { value: { id: 'mine' }, base: null, dirty: { name: 1 } },
      },
    };
    const { state } = applyRemote(local, snap([set('1')]));
    expect(state.sets.mine).toBeDefined();
  });

  it('forgets the history cursor of a removed set', () => {
    const s1 = noteHistoryPage(withSets(3), '3', {
      last: { date: '2026-01-01', id: 'h' },
      rows: 1,
      done: true,
    });
    const { state } = applyRemote(s1, snap([set('1'), set('2')]));
    expect(state.history['3']).toBeUndefined();
  });
});

describe('resolveHeld', () => {
  it("mass removal: 'delete' removes them here too", () => {
    const held = applyRemote(withSets(5), snap([set('1')])).state;
    const { state, removed } = resolveHeld(held, 'delete');
    expect(removed).toEqual(['2', '3', '4', '5']);
    expect(Object.keys(state.sets)).toEqual(['1']);
    expect(state.held).toBeNull();
  });

  it("mass removal: 'keep' keeps them as unconfirmed copies the next snapshot leaves alone", () => {
    const held = applyRemote(withSets(5), snap([set('1')])).state;
    const kept = resolveHeld(held, 'keep').state;
    expect(kept.held).toBeNull();
    expect(kept.sets['2'].base).toBeNull();
    const next = applyRemote(kept, snap([set('1')]));
    expect(Object.keys(next.state.sets)).toHaveLength(5);
    expect(next.state.held).toBeNull();
  });

  it("different source: 'delete' starts again from the new one", () => {
    const other = { ...SRC, uid: 'u2' };
    const held = applyRemote(withSets(3), snap([set('9')], { source: other })).state;
    const fresh = resolveHeld(held, 'delete');
    expect(fresh.removed.sort()).toEqual(['1', '2', '3']);
    expect(fresh.state.sets).toEqual({});
    expect(fresh.state.source).toEqual(other);
    expect(
      applyRemote(fresh.state, snap([set('9')], { source: other })).state.sets['9']
    ).toBeDefined();
  });

  it("different source: 'keep' keeps this copy and stops asking, still merging nothing", () => {
    const other = { ...SRC, uid: 'u2' };
    const held = applyRemote(withSets(3), snap([set('9')], { source: other })).state;
    const kept = resolveHeld(held, 'keep').state;
    expect(kept.held?.dismissed).toBe(true);
    const again = applyRemote(kept, snap([set('9')], { source: other })).state;
    expect(again.held?.dismissed).toBe(true);
    expect(again.sets['9']).toBeUndefined();
  });
});

describe('price sources', () => {
  it('replaces the stored list and keeps the state when nothing changed', () => {
    const s1 = applyRemotePriceSources(emptyState(), [{ id: 'a' }]);
    expect(s1.priceSources).toEqual([{ id: 'a' }]);
    expect(applyRemotePriceSources(s1, [{ id: 'a' }])).toBe(s1);
  });
});

describe('mergeHistory', () => {
  it('unions rows by id, oldest first, keeping a row already held', () => {
    const a = { id: 'a', date: '2026-01-02', x: 1 };
    const b = { id: 'b', date: '2026-01-01' };
    const c = { id: 'c', date: '2026-01-02' };
    expect(mergeHistory([a], [b, c, { id: 'a', date: '2026-01-02', x: 2 }])).toEqual([b, a, c]);
  });
});

describe('history cursors and the read budget', () => {
  it('lists sets never copied, then unfinished, then refreshed since', () => {
    let s = applyRemote(
      emptyState(),
      snap([
        set('1', { lastPricesRefreshTime: 10 }),
        set('2', { lastPricesRefreshTime: 10 }),
        set('3'),
      ])
    ).state;
    s = noteHistoryPage(s, '1', { last: { date: 'd', id: 'x' }, rows: 2, done: true });
    s = noteHistoryPage(s, '2', { last: { date: 'd', id: 'y' }, rows: 500, done: false });
    expect(historyWork(s).map((w) => w.setId)).toEqual(['3', '2']);

    const refreshed = applyRemote(
      s,
      snap([
        set('1', { lastPricesRefreshTime: 20 }),
        set('2', { lastPricesRefreshTime: 10 }),
        set('3'),
      ])
    ).state;
    expect(historyWork(refreshed).map((w) => w.setId)).toEqual(['3', '2', '1']);
    expect(historyWork(refreshed).find((w) => w.setId === '1')?.cursor).toMatchObject({
      lastDate: 'd',
      lastId: 'x',
      rows: 2,
    });
  });

  it('keeps the position across pages and completes for the current refresh', () => {
    let s = applyRemote(emptyState(), snap([set('1', { lastPricesRefreshTime: 7 })])).state;
    s = noteHistoryPage(s, '1', { last: { date: '2026-01-01', id: 'a' }, rows: 200, done: false });
    s = noteHistoryPage(s, '1', { last: null, rows: 0, done: true });
    expect(s.history['1']).toEqual({
      lastDate: '2026-01-01',
      lastId: 'a',
      rows: 200,
      complete: true,
      checkedFor: 7,
    });
  });

  it('spends a daily read budget that starts again each day', () => {
    let s = spendReads(emptyState(), '2026-11-04', 9_500);
    expect(budgetLeft(s, '2026-11-04')).toBe(500);
    s = spendReads(s, '2026-11-04', 1_000);
    expect(budgetLeft(s, '2026-11-04')).toBe(0);
    expect(budgetLeft(s, '2026-11-05')).toBe(10_000);
    expect(spendReads(s, '2026-11-05', 1).readBudget).toEqual({ day: '2026-11-05', used: 1 });
  });

  it('summarises progress', () => {
    let s = withSets(3);
    s = noteHistoryPage(s, '1', { last: { date: 'd', id: 'x' }, rows: 4, done: true });
    expect(summarize(s)).toMatchObject({
      sets: 3,
      historiesComplete: 1,
      historiesTotal: 3,
      historyRows: 4,
      held: null,
    });
  });
});
