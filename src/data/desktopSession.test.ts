import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from './types';

const fb = vi.hoisted(() => ({
  subscribe: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(async () => {}),
  hasAccess: vi.fn(async () => true),
}));
// Whether this copy has Firebase ("Firebase + a copy") or not ("On this PC only").
const firebase = vi.hoisted(() => ({ available: true }));
vi.mock('./firebaseSession', () => ({ firebaseSession: fb }));
vi.mock('../lib/firebase', () => ({
  get firebaseAvailable() {
    return firebase.available;
  },
}));

const { desktopSession, rememberedUser, userFromIdToken } = await import('./desktopSession');

const USER: AuthUser = { uid: 'u1', email: 'a@b.c', displayName: 'A', googleSub: '123' };

/** An unsigned JWT with these claims (UTF-8, base64url), as the sign-in hands back. */
const token = (claims: Record<string, unknown>) => {
  const b64 = (s: string) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(s)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${b64('{"alg":"RS256"}')}.${b64(JSON.stringify(claims))}.sig`;
};

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  firebase.available = true;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fb.subscribe.mockReset();
});

describe('desktopSession', () => {
  it("passes Firebase's user on and remembers it", () => {
    fb.subscribe.mockImplementation((l: (u: AuthUser | null) => void) => {
      l(USER);
      return () => {};
    });
    const seen: (AuthUser | null)[] = [];
    desktopSession.subscribe((u) => seen.push(u));
    expect(seen).toEqual([USER]);
    expect(rememberedUser()).toEqual(USER);
  });

  it('opens the copy of the last account when Firebase cannot start', () => {
    localStorage.setItem('desktopLastUser', JSON.stringify(USER));
    fb.subscribe.mockImplementation(() => {
      throw new Error('No Firebase project is configured');
    });
    const seen: (AuthUser | null)[] = [];
    desktopSession.subscribe((u) => seen.push(u));
    expect(seen).toEqual([USER]);
  });

  it('forgets the account on sign-out', async () => {
    localStorage.setItem('desktopLastUser', JSON.stringify(USER));
    localStorage.setItem('cachedSets', '[{"id":"a"}]');
    await desktopSession.signOut();
    expect(rememberedUser()).toBeNull();
    expect(localStorage.getItem('cachedSets')).toBeNull();
    expect(fb.signOut).toHaveBeenCalled();
  });

  it('ignores a remembered value that is not a user', () => {
    localStorage.setItem('desktopLastUser', '{"nope":1}');
    expect(rememberedUser()).toBeNull();
  });
});

describe('desktopSession on this PC only', () => {
  beforeEach(() => {
    firebase.available = false;
  });

  it('signs in with Google alone and keeps the account, without Firebase', async () => {
    const seen: (AuthUser | null)[] = [];
    const off = desktopSession.subscribe((u) => seen.push(u));
    expect(seen).toEqual([null]);
    vi.stubGlobal('window', {
      legoTrackerDesktop: {
        signInWithGoogle: async () => token({ sub: '104976', email: 'z@x.hu', name: 'Zoltán' }),
      },
    });
    await desktopSession.signIn();
    const user = { uid: '104976', email: 'z@x.hu', displayName: 'Zoltán', googleSub: '104976' };
    expect(seen).toEqual([null, user]);
    expect(fb.signIn).not.toHaveBeenCalled();
    expect(fb.subscribe).not.toHaveBeenCalled();
    expect(await desktopSession.hasAccess(user)).toBe(true);

    // The next start opens the same copy with no sign-in.
    const again: (AuthUser | null)[] = [];
    desktopSession.subscribe((u) => again.push(u));
    expect(again).toEqual([user]);

    await desktopSession.signOut();
    expect(seen[seen.length - 1]).toBeNull();
    expect(fb.signOut).not.toHaveBeenCalled();
    off();
  });

  it('opens the copy of an account remembered from Firebase', () => {
    localStorage.setItem('desktopLastUser', JSON.stringify(USER));
    const seen: (AuthUser | null)[] = [];
    desktopSession.subscribe((u) => seen.push(u));
    expect(seen).toEqual([USER]);
  });

  it('refuses a token without a Google account id', () => {
    expect(() => userFromIdToken(token({ email: 'z@x.hu' }))).toThrow('no account id');
    expect(() => userFromIdToken(token({ sub: '../x' }))).toThrow('no account id');
    expect(() => userFromIdToken('garbage')).toThrow('unreadable');
  });
});
