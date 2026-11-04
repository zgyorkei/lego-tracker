// What a Firebase failure means for the desktop app, which keeps working on
// its copy on this PC whatever happens. "offline" is normal (changes wait
// here) and only shows as a quiet pill; everything else is a problem the user
// can fix, shown in a banner with the steps.

export type HealthKind =
  | 'ok'
  | 'offline'
  | 'not-configured'
  | 'invalid-config'
  | 'provider-disabled'
  | 'desktop-client-untrusted'
  | 'database-missing'
  | 'rules-outdated'
  | 'index-missing'
  | 'account-refused'
  | 'quota-exceeded'
  | 'session-expired'
  | 'unknown';

export interface Health {
  kind: HealthKind;
  /** The error as Firebase put it, for the details. */
  detail?: string;
}

export const isProblem = (h: Health) => h.kind !== 'ok' && h.kind !== 'offline';

const text = (err: unknown) =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err ?? '');

/** Sorts a Firestore or Firebase Auth error into what the user can do about it. */
export function classifyFirebaseError(err: unknown): Health {
  const code = String((err as { code?: string } | null)?.code ?? '');
  const message = text(err);
  const detail = message.slice(0, 300);
  const has = (re: RegExp) => re.test(message);

  if (
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'auth/network-request-failed'
  )
    return { kind: 'offline', detail };
  if (
    code === 'auth/invalid-api-key' ||
    code === 'auth/api-key-not-valid' ||
    has(/API key not valid/i)
  )
    return { kind: 'invalid-config', detail };
  if (code === 'auth/operation-not-allowed') return { kind: 'provider-disabled', detail };
  if (
    code === 'auth/unauthorized-domain' ||
    code === 'auth/invalid-oauth-client-id' ||
    (code === 'auth/invalid-credential' && has(/audience|client/i))
  )
    return { kind: 'desktop-client-untrusted', detail };
  if (
    code === 'unauthenticated' ||
    code === 'auth/user-token-expired' ||
    code === 'auth/user-disabled' ||
    code === 'auth/requires-recent-login'
  )
    return { kind: 'session-expired', detail };
  if (code === 'resource-exhausted' || code === 'auth/quota-exceeded')
    return { kind: 'quota-exceeded', detail };
  if (code === 'failed-precondition' && has(/index/i)) return { kind: 'index-missing', detail };
  if (code === 'not-found' && has(/database/i)) return { kind: 'database-missing', detail };
  if (has(/database .* does not exist|The database \(?[\w-]+\)? does not exist/i))
    return { kind: 'database-missing', detail };
  // A refused account is told apart by the allowlist probe (hasAccess); any
  // other refusal means a collection's rule is missing or out of date.
  if (code === 'permission-denied') return { kind: 'rules-outdated', detail };
  return { kind: 'unknown', detail };
}

export interface HealthInfo {
  title: string;
  steps: string[];
}

const CONSOLE = 'https://console.firebase.google.com/';

/** The banner's title and what to do, per problem. */
export function stepsFor(kind: HealthKind): HealthInfo {
  switch (kind) {
    case 'ok':
      return { title: 'Firebase is connected', steps: [] };
    case 'offline':
      return {
        title: 'Offline: changes are saved on this PC',
        steps: ['Nothing to do. Changes go to Firebase when the connection is back.'],
      };
    case 'not-configured':
      return {
        title: 'No Firebase project is set up',
        steps: ['Open the tray menu, Settings..., and paste your Firebase web app config.'],
      };
    case 'invalid-config':
      return {
        title: 'The Firebase config is not valid',
        steps: [
          `In the Firebase console (${CONSOLE}), open Project settings, General, Your apps, and copy the web app config.`,
          'Open the tray menu, Settings..., paste it again and save.',
        ],
      };
    case 'provider-disabled':
      return {
        title: 'Google sign-in is turned off in Firebase',
        steps: ['In the Firebase console, open Authentication, Sign-in method, and enable Google.'],
      };
    case 'desktop-client-untrusted':
      return {
        title: "Firebase does not accept the desktop app's sign-in client",
        steps: [
          'In the Firebase console, open Authentication, Sign-in method, Google.',
          'Under "Safelist client IDs from external projects", add the client ID from the desktop sign-in file.',
        ],
      };
    case 'database-missing':
      return {
        title: 'The Firestore database was not found',
        steps: [
          'In the Firebase console, open Firestore Database and note the database name in the picker at the top.',
          'Open the tray menu, Settings..., and enter that name as the database (leave it empty for "(default)").',
        ],
      };
    case 'rules-outdated':
      return {
        title: 'Firestore refused the copy on this PC',
        steps: [
          'In the Firebase console, open Firestore Database, Rules, for the database this app uses.',
          'Paste the whole firestore.rules from the Brick Tracker repository and click Publish.',
        ],
      };
    case 'index-missing':
      return {
        title: 'Firestore needs an index',
        steps: [
          'Open the link in the details below; it creates the missing index in the Firebase console.',
        ],
      };
    case 'account-refused':
      return {
        title: 'This Google account is not on the list for this Firebase project',
        steps: [
          'Sign in with an account on the list, or add this one to the access/allowlist document in the Firebase console.',
          'The copy on this PC keeps working in the meantime; nothing reaches Firebase.',
        ],
      };
    case 'quota-exceeded':
      return {
        title: "Firebase's daily free quota is used up",
        steps: [
          'Changes are kept on this PC and go to Firebase after the quota resets (midnight Pacific time).',
        ],
      };
    case 'session-expired':
      return {
        title: 'The Google sign-in has expired',
        steps: ['Sign out and sign in again. The copy on this PC is kept.'],
      };
    case 'unknown':
      return {
        title: 'Firebase reported a problem',
        steps: ['Try again in a few minutes. The details below say what Firebase reported.'],
      };
  }
}
