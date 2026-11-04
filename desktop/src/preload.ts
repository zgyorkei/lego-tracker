import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DesktopStoreBridge, StoreChange } from '../../lib/data/storeBridge';

// The local copy of the account's data (desktop/src/store/ipc.ts answers).
const store: DesktopStoreBridge = {
  open: (sub) => ipcRenderer.invoke('store:open', sub),
  status: () => ipcRenderer.invoke('store:status'),
  applySets: (snapshot) => ipcRenderer.invoke('store:applySets', snapshot),
  putPriceSources: (list) => ipcRenderer.invoke('store:putPriceSources', list),
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
};

// The renderer's only window into the desktop shell. Its presence is what
// src/lib/platform.ts checks to switch the app into desktop mode.
contextBridge.exposeInMainWorld('legoTrackerDesktop', {
  store,
  isDesktop: true,
  /** Runs Google sign-in in the system browser; resolves with an ID token. */
  signInWithGoogle: (): Promise<string> => ipcRenderer.invoke('auth:google'),
  // Synchronous on purpose: src/lib/firebaseConfig.ts reads it as the page's
  // scripts load, and the installer has no project built in, only the one
  // saved by the setup window (lib/appConfig.ts).
  config: ipcRenderer.sendSync('config:get'),
});
