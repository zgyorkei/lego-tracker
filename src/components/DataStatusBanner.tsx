import { useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';
import { isProblem, stepsFor } from '../lib/dataHealth';
import type { DesktopSyncState } from '../hooks/useDesktopSync';

/**
 * Desktop app: a banner while Firebase has a problem the user can fix. The
 * app keeps working on the copy on this PC meanwhile; being offline is not a
 * problem and shows only in the header pill.
 */
export function DataStatusBanner({ sync }: { sync: DesktopSyncState }) {
  const [showSteps, setShowSteps] = useState(false);
  if (!sync.active || !isProblem(sync.health)) return null;
  const info = stepsFor(sync.health.kind);

  return (
    <>
      <div
        role="alert"
        className="bg-lego-red text-white border-b-4 border-black px-4 py-2 flex flex-wrap items-center gap-3"
      >
        <AlertTriangle size={18} className="shrink-0" />
        <p className="font-black text-sm flex-1 min-w-[12rem]">
          {info.title}. Your sets are safe on this PC.
        </p>
        <button
          onClick={() => setShowSteps(true)}
          className="px-3 py-1 bg-white text-black border-2 border-black rounded font-black text-xs uppercase"
        >
          What to do
        </button>
        <button
          onClick={() => sync.retryNow()}
          className="px-3 py-1 bg-black text-white border-2 border-white rounded font-black text-xs uppercase flex items-center gap-1"
        >
          <RefreshCw size={12} /> Retry now
        </button>
      </div>

      {showSteps && (
        <Modal onClose={() => setShowSteps(false)} label={info.title} className="w-full max-w-lg">
          <div className="bg-white border-4 border-black rounded-xl p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <h2 className="text-xl font-black mb-3">{info.title}</h2>
            <ol className="list-decimal pl-5 space-y-2 text-sm mb-4">
              {info.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="text-sm text-gray-600 mb-2">
              Until then the app works from the copy on this PC: changes are kept and go to Firebase
              once it accepts them.
            </p>
            {sync.health.detail && (
              <p className="text-xs font-mono break-all bg-gray-100 p-2 rounded">
                {sync.health.detail}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => {
                  sync.retryNow();
                  setShowSteps(false);
                }}
                className="px-4 py-2 border-2 border-black rounded font-black uppercase text-xs bg-lego-yellow"
              >
                Retry now
              </button>
              <button
                onClick={() => setShowSteps(false)}
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
