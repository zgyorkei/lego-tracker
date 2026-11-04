import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from './types';

const fb = vi.hoisted(() => ({
  subscribe: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(async () => {}),
  hasAccess: vi.fn(async () => true),
}));
vi.mock('./firebaseSession', () => ({ firebaseSession: fb }));

const { desktopSession, rememberedUser } = await import('./desktopSession');

const USER: AuthUser = { uid: 'u1', email: 'a@b.c', displayName: 'A', googleSub: '123' };

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
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
    await desktopSession.signOut();
    expect(rememberedUser()).toBeNull();
    expect(fb.signOut).toHaveBeenCalled();
  });

  it('ignores a remembered value that is not a user', () => {
    localStorage.setItem('desktopLastUser', '{"nope":1}');
    expect(rememberedUser()).toBeNull();
  });
});
