import { useState } from 'react';
import { HardDrive, Settings } from 'lucide-react';
import { Modal } from './Modal';
import {
  backupPill,
  changes,
  driveLine,
  heldActions,
  heldExplanation,
} from '../lib/localBackupText';
import { stepsFor } from '../lib/dataHealth';
import { openDesktopSettings } from '../lib/platform';
import type { DesktopSyncState } from '../hooks/useDesktopSync';
import type { HeldChoice } from '../../lib/data/storeBridge';

const TONE = {
  ok: 'bg-white text-black',
  busy: 'bg-lego-yellow text-black',
  problem: 'bg-lego-red text-white',
} as const;

const BUTTON = 'px-3 py-1.5 border-2 border-black rounded font-black text-xs uppercase';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'not yet');

/** Desktop app: the header pill for the copy on this PC, and its details. */
export function StorageStatus({ backup }: { backup: DesktopSyncState }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  if (!backup.active) return null;

  const { status, health, mode } = backup;
  const local = mode === 'local';
  const pill = backupPill(status, health, mode);
  const healthLine = health.kind === 'ok' ? null : stepsFor(health.kind).title;
  const explanation = status ? heldExplanation(status) : null;
  const held = status?.held;
  const actions = held && status ? heldActions(held, status.sets) : null;
  const drive = driveLine(backup.drive);
  const connect = async () => {
    setBusy(true);
    setDriveError(null);
    try {
      await backup.connectDrive();
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const answer = async (choice: HeldChoice) => {
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
            <h2 className="text-xl font-black uppercase mb-1">
              {local ? 'On this PC only' : 'Copy on this PC'}
            </h2>
            {local ? (
              <p className="text-sm text-gray-600 mb-4">
                Your sets, price history and settings are kept on this PC; Firebase is not used.
                Gift registries and the public Planned Sets link need Firebase: choose
                &quot;Firebase + a copy on this PC&quot; in Settings to use them.
                {status?.lastRemoteAt &&
                  ' Firestore still holds your sets as they were when this PC stopped syncing, so a website that reads Firebase shows them as of then.'}
              </p>
            ) : (
              <p className="text-sm text-gray-600 mb-4">
                The desktop app keeps your sets, price history and settings on this PC and works
                from that copy, so nothing is lost when Firebase is offline or broken. Changes made
                here go to Firebase, and changes made elsewhere come back here.
              </p>
            )}

            {held && actions && explanation && !held.dismissed && !local && (
              <div role="alert" className="mb-4 border-2 border-lego-red bg-red-50 rounded-lg p-3">
                <p className="font-bold text-sm mb-3">{explanation}</p>
                <div className="flex flex-wrap gap-2">
                  {actions.upload && (
                    <button
                      disabled={busy}
                      onClick={() => void answer('upload')}
                      className={`${BUTTON} bg-lego-blue text-white`}
                    >
                      {actions.upload}
                    </button>
                  )}
                  {actions.remove && (
                    <button
                      disabled={busy}
                      onClick={() => void answer('delete')}
                      className={`${BUTTON} bg-white`}
                    >
                      {actions.remove}
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => void answer('keep')}
                    className={`${BUTTON} bg-lego-yellow`}
                  >
                    {actions.keep}
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
                {!local && (
                  <>
                    <dt className="font-bold">Waiting to sync</dt>
                    <dd>{status.pending ? changes(status.pending) : 'nothing'}</dd>
                    <dt className="font-bold">Price history</dt>
                    <dd>
                      {status.historiesComplete} of {status.historiesTotal} sets copied (
                      {status.historyRows} rows)
                    </dd>
                    <dt className="font-bold">Firebase checked</dt>
                    <dd>{when(status.lastRemoteAt)}</dd>
                  </>
                )}
                <dt className="font-bold">Saved on this PC</dt>
                <dd>{when(status.lastWrittenAt)}</dd>
                <dt className="font-bold">Daily backups</dt>
                <dd>
                  {status.lastBackupDay ? `newest ${status.lastBackupDay}, 7 kept` : 'none yet'}
                </dd>
                {!local && (
                  <>
                    <dt className="font-bold">Reads today</dt>
                    <dd>
                      {status.budget.used} of {status.budget.limit} for copying history
                    </dd>
                  </>
                )}
                <dt className="font-bold">Folder</dt>
                <dd className="break-all font-mono text-xs">{status.dir}</dd>
                {drive && (
                  <>
                    <dt className="font-bold">Google Drive</dt>
                    <dd className={drive.problem ? 'text-red-600 font-bold' : ''}>
                      {drive.text}
                      {drive.connect && (
                        <button
                          disabled={busy}
                          onClick={() => void connect()}
                          className={`${BUTTON} bg-lego-blue text-white mt-2 block`}
                        >
                          Connect Google Drive
                        </button>
                      )}
                      {driveError && (
                        <span role="alert" className="block text-red-600 font-bold mt-1">
                          {driveError}
                        </span>
                      )}
                    </dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="text-sm">Opening the copy on this PC...</p>
            )}

            <div className="mt-6 flex justify-between gap-2">
              <button
                onClick={openDesktopSettings}
                className="px-4 py-2 border-2 border-black rounded font-black uppercase text-xs bg-white flex items-center gap-2"
              >
                <Settings size={14} /> Settings
              </button>
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
