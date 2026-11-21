import { registerServiceWorker as register, shouldRegister } from 'pwa-kit/update';
import { isDesktopApp } from './platform';

/**
 * Registers the service worker (built from src/sw.ts by pwa-kit's Vite plugin
 * as /sw.js) that makes the website installable on Android, ChromeOS and
 * Googlebooks.
 *
 * Production builds only: under the Vite dev server a service worker would
 * cache the dev bundles. Never in the desktop app, which serves the same build
 * from its own loopback server and has no use for an install prompt.
 */
export function registerServiceWorker(): void {
  if (
    !shouldRegister({
      prod: import.meta.env.PROD,
      mode: import.meta.env.MODE,
      supported: 'serviceWorker' in navigator,
      desktopWindow: isDesktopApp,
    })
  ) {
    return;
  }
  window.addEventListener('load', () => {
    register(navigator.serviceWorker).catch((err) => {
      console.warn(
        'Service worker registration failed; the site still works, but cannot be installed',
        err
      );
    });
  });
}
