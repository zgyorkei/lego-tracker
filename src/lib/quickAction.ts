/**
 * The three quick actions on the installed app's icon (pwa.config.ts) each open
 * the one screen with a query; this reads it, once, and says what to do.
 *
 *   /?add=set                          open the "track a set" form
 *   /?filter=planned&buy=pick          show the planned sets, to pick the one bought
 *   /?filter=planned&refresh=prices    show the planned sets and refresh their prices
 */
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
