import { describe, expect, it } from 'vitest';
import {
  ackPush,
  applyLocal,
  planPush,
  pendingCount,
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

const AT = '2026-11-05T09:00:00.000Z';
const update = (id: string, fields: Record<string, unknown>) =>
  ({ type: 'update', id, fields, at: AT }) as const;

describe('applyLocal', () => {
  it('edits a set here first and marks only the fields it changed', () => {
    const { state, changed } = applyLocal(
      withSets(1),
      update('1', { name: 'Mine', priority: 'high' })
    );
    expect(changed).toEqual(['1']);
    expect(state.sets['1'].value).toMatchObject({ name: 'Mine', priority: 'high', updatedAt: AT });
    expect(Object.keys(state.sets['1'].dirty).sort()).toEqual(['name', 'priority']);
    expect(state.sets['1'].base).toMatchObject({ name: 'Set 1' });
  });

  it('ignores fields an update may not change, and never marks updatedAt', () => {
    const r = applyLocal(
      withSets(1),
      update('1', { userId: 'x', createdAt: 'y', setNumber: 'z', updatedAt: 'w' })
    );
    expect(r.changed).toEqual([]);
    expect(r.state.sets['1'].dirty).toEqual({});
  });

  it('creates a set that is not on the server, without userId', () => {
    const { state } = applyLocal(withSets(1), {
      type: 'create',
      id: 'abcdefghij0123456789',
      value: { setNumber: '10333', userId: 'u1', status: 'planned', priority: 'low' },
      at: AT,
    });
    const s = state.sets.abcdefghij0123456789;
    expect(s.base).toBeNull();
    expect(s.value).not.toHaveProperty('userId');
    expect(s.value).toMatchObject({ createdAt: AT, updatedAt: AT, addedAt: AT });
    expect(pendingCount(state)).toBe(1);
  });

  it('keeps the addedAt of an uploaded set', () => {
    const { state } = applyLocal(emptyState(), {
      type: 'create',
      id: 'x'.repeat(20),
      value: { addedAt: '2024-01-01T00:00:00.000Z' },
      at: AT,
    });
    expect(state.sets['x'.repeat(20)].value.addedAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('drops a set never on the server outright, and tombstones one that is', () => {
    let s = applyLocal(withSets(1), {
      type: 'create',
      id: 'n'.repeat(20),
      value: {},
      at: AT,
    }).state;
    s = applyLocal(s, { type: 'delete', id: 'n'.repeat(20) }).state;
    expect(s.sets['n'.repeat(20)]).toBeUndefined();
    const t = applyLocal(s, { type: 'delete', id: '1' });
    expect(t.removed).toEqual(['1']);
    expect(t.state.sets['1'].deleted).toBe(true);
    expect(visibleSets(t.state)).toEqual([]);
  });

  it('queues history rows and drops them with their set', () => {
    let s = applyLocal(withSets(1), {
      type: 'addHistory',
      setId: '1',
      row: { id: 'h1', date: AT },
    });
    expect(s.historyAppend).toEqual({ setId: '1', row: { id: 'h1', date: AT } });
    s = applyLocal(s.state, { type: 'addHistory', setId: '1', row: { id: 'h1', date: AT } });
    expect(s.state.pendingHistory['1']).toHaveLength(1);
    expect(
      applyLocal(s.state, { type: 'delete', id: '1' }).state.pendingHistory['1']
    ).toBeUndefined();
  });
});

describe('planPush and ackPush', () => {
  it('sends only the dirty fields', () => {
    const s = applyLocal(withSets(2), update('1', { name: 'Mine', releaseDate: undefined })).state;
    expect(planPush(s)).toEqual([
      {
        kind: 'update',
        id: '1',
        fields: { name: 'Mine' },
        removeFields: ['releaseDate'],
        revs: { name: 1, releaseDate: 1 },
      },
    ]);
  });

  it('clears a field on acknowledgement only if it was not edited again in flight', () => {
    let s = applyLocal(withSets(1), update('1', { name: 'A', priority: 'high' })).state;
    const [op] = planPush(s);
    s = applyLocal(s, update('1', { name: 'B' })).state;
    s = ackPush(s, op);
    expect(s.sets['1'].dirty).toEqual({ name: 2 });
    expect(s.sets['1'].base).toMatchObject({ priority: 'high' });
    expect(planPush(s)).toEqual([
      { kind: 'update', id: '1', fields: { name: 'B' }, removeFields: [], revs: { name: 2 } },
    ]);
  });

  it('waits with creates until the server has been seen, then sends the whole set', () => {
    const local = applyLocal(emptyState(), {
      type: 'create',
      id: 'c'.repeat(20),
      value: { setNumber: '1' },
      at: AT,
    }).state;
    expect(planPush(local)).toEqual([]);
    const seen = applyRemote(local, snap([])).state;
    const [op] = planPush(seen);
    expect(op).toMatchObject({
      kind: 'create',
      id: 'c'.repeat(20),
      data: { setNumber: '1', addedAt: AT },
    });
    expect(op.kind === 'create' && op.data).not.toHaveProperty('id');
    const acked = ackPush(seen, op);
    expect(acked.sets['c'.repeat(20)].base).toMatchObject({ setNumber: '1' });
    expect(planPush(acked)).toEqual([]);
  });

  it('settles a create that landed without an acknowledgement when the server shows it', () => {
    const id = 'c'.repeat(20);
    let s = applyRemote(
      applyLocal(emptyState(), { type: 'create', id, value: { setNumber: '1', name: 'X' }, at: AT })
        .state,
      snap([])
    ).state;
    s = applyLocal(s, update(id, { name: 'Y' })).state;
    // The server has the create (name X); the later edit (Y) is still to go.
    s = applyRemote(
      s,
      snap([{ id, userId: 'u1', setNumber: '1', name: 'X', createdAt: 'server' }])
    ).state;
    expect(s.sets[id].base).toMatchObject({ name: 'X' });
    expect(s.sets[id].value).toMatchObject({ name: 'Y', createdAt: 'server' });
    expect(planPush(s)).toEqual([
      { kind: 'update', id, fields: { name: 'Y' }, removeFields: [], revs: { name: 2 } },
    ]);
  });

  it('treats an edit the server already holds as sent', () => {
    let s = applyLocal(withSets(1), update('1', { name: 'Same' })).state;
    s = applyRemote(s, snap([set('1', { name: 'Same' })])).state;
    expect(s.sets['1'].dirty).toEqual({});
    expect(planPush(s)).toEqual([]);
  });

  it('deletes win both ways', () => {
    // Deleted here, edited there: stays deleted, and the delete is sent once.
    let s = applyLocal(withSets(2), { type: 'delete', id: '1' }).state;
    s = applyRemote(s, snap([set('1', { name: 'Edited there' }), set('2')])).state;
    const ops = planPush(s);
    expect(ops).toEqual([{ kind: 'delete', id: '1' }]);
    s = ackPush(s, ops[0]);
    expect(planPush(s)).toEqual([]);
    expect(pendingCount(s)).toBe(0);
    expect(applyRemote(s, snap([set('2')])).state.sets['1']).toBeUndefined();

    // Edited here, deleted there: gone.
    let t = applyLocal(withSets(3), update('1', { name: 'Mine' })).state;
    t = applyRemote(t, snap([set('2'), set('3')])).state;
    expect(t.sets['1']).toBeUndefined();
  });

  it('sends history rows once their set is on the server', () => {
    const id = 'c'.repeat(20);
    let s = applyRemote(
      applyLocal(emptyState(), { type: 'create', id, value: {}, at: AT }).state,
      snap([])
    ).state;
    s = applyLocal(s, { type: 'addHistory', setId: id, row: { id: 'h1', date: AT } }).state;
    expect(planPush(s).map((o) => o.kind)).toEqual(['create']);
    s = ackPush(s, planPush(s)[0]);
    const [hist] = planPush(s);
    expect(hist).toEqual({ kind: 'history', setId: id, row: { id: 'h1', date: AT } });
    s = ackPush(s, hist);
    expect(s.pendingHistory).toEqual({});
  });

  it('pushes a local price-source change, and the server holding it counts as sent', () => {
    let s = applyRemotePriceSources(emptyState(), [{ id: 'a' }]);
    expect(s.priceSourcesSeen).toBe(true);
    s = applyLocal(s, { type: 'priceSources', list: [{ id: 'b' }] }).state;
    // A stale server answer does not undo the local change.
    s = applyRemotePriceSources(s, [{ id: 'a' }]);
    expect(s.priceSources).toEqual([{ id: 'b' }]);
    const [op] = planPush(s);
    expect(op).toEqual({ kind: 'priceSources', list: [{ id: 'b' }], rev: 1 });
    expect(ackPush(s, op).priceSourcesDirty).toBeNull();
    expect(applyRemotePriceSources(s, [{ id: 'b' }]).priceSourcesDirty).toBeNull();
  });

  it('pushes nothing while a snapshot is held', () => {
    let s = applyLocal(withSets(5), update('1', { name: 'Mine' })).state;
    s = applyRemote(s, snap([set('1')])).state;
    expect(s.held?.reason).toBe('mass-removal');
    expect(planPush(s)).toEqual([]);
    // Keeping them makes them sets to upload again.
    const kept = resolveHeld(s, 'keep').state;
    expect(
      planPush(kept)
        .filter((o) => o.kind === 'create')
        .map((o) => (o as { id: string }).id)
        .sort()
    ).toEqual(['2', '3', '4', '5']);
  });
});
