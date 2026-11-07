/**
 * The website's Google settings and the environment variable names each is
 * read from; the first name that is set wins. The last name of each list is
 * the documented one (.env.example); the others are for hosts where those
 * names could not be used. The page and the server share these lists, so they
 * always pick the same client id.
 */
export const ENV_NAMES = {
  googleClientId: ['NEW_GOOGLE_CLIENT_CONFIG', 'VITE_GOOGLE_CLIENT_ID'],
  googleClientSecret: ['GOOGLE_CLIENT_CONFIG_2', 'GOOGLE_CLIENT_CONFIG', 'GOOGLE_CLIENT_SECRET'],
  sessionSecret: ['SESSION_CONFIG_2', 'SESSION_CONFIG', 'SESSION_SECRET'],
} as const;

/**
 * Vite's envPrefix: every variable starting with one of these is copied into
 * the public page, so it may only match the client id's names. The secrets'
 * names must never start with one (envSettings.test.ts checks).
 */
export const CLIENT_ENV_PREFIXES = ['VITE_', 'NEW_GOOGLE_CLIENT_CONFIG'];

/** The first non-blank value among `names`, trimmed, or undefined. */
export function readEnv(
  env: Record<string, unknown>,
  names: readonly string[]
): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}
