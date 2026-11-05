import type { StoreStatus } from '../../lib/data/storeBridge';
import type { HeldSnapshot, RemoteSource } from '../../lib/data/store';
import { isProblem, stepsFor, type Health } from './dataHealth';

export type PillTone = 'ok' | 'busy' | 'problem';

/** "1 change", "3 changes". */
export const changes = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`;

/** The header pill for the copy on this PC and its sync with Firebase. */
export function backupPill(
  status: StoreStatus | null,
  health: Health
): { label: string; tone: PillTone } {
  if (!status) return { label: 'Opening the copy on this PC', tone: 'busy' };
  if (status.held && !status.held.dismissed)
    return { label: 'Sync paused: review', tone: 'problem' };
  if (isProblem(health) || status.error) return { label: 'Sync problem', tone: 'problem' };
  if (health.kind === 'offline')
    return {
      label: status.pending ? `Offline: ${changes(status.pending)} saved here` : 'Offline',
      tone: 'busy',
    };
  if (status.pending) return { label: `Syncing ${changes(status.pending)}`, tone: 'busy' };
  if (status.historiesComplete < status.historiesTotal)
    return {
      label: `Copying history ${status.historiesComplete}/${status.historiesTotal}`,
      tone: 'busy',
    };
  return { label: `In sync: ${status.sets} ${status.sets === 1 ? 'set' : 'sets'}`, tone: 'ok' };
}

/** The tray tooltip's line: the same state in a few words. */
export function syncSummary(status: StoreStatus | null, health: Health): string {
  if (!status) return 'opening the copy on this PC';
  if (status.held && !status.held.dismissed) return 'sync paused, open the app to review';
  if (isProblem(health)) return stepsFor(health.kind).title;
  if (health.kind === 'offline')
    return status.pending ? `offline, ${changes(status.pending)} saved on this PC` : 'offline';
  if (status.pending) return `syncing ${changes(status.pending)}`;
  return `in sync, ${status.sets} sets`;
}

/** What a held snapshot means, in the user's terms. */
export function heldExplanation(status: StoreStatus): string | null {
  const held = status.held;
  if (!held) return null;
  if (held.reason === 'mass-removal') {
    const n = held.removeIds.length;
    return (
      `Firebase no longer has ${n} of the ${status.sets} sets on this PC. ` +
      'That can be a deliberate clean-up, or a sign that the database was emptied or replaced. ' +
      'Nothing is sent to Firebase, and this PC keeps them, until you decide.'
    );
  }
  const { from, source: to } = held;
  const what = changedPart(from, to);
  let came: string;
  if (from && what === 'project')
    came = `This copy came from the Firebase project ${from.projectId}, but the app now uses ${to.projectId}.`;
  else if (from && what === 'database')
    came = `This copy came from the Firestore database ${from.databaseId}, but the app now uses ${to.databaseId} (same project, ${to.projectId}).`;
  else if (what === 'account')
    came =
      'This copy came from a different Firebase account of this project than the one signed in now.';
  else
    came = `This copy came from a different Firebase project, database or account than the one signed in now (${to.projectId}).`;
  const answered = held.confirmed
    ? ` The new ${what ?? 'one'} holds ${held.remoteCount} ${held.remoteCount === 1 ? 'set' : 'sets'}.`
    : ` The new ${what ?? 'one'} has not answered yet, so what it holds is not known; if the setting is a mistake, correct it under Settings... in the tray menu.`;
  return `${came}${answered} Nothing from it is mixed in, and nothing is sent to it, until you decide.`;
}

/** What differs between where the copy came from and where the app is now. */
function changedPart(
  from: RemoteSource | null | undefined,
  to: RemoteSource
): 'project' | 'database' | 'account' | null {
  if (!from) return null;
  if (from.projectId !== to.projectId) return 'project';
  if (from.databaseId !== to.databaseId) return 'database';
  if (from.uid !== to.uid) return 'account';
  return null;
}

/**
 * The answers a held snapshot offers. Starting again from a new source is
 * offered only once its server has answered: a mistyped database never does.
 */
export function heldActions(held: HeldSnapshot): { remove: string | null; keep: string } {
  if (held.reason === 'mass-removal')
    return { remove: 'Delete them here too', keep: 'Keep them here' };
  const what = changedPart(held.from, held.source) ?? 'project';
  return {
    remove: held.confirmed ? `Start again from this ${what}` : null,
    keep: 'Keep this copy',
  };
}
