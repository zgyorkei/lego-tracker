import { useState, useEffect, useCallback, useRef } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../lib/firebase';
import { readStoredJson, writeStored } from '../lib/storage';
import { ensureBrickLinkSources, toStoredSource } from '../lib/priceSources';
import { DEFAULT_PRICE_SOURCES, PriceSource } from '../types';

const SETTINGS_COLLECTION = 'userSettings';
const CACHE_KEY = 'legoPriceSources';

// The editor saves on every keystroke (the source id included), so writes are
// debounced: one Firestore write per pause in typing instead of one per key.
const SAVE_DEBOUNCE_MS = 700;

/**
 * Price sources, synced per user through userSettings/{uid}.
 *
 * They used to live only in localStorage, so every browser (and the desktop
 * app) had its own list and the same set could be priced against different
 * sources. localStorage is kept as a cache so the first render has sources
 * before Firestore answers, and as the migration source: a user with no
 * settings doc yet gets their existing local list uploaded once.
 *
 * Demo Mode and signed-out use never touch Firestore.
 */
export function usePriceSources(user: User | null, isDemoMode: boolean) {
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

  const synced = Boolean(user) && !isDemoMode;

  useEffect(() => {
    if (!user || isDemoMode) return;
    const ref = doc(db, SETTINGS_COLLECTION, user.uid);
    return onSnapshot(
      ref,
      (snap) => {
        if (dirty.current) return;
        const stored = snap.data()?.priceSources;
        if (Array.isArray(stored) && stored.length > 0) {
          const next = ensureBrickLinkSources(stored as PriceSource[]);
          setPriceSources(next);
          writeStored(CACHE_KEY, next);
          return;
        }
        // An empty cache-only snapshot says nothing about the server, so only
        // seed once the server has confirmed there is no settings doc.
        if (snap.metadata.fromCache) return;
        setDoc(ref, {
          priceSources: latest.current.map(toStoredSource),
          updatedAt: new Date().toISOString(),
        }).catch((err) => {
          console.error('Seeding price sources failed', err);
          setError('Could not save your price sources to your account.');
        });
      },
      (err) => {
        console.error('Price sources subscription failed', err);
        setError('Could not load your price sources. Using the copy on this device.');
      }
    );
  }, [user, isDemoMode]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const savePriceSources = useCallback(
    (newSources: PriceSource[]) => {
      const next = ensureBrickLinkSources(newSources);
      setPriceSources(next);
      writeStored(CACHE_KEY, next);
      if (!user || isDemoMode) return;

      dirty.current = true;
      const seq = ++saveSeq.current;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await setDoc(doc(db, SETTINGS_COLLECTION, user.uid), {
            priceSources: next.map(toStoredSource),
            updatedAt: new Date().toISOString(),
          });
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
    [user, isDemoMode]
  );

  return { priceSources, savePriceSources, error, synced };
}
