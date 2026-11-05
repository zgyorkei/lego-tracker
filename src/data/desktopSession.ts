import { firebaseAvailable } from '../lib/firebase';
import { readStoredJson, writeStored } from '../lib/storage';
import { isGoogleSub } from '../../lib/data/storeBridge';
import { firebaseSession } from './firebaseSession';
import type { AuthUser, SessionProvider } from './types';

// The desktop app's session.
//
// Firebase + a copy on this PC: sign-in is Firebase's (the system-browser
// flow in firebaseSession), and Firebase restores the session on its own, so
// upgrading to the local-first app needs no new sign-in: the Google account id
// (googleSub) that names the copy on this PC comes from the restored user.
//
// On this PC only: no Firebase. The same system-browser Google sign-in runs
// (desktop/src/oauth.ts); its ID token, which the main process got straight
// from Google, says who signed in, and the account is remembered here. Its
// Google account id is both the uid and the folder of the copy.
//
// The last signed-in account is remembered in both, so the copy on this PC
// also opens when Firebase itself cannot start, and switching from Firebase to
// this PC only needs no new sign-in. Signing out forgets it.

const LAST_USER_KEY = 'desktopLastUser';

const isAuthUser = (v: unknown): v is AuthUser =>
  !!v &&
  typeof (v as AuthUser).uid === 'string' &&
  ((v as AuthUser).googleSub === null || typeof (v as AuthUser).googleSub === 'string');

export function rememberedUser(): AuthUser | null {
  const v = readStoredJson<unknown>(LAST_USER_KEY, null);
  return isAuthUser(v) ? v : null;
}

const remember = (user: AuthUser) => writeStored(LAST_USER_KEY, user);
const forget = () => {
  try {
    localStorage.removeItem(LAST_USER_KEY);
    // Same as firebaseSession.signOut: Demo Mode seeds itself from this key.
    localStorage.removeItem('cachedSets');
  } catch {
    // Storage unavailable: nothing was remembered either.
  }
};

/** Who a Google ID token is for. Not verified: it came from Google to the main process directly. */
export function userFromIdToken(idToken: string): AuthUser {
  let claims: { sub?: unknown; email?: unknown; name?: unknown };
  try {
    const payload = idToken.split('.')[1] ?? '';
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0))));
  } catch {
    throw new Error('Sign-in failed: Google sent an unreadable answer');
  }
  if (!isGoogleSub(claims.sub)) throw new Error('Sign-in failed: Google sent no account id');
  return {
    uid: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    displayName: typeof claims.name === 'string' ? claims.name : null,
    googleSub: claims.sub,
  };
}

// On this PC only, the session lives here, so its listeners do too.
const localListeners = new Set<(user: AuthUser | null) => void>();
const tellLocal = (user: AuthUser | null) => {
  for (const l of [...localListeners]) l(user);
};

export const desktopSession: SessionProvider = {
  subscribe(listener) {
    if (!firebaseAvailable) {
      localListeners.add(listener);
      listener(rememberedUser());
      return () => {
        localListeners.delete(listener);
      };
    }
    try {
      let triedGoogle = false;
      return firebaseSession.subscribe((user) => {
        if (user) remember(user);
        // No Firebase session, but the desktop holds a Google one (Drive):
        // sign in to Firebase with a fresh ID token, once, instead of asking.
        const desktop = typeof window !== 'undefined' ? window.legoTrackerDesktop : undefined;
        if (!user && !triedGoogle && desktop?.googleIdToken) {
          triedGoogle = true;
          void desktop
            .googleIdToken()
            .then((idToken) => (idToken ? firebaseSession.signInWithIdToken(idToken) : undefined))
            .catch((err: unknown) =>
              console.warn('Signing in again from the Drive session failed', err)
            );
        }
        listener(user);
      });
    } catch (err) {
      // Firebase cannot start at all (no usable project): carry on with the
      // account last signed in on this PC, so its copy still opens.
      console.error('Firebase could not start; using the copy on this PC', err);
      listener(rememberedUser());
      return () => {};
    }
  },
  signIn: async () => {
    if (firebaseAvailable) return firebaseSession.signIn();
    const desktop = window.legoTrackerDesktop;
    if (!desktop) throw new Error('Sign-in is only available in the desktop app');
    const user = userFromIdToken(await desktop.signInWithGoogle());
    remember(user);
    tellLocal(user);
  },
  signOut: async () => {
    forget();
    // The desktop's Google session (Drive) goes too; it is not revoked.
    const desktop = typeof window !== 'undefined' ? window.legoTrackerDesktop : undefined;
    await desktop?.googleSignedOut?.().catch(() => {});
    if (firebaseAvailable) await firebaseSession.signOut();
    else tellLocal(null);
  },
  // The allowlist lives in Firestore's rules; on this PC only there is none.
  hasAccess: (user) =>
    firebaseAvailable ? firebaseSession.hasAccess(user) : Promise.resolve(true),
};
