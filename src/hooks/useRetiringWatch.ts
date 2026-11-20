import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LegoSet } from '../types';
import { readStoredJson, writeStored } from '../lib/storage';
import {
  RETIRING_CHECK_MS,
  RETIRING_STORAGE_KEY,
  applyLastChance,
  markNotified,
  sanitizeRetiringMap,
  withRetiring,
  type RetiringMap,
} from '../lib/retiring';

interface LastChanceAnswer {
  setNumbers: string[];
  readAt: string;
}

const isAnswer = (v: unknown): v is LastChanceAnswer =>
  !!v &&
  Array.isArray((v as LastChanceAnswer).setNumbers) &&
  (v as LastChanceAnswer).setNumbers.every((n) => typeof n === 'string') &&
  typeof (v as LastChanceAnswer).readAt === 'string';

/**
 * The announcement. There is no in-app notification channel, so this is the
 * browser's (the desktop app's page has the same API). Returns whether it was
 * shown: without permission the set stays un-announced and the next check
 * tries again, and the row's mark still shows it.
 */
async function announce(setNumbers: string[], sets: LegoSet[]): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  try {
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') return false;
    for (const n of setNumbers) {
      const set = sets.find(
        (s) => s.status === 'planned' && s.setNumber.replace(/-\d+$/, '') === n
      );
      const label = set?.name ? `${n} ${set.name}` : n;
      new Notification('Set retiring soon', {
        body: `${label} is on LEGO's last-chance page.`,
        tag: `retiring-${n}`,
      });
    }
    return true;
  } catch (e) {
    console.warn('Could not show the retiring notification', e);
    return false;
  }
}

/**
 * Watches LEGO.com's last-chance page (through GET /api/last-chance) on start
 * and every few hours, matches it against the planned sets, keeps the mark
 * (src/lib/retiring.ts) and announces each newly retiring planned set once.
 * Returns `sets` with `retiringSince` filled in on the retiring ones.
 *
 * `enabled` is off in demo mode and while the sets are loading. A failed read
 * (the server says why) keeps the marks as they were.
 */
export function useRetiringWatch(sets: LegoSet[], enabled: boolean): LegoSet[] {
  const [map, setMap] = useState<RetiringMap>(() =>
    sanitizeRetiringMap(readStoredJson<unknown>(RETIRING_STORAGE_KEY, {}))
  );
  const mapRef = useRef(map);
  const setsRef = useRef(sets);
  setsRef.current = sets;

  const commit = useCallback((next: RetiringMap) => {
    mapRef.current = next;
    setMap(next);
    writeStored(RETIRING_STORAGE_KEY, next);
  }, []);

  // The check reads the latest sets through a ref, so a change to the list
  // does not trigger a new request: one read per start or interval only.
  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/last-chance');
      if (!res.ok) return;
      const answer: unknown = await res.json();
      if (!isAnswer(answer)) return;
      const planned = setsRef.current.filter((s) => s.status === 'planned').map((s) => s.setNumber);
      const { map: next, toNotify } = applyLastChance(
        mapRef.current,
        planned,
        answer.setNumbers,
        answer.readAt
      );
      commit(next);
      if (toNotify.length && (await announce(toNotify, setsRef.current))) {
        commit(markNotified(mapRef.current, toNotify));
      }
    } catch (e) {
      console.warn('Could not check the last-chance page', e);
    }
  }, [commit]);

  useEffect(() => {
    if (!enabled) return;
    void check();
    const timer = window.setInterval(() => void check(), RETIRING_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [enabled, check]);

  return useMemo(() => withRetiring(sets, map), [sets, map]);
}
