import { describe, expect, it } from 'vitest';
import { classifyFirebaseError, isProblem, stepsFor, type HealthKind } from './dataHealth';

const err = (code: string, message = 'x') => Object.assign(new Error(message), { code });

describe('classifyFirebaseError', () => {
  it.each<[string, string, HealthKind]>([
    ['unavailable', 'Could not reach Cloud Firestore backend', 'offline'],
    ['auth/network-request-failed', 'network', 'offline'],
    ['auth/invalid-api-key', 'bad key', 'invalid-config'],
    ['auth/operation-not-allowed', 'disabled', 'provider-disabled'],
    ['auth/invalid-credential', 'Invalid audience in ID token', 'desktop-client-untrusted'],
    ['unauthenticated', 'no auth', 'session-expired'],
    ['resource-exhausted', 'Quota exceeded.', 'quota-exceeded'],
    [
      'failed-precondition',
      'The query requires an index. You can create it here: https://...',
      'index-missing',
    ],
    ['not-found', 'The database wrong-db does not exist for project p', 'database-missing'],
    ['permission-denied', 'Missing or insufficient permissions.', 'rules-outdated'],
    ['internal', 'something odd', 'unknown'],
  ])('%s: %s -> %s', (code, message, kind) => {
    expect(classifyFirebaseError(err(code, message)).kind).toBe(kind);
  });

  it('recognises a missing database from the message alone', () => {
    expect(
      classifyFirebaseError(new Error('The database (wrong) does not exist for project p')).kind
    ).toBe('database-missing');
  });

  it('keeps the detail short', () => {
    expect(classifyFirebaseError(err('internal', 'y'.repeat(1000))).detail).toHaveLength(300);
  });
});

describe('stepsFor and isProblem', () => {
  it('gives every problem a title and steps', () => {
    const kinds: HealthKind[] = [
      'not-configured',
      'invalid-config',
      'provider-disabled',
      'desktop-client-untrusted',
      'database-missing',
      'rules-outdated',
      'index-missing',
      'account-refused',
      'quota-exceeded',
      'session-expired',
      'unknown',
    ];
    for (const k of kinds) {
      const info = stepsFor(k);
      expect(info.title.length).toBeGreaterThan(5);
      expect(info.steps.length).toBeGreaterThan(0);
      expect(isProblem({ kind: k })).toBe(true);
    }
  });

  it('does not treat being offline as a problem', () => {
    expect(isProblem({ kind: 'offline' })).toBe(false);
    expect(isProblem({ kind: 'ok' })).toBe(false);
  });
});
