import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
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
