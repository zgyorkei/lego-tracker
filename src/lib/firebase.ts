import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithCredential, signInWithPopup } from 'firebase/auth';
import './platform';
import { getFirestore } from 'firebase/firestore';

// In our AI Studio environment, we load from a generated JSON config.
// In Vercel/production, we load from environment variables so secrets aren't exposed in standard Git repositories.
const getFirebaseConfig = () => {
    // If we're deployed on Vercel, use the VITE_ prefixed environment variables you set
    if (import.meta.env.VITE_FIREBASE_API_KEY) {
        return {
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
            authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
            appId: import.meta.env.VITE_FIREBASE_APP_ID,
            firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID || '(default)'
        };
    }
    
    // Otherwise fallback to the local json file (used in AI Studio preview)
    // We import it this way so Vite doesn't crash if the file is missing during build in Vercel
    const jsonProviders = import.meta.glob('../../firebase-applet-config.json', { eager: true });
    const configPath = '../../firebase-applet-config.json';
    if (jsonProviders[configPath]) {
        return (jsonProviders[configPath] as any).default;
    }
    
    console.error("No Firebase config found. Please set VITE_FIREBASE_* environment variables.");
    return {};
};

const firebaseConfig: any = getFirebaseConfig();

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');
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
