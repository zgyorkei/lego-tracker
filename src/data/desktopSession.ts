import { readStoredJson, writeStored } from '../lib/storage';
import { firebaseSession } from './firebaseSession';
import type { AuthUser, SessionProvider } from './types';

// The desktop app's session. Sign-in is still Firebase's (the system-browser
// flow in firebaseSession), and Firebase restores the session on its own, so
// upgrading to the local-first app needs no new sign-in: the Google account id
// (googleSub) that names the copy on this PC comes from the restored user.
//
// The last signed-in account is remembered here as well, so the copy on this
// PC still opens when Firebase itself cannot start. Signing out forgets it.

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
  } catch {
    // Storage unavailable: nothing was remembered either.
  }
};

export const desktopSession: SessionProvider = {
  subscribe(listener) {
    try {
      return firebaseSession.subscribe((user) => {
        if (user) remember(user);
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
  signIn: () => firebaseSession.signIn(),
  signOut: async () => {
    forget();
    await firebaseSession.signOut();
  },
  hasAccess: (user) => firebaseSession.hasAccess(user),
};
