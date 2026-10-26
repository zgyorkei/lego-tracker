import { useState } from 'react';
import { motion } from 'motion/react';
import { X, Check, Link as LinkIcon, RefreshCw, Trash2, Webhook } from 'lucide-react';
import { Modal } from './Modal';
import { plannedListApiUrl } from '../lib/plannedList';
import type { PlannedListState } from '../hooks/usePlannedList';

interface PlannedListDialogProps {
  onClose: () => void;
  state: PlannedListState;
}

export function PlannedListDialog({ onClose, state }: PlannedListDialogProps) {
  const { list, loading, busy, error, ready, plannedCount, purchaseCount, createList, deleteList, syncNow } = state;
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const apiUrl = list ? plannedListApiUrl(list.id) : null;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal onClose={onClose} label="Planned sets API" className="w-full max-w-2xl">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-xl shadow-2xl p-6 w-full relative"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-900 z-10"
        >
          <X size={24} />
        </button>

        <h2 className="text-2xl font-black text-gray-900 uppercase mb-2 flex items-center gap-2">
          <Webhook /> Planned Sets API
        </h2>
        <p className="text-gray-500 font-bold mb-6 text-sm">
          Publishes all of your planned sets as JSON so another application can fetch them, and the
          sets you bought (day, price paid and the official price), which BrickBudget books as
          expenses. The list stays in sync automatically while this app is open. Anyone with the
          link can read it, so treat it like a password.
        </p>

        {error && (
          <div role="alert" className="mb-4 bg-red-50 border-2 border-red-200 text-red-600 font-bold text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-gray-400 font-bold text-center py-8">Loading...</p>
        ) : !list || !apiUrl ? (
          <div className="text-center py-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <p className="text-gray-500 font-bold uppercase mb-4">No API link yet</p>
            <button
              onClick={() => void createList()}
              disabled={busy || !ready}
              className="px-6 py-3 font-black text-sm uppercase bg-lego-blue text-white rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Creating...' : 'Create API Link'}
            </button>
          </div>
        ) : (
          <div>
            <label htmlFor="planned-list-url" className="block text-xs font-black uppercase text-gray-500 mb-1">
              Endpoint (GET)
            </label>
            <div className="flex w-full items-center bg-gray-100 rounded-lg border-2 border-gray-300 p-2 mb-3">
              <input
                id="planned-list-url"
                readOnly
                value={apiUrl}
                className="flex-1 bg-transparent border-none focus:ring-0 text-sm font-mono text-gray-700 outline-none px-2 cursor-text"
              />
              <button
                onClick={() => handleCopy(apiUrl)}
                className="ml-2 px-4 py-2 bg-black text-white font-black text-xs uppercase rounded hover:bg-gray-800 transition-colors flex items-center gap-2"
              >
                {copied ? <Check size={14} /> : <LinkIcon size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-gray-500 font-bold text-xs mb-6">
              {list.sets?.length ?? 0} of {plannedCount} planned sets and {list.purchases?.length ?? 0} of {purchaseCount} purchases
              published, last synced{' '}
              {new Date(list.updatedAt).toLocaleString()}.
            </p>

            <div className="flex flex-wrap justify-between gap-3">
              {confirmingDelete ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setConfirmingDelete(false)}
                    className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-black border-2 border-black rounded font-black text-xs uppercase transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void deleteList().then(() => setConfirmingDelete(false))}
                    disabled={busy}
                    className="px-3 py-2 bg-red-600 hover:brightness-110 text-white border-2 border-black rounded font-black text-xs uppercase transition-colors disabled:opacity-50"
                  >
                    Confirm Delete
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="px-3 py-2 bg-lego-red hover:brightness-110 text-white border-2 border-black rounded font-black text-xs uppercase flex items-center gap-2 transition-colors"
                >
                  <Trash2 size={14} /> Delete Link
                </button>
              )}
              <button
                onClick={() => void syncNow()}
                disabled={busy || !ready}
                className="px-3 py-2 bg-lego-blue hover:brightness-110 text-white border-2 border-black rounded font-black text-xs uppercase flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Sync Now
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </Modal>
  );
}
