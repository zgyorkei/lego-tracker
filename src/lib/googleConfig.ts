import { ENV_NAMES, readEnv } from '../../lib/envSettings';
import { isDesktopApp } from './platform';

// The website's own Google sign-in, for reading the desktop's copy through
// Google Drive (local-storage plan, Phase 6): the Web client id from
// ENV_NAMES.googleClientId, or null. Never in the desktop build: the desktop's
// Google session lives in its main process, and package.mjs refuses a desktop
// web build that carries a client id. The ternary keeps the variable out of
// that build altogether (the minifier drops the branch it never takes).
const DESKTOP_BUILD = import.meta.env.MODE === 'desktop';
const CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

function resolveGoogleClientId(): string | null {
  const id = DESKTOP_BUILD ? undefined : readEnv(import.meta.env, ENV_NAMES.googleClientId);
  if (isDesktopApp || !id) return null;
  return CLIENT_ID_RE.test(id) ? id : null;
}

/** The Google Web client id this website signs in with, or null when it has none. */
export const googleClientId = resolveGoogleClientId();
