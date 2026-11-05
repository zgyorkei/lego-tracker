import { describe, expect, it } from 'vitest';
import { applyOps, checkOp, MAX_REQUEST_SETS, validateOpBatch } from './ops';
import { emptyState, visibleSets } from './store';
import { MAX_REQUEST_SETS as WEBSITE_MAX } from '../../src/lib/desktopWorker';

const ID = 'A'.repeat(20);
const newSet = (extra: Record<string, unknown> = {}) => ({
  type: 'create',
  id: ID,
  value: { setNumber: '10333', name: 'Barad-dur', status: 'planned', priority: 'high', ...extra },
});
const batch = (ops: unknown[], extra: Record<string, unknown> = {}) => ({
  batchId: 'batch-0001',
  createdAt: '2026-11-05T10:00:00.000Z',
  ops,
  ...extra,
});
const checked = (ops: unknown[]) => {
  const r = validateOpBatch(batch(ops));
  if (!('batch' in r)) throw new Error(r.error);
  return r.batch;
};
const reason = (op: unknown) => {
  const r = checkOp(op);
  return 'reason' in r ? r.reason : null;
};

describe('validateOpBatch', () => {
  it('refuses what is not a batch at all', () => {
    expect(validateOpBatch(null)).toHaveProperty('error');
    expect(validateOpBatch(batch([newSet()], { batchId: 'x/../y' }))).toHaveProperty('error');
    expect(validateOpBatch(batch([]))).toHaveProperty('error');
    expect(validateOpBatch(batch(Array(201).fill(newSet())))).toHaveProperty('error');
    expect(validateOpBatch(batch([newSet({ notes: 'x'.repeat(600 * 1024) })]))).toHaveProperty(
      'error'
    );
  });

  it('keeps the good ops and says why each bad one is refused', () => {
    const b = checked([newSet(), { type: 'delete', id: '../x' }, { type: 'nope' }]);
    expect(b.ops.map((o) => o.index)).toEqual([0]);
    expect(b.rejected).toEqual([
      { index: 1, reason: 'Unknown set' },
      { index: 2, reason: 'Unknown op' },
    ]);
  });
});

describe('checkOp mirrors the rules', () => {
  it('sets: id, set number, status, priority, name', () => {
    expect(reason(newSet())).toBeNull();
    expect(reason({ ...newSet(), id: 'short' })).toMatch(/Firestore-style id/);
    expect(reason(newSet({ setNumber: 'x'.repeat(21) }))).toMatch(/set number/);
    expect(reason(newSet({ setNumber: '-1' }))).toMatch(/set number/);
    expect(reason(newSet({ status: 'wished' }))).toBe('Unknown status');
    expect(reason(newSet({ priority: 'urgent' }))).toBe('Unknown priority');
    expect(reason(newSet({ name: 'x'.repeat(201) }))).toMatch(/200 characters/);
    const noName: Record<string, unknown> = { ...newSet().value };
    delete noName.name;
    expect(reason({ type: 'create', id: ID, value: noName })).toMatch(/needs a name/);
    expect(reason(newSet({ name: null }))).toBeNull();
  });

  it('never keeps a userId from outside', () => {
    const r = checkOp(newSet({ userId: 'someone-else' }));
    expect('op' in r && r.op.type === 'create' && r.op.value).not.toHaveProperty('userId');
  });

  it('updates: only the fields the update rule allows', () => {
    expect(reason({ type: 'update', id: ID, fields: { priority: 'low', name: 'X' } })).toBeNull();
    expect(reason({ type: 'update', id: ID, fields: { userId: 'u2' } })).toMatch(
      /cannot be changed/
    );
    expect(reason({ type: 'update', id: ID, fields: { createdAt: 'x' } })).toMatch(
      /cannot be changed/
    );
    expect(reason({ type: 'update', id: ID, fields: {} })).toMatch(/at least one/);
    expect(reason({ type: 'update', id: ID, fields: { status: 'gone' } })).toBe('Unknown status');
  });

  it('history: a date, a numeric rate, and every price in both columns', () => {
    const row = { id: 'h'.repeat(20), date: '2026-11-05', exchangeRate: 400 };
    const add = (r: Record<string, unknown>) => ({ type: 'addHistory', setId: ID, row: r });
    expect(reason(add({ ...row, shopPrice: 10, shopPriceHuf: 4000 }))).toBeNull();
    expect(reason(add({ ...row, shopPriceHuf: 4000 }))).toMatch(/needs shopPrice/);
    expect(reason(add({ ...row, shopPrice: 10 }))).toMatch(/needs shopPriceHuf/);
    expect(reason(add({ ...row, shopPrice: '10', shopPriceHuf: 4000 }))).toMatch(
      /must be a number/
    );
    expect(reason(add({ ...row, exchangeRate: 'x' }))).toMatch(/exchange rate/);
    expect(reason(add({ ...row, date: '' }))).toMatch(/date/);
    expect(reason(add({ ...row, id: 'x' }))).toMatch(/Firestore-style id/);
  });

  it('price sources: at most 15, each with an id and a name', () => {
    const src = (i: number) => ({ id: `s${i}`, name: `Shop ${i}` });
    expect(reason({ type: 'priceSources', list: [src(1)] })).toBeNull();
    expect(
      reason({ type: 'priceSources', list: Array.from({ length: 16 }, (_, i) => src(i)) })
    ).toMatch(/at most 15/);
    expect(reason({ type: 'priceSources', list: [{ id: 'x' }] })).toMatch(/id and a name/);
  });

  it('refreshes: a request id, a kind, and the same set cap as the website', () => {
    expect(MAX_REQUEST_SETS).toBe(WEBSITE_MAX);
    const refresh = (extra: Record<string, unknown>) => ({
      type: 'refresh',
      requestId: 'req-00000001',
      kind: 'prices',
      setIds: [ID],
      ...extra,
    });
    expect(reason(refresh({}))).toBeNull();
    expect(reason(refresh({ kind: 'everything' }))).toMatch(/kind/);
    expect(reason(refresh({ setIds: [] }))).toMatch(/1 to 500/);
    expect(reason(refresh({ setIds: Array(501).fill(ID) }))).toMatch(/1 to 500/);
    expect(reason(refresh({ requestId: '../x' }))).toMatch(/request id/);
  });
});

describe('applyOps', () => {
  const row = { id: 'h'.repeat(20), date: '2026-11-05', exchangeRate: 400 };

  it('applies a batch as local changes, in order', () => {
    const b = checked([
      newSet(),
      { type: 'update', id: ID, fields: { priority: 'low' } },
      { type: 'addHistory', setId: ID, row },
      { type: 'refresh', requestId: 'req-00000001', kind: 'details', setIds: [ID] },
    ]);
    const r = applyOps(emptyState(), b, '2026-11-05T10:00:01.000Z');
    expect(visibleSets(r.state)).toEqual([
      expect.objectContaining({ id: ID, priority: 'low', addedAt: '2026-11-05T10:00:01.000Z' }),
    ]);
    expect(r.historyAppends).toEqual([{ setId: ID, row }]);
    expect(r.refreshes).toEqual([
      { type: 'refresh', requestId: 'req-00000001', kind: 'details', setIds: [ID] },
    ]);
    expect(r.rejected).toEqual([]);
  });

  it('refuses what cannot apply here, and keeps the rest', () => {
    const other = 'B'.repeat(20);
    const once = applyOps(emptyState(), checked([newSet()]), 'T').state;
    const r = applyOps(
      once,
      checked([
        newSet(),
        { type: 'update', id: other, fields: { priority: 'low' } },
        { type: 'addHistory', setId: other, row },
        { type: 'delete', id: ID },
      ]),
      'T2'
    );
    expect(r.rejected).toEqual([
      { index: 0, reason: 'A set with this id already exists' },
      { index: 1, reason: 'Unknown set' },
      { index: 2, reason: 'Unknown set' },
    ]);
    expect(visibleSets(r.state)).toEqual([]);
    expect(r.removed).toEqual([ID]);
  });
});
