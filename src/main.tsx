import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import RegistryView from './RegistryView.tsx';
import './index.css';

const path = window.location.pathname;
let Content = <App />;

if (path.startsWith('/registry/')) {
  const registryId = path.split('/')[2];
  Content = <RegistryView registryId={registryId} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {Content}
  </StrictMode>,
);
