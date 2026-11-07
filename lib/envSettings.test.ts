import { describe, expect, it } from 'vitest';
import { CLIENT_ENV_PREFIXES, ENV_NAMES, readEnv } from './envSettings';

describe('readEnv', () => {
  it('takes the first name that is set, trimmed, and skips blank ones', () => {
    const names = ENV_NAMES.googleClientSecret;
    expect(readEnv({ GOOGLE_CLIENT_SECRET: 'old' }, names)).toBe('old');
    expect(readEnv({ GOOGLE_CLIENT_SECRET: 'old', GOOGLE_CLIENT_CONFIG: ' new ' }, names)).toBe(
      'new'
    );
    expect(readEnv({ GOOGLE_CLIENT_CONFIG: 'new', GOOGLE_CLIENT_CONFIG_2: 'newer' }, names)).toBe(
      'newer'
    );
    expect(readEnv({ GOOGLE_CLIENT_CONFIG_2: '  ', GOOGLE_CLIENT_CONFIG: 'new' }, names)).toBe(
      'new'
    );
    expect(readEnv({}, names)).toBeUndefined();
  });
});

describe('CLIENT_ENV_PREFIXES', () => {
  const exposed = (name: string) => CLIENT_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));

  it('copies the client id into the page under every name', () => {
    expect(ENV_NAMES.googleClientId.every(exposed)).toBe(true);
  });

  it('never copies a secret into the page', () => {
    const secrets = [...ENV_NAMES.googleClientSecret, ...ENV_NAMES.sessionSecret, 'GEMINI_API_KEY'];
    expect(secrets.filter(exposed)).toEqual([]);
  });
});
