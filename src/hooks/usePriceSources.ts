import { useState, useEffect, useCallback, useRef } from 'react';
import { readStoredJson, writeStored } from '../lib/storage';
import { ensureBrickLinkSources } from '../lib/priceSources';
import type { DataBackend } from '../data/types';
import { DEFAULT_PRICE_SOURCES, PriceSource } from '../types';

const CACHE_KEY = 'legoPriceSources';

// The editor saves on every keystroke (the source id included), so writes are
// debounced: one Firestore write per pause in typing instead of one per key.
const SAVE_DEBOUNCE_MS = 700;

/**
 * Price sources, synced per user through the backend (userSettings/{uid} in
 * Firestore). `backend` is null while nobody is signed in.
 *
 * They used to live only in localStorage, so every browser (and the desktop
 * app) had its own list and the same set could be priced against different
 * sources. localStorage is kept as a cache so the first render has sources
 * before the backend answers, and as the migration source: a user with no
 * stored list yet gets their existing local list uploaded once.
 *
 * Demo Mode and signed-out use never touch the backend.
 */
export function usePriceSources(backend: DataBackend | null, isDemoMode: boolean) {
  const [priceSources, setPriceSources] = useState<PriceSource[]>(() =>
    ensureBrickLinkSources(readStoredJson<PriceSource[]>(CACHE_KEY, DEFAULT_PRICE_SOURCES))
  );
  const [error, setError] = useState<string | null>(null);

  // True while a local edit is waiting to be written. Snapshots that arrive in
  // that window carry the older server copy and would undo what was just typed.
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSeq = useRef(0);
  // Mirrors priceSources so the snapshot handler can seed from the latest
  // local list without resubscribing whenever it changes.
  const latest = useRef(priceSources);
  useEffect(() => {
    latest.current = priceSources;
  }, [priceSources]);

  const synced = Boolean(backend) && !isDemoMode;

  useEffect(() => {
    if (!backend || isDemoMode) return;
    return backend.subscribePriceSources(
      (stored, fromCache) => {
        if (dirty.current) return;
        if (stored) {
          const next = ensureBrickLinkSources(stored);
          setPriceSources(next);
          writeStored(CACHE_KEY, next);
          return;
        }
        // An empty cache-only answer says nothing about the server, so only
        // seed once the server has confirmed there is no stored list.
        if (fromCache) return;
        backend.savePriceSources(latest.current).catch((err) => {
          console.error('Seeding price sources failed', err);
          setError('Could not save your price sources to your account.');
        });
      },
      (err) => {
        console.error('Price sources subscription failed', err);
        setError('Could not load your price sources. Using the copy on this device.');
      }
    );
  }, [backend, isDemoMode]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  const savePriceSources = useCallback(
    (newSources: PriceSource[]) => {
      const next = ensureBrickLinkSources(newSources);
      setPriceSources(next);
      writeStored(CACHE_KEY, next);
      if (!backend || isDemoMode) return;

      dirty.current = true;
      const seq = ++saveSeq.current;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await backend.savePriceSources(next);
          setError(null);
        } catch (err) {
          console.error('Saving price sources failed', err);
          setError('Could not save your price sources. Changes are kept on this device only.');
        } finally {
          // A newer edit may have been queued while this write was in flight;
          // stay dirty until that one lands too.
          if (saveSeq.current === seq) dirty.current = false;
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [backend, isDemoMode]
  );

  return { priceSources, savePriceSources, error, synced };
}
