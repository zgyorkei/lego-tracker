// npm run app: opens Brick Tracker in its own Chrome window (Edge when Chrome is absent).
// BRICK_TRACKER_APP_ID: the installed app's id; BRICK_TRACKER_URL: the site's address.
// Needs pwa-kit with the browser subpath (CHROME.KIT).
import { openBrickTracker } from '../lib/chromeApp';

const { openApp } = await import('pwa-kit/browser');
openBrickTracker(openApp, {
  appId: process.env.BRICK_TRACKER_APP_ID,
  url: process.env.BRICK_TRACKER_URL,
});
