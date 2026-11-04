import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { toIso, toMillis, withIsoDates } from './timestamps';

const ISO = '2024-10-27T03:33:20.000Z';
const SECONDS = 1730000000;

describe('toIso', () => {
  it('reads a Firestore Timestamp', () => {
    expect(toIso(new Timestamp(SECONDS, 0))).toBe(ISO);
  });

  it('reads a Timestamp after a JSON round trip (the cachedSets copy)', () => {
    const json: unknown = JSON.parse(JSON.stringify(new Timestamp(SECONDS, 0)));
    expect(toIso(json)).toBe(ISO);
  });

  it('reads plain { seconds, nanoseconds } and the underscored REST form', () => {
    expect(toIso({ seconds: SECONDS, nanoseconds: 0 })).toBe(ISO);
    expect(toIso({ seconds: SECONDS })).toBe(ISO);
    expect(toIso({ _seconds: SECONDS, _nanoseconds: 0 })).toBe(ISO);
  });

  it('keeps the milliseconds of the nanoseconds part', () => {
    expect(toIso({ seconds: SECONDS, nanoseconds: 123_456_789 })).toBe('2024-10-27T03:33:20.123Z');
  });

  it('reads anything with toDate()', () => {
    expect(toIso({ toDate: () => new Date(ISO) })).toBe(ISO);
  });

  it('reads strings, milliseconds and Dates', () => {
    expect(toIso(ISO)).toBe(ISO);
    expect(toIso('2026-01-01')).toBe('2026-01-01T00:00:00.000Z');
    expect(toIso(SECONDS * 1000)).toBe(ISO);
    expect(toIso(new Date(ISO))).toBe(ISO);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['a non-date string', 'not a date'],
    ['NaN', NaN],
    ['an empty object', {}],
    ['an invalid Date', new Date('nope')],
    ['a time beyond what a Date holds', 9e15],
    ['toDate() returning a non-Date', { toDate: () => 'x' }],
  ])('is undefined for %s', (_label, value) => {
    expect(toIso(value)).toBeUndefined();
    expect(toMillis(value)).toBeUndefined();
  });
});

describe('withIsoDates', () => {
  it('converts the named fields and leaves the rest alone', () => {
    const input = {
      id: 'a',
      createdAt: new Timestamp(SECONDS, 0),
      updatedAt: { seconds: SECONDS, nanoseconds: 0 },
      orderedDate: '2026-01-01',
    };
    expect(withIsoDates(input, ['createdAt', 'updatedAt'])).toEqual({
      id: 'a',
      createdAt: ISO,
      updatedAt: ISO,
      orderedDate: '2026-01-01',
    });
  });

  it('does not add missing fields or change its input', () => {
    const input = { id: 'a', createdAt: { seconds: SECONDS } };
    const out = withIsoDates(input, ['createdAt', 'updatedAt']);
    expect(out).not.toHaveProperty('updatedAt');
    expect(input.createdAt).toEqual({ seconds: SECONDS });
  });

  it('sets a field that is not a date to undefined', () => {
    expect(withIsoDates({ createdAt: null }, ['createdAt'])).toEqual({ createdAt: undefined });
  });
});
