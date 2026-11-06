import type { Op, RejectedOp } from '../../lib/data/ops';
import type { HistoryRow, SetRecord } from '../../lib/data/store';
import type { DriveSnapshot } from '../../lib/drive/layout';

// What the website shows of the desktop's copy through Google Drive: the
// snapshot the desktop last published, with this browser's own changes that
// the desktop has not applied yet on top, so an edit shows at once and stays
// while the PC is off. Pure, so the rules are tested (driveOverlay.test.ts).

/** A batch of this browser's changes on its way to the desktop (lib/data/ops.ts). */
export interface OutboxBatch {
  batchId: string;
  createdAt: string;
  ops: Op[];
  /** Its ops file is in Drive; false while it is still gathering changes, or its upload failed. */
  sent: boolean;
}

export interface Overlaid {
  /** Newest first (date added, else created). */
  sets: SetRecord[];
  priceSources: unknown[] | null;
  /** History rows queued here per set, not in its history file yet. */
  pendingHistory: Record<string, HistoryRow[]>;
}

type SnapshotView = Pick<DriveSnapshot, 'sets' | 'priceSources' | 'applied'>;

const added = (s: SetRecord) => String(s.addedAt ?? s.createdAt ?? '');
const newestFirst = (a: SetRecord, b: SetRecord) => added(b).localeCompare(added(a));

/** The snapshot with every batch it does not name as applied laid on top, in order. */
export function overlay(snapshot: SnapshotView | null, outbox: readonly OutboxBatch[]): Overlaid {
  const applied = new Set(snapshot?.applied ?? []);
  const sets = new Map<string, SetRecord>((snapshot?.sets ?? []).map((s) => [s.id, s]));
  let priceSources = snapshot?.priceSources ?? null;
  const pendingHistory: Record<string, HistoryRow[]> = {};
  for (const batch of outbox) {
    if (applied.has(batch.batchId)) continue;
    for (const op of batch.ops) {
      switch (op.type) {
        case 'create':
          if (!sets.has(op.id))
            sets.set(op.id, {
              createdAt: batch.createdAt,
              addedAt: batch.createdAt,
              ...op.value,
              id: op.id,
            });
          break;
        case 'update': {
          const s = sets.get(op.id);
          if (s) sets.set(op.id, { ...s, ...op.fields, updatedAt: batch.createdAt });
          break;
        }
        case 'delete':
          sets.delete(op.id);
          break;
        case 'addHistory':
          (pendingHistory[op.setId] ??= []).push(op.row);
          break;
        case 'priceSources':
          priceSources = op.list;
          break;
        case 'refresh':
          break;
      }
    }
  }
  return { sets: [...sets.values()].sort(newestFirst), priceSources, pendingHistory };
}

/** The outbox without the sent batches the snapshot names as applied (they are in it now). */
export function stillPending(
  outbox: readonly OutboxBatch[],
  applied: readonly string[]
): OutboxBatch[] {
  const done = new Set(applied);
  return outbox.filter((b) => !(b.sent && done.has(b.batchId)));
}

/** The ops the desktop refused from these batches, with the batch they came in. */
export function refusalsFor(
  snapshot: Pick<DriveSnapshot, 'rejected'> | null,
  batchIds: Iterable<string>
): { batchId: string; refused: RejectedOp[] }[] {
  const out: { batchId: string; refused: RejectedOp[] }[] = [];
  for (const batchId of batchIds) {
    const refused = snapshot?.rejected?.[batchId];
    if (refused?.length) out.push({ batchId, refused });
  }
  return out;
}

/** Says what the desktop refused, for the error line. */
export function describeRefusals(list: { refused: RejectedOp[] }[]): string | null {
  const reasons = list.flatMap((r) => r.refused.map((x) => x.reason));
  if (!reasons.length) return null;
  const unique = [...new Set(reasons)];
  return `Your desktop did not apply ${reasons.length} change${reasons.length === 1 ? '' : 's'}: ${unique.slice(0, 3).join('; ')}${unique.length > 3 ? '; ...' : ''}`;
}
