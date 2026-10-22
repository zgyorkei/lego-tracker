// localStorage throws in private-browsing / storage-blocked contexts, and
// JSON.parse throws on a corrupt value. These were previously called bare
// inside useState initializers, so a single bad entry threw during the first
// render and pinned the app on the ErrorBoundary screen with no way back.
export const readStoredString = (key: string, fallback: string): string => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch (e) {
    console.warn(`Could not read ${key} from localStorage`, e);
    return fallback;
  }
};

export const readStoredJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`Could not parse ${key} from localStorage`, e);
    return fallback;
  }
};

export const writeStored = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch (e) {
    // Quota exceeded or storage unavailable; persistence is best-effort.
    console.warn(`Could not persist ${key} to localStorage`, e);
  }
};
