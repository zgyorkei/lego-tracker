import type { StoreStatus } from '../../lib/data/storeBridge';
import type { HeldSnapshot, RemoteSource } from '../../lib/data/store';
import { isProblem, stepsFor, type Health } from './dataHealth';

export type PillTone = 'ok' | 'busy' | 'problem';
/** The desktop app's storage as it runs (desktopMode in ./platform). */
export type StorageMode = 'local' | 'both';

/** "1 change", "3 changes". */
export const changes = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`;
const setsText = (n: number) => `${n} ${n === 1 ? 'set' : 'sets'}`;

/** The header pill for the copy on this PC and its sync with Firebase. */
export function backupPill(
  status: StoreStatus | null,
  health: Health,
  mode: StorageMode = 'both'
): { label: string; tone: PillTone } {
  if (!status) return { label: 'Opening the copy on this PC', tone: 'busy' };
  if (mode === 'local') {
    // Nothing syncs, so nothing is "pending": every change is simply here.
    if (isProblem(health)) return { label: stepsFor(health.kind).title, tone: 'problem' };
    if (status.error) return { label: 'Problem saving on this PC', tone: 'problem' };
    return { label: `On this PC: ${setsText(status.sets)}`, tone: 'ok' };
  }
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
  return { label: `In sync: ${setsText(status.sets)}`, tone: 'ok' };
}

/** The tray tooltip's line: the same state in a few words. */
export function syncSummary(
  status: StoreStatus | null,
  health: Health,
  mode: StorageMode = 'both'
): string {
  if (!status) return 'opening the copy on this PC';
  if (mode === 'local') {
    if (isProblem(health)) return stepsFor(health.kind).title;
    return `on this PC only, ${setsText(status.sets)}`;
  }
  if (status.held && !status.held.dismissed) return 'sync paused, open the app to review';
  if (isProblem(health)) return stepsFor(health.kind).title;
  if (health.kind === 'offline')
    return status.pending ? `offline, ${changes(status.pending)} saved on this PC` : 'offline';
  if (status.pending) return `syncing ${changes(status.pending)}`;
  return `in sync, ${setsText(status.sets)}`;
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
  const target = what === 'local' ? 'project' : (what ?? 'one');
  let came: string;
  if (what === 'local')
    came = `The ${setsText(status.sets)} on this PC have never been in Firebase: they were kept on this PC only. The app now uses the Firebase project ${to.projectId}.`;
  else if (from && what === 'project')
    came = `This copy came from the Firebase project ${from.projectId}, but the app now uses ${to.projectId}.`;
  else if (from && what === 'database')
    came = `This copy came from the Firestore database ${from.databaseId}, but the app now uses ${to.databaseId} (same project, ${to.projectId}).`;
  else if (what === 'account')
    came =
      'This copy came from a different Firebase account of this project than the one signed in now.';
  else
    came = `This copy came from a different Firebase project, database or account than the one signed in now (${to.projectId}).`;
  const answered = held.confirmed
    ? ` The ${what === 'local' ? '' : 'new '}${target} holds ${setsText(held.remoteCount)}.`
    : ` The ${what === 'local' ? '' : 'new '}${target} has not answered yet, so what it holds is not known; if the setting is a mistake, correct it under Settings... in the tray menu.`;
  return `${came}${answered} Nothing is mixed in, and nothing is uploaded, until you decide.`;
}

/**
 * What differs between where the copy came from and where the app is now.
 * 'local': the copy was kept on this PC only (from is null). A hold saved
 * before `from` existed (undefined) says nothing.
 */
function changedPart(
  from: RemoteSource | null | undefined,
  to: RemoteSource
): 'local' | 'project' | 'database' | 'account' | null {
  if (from === null) return 'local';
  if (!from) return null;
  if (from.projectId !== to.projectId) return 'project';
  if (from.databaseId !== to.databaseId) return 'database';
  if (from.uid !== to.uid) return 'account';
  return null;
}

/**
 * The answers a held snapshot offers (lib/data/storeBridge.ts HeldChoice), as
 * button labels; null where an answer is not offered. Starting again from a
 * new source, or uploading to it, is offered only once its server has
 * answered: a mistyped database never does. `localSets` is the copy's count.
 */
export function heldActions(
  held: HeldSnapshot,
  localSets: number
): { upload: string | null; remove: string | null; keep: string } {
  if (held.reason === 'mass-removal')
    return { upload: null, remove: 'Delete them here too', keep: 'Keep them here' };
  const part = changedPart(held.from, held.source);
  const what = part === 'local' || part === null ? 'project' : part;
  if (!held.confirmed) return { upload: null, remove: null, keep: 'Keep this copy' };
  return {
    upload: `Upload ${setsText(localSets)} to this ${what}`,
    remove: part === 'local' ? "Use the project's sets instead" : `Start again from this ${what}`,
    keep: 'Keep this copy',
  };
}
