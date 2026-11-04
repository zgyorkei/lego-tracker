// Ids for documents created away from Firestore (the desktop app's local
// store), in Firestore's own auto-id format, so a set created on this PC keeps
// its id when it is uploaded (setDoc with that id) and the rules' id check
// (isValidId in firestore.rules) accepts it.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const AUTO_ID_LENGTH = 20;
// The largest multiple of 62 below 256: bytes from it up are drawn again, so
// every character is equally likely (the same rejection Firestore uses).
const MAX_MULTIPLE = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

type RandomBytes = (n: number) => Uint8Array;
const cryptoBytes: RandomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** A new 20-character id like Firestore's addDoc makes. */
export function newAutoId(randomBytes: RandomBytes = cryptoBytes): string {
  let id = '';
  while (id.length < AUTO_ID_LENGTH) {
    for (const b of randomBytes(40)) {
      if (b < MAX_MULTIPLE && id.length < AUTO_ID_LENGTH) id += ALPHABET[b % ALPHABET.length];
    }
  }
  return id;
}

/** Firestore's auto-id shape. */
export const isAutoId = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9]{20}$/.test(id);

/**
 * A document id the rules accept (isValidId in firestore.rules) and that is
 * safe as a file name: letters, digits, '_' and '-', at most 128.
 */
export const isValidDocId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[A-Za-z0-9_-]+$/.test(id);
