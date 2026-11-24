import { describe, expect, it } from 'vitest';
import { buildManifest } from 'pwa-kit/manifest';
import type { LaunchEnv, LaunchParamsLike } from 'pwa-kit/launch';
import pwa from '../../pwa.config';
import { readQuickAction, watchQuickActions, withoutQuickAction, type QuickAction } from './quickAction';

describe('quick actions', () => {
  it('reads the three actions the manifest opens', () => {
    expect(readQuickAction('?add=set')).toEqual({ add: true, filter: null, refreshPrices: false });
    expect(readQuickAction('?filter=planned&buy=pick')).toEqual({
      add: false,
      filter: 'planned',
      refreshPrices: false,
    });
    expect(readQuickAction('?filter=planned&refresh=prices')).toEqual({
      add: false,
      filter: 'planned',
      refreshPrices: true,
    });
  });

  it('is null for an ordinary open or an unknown value', () => {
    expect(readQuickAction('')).toBeNull();
    expect(readQuickAction('?add=other&filter=all&refresh=x')).toBeNull();
  });

  it('takes the action out of the address and keeps the rest', () => {
    expect(withoutQuickAction('https://x.test/?filter=planned&refresh=prices')).toBe('/');
    expect(withoutQuickAction('https://x.test/registry/abc?add=set&utm=1#top')).toBe(
      '/registry/abc?utm=1#top'
    );
  });
});

describe('the web manifest', () => {
  it('carries launch_handler focus-existing, so a quick action focuses the open window', () => {
    expect(buildManifest(pwa).launch_handler).toEqual({ client_mode: ['focus-existing', 'auto'] });
  });
});

// A fake launchQueue and clock: the browser's launches and the timer are driven by the test.
function fake(href = 'https://lego.test/') {
  let consumer: ((p: LaunchParamsLike) => void) | undefined;
  let timer: (() => void) | undefined;
  const env: LaunchEnv = {
    href,
    launchQueue: { setConsumer: (c) => { consumer = c; } },
    setTimeout: (fn) => { timer = fn; return 1; },
    clearTimeout: () => { timer = undefined; },
  };
  const got: QuickAction[] = [];
  watchQuickActions((a) => got.push(a), env);
  return {
    got,
    launch: (target: string) => consumer?.({ targetURL: `https://lego.test${target}` }),
    tick: () => { const t = timer; timer = undefined; t?.(); },
  };
}

describe('a quick action arriving while the app is open', () => {
  it('runs each one, once, in the open window', () => {
    const f = fake();
    f.launch('/'); // the launch that opened the window
    f.launch('/?add=set');
    f.launch('/?filter=planned&buy=pick');
    f.launch('/?filter=planned&refresh=prices');
    expect(f.got).toEqual([
      { add: true, filter: null, refreshPrices: false },
      { add: false, filter: 'planned', refreshPrices: false },
      { add: false, filter: 'planned', refreshPrices: true },
    ]);
  });

  it('does not run a cold start twice: App reads the page\'s address itself', () => {
    const f = fake('https://lego.test/?add=set');
    f.launch('/?add=set'); // launchQueue's copy of the cold start
    f.tick();
    expect(f.got).toEqual([]);
    f.launch('/?add=set'); // a real second launch of the same action
    expect(f.got).toHaveLength(1);
  });

  it('ignores a launch that is no quick action', () => {
    const f = fake();
    f.launch('/');
    f.launch('/registry/abc');
    expect(f.got).toEqual([]);
  });

  it('does nothing in a browser without launchQueue', () => {
    const got: QuickAction[] = [];
    watchQuickActions((a) => got.push(a), { href: 'https://lego.test/?add=set' });
    expect(got).toEqual([]);
  });
});