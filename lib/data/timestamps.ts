// Dates in this app are ISO strings, but Firestore hands back a Timestamp
// object for every field written with serverTimestamp(), and a Timestamp that
// went through JSON (the localStorage cachedSets copy) comes back as a plain
// { seconds, nanoseconds } object. new Date() makes NaN of both, which silently
// broke every date sort. Reads normalise through here.
//
// Pure on purpose (no firebase import), so the server and the desktop app can
// use it too.

// The largest time a Date can hold; toISOString() throws beyond it.
const MAX_DATE_MS = 8.64e15;

function readNumber(o: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number') return v;
  }
  return undefined;
}

/** Milliseconds since the epoch, or undefined when the value is missing or not a date. */
export function toMillis(value: unknown): number | undefined {
  let ms: number | undefined;
  if (typeof value === 'number') {
    ms = value;
  } else if (typeof value === 'string') {
    ms = value.trim() ? Date.parse(value) : undefined;
  } else if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    // A Firestore Timestamp, its JSON form, or the Admin/REST form (_seconds).
    const seconds = readNumber(o, 'seconds', '_seconds');
    if (seconds !== undefined) {
      const nanos = readNumber(o, 'nanoseconds', '_nanoseconds') ?? 0;
      ms = seconds * 1000 + Math.floor(nanos / 1e6);
    } else if (typeof o.toDate === 'function') {
      const d: unknown = (o.toDate as () => unknown).call(value);
      ms = d instanceof Date ? d.getTime() : undefined;
    }
  }
  return ms !== undefined && Number.isFinite(ms) && Math.abs(ms) <= MAX_DATE_MS ? ms : undefined;
}

/** An ISO string, or undefined when the value is missing or not a date. */
export function toIso(value: unknown): string | undefined {
  const ms = toMillis(value);
  return ms === undefined ? undefined : new Date(ms).toISOString();
}

/**
 * A copy of obj with the named fields as ISO strings (undefined when a field is
 * not a date). Fields obj does not have are not added; the rest are untouched.
 */
export function withIsoDates<T extends object>(obj: T, fields: readonly string[]): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const f of fields) {
    if (f in out) out[f] = toIso(out[f]);
  }
  return out as T;
}
