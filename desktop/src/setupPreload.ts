import { contextBridge, ipcRenderer } from 'electron';
import type { SetupForm, SetupState } from './setup';

// The settings window's only access to the app (see setup.ts).
contextBridge.exposeInMainWorld('brickTrackerSetup', {
  load: (): Promise<SetupState> => ipcRenderer.invoke('setup:load'),
  pickOAuthClient: (): Promise<{ file: string | null; error?: string }> => ipcRenderer.invoke('setup:pickOAuthClient'),
  save: (form: SetupForm): Promise<{ error?: string }> => ipcRenderer.invoke('setup:save', form),
});
