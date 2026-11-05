import { firebaseMissing, usesFirebase, type DesktopAppConfig } from '../../lib/appConfig';
import type { DesktopStoreBridge } from '../../lib/data/storeBridge';

// The desktop (Electron) build exposes a bridge object on window from its
// preload script. Its presence is the single switch between the two runtimes:
// the desktop app scrapes with a local browser and refreshes automatically,
// while the web app uses the Gemini-backed routes and refreshes on request.
//
// The bridge is defined in desktop/src/preload.ts.
declare global {
  interface Window {
    legoTrackerDesktop?: {
      isDesktop: true;
      /** Google sign-in in the system browser; resolves with a Google ID token. */
      signInWithGoogle(): Promise<string>;
      /**
       * The Firebase project and website address entered in the desktop app's
       * setup (lib/appConfig.ts). Desktop builds carry no config of their own.
       */
      config: DesktopAppConfig;
      /** The account's copy on this PC (lib/data/storeBridge.ts). Absent in builds before it. */
      store?: DesktopStoreBridge;
      /** The tray icon's tooltip line. Absent in builds before it. */
      setTrayStatus?(text: string): void;
      /** Opens the settings window; saving restarts the app. Absent in builds before it. */
      openSettings?(): Promise<void>;
    };
  }
}

export const isDesktopApp: boolean =
  typeof window !== 'undefined' && window.legoTrackerDesktop?.isDesktop === true;

/** The desktop app's settings, or null on the website. */
export const desktopConfig: DesktopAppConfig | null =
  (isDesktopApp && window.legoTrackerDesktop?.config) || null;

/**
 * The desktop app's storage as it runs: 'both' syncs with Firebase, 'local'
 * keeps the sets on this PC only (also when 'both' is chosen but no project
 * is saved, which `desktopFirebaseMissing` reports). Null on the website.
 */
export const desktopMode: 'local' | 'both' | null = desktopConfig
  ? usesFirebase(desktopConfig)
    ? 'both'
    : 'local'
  : null;

export const desktopFirebaseMissing: boolean = firebaseMissing(desktopConfig);

/** Desktop app: opens its settings window (no-op on the website). */
export const openDesktopSettings = (): void =>
  void window.legoTrackerDesktop?.openSettings?.().catch((err: unknown) => {
    console.error('Could not open the settings', err);
  });
