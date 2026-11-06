import { CloudOff, HardDrive, RefreshCw } from 'lucide-react';
import { isFresh, type DriveStatus } from '../../lib/drive/layout';
import { stepsFor, type Health } from '../lib/dataHealth';
import type { SourceChoice } from '../lib/dataSource';

const ago = (iso: string | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 'a while ago';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${Math.round(h / 24)} days ago`;
};

const bar = 'border-b-4 border-black px-4 py-2 flex flex-wrap items-center gap-3';
const button =
  'px-3 py-1 bg-white text-black border-2 border-black rounded font-black text-xs uppercase flex items-center gap-1 disabled:opacity-60';

/**
 * Website: where the sets come from when that is worth saying (local-storage
 * plan, Phase 6). Firebase failing, with the desktop's copy one Google sign-in
 * away (the button is the click the sign-in popup needs); shown the desktop's
 * copy because Firebase failed, with "Switch back" once it answers again; the
 * desktop no longer syncing to Firebase; the desktop not seen for a while.
 */
export function DataSourceBanner(props: {
  choice: SourceChoice;
  /** Why Firestore failed, when it did. */
  firestoreHealth: Health | null;
  /** Firestore answered the last check again. */
  firestoreBack: boolean;
  /** This website has a Firebase project (else the desktop's copy is all there is). */
  firebase: boolean;
  driveStatus: DriveStatus | null;
  /** The Drive backend has read the folder (so a missing status means no desktop publishes). */
  driveChecked: boolean;
  signingIn: boolean;
  onUseDesktop: () => void;
  onSwitchBack: () => void;
}) {
  const { choice, firestoreHealth, driveStatus } = props;
  const why = firestoreHealth ? stepsFor(firestoreHealth.kind).title : 'Firebase is not answering';

  if (choice.offerDesktop)
    return (
      <div role="alert" className={`${bar} bg-lego-red text-white`}>
        <CloudOff size={18} className="shrink-0" />
        <p className="font-black text-sm flex-1 min-w-[12rem]">
          {why}. Your desktop&apos;s copy can be shown instead, through your Google Drive.
        </p>
        <button onClick={props.onUseDesktop} disabled={props.signingIn} className={button}>
          <HardDrive size={12} /> {props.signingIn ? 'Signing in...' : "Use my desktop's copy"}
        </button>
      </div>
    );

  if (choice.source !== 'drive') return null;

  const notes: string[] = [];
  if (props.firebase && driveStatus?.mode === 'local')
    notes.push('Your desktop keeps its sets on that PC only now: it no longer syncs to Firebase.');
  if (driveStatus && !isFresh(driveStatus))
    notes.push(
      `Your desktop (${driveStatus.publisherName}) was last seen ${ago(driveStatus.heartbeatAt)}. Changes wait in Google Drive until it runs.`
    );
  else if (!driveStatus && props.driveChecked)
    notes.push(
      'No desktop is publishing its copy right now. Changes wait in Google Drive until one runs.'
    );

  if (choice.switched)
    return (
      <div role="status" className={`${bar} bg-lego-blue text-white`}>
        <HardDrive size={18} className="shrink-0" />
        <p className="font-black text-sm flex-1 min-w-[12rem]">
          {why}, so this shows your desktop&apos;s copy through Google Drive.{' '}
          {props.firestoreBack
            ? 'Firebase answers again.'
            : 'Firebase is checked again every 5 minutes.'}
          {notes.map((n) => ` ${n}`)}
        </p>
        {props.firestoreBack && (
          <button onClick={props.onSwitchBack} className={button}>
            <RefreshCw size={12} /> Switch back
          </button>
        )}
      </div>
    );

  if (!notes.length) return null;
  return (
    <div role="status" className={`${bar} bg-gray-100 text-black`}>
      <HardDrive size={18} className="shrink-0" />
      <p className="font-bold text-sm flex-1 min-w-[12rem]">{notes.join(' ')}</p>
    </div>
  );
}
