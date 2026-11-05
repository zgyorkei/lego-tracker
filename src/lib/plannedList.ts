import { publicAppUrl } from './appUrl';

export const PLANNED_LISTS_COLLECTION = 'plannedLists';

// Same public origin the gift registry links use (publicAppUrl). The API URL
// is handed to another application, so it must point at the deployment, not
// at the desktop app's localhost.
export const plannedListApiUrl = (token: string): string =>
  `${publicAppUrl()}/api/planned-sets/${token}`;

/**
 * Desktop app: its own address for the list, served from the copy on this PC.
 * Only programs on this PC (BrickBudget) can open it, while the app runs.
 */
export const localPlannedListApiUrl = (token: string): string =>
  `${window.location.origin}/api/planned-sets/${token}`;

/** 24 hex chars from the CSPRNG. The token is the only access control. */
export function generatePlannedListToken(): string {
  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// The public list's shape and builders live in lib/ (the desktop's main process
// builds the list from its copy too); re-exported here for the web app.
export { buildPlannedListPurchases, buildPlannedListSets } from '../../lib/plannedListPayload';

/**
 * JSON with object keys sorted, for change detection. Firestore does not
 * preserve map key order, so comparing plain JSON.stringify output of the
 * stored doc against a freshly built payload would always see a difference
 * and rewrite the doc on every snapshot.
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
