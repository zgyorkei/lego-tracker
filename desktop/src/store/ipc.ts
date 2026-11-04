import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { LocalStore } from './localStore';
import type { StoreChange } from '../../../lib/data/storeBridge';

// The page's way into the local store (lib/data/storeBridge.ts describes it;
// the preload script exposes it as window.legoTrackerDesktop.store). Only the
// app's own page may call it, the same check the sign-in and setup channels
// use, and the store re-checks every argument: nothing the page sends becomes
// a path. Local data is never served over HTTP.

export function registerStoreIpc(
  store: LocalStore,
  appOrigin: string,
  getWindow: () => BrowserWindow | null
): void {
  const fromApp = (e: IpcMainInvokeEvent) => {
    if (!e.senderFrame?.url.startsWith(appOrigin)) throw new Error('Unexpected sender');
  };
  const handle = (channel: string, fn: (...args: never[]) => unknown) =>
    ipcMain.handle(channel, (e, ...args) => {
      fromApp(e);
      return (fn as (...a: unknown[]) => unknown)(...args);
    });

  handle('store:open', (sub: string) => store.open(sub));
  handle('store:status', () => store.status());
  handle('store:applySets', (snap: Parameters<LocalStore['applySets']>[0]) =>
    store.applySets(snap)
  );
  handle('store:putPriceSources', (list: unknown[] | null) => store.putPriceSources(list));
  handle('store:historyWork', () => store.historyWork());
  handle(
    'store:putHistoryPage',
    (setId: string, page: Parameters<LocalStore['putHistoryPage']>[1]) =>
      store.putHistoryPage(setId, page)
  );
  handle('store:budgetLeft', (day: string) => store.budgetLeft(String(day)));
  handle('store:putBackup', (kind: Parameters<LocalStore['putBackup']>[0], data: unknown) =>
    store.putBackup(kind, data)
  );
  handle('store:resolveHeld', (choice: 'delete' | 'keep') => store.resolveHeld(choice));
  handle('store:sets', () => store.sets());
  handle('store:history', (setId: string) => store.history(setId));
  handle('store:priceSources', () => store.priceSources());
  handle('store:applyLocal', (change: Parameters<LocalStore['applyLocal']>[0]) =>
    store.applyLocal(change)
  );
  handle('store:planPush', () => store.planPush());
  handle('store:ackPush', (op: Parameters<LocalStore['ackPush']>[0]) => store.ackPush(op));

  store.on('change', (change: StoreChange) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('store:changed', change);
  });
}
