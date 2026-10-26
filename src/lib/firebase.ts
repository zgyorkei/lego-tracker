import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithCredential, signInWithPopup } from 'firebase/auth';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';

// main.tsx shows the setup instructions instead of the app when no project is
// configured, so this only runs once there is one.
if (!firebaseConfig) throw new Error('No Firebase project is configured (see src/lib/firebaseConfig.ts).');

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Google blocks its sign-in page inside embedded browsers, so the desktop app
// runs the OAuth flow in the system browser and hands back an ID token, which
// is exchanged for a Firebase session here. The web keeps the popup.
export const signInWithGoogle = async () => {
  const desktop = window.legoTrackerDesktop;
  if (desktop) {
    const idToken = await desktop.signInWithGoogle();
    return signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  }
  return signInWithPopup(auth, googleProvider);
};

/**
 * False when this copy is limited to certain accounts (access/allowlist in
 * firestore.rules) and this one is not among them. The rules are what keep
 * such an account out of the data; this only lets the app say so instead of
 * showing permission errors. It reads the user's own settings doc, which
 * every allowed account may read (missing or not), so it needs no rule of its
 * own. Anything but a refusal (offline, say) counts as allowed: the rules
 * still decide.
 */
export const hasAccess = async (uid: string): Promise<boolean> => {
  try {
    await getDoc(doc(db, 'userSettings', uid));
    return true;
  } catch (err) {
    return (err as { code?: string } | null)?.code !== 'permission-denied';
  }
};

// Clear the local set cache on the way out. 'cachedSets' holds the signed-in
// user's real sets (including what they paid), and Demo Mode on the login
// screen seeds itself from that same key -- so without this, the next person
// to use this browser profile sees the previous user's collection pre-login.
export const signOut = async () => {
  try {
    localStorage.removeItem('cachedSets');
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); sign out anyway.
  }
  await auth.signOut();
};
