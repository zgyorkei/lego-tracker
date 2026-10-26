import { contextBridge, ipcRenderer } from 'electron';

// The renderer's only window into the desktop shell. Its presence is what
// src/lib/platform.ts checks to switch the app into desktop mode.
contextBridge.exposeInMainWorld('legoTrackerDesktop', {
  isDesktop: true,
  /** Runs Google sign-in in the system browser; resolves with an ID token. */
  signInWithGoogle: (): Promise<string> => ipcRenderer.invoke('auth:google'),
  // Synchronous on purpose: src/lib/firebase.ts initialises Firebase as the
  // page's scripts load, and the installer has no project built in, only the
  // one saved by the setup window (lib/appConfig.ts).
  config: ipcRenderer.sendSync('config:get'),
});
