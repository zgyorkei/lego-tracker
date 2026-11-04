import type { StoreStatus } from '../../lib/data/storeBridge';
import { isProblem, stepsFor, type Health } from './dataHealth';

export type PillTone = 'ok' | 'busy' | 'problem';

const changes = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`;

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
  return (
    `This copy came from a different Firebase project or account than the one signed in now ` +
    `(${held.source.projectId}). Nothing from the new one is mixed in, and nothing is sent to it, until you decide.`
  );
}
