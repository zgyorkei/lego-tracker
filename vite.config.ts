import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {existsSync} from 'fs';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

/**
 * Stops a website build that has no Firebase project: it would deploy fine
 * and then fail for every visitor. Desktop builds (`--mode desktop`) carry no
 * project on purpose; the desktop app's setup supplies one at run time (see
 * src/lib/firebaseConfig.ts). CI only checks that the code builds, so it sets
 * ALLOW_MISSING_FIREBASE_CONFIG=1.
 */
function checkFirebaseConfig(mode: string) {
  if (mode === 'desktop') return;
  const env = loadEnv(mode, __dirname, 'VITE_');
  if (env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID) return;
  if (existsSync(path.join(__dirname, 'firebase-applet-config.json'))) return;
  const message =
    'No Firebase project configured: set the VITE_FIREBASE_* variables (see .env.example) ' +
    'or add firebase-applet-config.json. For the desktop app, run npm run build:desktop instead.';
  if (process.env.ALLOW_MISSING_FIREBASE_CONFIG === '1') {
    console.warn(`warning: ${message}`);
    return;
  }
  throw new Error(message);
}

export default defineConfig(({command, mode}) => {
  if (command === 'build') checkFirebaseConfig(mode);
  // NOTE: GEMINI_API_KEY is intentionally NOT exposed to the client bundle.
  // It is a billable secret and must only be used server-side (see server.ts / api/index.ts).
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // The app previously shipped as one ~878 kB chunk. These are the
          // heavyweight, rarely-changing dependencies, so splitting them out
          // lets the browser cache them across app deploys.
          manualChunks: {
            firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
            charts: ['recharts'],
            motion: ['motion/react'],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
