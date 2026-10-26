import type { FirebaseWebConfig } from '../../lib/appConfig';
import { desktopConfig } from './platform';

// Built with `vite build --mode desktop` (npm run build:desktop): the desktop
// installer carries no Firebase project of its own, so it can be handed to
// anybody; each install gets its project from the setup it runs on first
// start, through the preload bridge.
const DESKTOP_BUILD = import.meta.env.MODE === 'desktop';

/**
 * Which Firebase project this copy of the app talks to, or null when none is
 * configured (main.tsx then shows how to set one up instead of the app).
 *
 * Desktop app: its own setup (%APPDATA%\Brick Tracker\app-config.json).
 * Website: VITE_FIREBASE_* at build time, else the gitignored
 * firebase-applet-config.json. Nothing falls back to anybody else's project.
 */
function resolveFirebaseConfig(): FirebaseWebConfig | null {
  if (desktopConfig) return desktopConfig.firebase;
  if (DESKTOP_BUILD) return null;

  if (import.meta.env.VITE_FIREBASE_API_KEY) {
    return {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID || '(default)',
    };
  }

  // A glob rather than an import, so a build without the file still compiles.
  const files = import.meta.glob<{ default: FirebaseWebConfig }>('../../firebase-applet-config.json', { eager: true });
  const file = files['../../firebase-applet-config.json']?.default;
  if (file?.apiKey && file.projectId) return { ...file, firestoreDatabaseId: file.firestoreDatabaseId || '(default)' };

  return null;
}

export const firebaseConfig = resolveFirebaseConfig();
