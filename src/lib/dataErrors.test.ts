import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperationType, handleFirestoreError, toDataError } from './dataErrors';
import { DataError } from '../data/types';

const withCode = (code: string, message = 'boom') => Object.assign(new Error(message), { code });

describe('handleFirestoreError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps a refusal to the access message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(handleFirestoreError(withCode('permission-denied'), OperationType.LIST, 'sets')).toBe(
      'You do not have access to this data. Try signing out and back in.'
    );
  });

  it.each(['unavailable', 'deadline-exceeded'])('maps %s to the offline message', (code) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(handleFirestoreError(withCode(code), OperationType.GET, 'sets/a')).toBe(
      'Cannot reach the database right now. Showing cached data if available.'
    );
  });

  it('names the operation otherwise, for errors and non-errors alike', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(handleFirestoreError(new Error('x'), OperationType.UPDATE, 'sets/a')).toBe(
      'Something went wrong while trying to update data. Please try again.'
    );
    expect(handleFirestoreError('weird', OperationType.CREATE, null)).toBe(
      'Something went wrong while trying to create data. Please try again.'
    );
  });

  it('logs the operation, path and message only, and does not throw', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    handleFirestoreError(withCode('permission-denied', 'denied'), OperationType.DELETE, 'sets/a');
    expect(log).toHaveBeenCalledWith('Firestore error', {
      operationType: 'delete',
      path: 'sets/a',
      message: 'denied',
    });
  });
});

describe('toDataError', () => {
  it('carries the message, the code and the original error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = withCode('permission-denied');
    const e = toDataError(original, OperationType.LIST, 'sets');
    expect(e).toBeInstanceOf(DataError);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('You do not have access to this data. Try signing out and back in.');
    expect(e.code).toBe('permission-denied');
    expect(e.cause).toBe(original);
  });
});
