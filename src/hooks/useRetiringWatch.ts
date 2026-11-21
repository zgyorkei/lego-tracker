import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LegoSet } from '../types';
import { readStoredJson, writeStored } from '../lib/storage';
import {
  RETIRING_CHECK_MS,
  RETIRING_STORAGE_KEY,
  applyLastChance,
  baseSetNumber,
  markNotified,
  sanitizeRetiringMap,
  withRetiring,
  type RetiringMap,
} from '../lib/retiring';
import {
  INBOX_STORAGE_KEY,
  addNotices,
  markAllRead,
  markRead,
  noticeLabel,
  sanitizeInbox,
  type RetiringNotice,
} from '../lib/retiringInbox';

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
 * When the page is in the background the in-app toast would go unseen, so a
 * system notification (a Windows toast) says it too, but only if the user
 * already allowed them: the app never asks for the permission.
 */
function announceInBackground(notices: RetiringNotice[]): void {
  if (typeof Notification === 'undefined' || !document.hidden) return;
  if (Notification.permission !== 'granted') return;
  try {
    for (const n of notices) {
      new Notification('Set retiring soon', {
        body: `${noticeLabel(n)} is on LEGO's last-chance page.`,
        tag: `retiring-${n.setNumber}`,
      });
    }
  } catch (e) {
    console.warn('Could not show the retiring notification', e);
  }
}

export interface RetiringWatch {
  /** `sets` with `retiringSince` filled in on the retiring ones. */
  sets: LegoSet[];
  /** The bell's list, newest first. */
  inbox: RetiringNotice[];
  /** Notices whose toast is still up (each set's toast shows once, ever). */
  toasts: RetiringNotice[];
  dismissToast: (setNumber: string) => void;
  readAll: () => void;
  readOne: (setNumber: string) => void;
}

/**
 * Watches LEGO.com's last-chance page (through GET /api/last-chance) on start
 * and every few hours, matches it against the planned sets, keeps the mark
 * (src/lib/retiring.ts) and announces each newly retiring planned set once:
 * a bell entry (kept until read) and a toast.
 *
 * `enabled` is off in demo mode and while the sets are loading. A failed read
 * (the server says why) keeps the marks as they were.
 */
export function useRetiringWatch(sets: LegoSet[], enabled: boolean): RetiringWatch {
  const [map, setMap] = useState<RetiringMap>(() =>
    sanitizeRetiringMap(readStoredJson<unknown>(RETIRING_STORAGE_KEY, {}))
  );
  const mapRef = useRef(map);
  const [inbox, setInbox] = useState<RetiringNotice[]>(() =>
    sanitizeInbox(readStoredJson<unknown>(INBOX_STORAGE_KEY, []))
  );
  const inboxRef = useRef(inbox);
  const [toasts, setToasts] = useState<RetiringNotice[]>([]);
  const setsRef = useRef(sets);
  setsRef.current = sets;

  const commit = useCallback((next: RetiringMap) => {
    mapRef.current = next;
    setMap(next);
    writeStored(RETIRING_STORAGE_KEY, next);
  }, []);

  const commitInbox = useCallback((next: RetiringNotice[]) => {
    inboxRef.current = next;
    setInbox(next);
    writeStored(INBOX_STORAGE_KEY, next);
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
      if (!toNotify.length) return;
      const added = toNotify.map((n) => ({
        setNumber: n,
        name:
          setsRef.current.find((s) => s.status === 'planned' && baseSetNumber(s.setNumber) === n)
            ?.name ?? '',
      }));
      const { inbox: nextInbox, fresh } = addNotices(inboxRef.current, added, answer.readAt);
      commitInbox(nextInbox);
      commit(markNotified(mapRef.current, toNotify));
      if (fresh.length) {
        setToasts((t) => [...t, ...fresh]);
        announceInBackground(fresh);
      }
    } catch (e) {
      console.warn('Could not check the last-chance page', e);
    }
  }, [commit, commitInbox]);

  useEffect(() => {
    if (!enabled) return;
    void check();
    const timer = window.setInterval(() => void check(), RETIRING_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [enabled, check]);

  const watched = useMemo(() => withRetiring(sets, map), [sets, map]);
  const dismissToast = useCallback(
    (n: string) => setToasts((t) => t.filter((x) => x.setNumber !== n)),
    []
  );
  const readAll = useCallback(() => commitInbox(markAllRead(inboxRef.current)), [commitInbox]);
  const readOne = useCallback(
    (n: string) => commitInbox(markRead(inboxRef.current, n)),
    [commitInbox]
  );
  return { sets: watched, inbox, toasts, dismissToast, readAll, readOne };
}
