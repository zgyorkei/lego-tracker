import type { LegoSet } from '../types';

// Retiring sets: planned sets that LEGO.com lists on its "last chance to buy"
// page (GET /api/last-chance reads it). The mark is kept on this device, in
// localStorage, not on the set document: the sets update rule (firestore.rules,
// kept in its own Firebase store) lists the fields that may change, the Drive
// ops and the desktop copy share that list, and a new field would need a rules
// deployment. It is derived data anyway: every device that runs the app reads
// the same page and reaches the same mark; only the "first seen" date and the
// "notified" flag are per device.
//
// A set that LEGO later takes off the page loses the mark (onPage false): it
// either sold out for good or was brought back, and in neither case does the
// app know it is "retiring". Its record stays, so a set that comes back is
// marked again with its first date and is not announced a second time.

export const RETIRING_STORAGE_KEY = 'bt.retiring.v1';
/** How often the app asks again while it stays open (the server caches 6 h). */
export const RETIRING_CHECK_MS = 3 * 60 * 60 * 1000;
/** Records kept at most (the page lists some 300 sets). */
const MAX_RECORDS = 500;

export interface RetiringRecord {
  /** When the app first saw the set on the page (ISO). */
  firstSeen: string;
  /** The server's read time of the last page that listed it (ISO). */
  lastSeen: string;
  /** Whether the latest read listed it. */
  onPage: boolean;
  /** Whether the user was told (once per set). */
  notified: boolean;
}

export type RetiringMap = Record<string, RetiringRecord>;

/** "75192-1" and "75192" are the same set on the page. */
export const baseSetNumber = (setNumber: string): string => setNumber.trim().replace(/-\d+$/, '');

const isRecord = (v: unknown): v is RetiringRecord =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as RetiringRecord).firstSeen === 'string' &&
  typeof (v as RetiringRecord).lastSeen === 'string' &&
  typeof (v as RetiringRecord).onPage === 'boolean' &&
  typeof (v as RetiringRecord).notified === 'boolean';

/** The stored map, dropping anything that is not a well-formed record. */
export function sanitizeRetiringMap(raw: unknown): RetiringMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: RetiringMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isRecord(v)) out[k] = { ...v };
  }
  return out;
}

export interface RetiringUpdate {
  map: RetiringMap;
  /** Planned sets that appeared on the page for the first time and were not yet announced. */
  toNotify: string[];
}

/**
 * Matches one read of the page against the planned sets. A planned set on the
 * page gets a record (first seen = `readAt`) or has its record refreshed; a
 * record whose set is not on the page now goes off-page. `toNotify` holds each
 * planned set once, until `markNotified` records that the user was told.
 */
export function applyLastChance(
  previous: RetiringMap,
  plannedSetNumbers: string[],
  onPage: string[],
  readAt: string
): RetiringUpdate {
  const page = new Set(onPage.map(baseSetNumber));
  const planned = new Set(plannedSetNumbers.map(baseSetNumber));
  const map: RetiringMap = {};
  for (const [k, v] of Object.entries(previous)) map[k] = { ...v, onPage: page.has(k) };

  const toNotify: string[] = [];
  for (const n of planned) {
    if (!page.has(n)) continue;
    const rec = map[n];
    if (rec) {
      map[n] = { ...rec, lastSeen: readAt, onPage: true };
    } else {
      map[n] = { firstSeen: readAt, lastSeen: readAt, onPage: true, notified: false };
    }
    if (!map[n].notified) toNotify.push(n);
  }

  const keys = Object.keys(map);
  if (keys.length > MAX_RECORDS) {
    keys
      .filter((k) => !map[k].onPage)
      .sort((a, b) => map[a].lastSeen.localeCompare(map[b].lastSeen))
      .slice(0, keys.length - MAX_RECORDS)
      .forEach((k) => delete map[k]);
  }
  return { map, toNotify };
}

/** The map with these sets recorded as announced. */
export function markNotified(map: RetiringMap, setNumbers: string[]): RetiringMap {
  const out = { ...map };
  for (const n of setNumbers.map(baseSetNumber)) {
    if (out[n]) out[n] = { ...out[n], notified: true };
  }
  return out;
}

/**
 * The sets with `retiringSince` (the date first seen) on each planned set that
 * is on the page now. Derived for display: never written to a backend.
 */
export function withRetiring(sets: LegoSet[], map: RetiringMap): LegoSet[] {
  let changed = false;
  const out = sets.map((s) => {
    const rec = s.status === 'planned' ? map[baseSetNumber(s.setNumber)] : undefined;
    const since = rec?.onPage ? rec.firstSeen : undefined;
    if (since === s.retiringSince) return s;
    changed = true;
    return { ...s, retiringSince: since };
  });
  return changed ? out : sets;
}
