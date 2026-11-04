import { newAutoId } from '../../lib/data/ids';
import type { DesktopStoreBridge, StoreStatus } from '../../lib/data/storeBridge';
import { toStoredSource } from '../lib/priceSources';
import type { LegoSet, PriceHistory, PriceSource } from '../types';
import { DataError, type DataBackend } from './types';

// The desktop app's backend: the copy on this PC (desktop/src/store) is what
// the app reads and writes; src/data/firestoreSync.ts keeps it in step with
// Firestore. Every change lands here first, so it is kept when Firebase is
// offline or broken, and it reaches Firestore when it can.

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
const saveError = (err: unknown) =>
  new DataError(`Could not save on this PC: ${messageOf(err)}`, 'local', err);

/** Sets copied before, or the server answered: the list is real (empty or not). */
const listIsReal = (s: StoreStatus) => s.sets > 0 || s.lastRemoteAt !== null;

export function createLocalBackend(store: DesktopStoreBridge, googleSub: string): DataBackend {
  const opened = store.open(googleSub);

  return {
    capabilities: { registries: true, publicPlannedList: true, firestoreWorker: true },

    subscribeSets(onSets, onError) {
      let stopped = false;
      let ready = false;
      // Unchanged sets keep their object, so SetCard's memo holds.
      let previous = new Map<string, LegoSet>();

      const deliver = async (changed: Set<string> | null) => {
        try {
          const sets = (await store.sets()) as unknown as LegoSet[];
          if (stopped) return;
          const next = new Map<string, LegoSet>();
          const list = sets.map((s) => {
            const old = previous.get(s.id);
            const keep = old && changed && !changed.has(s.id) ? old : s;
            next.set(s.id, keep);
            return keep;
          });
          previous = next;
          onSets(list);
        } catch (err) {
          if (!stopped)
            onError(new DataError(`Could not read the copy on this PC: ${messageOf(err)}`));
        }
      };

      const off = store.onChange((change) => {
        if (!ready) {
          // An empty list must not look real before the first copy: the
          // planned list would publish it (usePlannedList's ready gate).
          if (listIsReal(change.status)) {
            ready = true;
            void deliver(null);
          }
          return;
        }
        if (change.changed.length || change.removed.length) void deliver(new Set(change.changed));
      });

      opened.then(
        (status) => {
          if (stopped || ready || !listIsReal(status)) return;
          ready = true;
          void deliver(null);
        },
        (err) => onError(new DataError(`Could not open the copy on this PC: ${messageOf(err)}`))
      );

      return () => {
        stopped = true;
        off();
      };
    },

    async addSet(setData) {
      try {
        await opened;
        await store.applyLocal({ type: 'create', id: newAutoId(), value: { ...setData } });
      } catch (err) {
        throw saveError(err);
      }
    },

    async updateSet(id, updates) {
      try {
        await opened;
        await store.applyLocal({ type: 'update', id, fields: { ...updates } });
      } catch (err) {
        throw saveError(err);
      }
    },

    async deleteSet(id) {
      try {
        await opened;
        await store.applyLocal({ type: 'delete', id });
      } catch (err) {
        throw saveError(err);
      }
    },

    async addPriceHistory(setId, row) {
      try {
        await opened;
        await store.applyLocal({
          type: 'addHistory',
          setId,
          row: { ...row, id: newAutoId(), createdAt: new Date().toISOString() },
        });
      } catch (err) {
        throw saveError(err);
      }
    },

    async getPriceHistory(setId) {
      try {
        await opened;
        return (await store.history(setId)) as unknown as PriceHistory[];
      } catch (err) {
        throw new DataError(`Could not read the price history on this PC: ${messageOf(err)}`);
      }
    },

    subscribePriceSources(onSources, onError) {
      let stopped = false;
      let last = '';
      const read = async () => {
        try {
          const { list, seen } = await store.priceSources();
          const sig = JSON.stringify([list, seen]);
          if (stopped || sig === last) return;
          last = sig;
          onSources(Array.isArray(list) && list.length ? (list as PriceSource[]) : null, !seen);
        } catch (err) {
          if (!stopped) onError(err);
        }
      };
      const off = store.onChange(() => void read());
      opened.then(read, onError);
      return () => {
        stopped = true;
        off();
      };
    },

    async savePriceSources(sources) {
      await opened;
      await store.applyLocal({ type: 'priceSources', list: sources.map(toStoredSource) });
    },
  };
}
