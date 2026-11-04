import { useState } from 'react';
import { HardDrive } from 'lucide-react';
import { Modal } from './Modal';
import { backupPill, heldExplanation } from '../lib/localBackupText';
import { stepsFor } from '../lib/dataHealth';
import type { DesktopSyncState } from '../hooks/useDesktopSync';

const TONE = {
  ok: 'bg-white text-black',
  busy: 'bg-lego-yellow text-black',
  problem: 'bg-lego-red text-white',
} as const;

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'not yet');

/** Desktop app: the header pill for the copy on this PC, and its details. */
export function StorageStatus({ backup }: { backup: DesktopSyncState }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!backup.active) return null;

  const { status, health } = backup;
  const pill = backupPill(status, health);
  const healthLine = health.kind === 'ok' ? null : stepsFor(health.kind).title;
  const explanation = status ? heldExplanation(status) : null;
  const held = status?.held;

  const answer = async (choice: 'delete' | 'keep') => {
    setBusy(true);
    try {
      await backup.resolveHeld(choice);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`px-3 py-1.5 border-2 border-black rounded font-black text-[10px] uppercase flex items-center gap-2 ${TONE[pill.tone]}`}
        title="The copy of your collection on this PC"
      >
        <HardDrive size={14} /> <span className="hidden sm:inline">{pill.label}</span>
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} label="Copy on this PC" className="w-full max-w-lg">
          <div className="bg-white border-4 border-black rounded-xl p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <h2 className="text-xl font-black uppercase mb-1">Copy on this PC</h2>
            <p className="text-sm text-gray-600 mb-4">
              The desktop app keeps your sets, price history and settings on this PC and works from
              that copy, so nothing is lost when Firebase is offline or broken. Changes made here go
              to Firebase, and changes made elsewhere come back here.
            </p>

            {held && explanation && !held.dismissed && (
              <div role="alert" className="mb-4 border-2 border-lego-red bg-red-50 rounded-lg p-3">
                <p className="font-bold text-sm mb-3">{explanation}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={busy}
                    onClick={() => void answer('delete')}
                    className="px-3 py-1.5 border-2 border-black rounded font-black text-xs uppercase bg-white"
                  >
                    {held.reason === 'mass-removal'
                      ? 'Delete them here too'
                      : 'Start again from this project'}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void answer('keep')}
                    className="px-3 py-1.5 border-2 border-black rounded font-black text-xs uppercase bg-lego-yellow"
                  >
                    {held.reason === 'mass-removal' ? 'Keep them here' : 'Keep this copy'}
                  </button>
                </div>
              </div>
            )}

            {(status?.error || healthLine) && (
              <p role="alert" className="mb-4 text-sm font-bold text-red-600">
                {status?.error ?? healthLine}
              </p>
            )}

            {status ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="font-bold">Sets</dt>
                <dd>{status.sets}</dd>
                <dt className="font-bold">Waiting to sync</dt>
                <dd>{status.pending ? ` changes` : 'nothing'}</dd>
                <dt className="font-bold">Price history</dt>
                <dd>
                  {status.historiesComplete} of {status.historiesTotal} sets copied (
                  {status.historyRows} rows)
                </dd>
                <dt className="font-bold">Firebase checked</dt>
                <dd>{when(status.lastRemoteAt)}</dd>
                <dt className="font-bold">Saved on this PC</dt>
                <dd>{when(status.lastWrittenAt)}</dd>
                <dt className="font-bold">Daily backups</dt>
                <dd>
                  {status.lastBackupDay ? `newest ${status.lastBackupDay}, 7 kept` : 'none yet'}
                </dd>
                <dt className="font-bold">Reads today</dt>
                <dd>
                  {status.budget.used} of {status.budget.limit} for copying history
                </dd>
                <dt className="font-bold">Folder</dt>
                <dd className="break-all font-mono text-xs">{status.dir}</dd>
              </dl>
            ) : (
              <p className="text-sm">Opening the copy on this PC...</p>
            )}

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 border-2 border-black rounded font-black uppercase text-xs bg-white"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
