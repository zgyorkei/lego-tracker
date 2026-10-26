import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { firebaseConfig } from './lib/firebaseConfig.ts';
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

// A copy built without a Firebase project would otherwise fail somewhere
// inside the SDK with a blank page; say what is missing instead.
const NotConfigured = (
  <div className="min-h-screen flex items-center justify-center p-6">
    <div className="max-w-lg border-2 border-black bg-white p-6 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
      <h1 className="text-xl font-black mb-3">Brick Tracker is not set up yet</h1>
      <p className="mb-3">
        This copy has no Firebase project to keep your sets in. Set the <code>VITE_FIREBASE_*</code> variables
        for the build (or add <code>firebase-applet-config.json</code>) and build it again.
      </p>
      <a className="underline font-bold" href="https://zgyorkei.github.io/lego-tracker/#setup-firebase">
        Setup guide
      </a>
    </div>
  </div>
);

const Content = !firebaseConfig ? (
  NotConfigured
) : registryMatch ? (
  <RegistryView registryId={registryMatch[1]} />
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
  </StrictMode>,
);
