/**
 * The three quick actions on the installed app's icon (pwa.config.ts) each open
 * the one screen with a query; this reads it, once, and says what to do.
 *
 *   /?add=set                          open the "track a set" form
 *   /?filter=planned&buy=pick          show the planned sets, to pick the one bought
 *   /?filter=planned&refresh=prices    show the planned sets and refresh their prices
 *
 * With pwa-kit's launch_handler focus-existing the installed app has one window: an action chosen while it is open
 * arrives through pwa-kit/launch (watchQuickActions) instead of as the page's address.
 */
import { onLaunch, type LaunchEnv } from 'pwa-kit/launch';

export interface QuickAction {
  add: boolean;
  filter: 'planned' | null;
  refreshPrices: boolean;
}

export function readQuickAction(search: string): QuickAction | null {
  const q = new URLSearchParams(search);
  const action: QuickAction = {
    add: q.get('add') === 'set',
    filter: q.get('filter') === 'planned' ? 'planned' : null,
    refreshPrices: q.get('refresh') === 'prices',
  };
  const isBuy = q.get('buy') === 'pick';
  if (!action.add && !action.filter && !action.refreshPrices && !isBuy) return null;
  // Both the purchase and the refresh start from the planned sets.
  if (isBuy || action.refreshPrices) action.filter = 'planned';
  return action;
}

/** The address without the action's keys, so a reload does not run it again. */
export function withoutQuickAction(href: string): string {
  const url = new URL(href);
  for (const key of ['add', 'filter', 'buy', 'refresh']) url.searchParams.delete(key);
  return url.pathname + url.search + url.hash;
}

/**
 * Hands each quick action that reaches the open window to `onAction`: a launch of the installed app while it is open
 * (the first launch is the page's own address, which App reads once at start, so it is not handed over twice).
 * A launch that is no quick action is ignored. Returns a function that stops it.
 */
export function watchQuickActions(
  onAction: (action: QuickAction) => void,
  env?: LaunchEnv
): () => void {
  return onLaunch((launch) => {
    if (launch.cold) return;
    const action = readQuickAction(launch.url.search);
    if (action) onAction(action);
  }, env);
}
