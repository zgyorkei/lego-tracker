import { useEffect, useRef, useState } from 'react';
import { Bell, Package } from 'lucide-react';
import { noticeLabel, shortDate, unreadCount, type RetiringNotice } from '../lib/retiringInbox';

/** Brings a retiring set's card into view (SetCard carries data-set-number). */
export function showSetCard(setNumber: string): void {
  const el = Array.from(document.querySelectorAll<HTMLElement>('[data-set-number]')).find(
    (e) => e.dataset.setNumber === setNumber
  );
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

interface BellProps {
  inbox: RetiringNotice[];
  onReadAll: () => void;
  onReadOne: (setNumber: string) => void;
}

/** The header bell: a red count while something is unread, a dropdown with the list. */
export function RetiringBell({ inbox, onReadAll, onReadOne }: BellProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const unread = unreadCount(inbox);
  const bellLabel = unread ? `Notifications, ${unread} unread` : 'Notifications';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-full bg-black/5 hover:bg-black/10 transition-colors flex"
        aria-label={bellLabel}
        title={bellLabel}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute top-0 right-0 min-w-4 h-4 px-0.5 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center border-2 border-lego-yellow">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="region"
          aria-label="Notifications"
          className="absolute right-0 top-12 w-[min(340px,calc(100vw-2rem))] bg-white border-2 border-black rounded-lg shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] overflow-hidden z-[80] text-left"
        >
          <div className="px-3.5 py-2.5 border-b-2 border-black bg-gray-50 flex justify-between items-center text-[11px] font-black uppercase">
            <span>Notifications</span>
            <button
              type="button"
              onClick={onReadAll}
              disabled={!unread}
              className="text-blue-600 disabled:text-gray-400 uppercase font-black"
            >
              Mark all read
            </button>
          </div>
          {inbox.length === 0 ? (
            <p className="px-3.5 py-4 text-xs font-semibold text-gray-500">
              Nothing yet. A planned set that lands on LEGO&apos;s last-chance page shows up here.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {inbox.map((n) => (
                <li key={n.setNumber} className="border-b border-gray-100 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => {
                      onReadOne(n.setNumber);
                      setOpen(false);
                      showSetCard(n.setNumber);
                    }}
                    className={`w-full text-left px-3.5 py-3 flex gap-2.5 ${
                      n.read ? 'bg-white opacity-70' : 'bg-red-50'
                    } hover:bg-red-100`}
                  >
                    <span
                      aria-hidden="true"
                      className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.read ? 'bg-gray-300' : 'bg-red-600'}`}
                    />
                    <span>
                      <span className="block text-xs font-semibold text-gray-600 leading-snug">
                        <b className="text-gray-900">{noticeLabel(n)}</b> is on LEGO&apos;s
                        last-chance page. It is pinned to the top of your planned list.
                      </span>
                      <span className="block mt-1 text-[10px] font-bold uppercase text-gray-400">
                        {shortDate(n.at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface ToastProps {
  toasts: RetiringNotice[];
  onDismiss: (setNumber: string) => void;
  /** Called when the toast is opened, so the bell entry counts as read. */
  onOpen: (setNumber: string) => void;
}

/** The Windows-style toast, bottom right: the oldest waiting one, with a count of the rest. */
export function RetiringToast({ toasts, onDismiss, onOpen }: ToastProps) {
  const first = toasts[0];
  if (!first) return null;
  const more = toasts.length - 1;
  return (
    <div
      role="status"
      className="fixed right-5 bottom-5 w-[min(360px,calc(100vw-2.5rem))] bg-[#2b2b2b] text-white rounded-lg shadow-[0_8px_28px_rgba(0,0,0,0.45)] p-3.5 z-[90] font-[Segoe_UI,system-ui,sans-serif]"
    >
      <div className="flex justify-between text-[11px] text-[#bdbdbd] mb-2">
        <span>Brick Tracker</span>
        <span>{more > 0 ? `+${more} more` : 'now'}</span>
      </div>
      <div className="flex gap-3">
        <div className="w-11 h-11 rounded-md bg-lego-yellow shrink-0 flex items-center justify-center text-[#e3000b]">
          <Package size={28} aria-hidden="true" />
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-0.5">
            {first.name || first.setNumber} is retiring
          </h4>
          <p className="text-[12.5px] text-[#d6d6d6] leading-snug">
            {first.setNumber} just showed up on LEGO&apos;s last-chance page. Pinned to the top of
            your planned list.
          </p>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={() => {
            onOpen(first.setNumber);
            onDismiss(first.setNumber);
            showSetCard(first.setNumber);
          }}
          className="flex-1 bg-[#3c3c3c] hover:bg-[#4a4a4a] rounded py-1.5 text-[12.5px]"
        >
          Open
        </button>
        <button
          type="button"
          onClick={() => onDismiss(first.setNumber)}
          className="flex-1 bg-[#3c3c3c] hover:bg-[#4a4a4a] rounded py-1.5 text-[12.5px]"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
