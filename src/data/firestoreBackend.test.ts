import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from './types';
import type { PriceSource } from '../types';

// Firestore itself is replaced by recorders: these tests pin down what the
// backend asks Firestore for, which is what moving the code must not change.
const fs = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  setDoc: vi.fn(),
  getDocs: vi.fn(),
  where: vi.fn((...args: unknown[]) => ({ where: args })),
}));

vi.mock('firebase/firestore', () => ({
  ...fs,
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (ref: unknown, ...constraints: unknown[]) => ({ ref, constraints }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
}));
vi.mock('../lib/firebase', () => ({ getDb: () => ({}) }));
const missingDb = vi.hoisted(() => ({
  listeners: [] as ((id: string, message: string) => void)[],
}));
vi.mock('../lib/firestoreLog', () => ({
  onMissingDatabase: (l: (id: string, message: string) => void) => {
    missingDb.listeners.push(l);
    return () => missingDb.listeners.splice(missingDb.listeners.indexOf(l), 1);
  },
}));

const { createFirestoreBackend } = await import('./firestoreBackend');

const denied = () => Object.assign(new Error('denied'), { code: 'permission-denied' });
const ACCESS = 'You do not have access to this data. Try signing out and back in.';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('createFirestoreBackend', () => {
  it("subscribes to the user's sets, newest first, with ISO dates", () => {
    const backend = createFirestoreBackend('uid-1');
    const onSets = vi.fn();
    backend.subscribeSets(onSets, vi.fn());

    const [q, next] = fs.onSnapshot.mock.calls[0];
    expect(q.ref.path).toBe('sets');
    expect(fs.where).toHaveBeenCalledWith('userId', '==', 'uid-1');
    expect(q.constraints).toContainEqual({ orderBy: ['createdAt', 'desc'] });

    const data = vi.fn(() => ({
      name: 'A',
      createdAt: { seconds: 1730000000, nanoseconds: 0 },
      updatedAt: { seconds: 1730000000, nanoseconds: 0 },
    }));
    next({ forEach: (cb: (d: unknown) => void) => cb({ id: 's1', data }) });
    expect(data).toHaveBeenCalledWith({ serverTimestamps: 'estimate' });
    expect(onSets).toHaveBeenCalledWith([
      {
        id: 's1',
        name: 'A',
        createdAt: '2024-10-27T03:33:20.000Z',
        updatedAt: '2024-10-27T03:33:20.000Z',
      },
    ]);
  });

  it('reports a failed subscription as a DataError with the UI message', () => {
    const onError = vi.fn();
    createFirestoreBackend('uid-1').subscribeSets(vi.fn(), onError);
    fs.onSnapshot.mock.calls[0][2](denied());
    const err = onError.mock.calls[0][0];
    expect(err).toBeInstanceOf(DataError);
    expect(err.message).toBe(ACCESS);
  });

  it('reports a missing database once, instead of showing its empty cache as no sets', () => {
    missingDb.listeners.length = 0;
    fs.onSnapshot.mockReturnValueOnce(() => {});
    const onSets = vi.fn();
    const onError = vi.fn();
    const unsubscribe = createFirestoreBackend('uid-1').subscribeSets(onSets, onError);
    const next = fs.onSnapshot.mock.calls[0][1];
    const snapshot = (fromCache: boolean) => ({ forEach: () => {}, metadata: { fromCache } });

    for (const l of [...missingDb.listeners]) l('typo', 'warning');
    for (const l of [...missingDb.listeners]) l('typo', 'warning');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({
      name: 'DataError',
      code: 'not-found',
      message: expect.stringContaining('"typo" was not found'),
    });
    next(snapshot(true));
    expect(onSets).not.toHaveBeenCalled();
    // The server answered after all: back to normal.
    next(snapshot(false));
    expect(onSets).toHaveBeenCalledWith([]);

    unsubscribe();
    expect(missingDb.listeners).toHaveLength(0);
  });

  it('writes sets with the uid and server timestamps', async () => {
    const backend = createFirestoreBackend('uid-1');
    await backend.addSet({ setNumber: '10333' });
    expect(fs.addDoc).toHaveBeenCalledWith(
      { path: 'sets' },
      {
        setNumber: '10333',
        userId: 'uid-1',
        addedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
        createdAt: 'SERVER_TIMESTAMP',
        updatedAt: 'SERVER_TIMESTAMP',
      }
    );
    // An upload keeps the date the set was added.
    await backend.addSet({ setNumber: '10334', addedAt: '2025-05-05T00:00:00.000Z' });
    expect(fs.addDoc.mock.calls[1][1].addedAt).toBe('2025-05-05T00:00:00.000Z');
    await backend.updateSet('s1', { name: 'B' });
    expect(fs.updateDoc).toHaveBeenCalledWith(
      { path: 'sets/s1' },
      { name: 'B', updatedAt: 'SERVER_TIMESTAMP' }
    );
    await backend.deleteSet('s1');
    expect(fs.deleteDoc).toHaveBeenCalledWith({ path: 'sets/s1' });
  });

  it('turns a failed write into a DataError', async () => {
    fs.updateDoc.mockRejectedValueOnce(denied());
    await expect(createFirestoreBackend('uid-1').updateSet('s1', {})).rejects.toMatchObject({
      name: 'DataError',
      message: ACCESS,
      code: 'permission-denied',
    });
  });

  it('appends and reads price history, oldest first', async () => {
    const backend = createFirestoreBackend('uid-1');
    await backend.addPriceHistory('s1', { date: '2026-01-01', exchangeRate: 400 });
    expect(fs.addDoc).toHaveBeenCalledWith(
      { path: 'sets/s1/priceHistory' },
      { date: '2026-01-01', exchangeRate: 400, createdAt: 'SERVER_TIMESTAMP' }
    );

    fs.getDocs.mockResolvedValueOnce({
      docs: [
        {
          id: 'h1',
          data: () => ({ date: '2026-01-01', createdAt: { seconds: 1730000000, nanoseconds: 0 } }),
        },
      ],
    });
    expect(await backend.getPriceHistory('s1')).toEqual([
      { id: 'h1', date: '2026-01-01', createdAt: '2024-10-27T03:33:20.000Z' },
    ]);
    expect(fs.getDocs.mock.calls[0][0].constraints).toContainEqual({ orderBy: ['date', 'asc'] });
  });

  it('reads the stored price sources, null when none, with fromCache passed on', () => {
    const onSources = vi.fn();
    createFirestoreBackend('uid-1').subscribePriceSources(onSources, vi.fn());
    const [ref, next] = fs.onSnapshot.mock.calls[0];
    expect(ref.path).toBe('userSettings/uid-1');

    next({ data: () => undefined, metadata: { fromCache: true } });
    next({ data: () => ({ priceSources: [] }), metadata: { fromCache: false } });
    next({ data: () => ({ priceSources: [{ id: 'x' }] }), metadata: { fromCache: false } });
    expect(onSources.mock.calls).toEqual([
      [null, true],
      [null, false],
      [[{ id: 'x' }], false],
    ]);
  });

  it('saves price sources in their stored form', async () => {
    const source: PriceSource = {
      id: 'shop',
      name: 'Shop',
      urlTemplate: 'https://shop.example/?q={set}',
      currency: 'HUF',
      color: '#000000',
    };
    await createFirestoreBackend('uid-1').savePriceSources([source]);
    const [ref, body] = fs.setDoc.mock.calls[0];
    expect(ref.path).toBe('userSettings/uid-1');
    expect(body.priceSources).toHaveLength(1);
    expect(body.priceSources[0]).toMatchObject({ id: 'shop' });
    expect(typeof body.updatedAt).toBe('string');
  });
});
