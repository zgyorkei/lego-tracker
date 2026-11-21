import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_URL, chromeAppLaunch, openBrickTracker } from './chromeApp';

const ID = 'abcdefghijklmnopabcdefghijklmnop';

describe('chromeAppLaunch', () => {
  it('opens the Vercel site by its address when no app id is known', () => {
    expect(chromeAppLaunch()).toMatchObject({ url: DEFAULT_APP_URL });
    expect(chromeAppLaunch({ url: 'https://x.example/' })).toMatchObject({
      url: 'https://x.example',
    });
  });
  it('opens the installed app by its id, with no address', () => {
    const l = chromeAppLaunch({ appId: ID, url: 'https://x.example' });
    expect(l).toMatchObject({ appId: ID });
    expect(l).not.toHaveProperty('url');
  });
  it('refuses a bad id and a non-https address', () => {
    expect(() => chromeAppLaunch({ appId: 'nope' })).toThrow();
    expect(() => chromeAppLaunch({ url: 'http://x.example' })).toThrow();
  });
});

describe('openBrickTracker', () => {
  it('starts one window through the launcher', () => {
    const open = vi.fn();
    openBrickTracker(open, { appId: ID });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toMatchObject({ appId: ID });
  });
});
