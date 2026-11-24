import { describe, expect, it } from 'vitest';
import {
  addNotices,
  markAllRead,
  markRead,
  noticeLabel,
  sanitizeInbox,
  shortDate,
  unreadCount,
  type RetiringNotice,
} from './retiringInbox';

const T1 = '2026-11-14T08:00:00.000Z';
const T2 = '2026-11-20T08:00:00.000Z';
const n = (setNumber: string, read = false): RetiringNotice => ({
  setNumber,
  name: `Set ${setNumber}`,
  at: T1,
  read,
});

describe('addNotices', () => {
  it('adds a set once, newest first, and says which are fresh', () => {
    const a = addNotices([n('1')], [{ setNumber: '21343-1', name: 'Viking Village' }], T2);
    expect(a.fresh.map((x) => x.setNumber)).toEqual(['21343']);
    expect(a.inbox.map((x) => x.setNumber)).toEqual(['21343', '1']);
    expect(a.inbox[0]).toEqual({ setNumber: '21343', name: 'Viking Village', at: T2, read: false });
  });

  it('never repeats a set, even one already read', () => {
    const inbox = [n('21343', true)];
    const a = addNotices(inbox, [{ setNumber: '21343', name: 'x' }], T2);
    expect(a.fresh).toEqual([]);
    expect(a.inbox).toBe(inbox);
  });

  it('keeps at most 30, dropping read ones first', () => {
    const inbox = Array.from({ length: 30 }, (_, i) => n(`${i + 100}`, i === 5));
    const a = addNotices(inbox, [{ setNumber: '9', name: '' }], T2);
    expect(a.inbox).toHaveLength(30);
    expect(a.inbox.some((x) => x.setNumber === '105')).toBe(false);
    expect(a.inbox[0].setNumber).toBe('9');
  });
});

describe('reading', () => {
  it('counts and clears unread entries', () => {
    const inbox = [n('1'), n('2', true), n('3')];
    expect(unreadCount(inbox)).toBe(2);
    const all = markAllRead(inbox);
    expect(unreadCount(all)).toBe(0);
    expect(markAllRead(all)).toBe(all);
  });

  it('reads one entry by base number', () => {
    const inbox = [n('1'), n('2')];
    expect(markRead(inbox, '2-1').map((x) => x.read)).toEqual([false, true]);
    expect(markRead(inbox, '9')).toBe(inbox);
  });
});

describe('sanitizeInbox', () => {
  it('drops malformed and repeated entries', () => {
    expect(sanitizeInbox('x')).toEqual([]);
    expect(sanitizeInbox([n('1'), { setNumber: 2 }, null, n('1', true)])).toEqual([n('1')]);
  });
});

describe('labels', () => {
  it('names the set, or only its number', () => {
    expect(noticeLabel({ setNumber: '21343', name: 'Viking Village' })).toBe(
      'Viking Village (21343)'
    );
    expect(noticeLabel({ setNumber: '21343', name: '' })).toBe('21343');
  });

  it('gives a short date, empty for nonsense', () => {
    expect(shortDate('2026-11-14T12:00:00.000Z')).toBe('14 Nov');
    expect(shortDate('nope')).toBe('');
  });
});
