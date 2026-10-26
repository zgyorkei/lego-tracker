import { isDesktopApp } from './platform';

/**
 * Registers the service worker (public/sw.js) that makes the website
 * installable on Android, ChromeOS and Googlebooks.
 *
 * Production builds only: under the Vite dev server a service worker would
 * cache the dev bundles. Never in the desktop app, which serves the same build
 * from its own loopback server and has no use for an install prompt.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || isDesktopApp || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed; the site still works, but cannot be installed', err);
    });
  });
}
