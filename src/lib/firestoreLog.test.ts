import { describe, expect, it, vi } from 'vitest';

type LogParams = { level: string; message: string; args: unknown[]; type: string };
const app = vi.hoisted(() => ({ onLog: vi.fn() }));
vi.mock('firebase/app', () => app);

const { missingDatabaseIn, onMissingDatabase } = await import('./firestoreLog');

// What Firestore 12.12 logs when the database does not exist, as Firebase's
// logger hands it to an onLog handler.
const WARNING =
  "Firestore (12.12.0): Database 'no-such-db' not found. Please check your project configuration.";
const log = (message: string): LogParams => ({
  level: 'warn',
  message,
  args: [message],
  type: '@firebase/firestore',
});

describe('missingDatabaseIn', () => {
  it("reads the database id from Firestore's warning", () => {
    expect(missingDatabaseIn(WARNING)).toBe('no-such-db');
    expect(missingDatabaseIn("Firestore (12.12.0): Database '(default)' not found.")).toBe(
      '(default)'
    );
    expect(missingDatabaseIn('Firestore (12.12.0): Could not reach Cloud Firestore backend.')).toBe(
      null
    );
  });
});

describe('onMissingDatabase', () => {
  it('installs one warn-level log handler and calls back every listener', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onMissingDatabase(a);
    onMissingDatabase(b);
    expect(app.onLog).toHaveBeenCalledTimes(1);
    expect(app.onLog.mock.calls[0][1]).toEqual({ level: 'warn' });
    const handler = app.onLog.mock.calls[0][0] as (p: LogParams) => void;

    handler(log('Firestore (12.12.0): something else'));
    expect(a).not.toHaveBeenCalled();
    handler(log(WARNING));
    expect(a).toHaveBeenCalledWith('no-such-db', WARNING);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    handler(log(WARNING));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });
});
