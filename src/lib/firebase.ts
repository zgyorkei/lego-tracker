import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';

// The Firebase app starts on first use, not at import, so a copy without a
// project (main.tsx then shows the setup instructions, and later the desktop
// app's "On this PC only" mode) can still load modules that import this one.

/** Whether this copy has a Firebase project at all. */
export const firebaseAvailable = firebaseConfig !== null;

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

function firebaseApp(): FirebaseApp {
  if (!firebaseConfig)
    throw new Error('No Firebase project is configured (see src/lib/firebaseConfig.ts).');
  return (app ??= initializeApp(firebaseConfig));
}

/** The project's Firestore database (the named one when configured). */
export function getDb(): Firestore {
  return (db ??= getFirestore(firebaseApp(), firebaseConfig!.firestoreDatabaseId));
}

export function getFirebaseAuth(): Auth {
  return (auth ??= getAuth(firebaseApp()));
}
