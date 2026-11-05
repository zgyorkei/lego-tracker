import { onLog } from 'firebase/app';

// Firestore (12.12) reports a database that does not exist only as a logged
// warning, "Database '<id>' not found. Please check your project
// configuration.", and keeps retrying: listeners and writes never get an
// error, so the app would just look offline (a cached, empty snapshot). This
// turns that warning into something the app can show.
//
// onLog sets Firebase's one user log handler, and only on the SDK loggers
// that exist when it is called, so it is installed once, on first use (by
// then the Firestore module has loaded), and shared by every caller.

const MISSING_DATABASE = /Database '([^']*)' not found/;

/** The database id a Firestore log message says does not exist, or null. */
export function missingDatabaseIn(message: string): string | null {
  const m = MISSING_DATABASE.exec(message);
  return m ? m[1] : null;
}

type Listener = (databaseId: string, message: string) => void;
const listeners = new Set<Listener>();
let installed = false;

/** Calls back each time Firestore logs that its database does not exist. Returns the unsubscribe. */
export function onMissingDatabase(listener: Listener): () => void {
  listeners.add(listener);
  if (!installed) {
    installed = true;
    onLog(
      ({ message }) => {
        const id = missingDatabaseIn(message);
        if (id === null) return;
        for (const l of [...listeners]) l(id, message);
      },
      { level: 'warn' }
    );
  }
  return () => {
    listeners.delete(listener);
  };
}
