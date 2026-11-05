import { describe, expect, it, vi } from 'vitest';
import { createLocalBackend } from './localBackend';
import { DataError } from './types';
import type { DesktopStoreBridge, StoreChange, StoreStatus } from '../../lib/data/storeBridge';
import type { SetRecord } from '../../lib/data/store';

const status = (extra: Partial<StoreStatus> = {}): StoreStatus => ({
  sets: 0,
  historiesComplete: 0,
  historiesTotal: 0,
  historyRows: 0,
  lastRemoteAt: null,
  held: null,
  pending: 0,
  sub: '1',
  dir: 'd',
  lastWrittenAt: null,
  lastBackupDay: null,
  budget: { day: 'x', used: 0, limit: 1 },
  error: null,
  ...extra,
});

function fakeStore(opened: StoreStatus, sets: SetRecord[] = []) {
  const listeners = new Set<(c: StoreChange) => void>();
  let current = sets;
  let prices: { list: unknown[] | null; seen: boolean } = { list: null, seen: false };
  const store = {
    open: vi.fn(async () => opened),
    sets: vi.fn(async () => current.map((s) => ({ ...s }))),
    history: vi.fn(async () => [{ id: 'h1', date: '2026-01-01' }]),
    priceSources: vi.fn(async () => prices),
    applyLocal: vi.fn(async () => status()),
    onChange: (l: (c: StoreChange) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  } as unknown as DesktopStoreBridge & { applyLocal: ReturnType<typeof vi.fn> };
  return {
    store,
    setSets: (s: SetRecord[]) => (current = s),
    setPrices: (p: typeof prices) => (prices = p),
    emit: (c: Partial<StoreChange>) =>
      listeners.forEach((l) => l({ changed: [], removed: [], status: status(), ...c })),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createLocalBackend', () => {
  it('holds an empty list back until the copy is real, so it is never published', async () => {
    const f = fakeStore(status());
    const onSets = vi.fn();
    createLocalBackend(f.store, '1').subscribeSets(onSets, vi.fn());
    await tick();
    expect(onSets).not.toHaveBeenCalled();
    // A history page or similar: still nothing.
    f.emit({ status: status() });
    await tick();
    expect(onSets).not.toHaveBeenCalled();
    // The first server snapshot arrived (with no sets): now it is real.
    f.emit({ status: status({ lastRemoteAt: 'now' }) });
    await tick();
    expect(onSets).toHaveBeenCalledWith([]);
  });

  it('shows sets copied before at once, even offline', async () => {
    const f = fakeStore(status({ sets: 2 }), [{ id: 'a' }, { id: 'b' }]);
    const onSets = vi.fn();
    createLocalBackend(f.store, '1').subscribeSets(onSets, vi.fn());
    await tick();
    await tick();
    expect(onSets.mock.calls[0][0].map((s: SetRecord) => s.id)).toEqual(['a', 'b']);
  });

  it('keeps unchanged sets as the same objects, so memoised cards do not redraw', async () => {
    const f = fakeStore(status({ sets: 2 }), [{ id: 'a' }, { id: 'b', name: 'old' }]);
    const onSets = vi.fn();
    createLocalBackend(f.store, '1').subscribeSets(onSets, vi.fn());
    await tick();
    await tick();
    const [first] = onSets.mock.calls[0];
    f.setSets([{ id: 'a' }, { id: 'b', name: 'new' }]);
    f.emit({ changed: ['b'], status: status({ sets: 2 }) });
    await tick();
    await tick();
    const [second] = onSets.mock.calls[1];
    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect(second[1].name).toBe('new');
    // A change that touched no set (a history page) does not redeliver.
    f.emit({ status: status({ sets: 2 }) });
    await tick();
    expect(onSets).toHaveBeenCalledTimes(2);
  });

  it('creates sets with Firestore-style ids and history rows with their own', async () => {
    const f = fakeStore(status({ sets: 1 }));
    const backend = createLocalBackend(f.store, '1');
    await backend.addSet({ setNumber: '10333', name: 'x', status: 'planned', priority: 'low' });
    const create = f.store.applyLocal.mock.calls[0][0];
    expect(create).toMatchObject({ type: 'create', value: { setNumber: '10333' } });
    expect(create.id).toMatch(/^[A-Za-z0-9]{20}$/);
    await backend.addPriceHistory('a', { date: '2026-11-05', exchangeRate: 400, id: 'ignored' });
    const hist = f.store.applyLocal.mock.calls[1][0];
    expect(hist.row.id).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(hist.row).toMatchObject({ date: '2026-11-05', exchangeRate: 400 });
    expect(typeof hist.row.createdAt).toBe('string');
    expect(await backend.getPriceHistory('a')).toEqual([{ id: 'h1', date: '2026-01-01' }]);
  });

  it('turns a failed save into a DataError for the UI', async () => {
    const f = fakeStore(status());
    f.store.applyLocal.mockRejectedValueOnce(new Error('Unknown set'));
    const err = await createLocalBackend(f.store, '1')
      .updateSet('a', { name: 'x' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(DataError);
    expect(err.message).toBe('Could not save on this PC: Unknown set');
  });

  it('on this PC only: an empty copy is real at once, and Firebase features are off', async () => {
    const f = fakeStore(status());
    const onSets = vi.fn();
    const onSources = vi.fn();
    const backend = createLocalBackend(f.store, '1', { localOnly: true });
    expect(backend.capabilities).toEqual({
      registries: false,
      publicPlannedList: false,
      firestoreWorker: false,
    });
    backend.subscribeSets(onSets, vi.fn());
    backend.subscribePriceSources(onSources, vi.fn());
    await tick();
    await tick();
    expect(onSets).toHaveBeenCalledWith([]);
    // No server will ever answer: the copy's "none" is final, so defaults get seeded.
    expect(onSources).toHaveBeenLastCalledWith(null, false);
    expect(createLocalBackend(f.store, '1').capabilities.registries).toBe(true);
  });

  it('reports price sources as not yet known until the server has answered', async () => {
    const f = fakeStore(status());
    const onSources = vi.fn();
    createLocalBackend(f.store, '1').subscribePriceSources(onSources, vi.fn());
    await tick();
    await tick();
    expect(onSources).toHaveBeenLastCalledWith(null, true);
    f.setPrices({ list: [{ id: 'x' }], seen: true });
    f.emit({});
    await tick();
    await tick();
    expect(onSources).toHaveBeenLastCalledWith([{ id: 'x' }], false);
  });
});
