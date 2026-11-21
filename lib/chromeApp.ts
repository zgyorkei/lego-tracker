// Brick Tracker as a Chrome app: the install step. The site on Vercel is the PWA; this
// opens it in its own window through the shared launcher (pwa-kit/browser, CHROME.KIT):
// Chrome first, Edge when Chrome is absent, one window per installed app. Sign-in
// (Firebase, the browser flow) and offline reading are the site's own and not touched.

export const DEFAULT_APP_URL = 'https://lego.gykovacszoltan.hu';

/** The part of pwa-kit/browser's openApp this step uses. */
export type OpenApp = (options: {
  url?: string;
  appId?: string;
  width?: number;
  height?: number;
}) => unknown;

export interface ChromeAppOptions {
  /** The installed app's id (chrome://apps, or the app's details page); opens that app, one window. */
  appId?: string;
  /** The site's address when no app id is given: --app=<url>, the install itself is Chrome's menu. */
  url?: string;
}

/** The launch options: the installed app's id when known, else the site's address. */
export function chromeAppLaunch(o: ChromeAppOptions = {}) {
  const appId = o.appId?.trim();
  const base = { width: 1280, height: 860 };
  if (appId) {
    if (!/^[a-p]{32}$/.test(appId))
      throw new Error('Brick Tracker: an app id is 32 letters a to p');
    return { ...base, appId };
  }
  const url = (o.url?.trim() || DEFAULT_APP_URL).replace(/\/+$/, '');
  if (!/^https:\/\//i.test(url)) throw new Error('Brick Tracker: the site address must be https');
  return { ...base, url };
}

/** Opens Brick Tracker's window. */
export function openBrickTracker(openApp: OpenApp, o: ChromeAppOptions = {}): void {
  openApp(chromeAppLaunch(o));
}
