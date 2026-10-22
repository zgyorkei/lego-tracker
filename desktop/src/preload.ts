import { contextBridge, ipcRenderer } from 'electron';

// The renderer's only window into the desktop shell. Its presence is what
// src/lib/platform.ts checks to switch the app into desktop mode.
contextBridge.exposeInMainWorld('legoTrackerDesktop', {
  isDesktop: true,
  /** Runs Google sign-in in the system browser; resolves with an ID token. */
  signInWithGoogle: (): Promise<string> => ipcRenderer.invoke('auth:google'),
});
