import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getDb, getFirebaseAuth } from '../lib/firebase';
import type { AuthUser, SessionProvider } from './types';

/** The app's view of a Firebase user. */
export function toAuthUser(user: User | null): AuthUser | null {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    // For the Google provider, providerData's uid is the Google account id.
    googleSub: user.providerData.find((p) => p.providerId === 'google.com')?.uid ?? null,
  };
}

/** Sign-in through Firebase Authentication with Google. */
export const firebaseSession: SessionProvider & {
  /** Desktop: signs in with a Google ID token the desktop already has (its Drive session). */
  signInWithIdToken(idToken: string): Promise<void>;
} = {
  subscribe: (listener) => onAuthStateChanged(getFirebaseAuth(), (u) => listener(toAuthUser(u))),

  signInWithIdToken: async (idToken) => {
    await signInWithCredential(getFirebaseAuth(), GoogleAuthProvider.credential(idToken));
  },

  // Google blocks its sign-in page inside embedded browsers, so the desktop app
  // runs the OAuth flow in the system browser and hands back an ID token, which
  // is exchanged for a Firebase session here. The web keeps the popup.
  signIn: async () => {
    const auth = getFirebaseAuth();
    const desktop = window.legoTrackerDesktop;
    if (desktop) {
      const idToken = await desktop.signInWithGoogle();
      await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
      return;
    }
    await signInWithPopup(auth, new GoogleAuthProvider());
  },

  // Clear the local set cache on the way out. 'cachedSets' holds the signed-in
  // user's real sets (including what they paid), and Demo Mode on the login
  // screen seeds itself from that same key -- so without this, the next person
  // to use this browser profile sees the previous user's collection pre-login.
  signOut: async () => {
    try {
      localStorage.removeItem('cachedSets');
    } catch {
      // Storage can be unavailable (private mode, blocked cookies); sign out anyway.
    }
    await getFirebaseAuth().signOut();
  },

  // The rules (access/allowlist in firestore.rules) are what keep a refused
  // account out of the data; this only lets the app say so instead of showing
  // permission errors. It reads the user's own settings doc, which every
  // allowed account may read (missing or not), so it needs no rule of its own.
  // Anything but a refusal (offline, say) counts as allowed: the rules still
  // decide.
  hasAccess: async (user) => {
    try {
      await getDoc(doc(getDb(), 'userSettings', user.uid));
      return true;
    } catch (err) {
      return (err as { code?: string } | null)?.code !== 'permission-denied';
    }
  },
};
