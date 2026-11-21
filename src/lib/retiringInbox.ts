import { baseSetNumber } from './retiring';

// The retiring notifications the bell keeps (header dropdown) and the toast
// that shows each one once. Kept on this device like the retiring mark itself
// (src/lib/retiring.ts). One entry per set: LEGO.RETIRE.WATCH announces a set
// once, so an entry is added once and stays until it is read (and a little
// while after, for the dropdown's history).

export const INBOX_STORAGE_KEY = 'bt.retiring.inbox.v1';
/** Entries kept at most; the oldest read ones go first. */
const MAX_ENTRIES = 30;

export interface RetiringNotice {
  /** The set's base number, which is also the entry's id. */
  setNumber: string;
  name: string;
  /** When the app announced it (ISO). */
  at: string;
  read: boolean;
}

const isNotice = (v: unknown): v is RetiringNotice =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as RetiringNotice).setNumber === 'string' &&
  typeof (v as RetiringNotice).name === 'string' &&
  typeof (v as RetiringNotice).at === 'string' &&
  typeof (v as RetiringNotice).read === 'boolean';

/** The stored list, dropping anything malformed and any repeat of a set. */
export function sanitizeInbox(raw: unknown): RetiringNotice[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RetiringNotice[] = [];
  for (const v of raw) {
    if (!isNotice(v) || seen.has(v.setNumber)) continue;
    seen.add(v.setNumber);
    out.push({ ...v });
  }
  return out.slice(0, MAX_ENTRIES);
}

/** The inbox with a new entry first for each set it does not hold yet. */
export function addNotices(
  inbox: RetiringNotice[],
  added: { setNumber: string; name: string }[],
  at: string
): { inbox: RetiringNotice[]; fresh: RetiringNotice[] } {
  const have = new Set(inbox.map((n) => n.setNumber));
  const fresh: RetiringNotice[] = [];
  for (const a of added) {
    const setNumber = baseSetNumber(a.setNumber);
    if (have.has(setNumber)) continue;
    have.add(setNumber);
    fresh.push({ setNumber, name: a.name, at, read: false });
  }
  if (!fresh.length) return { inbox, fresh };
  let next = [...fresh, ...inbox];
  while (next.length > MAX_ENTRIES) {
    const i = next.map((n) => n.read).lastIndexOf(true);
    next = next.filter((_, j) => j !== (i === -1 ? next.length - 1 : i));
  }
  return { inbox: next, fresh };
}

export const unreadCount = (inbox: RetiringNotice[]): number => inbox.filter((n) => !n.read).length;

/** Every entry read (the same list back when nothing was unread). */
export function markAllRead(inbox: RetiringNotice[]): RetiringNotice[] {
  return unreadCount(inbox) ? inbox.map((n) => (n.read ? n : { ...n, read: true })) : inbox;
}

/** One entry read. */
export function markRead(inbox: RetiringNotice[], setNumber: string): RetiringNotice[] {
  const key = baseSetNumber(setNumber);
  return inbox.some((n) => n.setNumber === key && !n.read)
    ? inbox.map((n) => (n.setNumber === key ? { ...n, read: true } : n))
    : inbox;
}

/** "Viking Village (21343)", or the bare number when the set has no name. */
export const noticeLabel = (n: Pick<RetiringNotice, 'setNumber' | 'name'>): string =>
  n.name ? `${n.name} (${n.setNumber})` : n.setNumber;

/** "14 Nov" for the chip and the dropdown, in English like the rest of the app. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
