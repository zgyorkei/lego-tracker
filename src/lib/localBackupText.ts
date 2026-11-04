import type { StoreStatus } from '../../lib/data/storeBridge';

export type PillTone = 'ok' | 'busy' | 'problem';

/** The header pill's text for the copy on this PC. */
export function backupPill(
  status: StoreStatus | null,
  error: string | null
): { label: string; tone: PillTone } {
  if (!status) return { label: 'Copying to this PC', tone: 'busy' };
  if (status.held && !status.held.dismissed)
    return { label: 'Backup paused: review', tone: 'problem' };
  if (status.error || error) return { label: 'Backup problem', tone: 'problem' };
  if (status.historiesComplete < status.historiesTotal)
    return {
      label: `Backup: ${status.historiesComplete}/${status.historiesTotal} histories`,
      tone: 'busy',
    };
  return { label: `Backup: ${status.sets} ${status.sets === 1 ? 'set' : 'sets'}`, tone: 'ok' };
}

/** What a held snapshot means, in the user's terms. */
export function heldExplanation(status: StoreStatus): string | null {
  const held = status.held;
  if (!held) return null;
  if (held.reason === 'mass-removal') {
    const n = held.removeIds.length;
    return (
      `Firebase no longer has ${n} of the ${status.sets} sets copied to this PC. ` +
      'That can be a deliberate clean-up, or a sign that the database was emptied or replaced. ' +
      'The copy on this PC keeps them until you decide.'
    );
  }
  return (
    `This copy came from a different Firebase project or account than the one signed in now ` +
    `(${held.source.projectId}). Nothing from the new one is mixed into it until you decide.`
  );
}
