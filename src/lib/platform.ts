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
    };
  }
}

export const isDesktopApp: boolean =
  typeof window !== 'undefined' && window.legoTrackerDesktop?.isDesktop === true;
