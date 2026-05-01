import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// In our AI Studio environment, we load from a generated JSON config.
// In Vercel/production, we load from environment variables so secrets aren't exposed in standard Git repositories.
let firebaseConfig: any;

try {
  // We use a dynamic require pattern or just vite's built in optional loading if possible.
  // Wait, let's use import.meta.env primarily, and fallback.
} catch (e) {}

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

firebaseConfig = getFirebaseConfig();

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);
export const signOut = () => auth.signOut();
