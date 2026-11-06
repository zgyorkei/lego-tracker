import { describe, expect, it } from 'vitest';
import {
  describeRefusals,
  overlay,
  refusalsFor,
  stillPending,
  type OutboxBatch,
} from './driveOverlay';

const A = 'A'.repeat(20);
const B = 'B'.repeat(20);
const C = 'C'.repeat(20);
const snap = {
  sets: [
    { id: A, name: 'Old', addedAt: '2026-01-01T00:00:00.000Z' },
    { id: B, name: 'Newer', addedAt: '2026-02-01T00:00:00.000Z' },
  ],
  priceSources: [{ id: 'shop', name: 'Shop' }],
  applied: ['done-batch'],
};
const batch = (batchId: string, ops: OutboxBatch['ops'], sent = true): OutboxBatch => ({
  batchId,
  createdAt: '2026-03-01T00:00:00.000Z',
  ops,
  sent,
});

describe('overlay', () => {
  it('shows the snapshot newest first when nothing is pending', () => {
    const v = overlay(snap, []);
    expect(v.sets.map((s) => s.id)).toEqual([B, A]);
    expect(v.priceSources).toEqual(snap.priceSources);
  });

  it("lays this browser's pending changes on top, in order", () => {
    const v = overlay(snap, [
      batch('b1', [
        {
          type: 'create',
          id: C,
          value: { name: 'Fresh', setNumber: '1', status: 'planned', priority: 'low' },
        },
        { type: 'update', id: A, fields: { name: 'Edited' } },
      ]),
      batch('b2', [{ type: 'delete', id: B }], false),
    ]);
    expect(v.sets.map((s) => [s.id, s.name])).toEqual([
      [C, 'Fresh'],
      [A, 'Edited'],
    ]);
    // A create without dates gets the batch's, so it sorts as new.
    expect(v.sets[0].addedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('skips the batches the snapshot already names as applied', () => {
    const v = overlay(snap, [batch('done-batch', [{ type: 'delete', id: A }])]);
    expect(v.sets.map((s) => s.id)).toEqual([B, A]);
  });

  it('keeps queued history rows and price sources apart from the sets', () => {
    const row = { id: 'r'.repeat(20), date: '2026-03-01' };
    const v = overlay(snap, [
      batch('b1', [
        { type: 'addHistory', setId: A, row },
        { type: 'priceSources', list: [] },
        { type: 'refresh', requestId: 'req12345', kind: 'all', setIds: [A] },
      ]),
    ]);
    expect(v.pendingHistory).toEqual({ [A]: [row] });
    expect(v.priceSources).toEqual([]);
  });

  it('works before any snapshot arrived (the PC never published)', () => {
    const v = overlay(null, [batch('b1', [{ type: 'create', id: C, value: { name: 'Only' } }])]);
    expect(v.sets.map((s) => s.id)).toEqual([C]);
    expect(v.priceSources).toBeNull();
  });
});

describe('the outbox', () => {
  it('drops sent batches once applied, keeps unsent ones', () => {
    const out = stillPending(
      [batch('done-batch', []), batch('later', []), batch('draft', [], false)],
      snap.applied
    );
    expect(out.map((b) => b.batchId)).toEqual(['later', 'draft']);
  });

  it("finds and words what the desktop refused of this browser's batches", () => {
    const refused = refusalsFor(
      {
        rejected: {
          mine: [{ index: 1, reason: 'Unknown set' }],
          other: [{ index: 0, reason: 'x' }],
        },
      },
      ['mine', 'none']
    );
    expect(refused).toEqual([{ batchId: 'mine', refused: [{ index: 1, reason: 'Unknown set' }] }]);
    expect(describeRefusals(refused)).toBe('Your desktop did not apply 1 change: Unknown set');
    expect(describeRefusals([])).toBeNull();
  });
});
