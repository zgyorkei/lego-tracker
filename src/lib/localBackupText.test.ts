import { describe, expect, it } from 'vitest';
import { backupPill, heldExplanation } from './localBackupText';
import type { StoreStatus } from '../../lib/data/storeBridge';

const status = (extra: Partial<StoreStatus> = {}): StoreStatus => ({
  sets: 57,
  historiesComplete: 57,
  historiesTotal: 57,
  historyRows: 1200,
  lastRemoteAt: '2026-11-04T10:00:00.000Z',
  held: null,
  sub: '1',
  dir: 'C:\\data\\1',
  lastWrittenAt: null,
  lastBackupDay: null,
  budget: { day: '2026-11-04', used: 0, limit: 10_000 },
  error: null,
  ...extra,
});
const held = (reason: 'mass-removal' | 'different-source', dismissed = false) => ({
  reason,
  at: 'x',
  source: { projectId: 'other-project', databaseId: '(default)', uid: 'u' },
  removeIds: ['a', 'b', 'c', 'd'],
  remoteCount: 3,
  dismissed,
});

describe('backupPill', () => {
  it('says it is starting before the first status', () => {
    expect(backupPill(null, null)).toEqual({ label: 'Copying to this PC', tone: 'busy' });
  });

  it('puts a held snapshot first, then problems, then history progress', () => {
    expect(backupPill(status({ held: held('mass-removal'), error: 'x' }), 'y').tone).toBe(
      'problem'
    );
    expect(backupPill(status({ held: held('mass-removal') }), null).label).toBe(
      'Backup paused: review'
    );
    expect(backupPill(status({ error: 'disk full' }), null).label).toBe('Backup problem');
    expect(backupPill(status(), 'Copying price history failed').label).toBe('Backup problem');
    expect(backupPill(status({ historiesComplete: 12 }), null)).toEqual({
      label: 'Backup: 12/57 histories',
      tone: 'busy',
    });
    expect(backupPill(status(), null)).toEqual({ label: 'Backup: 57 sets', tone: 'ok' });
    expect(
      backupPill(status({ sets: 1, historiesComplete: 1, historiesTotal: 1 }), null).label
    ).toBe('Backup: 1 set');
  });

  it('stops nagging about a different project the user chose to keep', () => {
    expect(backupPill(status({ held: held('different-source', true) }), null).tone).toBe('ok');
  });
});

describe('heldExplanation', () => {
  it('explains both kinds', () => {
    expect(heldExplanation(status())).toBeNull();
    expect(heldExplanation(status({ held: held('mass-removal') }))).toMatch(
      /no longer has 4 of the 57 sets/
    );
    expect(heldExplanation(status({ held: held('different-source') }))).toMatch(/other-project/);
  });
});
