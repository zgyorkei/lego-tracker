import { readStoredString, writeStored } from './storage';

// Where this page's sets come from (local-storage plan, Phase 6):
//   local      the desktop app's own copy on this PC
//   firestore  Firebase, as the website always worked
//   drive      the desktop's copy through the account's Google Drive (no Firebase needed)
// A website with both Firebase and a Google client id follows a per-device
// preference: Auto (Firebase, and the desktop's copy when Firebase fails),
// Firebase, or the desktop's copy. Pure, so the rules are tested.

export type DataSource = 'local' | 'firestore' | 'drive';
export type SourcePreference = 'auto' | 'firebase' | 'desktop';

export interface SourceInputs {
  /** Running inside the desktop app. */
  desktopApp: boolean;
  /** This copy has a Firebase project. */
  firebase: boolean;
  /** This website has a Google client id (it can read the desktop's copy through Drive). */
  google: boolean;
  preference: SourcePreference;
  /** Firestore failed with a problem (not just offline), and the user has not switched back since. */
  firestoreFailed: boolean;
  /** Signed in to the website's Google session (Drive). */
  driveSignedIn: boolean;
}

export interface SourceChoice {
  source: DataSource;
  /** Auto moved to the desktop's copy because Firebase failed: say so, and offer "Switch back". */
  switched: boolean;
  /** Firebase failed and the desktop's copy is one Google sign-in away (the popup needs the user's click). */
  offerDesktop: boolean;
}

export function chooseDataSource(i: SourceInputs): SourceChoice {
  const choice = (source: DataSource, switched = false, offerDesktop = false): SourceChoice => ({
    source,
    switched,
    offerDesktop,
  });
  if (i.desktopApp) return choice('local');
  if (!i.google) return choice('firestore');
  if (!i.firebase) return choice('drive');
  if (i.preference === 'firebase') return choice('firestore');
  if (i.preference === 'desktop') return choice('drive');
  if (!i.firestoreFailed) return choice('firestore');
  return i.driveSignedIn ? choice('drive', true) : choice('firestore', false, true);
}

/** Whether this page lets the user choose (a website with both Firebase and a Google client id). */
export const canChooseSource = (i: Pick<SourceInputs, 'desktopApp' | 'firebase' | 'google'>) =>
  !i.desktopApp && i.firebase && i.google;

const PREFERENCE_KEY = 'brickTrackerDataSource';
const PREFERENCES: SourcePreference[] = ['auto', 'firebase', 'desktop'];

/** This device's preference (Auto when none is stored). */
export function readSourcePreference(): SourcePreference {
  const stored = readStoredString(PREFERENCE_KEY, 'auto') as SourcePreference;
  return PREFERENCES.includes(stored) ? stored : 'auto';
}

export function writeSourcePreference(preference: SourcePreference): void {
  writeStored(PREFERENCE_KEY, preference);
}

/** How often a failed Firestore is tried again while the desktop's copy is shown. */
export const FIRESTORE_PROBE_MS = 5 * 60 * 1000;
