import { describe, expect, it } from 'vitest';
import type { LegoSet } from '../types';
import {
  applyLastChance,
  baseSetNumber,
  markNotified,
  sanitizeRetiringMap,
  withRetiring,
} from './retiring';

const T1 = '2026-11-20T08:00:00.000Z';
const T2 = '2026-11-20T14:00:00.000Z';

const set = (setNumber: string, over: Partial<LegoSet> = {}): LegoSet =>
  ({ id: setNumber, setNumber, name: `Set ${setNumber}`, status: 'planned', ...over }) as LegoSet;

describe('baseSetNumber', () => {
  it('drops the -1 suffix', () => {
    expect(baseSetNumber('75192-1')).toBe('75192');
    expect(baseSetNumber(' 75192 ')).toBe('75192');
  });
});

describe('applyLastChance', () => {
  it('marks a planned set on the page with the date first seen, and announces it once', () => {
    const a = applyLastChance({}, ['75192-1', '10300'], ['75192', '99999'], T1);
    expect(a.map).toEqual({
      '75192': { firstSeen: T1, lastSeen: T1, onPage: true, notified: false },
    });
    expect(a.toNotify).toEqual(['75192']);

    const told = markNotified(a.map, a.toNotify);
    const b = applyLastChance(told, ['75192'], ['75192'], T2);
    expect(b.toNotify).toEqual([]);
    expect(b.map['75192']).toEqual({ firstSeen: T1, lastSeen: T2, onPage: true, notified: true });
  });

  it('keeps announcing until the user was actually told', () => {
    const a = applyLastChance({}, ['75192'], ['75192'], T1);
    const b = applyLastChance(a.map, ['75192'], ['75192'], T2);
    expect(b.toNotify).toEqual(['75192']);
    expect(b.map['75192'].firstSeen).toBe(T1);
  });

  it('takes the mark off when the set leaves the page, and does not announce its return', () => {
    const told = markNotified(applyLastChance({}, ['75192'], ['75192'], T1).map, ['75192']);
    const gone = applyLastChance(told, ['75192'], ['10300'], T2);
    expect(gone.map['75192'].onPage).toBe(false);
    expect(gone.toNotify).toEqual([]);
    const back = applyLastChance(gone.map, ['75192'], ['75192'], '2026-11-21T08:00:00.000Z');
    expect(back.map['75192']).toMatchObject({ firstSeen: T1, onPage: true, notified: true });
    expect(back.toNotify).toEqual([]);
  });

  it('ignores sets on the page that are not planned', () => {
    const a = applyLastChance({}, [], ['75192'], T1);
    expect(a.map).toEqual({});
    expect(a.toNotify).toEqual([]);
  });
});

describe('withRetiring', () => {
  const map = applyLastChance({}, ['75192'], ['75192'], T1).map;

  it('sets retiringSince on planned sets that are on the page, not on purchased ones', () => {
    const out = withRetiring(
      [set('75192-1'), set('75192', { id: 'b', status: 'ordered' }), set('10300')],
      map
    );
    expect(out[0].retiringSince).toBe(T1);
    expect(out[1].retiringSince).toBeUndefined();
    expect(out[2].retiringSince).toBeUndefined();
  });

  it('returns the same array when nothing changes, and clears a mark that went off the page', () => {
    const sets = [set('10300')];
    expect(withRetiring(sets, map)).toBe(sets);
    const marked = withRetiring([set('75192')], map);
    const off = applyLastChance(map, ['75192'], [], T2).map;
    expect(withRetiring(marked, off)[0].retiringSince).toBeUndefined();
  });
});

describe('sanitizeRetiringMap', () => {
  it('drops malformed entries', () => {
    expect(sanitizeRetiringMap(null)).toEqual({});
    expect(sanitizeRetiringMap([])).toEqual({});
    expect(
      sanitizeRetiringMap({
        ok: { firstSeen: T1, lastSeen: T1, onPage: true, notified: false },
        bad: { firstSeen: 1 },
      })
    ).toEqual({ ok: { firstSeen: T1, lastSeen: T1, onPage: true, notified: false } });
  });
});
