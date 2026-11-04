import { DataError } from '../data/types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

/**
 * Logs a data failure and returns a plain-language message for the UI.
 *
 * Deliberately does NOT throw. An earlier version threw a JSON blob, which
 * (a) embedded the user's email and uid into an Error message that could reach
 * any log sink, and (b) was thrown from inside an onSnapshot error callback,
 * where nothing can catch it -- it became an unhandled rejection that the
 * ErrorBoundary cannot intercept either, since boundaries only catch errors
 * raised during render/lifecycle.
 */
export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): string {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Firestore error', { operationType, path, message });

  const code = (error as { code?: string } | null)?.code;
  if (code === 'permission-denied') {
    return 'You do not have access to this data. Try signing out and back in.';
  }
  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return 'Cannot reach the database right now. Showing cached data if available.';
  }
  return `Something went wrong while trying to ${operationType} data. Please try again.`;
}

/** handleFirestoreError's message as a DataError, keeping the original code and error. */
export function toDataError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): DataError {
  const code = (error as { code?: string } | null)?.code;
  return new DataError(handleFirestoreError(error, operationType, path), code, error);
}
