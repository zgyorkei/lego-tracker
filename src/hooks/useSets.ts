import { useState, useEffect, useCallback } from 'react';
import { withSetDates } from '../lib/setDates';
import type { DataBackend, SessionUser } from '../data/types';
import { LegoSet, PriceHistory } from '../types';

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The signed-in user's sets, through `backend` (null while nobody is signed
 * in). `loading` stays true until the session is known and, for a signed-in
 * user, until the first list has arrived: usePlannedList's ready gate relies
 * on that, so an empty list is never published.
 */
export function useSets(user: SessionUser, backend: DataBackend | null) {
  const [sets, setSets] = useState<LegoSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const signedOut = user === null;

  useEffect(() => {
    if (!backend) {
      if (signedOut) {
        setSets([]);
        setError(null);
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    return backend.subscribeSets(
      (next) => {
        setSets(next);
        setError(null);
        setLoading(false);
      },
      (err) => {
        // Fallback to cached sets if the live query fails.
        try {
          const cached = localStorage.getItem('cachedSets');
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
              // Older caches hold the dates in Timestamp JSON form.
              setSets((parsed as LegoSet[]).map(withSetDates));
            }
          }
        } catch (e) {
          console.warn('Could not restore cached sets', e);
        }

        setLoading(false);
        setError(err.message);
      }
    );
  }, [backend, signedOut]);

  // All CRUD wrappers are useCallback'd so they keep a stable identity across
  // renders. Without this, memoising SetCard achieves nothing: every render of
  // App would hand every card brand-new function props.
  //
  // They surface a message via setError and then re-throw, so an awaiting
  // caller can branch on failure while the UI still gets something to display.

  const addSet = useCallback(
    async (setData: Partial<LegoSet>) => {
      if (!backend) return;
      try {
        await backend.addSet(setData);
        setError(null);
      } catch (err) {
        const message = messageOf(err);
        setError(message);
        throw new Error(message);
      }
    },
    [backend]
  );

  const updateSet = useCallback(
    async (id: string, updates: Partial<LegoSet>) => {
      try {
        if (!backend) throw new Error('Sign in to save changes.');
        await backend.updateSet(id, updates);
        setError(null);
      } catch (err) {
        const message = messageOf(err);
        setError(message);
        throw new Error(message);
      }
    },
    [backend]
  );

  const deleteSet = useCallback(
    async (id: string) => {
      try {
        if (!backend) throw new Error('Sign in to delete sets.');
        await backend.deleteSet(id);
        setError(null);
      } catch (err) {
        const message = messageOf(err);
        setError(message);
        throw new Error(message);
      }
    },
    [backend]
  );

  const addPriceHistory = useCallback(
    async (setId: string, history: PriceHistory) => {
      try {
        if (!backend) throw new Error('Sign in to record prices.');
        await backend.addPriceHistory(setId, history);
      } catch (err) {
        const message = messageOf(err);
        setError(message);
        throw new Error(message);
      }
    },
    [backend]
  );

  const getPriceHistory = useCallback(
    async (setId: string): Promise<PriceHistory[]> => {
      if (!backend) return [];
      try {
        return await backend.getPriceHistory(setId);
      } catch (err) {
        // Read-only and non-critical: surface it but return empty rather than
        // throwing, so a history-fetch failure cannot break the card.
        setError(messageOf(err));
        return [];
      }
    },
    [backend]
  );

  return {
    sets,
    loading,
    error,
    addSet,
    updateSet,
    deleteSet,
    addPriceHistory,
    getPriceHistory,
    user,
  };
}
