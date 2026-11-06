import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { firebaseConfig } from './lib/firebaseConfig.ts';
import { googleClientId } from './lib/googleConfig.ts';
import { isDesktopApp } from './lib/platform.ts';
import { registerServiceWorker } from './lib/pwa.ts';
import './index.css';

registerServiceWorker();

// The two entry points are mutually exclusive, so neither needs to be in the
// other's bundle: a signed-in user never renders RegistryView, and a gift
// recipient opening a share link never renders the full App.
const App = lazy(() => import('./App.tsx'));
const RegistryView = lazy(() => import('./RegistryView.tsx'));

const path = window.location.pathname;
const registryMatch = path.match(/^\/registry\/([^/]+)/);

// A copy built with nowhere to keep sets would otherwise fail somewhere
// inside the SDK with a blank page; say what is missing instead.
const NotConfigured = (
  <div className="min-h-screen flex items-center justify-center p-6">
    <div className="max-w-lg border-2 border-black bg-white p-6 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
      <h1 className="text-xl font-black mb-3">Brick Tracker is not set up yet</h1>
      <p className="mb-3">This website needs one of two things, set for the build:</p>
      <ul className="list-disc pl-5 mb-3 space-y-2">
        <li>
          A Firebase project to keep your sets in: the <code>VITE_FIREBASE_*</code> variables (or{' '}
          <code>firebase-applet-config.json</code>).
        </li>
        <li>
          Or your desktop app&apos;s copy, read through your Google Drive:{' '}
          <code>VITE_GOOGLE_CLIENT_ID</code> for the build, and <code>GOOGLE_CLIENT_SECRET</code>{' '}
          and <code>SESSION_SECRET</code> on the server.
        </li>
      </ul>
      <p className="mb-3">Set them and build it again.</p>
      <a className="underline font-bold" href="https://zgyorkei.github.io/lego-tracker/#setup-plan">
        Setup guide
      </a>
    </div>
  </div>
);

// Registries are read from Firestore; without Firebase there are none.
const NoRegistries = (
  <div className="min-h-screen flex items-center justify-center p-6">
    <div className="max-w-lg border-2 border-black bg-white p-6 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
      <h1 className="text-xl font-black mb-3">Gift registries need Firebase</h1>
      <p>
        {isDesktopApp
          ? 'This Brick Tracker keeps its sets on this PC only, so it has no registries to show.'
          : 'A registry is kept in Firebase, and this Brick Tracker has no Firebase project, so this link has nothing to show.'}
      </p>
    </div>
  </div>
);

// The desktop app runs without Firebase "On this PC only"; a website needs
// Firebase, or a Google client id to read the desktop's copy through Drive.
const configured = Boolean(firebaseConfig) || Boolean(googleClientId) || isDesktopApp;
const Content = !configured ? (
  NotConfigured
) : registryMatch ? (
  firebaseConfig || registryMatch[1] === 'demo' ? (
    <RegistryView registryId={registryMatch[1]} />
  ) : (
    NoRegistries
  )
) : (
  <App />
);

const Fallback = (
  <div className="min-h-screen flex items-center justify-center">
    <div className="w-10 h-10 border-4 border-black border-t-transparent rounded-full animate-spin" />
  </div>
);

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={Fallback}>{Content}</Suspense>
    </ErrorBoundary>
  </StrictMode>
);
