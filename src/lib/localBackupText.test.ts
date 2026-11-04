import { describe, expect, it } from 'vitest';
import { backupPill, heldExplanation, syncSummary } from './localBackupText';
import type { StoreStatus } from '../../lib/data/storeBridge';
import type { Health } from './dataHealth';

const OK: Health = { kind: 'ok' };
const status = (extra: Partial<StoreStatus> = {}): StoreStatus => ({
  sets: 57,
  historiesComplete: 57,
  historiesTotal: 57,
  historyRows: 1200,
  lastRemoteAt: '2026-11-04T10:00:00.000Z',
  held: null,
  pending: 0,
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
  it('says it is opening before the first status', () => {
    expect(backupPill(null, OK)).toEqual({ label: 'Opening the copy on this PC', tone: 'busy' });
  });

  it('puts a held snapshot first, then problems, offline, pending changes and history', () => {
    expect(
      backupPill(status({ held: held('mass-removal') }), { kind: 'rules-outdated' }).label
    ).toBe('Sync paused: review');
    expect(backupPill(status(), { kind: 'database-missing' })).toEqual({
      label: 'Sync problem',
      tone: 'problem',
    });
    expect(backupPill(status({ error: 'disk full' }), OK).label).toBe('Sync problem');
    expect(backupPill(status({ pending: 3 }), { kind: 'offline' }).label).toBe(
      'Offline: 3 changes saved here'
    );
    expect(backupPill(status(), { kind: 'offline' }).label).toBe('Offline');
    expect(backupPill(status({ pending: 1 }), OK).label).toBe('Syncing 1 change');
    expect(backupPill(status({ historiesComplete: 12 }), OK).label).toBe('Copying history 12/57');
    expect(backupPill(status(), OK)).toEqual({ label: 'In sync: 57 sets', tone: 'ok' });
  });

  it('stops nagging about a different project the user chose to keep', () => {
    expect(backupPill(status({ held: held('different-source', true) }), OK).tone).toBe('ok');
  });
});

describe('syncSummary', () => {
  it('says the state in a few words for the tray', () => {
    expect(syncSummary(status(), OK)).toBe('in sync, 57 sets');
    expect(syncSummary(status({ pending: 2 }), { kind: 'offline' })).toBe(
      'offline, 2 changes saved on this PC'
    );
    expect(syncSummary(status(), { kind: 'database-missing' })).toBe(
      'The Firestore database was not found'
    );
    expect(syncSummary(status({ held: held('mass-removal') }), OK)).toMatch(/paused/);
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
