import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DesktopStoreBridge, StoreChange } from '../../lib/data/storeBridge';
import type { DesktopDriveBridge, DriveRefresh, DriveWorkerStatus } from '../../lib/drive/bridge';

/** A listener on a main-process event; returns the unsubscribe. */
function on<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Google Drive (desktop/src/drive): the state and the refreshes asked for;
// Drive tokens stay in the main process.
const drive: DesktopDriveBridge = {
  status: () => ipcRenderer.invoke('drive:status'),
  onStatus: (listener) => on<DriveWorkerStatus>('drive:status', listener),
  connect: () => ipcRenderer.invoke('drive:connect'),
  takeRefreshes: () => ipcRenderer.invoke('drive:takeRefreshes'),
  onRefresh: (listener) => on<DriveRefresh>('drive:refresh', listener),
  reply: (requestId, status, error) => ipcRenderer.invoke('drive:reply', requestId, status, error),
};

// The local copy of the account's data (desktop/src/store/ipc.ts answers).
const store: DesktopStoreBridge = {
  open: (sub) => ipcRenderer.invoke('store:open', sub),
  status: () => ipcRenderer.invoke('store:status'),
  applySets: (snapshot) => ipcRenderer.invoke('store:applySets', snapshot),
  putPriceSources: (list, source) => ipcRenderer.invoke('store:putPriceSources', list, source),
  historyWork: () => ipcRenderer.invoke('store:historyWork'),
  putHistoryPage: (setId, page) => ipcRenderer.invoke('store:putHistoryPage', setId, page),
  budgetLeft: (day) => ipcRenderer.invoke('store:budgetLeft', day),
  putBackup: (kind, data) => ipcRenderer.invoke('store:putBackup', kind, data),
  resolveHeld: (choice) => ipcRenderer.invoke('store:resolveHeld', choice),
  onChange: (listener) => {
    const handler = (_e: IpcRendererEvent, change: StoreChange) => listener(change);
    ipcRenderer.on('store:changed', handler);
    return () => ipcRenderer.removeListener('store:changed', handler);
  },
  sets: () => ipcRenderer.invoke('store:sets'),
  history: (setId) => ipcRenderer.invoke('store:history', setId),
  priceSources: () => ipcRenderer.invoke('store:priceSources'),
  applyLocal: (change) => ipcRenderer.invoke('store:applyLocal', change),
  planPush: () => ipcRenderer.invoke('store:planPush'),
  ackPush: (op) => ipcRenderer.invoke('store:ackPush', op),
  plannedList: () => ipcRenderer.invoke('store:plannedList'),
  setPlannedList: (list) => ipcRenderer.invoke('store:setPlannedList', list),
};

// The renderer's only window into the desktop shell. Its presence is what
// src/lib/platform.ts checks to switch the app into desktop mode.
contextBridge.exposeInMainWorld('legoTrackerDesktop', {
  store,
  drive,
  /** A fresh Google ID token from the desktop's Drive session, or null without one. */
  googleIdToken: (): Promise<string | null> => ipcRenderer.invoke('auth:idToken'),
  /** The page signed out: the desktop forgets its Google session. */
  googleSignedOut: (): Promise<void> => ipcRenderer.invoke('auth:signedOut'),
  /** The tray icon's tooltip line: the sync state, in a few words. */
  setTrayStatus: (text: string): void => ipcRenderer.send('tray:status', text),
  isDesktop: true,
  /** Runs Google sign-in in the system browser; resolves with an ID token. */
  signInWithGoogle: (): Promise<string> => ipcRenderer.invoke('auth:google'),
  /** Opens the settings window (the tray's "Settings..."); saving restarts the app. */
  openSettings: (): Promise<void> => ipcRenderer.invoke('settings:open'),
  // Synchronous on purpose: src/lib/firebaseConfig.ts reads it as the page's
  // scripts load, and the installer has no project built in, only the one
  // saved by the setup window (lib/appConfig.ts).
  config: ipcRenderer.sendSync('config:get'),
});
