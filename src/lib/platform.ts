import type { DesktopAppConfig } from '../../lib/appConfig';

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
    };
  }
}

export const isDesktopApp: boolean =
  typeof window !== 'undefined' && window.legoTrackerDesktop?.isDesktop === true;

/** The desktop app's settings, or null on the website. */
export const desktopConfig: DesktopAppConfig | null =
  (isDesktopApp && window.legoTrackerDesktop?.config) || null;
