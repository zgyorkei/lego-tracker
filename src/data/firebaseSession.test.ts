import { describe, expect, it } from 'vitest';
import type { User } from 'firebase/auth';
import { toAuthUser } from './firebaseSession';

const user = (providerData: { providerId: string; uid: string }[]) =>
  ({
    uid: 'firebase-uid',
    email: 'someone@example.com',
    displayName: 'Some One',
    providerData,
  }) as unknown as User;

describe('toAuthUser', () => {
  it('is null for no user', () => {
    expect(toAuthUser(null)).toBeNull();
  });

  it('takes googleSub from the Google provider entry', () => {
    expect(
      toAuthUser(
        user([
          { providerId: 'password', uid: 'someone@example.com' },
          { providerId: 'google.com', uid: '1234567890' },
        ])
      )
    ).toEqual({
      uid: 'firebase-uid',
      email: 'someone@example.com',
      displayName: 'Some One',
      googleSub: '1234567890',
    });
  });

  it('has no googleSub without a Google sign-in', () => {
    expect(toAuthUser(user([]))?.googleSub).toBeNull();
  });
});
