import { describe, expect, it } from 'vitest';
import { AUTO_ID_LENGTH, isAutoId, isValidDocId, newAutoId } from './ids';

describe('newAutoId', () => {
  it("makes 20-character ids in Firestore's alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const id = newAutoId();
      expect(id).toHaveLength(AUTO_ID_LENGTH);
      expect(isAutoId(id)).toBe(true);
      expect(isValidDocId(id)).toBe(true);
    }
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newAutoId()));
    expect(ids.size).toBe(1000);
  });

  it('draws again for bytes that would bias the alphabet', () => {
    // 248..255 are rejected; 0 maps to 'A', 61 to '9'.
    let call = 0;
    const bytes = (n: number) => {
      call++;
      return Uint8Array.from({ length: n }, (_, i) => (call === 1 && i % 2 === 0 ? 250 : 61));
    };
    expect(newAutoId(bytes)).toBe('9'.repeat(20));
  });
});

describe('isValidDocId', () => {
  it.each(['abc', 'A-b_9', 'x'.repeat(128)])('accepts %j', (id) => {
    expect(isValidDocId(id)).toBe(true);
  });
  it.each(['', '../x', 'a/b', 'a.b', 'x'.repeat(129), 'café', null, 5])('refuses %j', (id) => {
    expect(isValidDocId(id)).toBe(false);
  });
});
