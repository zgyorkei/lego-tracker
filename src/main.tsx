import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

// The two entry points are mutually exclusive, so neither needs to be in the
// other's bundle: a signed-in user never renders RegistryView, and a gift
// recipient opening a share link never renders the full App.
const App = lazy(() => import('./App.tsx'));
const RegistryView = lazy(() => import('./RegistryView.tsx'));

const path = window.location.pathname;
const registryMatch = path.match(/^\/registry\/([^/]+)/);

const Content = registryMatch ? (
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
