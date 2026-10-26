import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  LogIn,
  Package,
  ShoppingBag,
  RefreshCcw,
  RefreshCw,
  Loader2,
  X,
  Eye,
  AlertTriangle,
  LogOut as LogOutIcon,
  Palette,
  Gift,
  Webhook
} from 'lucide-react';
import { useSets } from './hooks/useSets';
import { usePlannedList } from './hooks/usePlannedList';
import { signInWithGoogle, signOut } from './lib/firebase';
import { formatPrice as formatPriceUtil } from './lib/currency';
import { ClassicSpaceLogo } from './components/ClassicSpaceLogo';
import { SetCard } from './components/SetCard';
import { GiftRegistryDialog } from './components/GiftRegistryDialog';
import { PlannedListDialog } from './components/PlannedListDialog';
import { TeachSourcePanel } from './components/TeachSourcePanel';
import { SourceIdInput } from './components/SourceIdInput';
import { identityFromQuotes, mergeLookupName } from './lib/setIdentity';
import { scheduleDailyRun, useDesktopWorker, type RunRefresh } from './hooks/useDesktopWorker';
import { withUrlTemplate } from './lib/priceSources';
import { Modal } from './components/Modal';
import { Status, Priority, DEFAULT_PRICE_SOURCES, PERMANENT_SOURCE_IDS, LegoSet, PriceHistory, SUPPORTED_CURRENCIES, isSupportedCurrency, isPriceQuote } from './types';
import { DEMO_SETS, demoPriceHistory } from './demoData';
import { readStoredString, readStoredJson, writeStored } from './lib/storage';
import { usePriceSources } from './hooks/usePriceSources';
import { isDesktopApp } from './lib/platform';

// Same rule as isValidSetNumber on the server; /api/teach-source rejects the
// whole request if any sample fails it.
const isValidTeachSet = (n: string) => /^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(n);

const getMockSets = (): LegoSet[] => {
  let sourceSets = DEMO_SETS;
  const parsed = readStoredJson<LegoSet[] | null>('cachedSets', null);
  if (Array.isArray(parsed) && parsed.length > 0) {
    sourceSets = parsed;
  }
  // A visitor (nothing cached) gets the whole curated demo, in a fixed order,
  // so every feature is on show; the random pick below is for previewing the
  // demo with your own cached sets.
  if (sourceSets === DEMO_SETS) return DEMO_SETS;

  // selection: one from each priority, one minifigures series and at least one purchased
  const high = sourceSets.filter(s => s.priority === 'high');
  const medium = sourceSets.filter(s => s.priority === 'medium');
  const low = sourceSets.filter(s => s.priority === 'low');
  const minifigs = sourceSets.filter(s => (s.minifigures && s.minifigures.length > 0) || (s.name && s.name.toLowerCase().includes('minifigure')));
  const purchased = sourceSets.filter(s => s.status === 'ordered');

  const selected: LegoSet[] = [];
  const addRandom = (arr: LegoSet[]) => {
    if (arr.length > 0) {
      const rnd = arr[Math.floor(Math.random() * arr.length)];
      if (!selected.find(s => s.id === rnd.id)) {
        selected.push(rnd);
      }
    }
  };

  addRandom(high);
  addRandom(medium);
  addRandom(low);
  addRandom(minifigs);
  addRandom(purchased);

  // If we couldn't find enough to show, just return the source Sets or defaults
  if (selected.length === 0) return DEMO_SETS;
  
  return selected;
};

const AVAILABLE_THEMES = [
  { id: 'classic', name: 'Classic Space' },
  { id: 'batman', name: 'Batman' },
  { id: 'star-wars', name: 'Star Wars' },
  { id: 'ninjago', name: 'Ninjago' },
  { id: 'hidden-side', name: 'Hidden Side' },
  { id: 'bionicle', name: 'Bionicle' },
  { id: 'technic', name: 'Technic' },
  { id: 'friends', name: 'Friends' },
  { id: 'castle', name: 'Castle/City' }
];

export default function App() {
  const { sets, loading, error: setsError, addSet, updateSet, deleteSet, addPriceHistory, getPriceHistory, user } = useSets();
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [mockSets, setMockSets] = useState<LegoSet[]>(() => getMockSets());

  // Cache sets whenever they change
  useEffect(() => {
    if (sets && sets.length > 0) {
      writeStored('cachedSets', sets);
    }
  }, [sets]);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [sortBy, setSortBy] = useState<string>('date-desc');
  const [isAdding, setIsAdding] = useState(false);
  const [newSetNumber, setNewSetNumber] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('medium');
  const [searchingLego, setSearchingLego] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeOperation, setActiveOperation] = useState<{setId: string, message: string} | null>(null);
  const [isBatchRefreshing, setIsBatchRefreshing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number} | null>(null);
  const [showPriceSourcesSetting, setShowPriceSourcesSetting] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(() => readStoredString('brickTrackerTheme', 'classic'));
  const [showThemeSelector, setShowThemeSelector] = useState(false);
  const [showGiftRegistry, setShowGiftRegistry] = useState(false);
  const [showPlannedList, setShowPlannedList] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  // The click handler used to be signInWithGoogle itself, so a failure (on a
  // phone, typically a blocked sign-in pop-up) did nothing visible at all.
  const handleSignIn = async () => {
    setSignInError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      console.error('Sign-in failed', err);
      setSignInError(
        code === 'auth/popup-blocked'
          ? 'Your browser blocked the Google sign-in window. Allow pop-ups for this site, then try again.'
          : err instanceof Error && err.message.startsWith('Sign-in')
            ? err.message
            : 'Sign-in failed. Please try again.'
      );
    }
  };
  const [displayCurrency, setDisplayCurrency] = useState<string>(() => readStoredString('legoDisplayCurrency', 'HUF'));
  const [exchangeRates, setExchangeRates] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    if (currentTheme === 'classic') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', currentTheme);
    }
    writeStored('brickTrackerTheme', currentTheme);
  }, [currentTheme]);

  const activeSets = isDemoMode ? mockSets : sets;

  useEffect(() => {
     fetch('/api/exchange-rates')
       .then(res => res.json())
       .then(data => {
          if (data.rates) {
             setExchangeRates({ ...data.rates, EUR: 1 });
          }
       })
       .catch(err => console.error("Could not fetch exchange rates:", err));
  }, []);

  const { priceSources, savePriceSources, error: priceSourcesError } = usePriceSources(user, isDemoMode);

  // Sets a new source is taught with: planned sets that some shop already
  // prices first (likely to be stocked), then any other planned set.
  const teachSamples = useMemo(() => {
    const planned = sets.filter(s => s.status === 'planned' && isValidTeachSet(s.setNumber));
    const priced = planned.filter(s => Object.values(s.marketPrices ?? {}).some(isPriceQuote));
    const ordered = [...priced, ...planned.filter(s => !priced.includes(s))].map(s => s.setNumber);
    return [...new Set(ordered)].slice(0, 3);
  }, [sets]);

  // Lives here rather than in its dialog so the published list keeps syncing
  // whenever the app is open, not only while the dialog is showing. Held back
  // while sets are loading or failed, so an empty/cached array is never synced.
  const plannedList = usePlannedList(
    isDemoMode ? null : user,
    sets,
    priceSources,
    !isDemoMode && !loading && !setsError
  );

  const filteredSets = useMemo(() => {
    let result = activeSets;
    if (filter !== 'all') {
      result = activeSets.filter(s => s.status === filter);
    }
    
    result = [...result].sort((a, b) => {
      // Automatically place ordered (purchased) sets at the end
      if (a.status === 'ordered' && b.status !== 'ordered') return 1;
      if (a.status !== 'ordered' && b.status === 'ordered') return -1;

      const pVals: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
      
      switch (sortBy) {
        case 'priority-desc': {
          const pA = pVals[a.priority || 'medium'];
          const pB = pVals[b.priority || 'medium'];
          if (pA !== pB) return pB - pA;
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        }
        case 'priority-asc': {
          const pA = pVals[a.priority || 'medium'];
          const pB = pVals[b.priority || 'medium'];
          if (pA !== pB) return pA - pB;
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        }
        case 'name-asc': {
          const nameA = (a.name || '').toLowerCase();
          const nameB = (b.name || '').toLowerCase();
          if (nameA < nameB) return -1;
          if (nameA > nameB) return 1;
          return 0;
        }
        case 'name-desc': {
          const nameA = (a.name || '').toLowerCase();
          const nameB = (b.name || '').toLowerCase();
          if (nameA < nameB) return 1;
          if (nameA > nameB) return -1;
          return 0;
        }
        case 'set-asc': {
          const setA = parseInt(a.setNumber) || 0;
          const setB = parseInt(b.setNumber) || 0;
          return setA - setB;
        }
        case 'set-desc': {
          const setA = parseInt(a.setNumber) || 0;
          const setB = parseInt(b.setNumber) || 0;
          return setB - setA;
        }
        case 'date-asc': {
          const dateA = new Date(a.createdAt || 0).getTime();
          const dateB = new Date(b.createdAt || 0).getTime();
          return dateA - dateB;
        }
        case 'date-desc':
        default: {
          const dateA = new Date(a.createdAt || 0).getTime();
          const dateB = new Date(b.createdAt || 0).getTime();
          return dateB - dateA;
        }
      }
    });
    
    return result;
  }, [activeSets, filter, sortBy]);

  // Mirrors isBatchRefreshing for code that must not wait for a re-render: the
  // desktop worker checks it before starting a request, and a second refresh
  // must not start in the gap before the state update lands.
  const isBatchRefreshingRef = useRef(false);
  const setsRef = useRef(sets);
  useEffect(() => {
    setsRef.current = sets;
  });

  // Desktop app: runs a refresh the website handed over (useDesktopWorker).
  // Waits for a refresh already under way (the 4AM run, or one started here).
  const runDesktopRequest = useCallback<RunRefresh>(async (kind, setIds) => {
    const deadline = Date.now() + 30 * 60 * 1000;
    while (isBatchRefreshingRef.current) {
      if (Date.now() > deadline) throw new Error('The desktop app was busy with another refresh');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    const targets = setsRef.current.filter(s => setIds.includes(s.id));
    if (targets.length === 0) return;
    const ran = await batchRefreshRef.current(kind === 'prices', { targets, skipPrices: kind === 'details' });
    if (!ran) throw new Error('Another refresh started first');
  }, []);

  // The desktop app as the website's scraper: on the website `delegate` hands a
  // refresh to it, in the desktop app this works through those requests.
  const { desktopOnline, delegate } = useDesktopWorker(user, isDemoMode, isDesktopApp ? runDesktopRequest : undefined);

  /**
   * Refreshes set details and/or market prices. `targets` defaults to the sets
   * in view; `skipPrices` stops after the details (a card's info refresh run
   * by the desktop for the website). Resolves false if another refresh was
   * already running.
   */
  const handleBatchRefresh = async (
    skipLegoInfo = false,
    opts: { targets?: LegoSet[]; skipPrices?: boolean } = {}
  ): Promise<boolean> => {
    const targets = opts.targets ?? filteredSets;
    if (isBatchRefreshingRef.current || targets.length === 0) return false;
    isBatchRefreshingRef.current = true;
    setIsBatchRefreshing(true);

    try {
    // Website: hand the whole job to the desktop app when it is running. It
    // reads the shops in its own browser, so no AI is spent, and the results
    // arrive through the live sets subscription. Gemini only if it can't.
    if (!opts.targets && !isDesktopApp && desktopOnline) {
      setActiveOperation({
        setId: 'Bulk',
        message: `Refreshing ${targets.length} sets in the desktop app (local browser, no AI). This can take a while...`,
      });
      const outcome = await delegate(skipLegoInfo ? 'prices' : 'all', targets.map(s => s.id));
      if (outcome === 'done') return true;
      if (outcome === 'failed') setActionError('The desktop app could not finish the refresh, so Gemini is used instead.');
    }

    const headers = {};
    // What this run has already written per set. targets is a snapshot from
    // before the run, so without this a name the details step just found
    // would still look like a placeholder when the price step fills gaps.
    const resolved = new Map<string, Partial<LegoSet>>();

    if (!skipLegoInfo) {
      setBatchProgress({ current: 0, total: targets.length });
      // Track which sets already have an image (pre-existing or fetched in the
      // loop below) so the remaining gaps can be filled with a single
      // /api/batch-images call afterwards.
      const imagesResolved = new Set<string>();
      targets.forEach(s => { if (s.productImage) imagesResolved.add(s.setNumber); });
      for (let i = 0; i < targets.length; i++) {
          setBatchProgress({ current: i + 1, total: targets.length });
          const set = targets[i];
          
          if (i > 0) {
              await new Promise(resolve => setTimeout(resolve, 500));
          }

          try {
              setActiveOperation({ setId: set.setNumber, message: 'Fetching Set Data & Image' });

              const legoRes = await fetch(`/api/lego/${set.setNumber}`, { headers });
              if (legoRes.status === 429) {
                  setActionError("Rate limit reached while fetching set info. Please wait a minute and try again.");
                  break; // stop lego info updates
              }
              if (legoRes.ok) {
                  const legoData = await legoRes.json();
                  if (legoData?.image) imagesResolved.add(set.setNumber);
                  if (legoData && legoData.priceHuf !== undefined) {
                      // A placeholder ("633412-1") never replaces a real name.
                      const finalName = mergeLookupName(legoData.name, set);
                      const updates: any = {
                         name: finalName,
                         ...(legoData.image ? { productImage: legoData.image } : {}),
                         legoUrl: legoData.url || set.legoUrl,
                         legoPriceError: false,
                         isTemporary: legoData.isTemporary || false,
                         releaseDate: legoData.releaseDate || null,
                         hasFetchedLegoInfo: true,
                         lastLegoPriceRefreshTime: Date.now()
                      };
                      if (legoData.priceHuf > 0 || !set.legoPriceHuf) {
                          updates.legoPriceHuf = legoData.priceHuf;
                      }
                      
                      if ((finalName || '').toLowerCase().includes('minifigure') || set.setNumber.length > 5 || set.name.toLowerCase().includes('minifigure')) {
                          setActiveOperation({ setId: set.setNumber, message: 'Fetching Minifigures' });
                          try {
                              const mfRes = await fetch(`/api/minifigures/${set.setNumber}`);
                              if (mfRes.ok) {
                                  const mfData = await mfRes.json();
                                  if (mfData.figures && mfData.figures.length > 0) {
                                      updates.minifigures = mfData.figures;
                                      updates.minifiguresStatus = set.minifiguresStatus || {};
                                  }
                              }
                          } catch(e) {}
                      }
                      
                      await updateSet(set.id, updates);
                      resolved.set(set.id, updates);
                  }
              }
          } catch (e) {
              console.error('Batch update failed for set lego info', set.setNumber, e);
          }
      }

      // Gap-fill: any sets still without an image get one via a single batched
      // call (cheerio-first; misses go to Gemini on the web, the local browser
      // on desktop).
      const setsMissingImage = targets.filter(s => !imagesResolved.has(s.setNumber));
      if (setsMissingImage.length > 0) {
          try {
              setActiveOperation({ setId: 'Bulk', message: 'Fetching Missing Images...' });
              const imgRes = await fetch('/api/batch-images', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ setNumbers: setsMissingImage.map(s => s.setNumber) })
              });
              if (imgRes.ok) {
                  const imageMap: Record<string, string> = await imgRes.json();
                  // Parallel rather than one sequential write per set.
                  await Promise.allSettled(
                      setsMissingImage
                          .filter(s => imageMap[s.setNumber])
                          .map(s => {
                              resolved.set(s.id, { ...resolved.get(s.id), productImage: imageMap[s.setNumber] });
                              return updateSet(s.id, { productImage: imageMap[s.setNumber] });
                          })
                  );
              }
          } catch (e) {
              console.error('Batch image gap-fill failed', e);
          }
      }
    }

    // Batch market prices
    if (!opts.skipPrices) try {
        setBatchProgress(null);
        setActiveOperation({
          setId: 'Bulk',
          // The desktop app reads every shop page in its own browser, one at a
          // time, so a full refresh takes minutes rather than seconds.
          message: isDesktopApp
            ? `Reading market prices in the local browser for ${targets.length} sets. This takes a few minutes...`
            : 'Fetching Market Prices via Gemini...',
        });
        const setNumbers = targets.map(s => s.setNumber);
        const marketRes = await fetch(`/api/prices-batch`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ setNumbers, sources: priceSources })
        });
        if (marketRes.status === 429) {
            setActionError("Rate limit reached while fetching market prices. Please wait a minute and try again.");
        } else if (marketRes.ok) {
            const batchPrices = await marketRes.json();
            const today = new Date().toISOString().split('T')[0];

            // Collected and flushed in parallel below. Previously this awaited
            // updateSet then addPriceHistory one set at a time, so 50 sets meant
            // 100 sequential Firestore round-trips.
            const setUpdates: Promise<void>[] = [];
            const historyEntries: { setId: string; entry: PriceHistory }[] = [];

            for (const set of targets) {
                const marketPrices = batchPrices[set.setNumber];
                if (marketPrices) {
                    setUpdates.push(updateSet(set.id, {
                        marketPrices,
                        lastPricesRefreshTime: Date.now(),
                        // Name and image from a shop listing, only where the set
                        // still has none (e.g. promotional items like 633412).
                        ...identityFromQuotes({ ...set, ...resolved.get(set.id) }, marketPrices, priceSources),
                    }));

                    const historyEntry: PriceHistory = {
                        date: today,
                        exchangeRate: marketPrices.exchangeRate ?? 0
                    };

                    priceSources.forEach(s => {
                        const quote = marketPrices[s.id];
                        if (isPriceQuote(quote)) {
                            historyEntry[`${s.id}Price`] = quote.price;
                            // Also store the HUF-normalised value: '...Price' is
                            // in the source's own currency, so it cannot be
                            // compared across sources or charted on one axis.
                            historyEntry[`${s.id}PriceHuf`] = quote.priceHuf;
                        }
                    });

                    historyEntries.push({ setId: set.id, entry: historyEntry });
                }
            }

            // allSettled so one rejected write cannot abandon the rest.
            const results = await Promise.allSettled([
                ...setUpdates,
                ...historyEntries.map(h => addPriceHistory(h.setId, h.entry)),
            ]);
            const failed = results.filter(r => r.status === 'rejected').length;
            if (failed > 0) {
                console.error(`${failed} of ${results.length} price writes failed`);
                setActionError(`Saved prices for some sets, but ${failed} write(s) failed.`);
            }
        }
    } catch(e) {
        console.error('Batch market prices failed', e);
        setActionError('Could not refresh market prices. Please try again.');
    }
    return true;
    } finally {
      isBatchRefreshingRef.current = false;
      setIsBatchRefreshing(false);
      setBatchProgress(null);
      setActiveOperation(null);
    }
  };

  // Always points at the current handleBatchRefresh, so the scheduler below
  // can call it without listing it as a dependency. Previously the interval
  // closed over the first render's copy and refreshed a stale set list.
  const batchRefreshRef = useRef(handleBatchRefresh);
  useEffect(() => {
    batchRefreshRef.current = handleBatchRefresh;
  });

  // Daily refresh at 04:00 local time.
  //
  // Desktop app only. Automatic refreshes moved there because it scrapes with a
  // local browser instead of spending Gemini quota; on the web this would burn
  // credits on every open tab, so the web app refreshes only on request.
  //
  // The run itself is a shared request with a fixed id per day
  // (scheduleDailyRun), so with the desktop app signed in on several machines
  // exactly one of them does it; useDesktopWorker's claim decides which.
  const filteredSetsRef = useRef(filteredSets);
  useEffect(() => {
    filteredSetsRef.current = filteredSets;
  });
  const uid = user?.uid ?? null;
  useEffect(() => {
    if (!isDesktopApp || !uid || isDemoMode) return;
    let running = false;

    const checkSchedule = async () => {
      if (running) return;
      // A "refresh day" starts at 04:00 local: shifting the clock back four
      // hours makes 00:00-03:59 count as the previous day. The run therefore
      // fires at 4AM, or on the first check after it if the PC was off then.
      const shifted = new Date(Date.now() - 4 * 60 * 60 * 1000);
      const pad = (n: number) => String(n).padStart(2, '0');
      const quotaDay = `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;

      const lastRefresh = readStoredString('brickTrackerLastDailyRefresh', '');
      if (lastRefresh === quotaDay) return;

      running = true;
      try {
        // Market prices only. Creates (or retries) today's request; this or
        // another desktop's worker runs it. Checked again every minute until
        // some desktop reports it done, and only then marked locally, so a
        // reload or crash mid-run does not skip the day.
        const action = await scheduleDailyRun(uid, quotaDay, filteredSetsRef.current.map(s => s.id));
        if (action === 'done') writeStored('brickTrackerLastDailyRefresh', quotaDay);
      } catch (e) {
        console.error('Scheduling the daily refresh failed; will retry on the next tick', e);
      } finally {
        running = false;
      }
    };

    void checkSchedule();
    const interval = setInterval(() => void checkSchedule(), 60 * 1000);
    return () => clearInterval(interval);
    // Deliberately depends only on whether there is anything to refresh and
    // who is signed in. isBatchRefreshing was previously a dependency, which
    // tore down and re-ran the scheduler every time a batch started and finished.
  }, [filteredSets.length, uid, isDemoMode]);

  const formatPrice = (priceHuf: number) => formatPriceUtil(priceHuf, displayCurrency, exchangeRates);

  const stats = useMemo(() => {
    const ordered = activeSets.filter(s => s.status === 'ordered');
    
    const plannedTotal = activeSets.reduce((acc, s) => acc + ((s.legoPriceHuf || 0) * (s.quantity || 1)), 0);
    const orderedLegoRetail = ordered.reduce((acc, s) => acc + ((s.legoPriceHuf || 0) * (s.quantity || 1)), 0);
    const orderedTotal = ordered.reduce((acc, s) => acc + ((s.orderedPriceHuf || 0) * (s.quantity || 1)), 0);
    const savings = ordered.reduce((acc, s) => {
      if (s.legoPriceHuf && s.legoPriceHuf > 0 && typeof s.orderedPriceHuf === 'number') {
        return acc + ((s.legoPriceHuf - s.orderedPriceHuf) * (s.quantity || 1));
      }
      return acc;
    }, 0);

    return { plannedTotal, orderedLegoRetail, orderedTotal, savings };
  }, [activeSets]);

  // Hoisted out of the SetCard JSX: as an inline arrow it was a fresh function
  // on every render, which defeated memoising SetCard entirely.
  // Demo Mode has no Firestore history to read; the demo sets get generated
  // readings instead, so the price-history chart has something to show.
  const priceHistoryFor = useCallback(
    async (id: string): Promise<PriceHistory[]> => {
      if (!isDemoMode) return getPriceHistory(id);
      const set = mockSets.find(s => s.id === id);
      return set ? demoPriceHistory(set) : [];
    },
    [isDemoMode, mockSets, getPriceHistory]
  );

  const handleDeleteSet = useCallback((id: string) => {
    if (isDemoMode) {
      setMockSets(prev => prev.filter(s => s.id !== id));
      return;
    }
    deleteSet(id).catch(() => {
      /* useSets surfaces the message via setsError */
    });
  }, [isDemoMode, deleteSet]);

  const handleAddSet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSetNumber || searchingLego) return;

    // The busy state drives the spinner, the disabled inputs and the
    // "Fetching..." label in the add-set form. It was previously never set, so
    // all of that UI was unreachable and a slow addSet looked like a no-op.
    setSearchingLego(true);
    try {
      await addSet({
        setNumber: newSetNumber,
        name: `Lego Set ${newSetNumber}`,
        legoPriceHuf: 0,
        productImage: null,
        legoUrl: null,
        status: 'planned',
        priority: newPriority,
        isTemporary: false,
        releaseDate: null,
        hasFetchedLegoInfo: false,
      });
      setNewSetNumber('');
      setIsAdding(false);
    } catch (err) {
      console.error('Failed to add set', err);
      setActionError('Could not add that set. Please try again.');
    } finally {
      setSearchingLego(false);
    }
  };

  if (!user && !isDemoMode) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="lego-card p-8 max-w-md w-full text-center"
        >
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-lego-yellow rounded-xl border-4 border-black flex items-center justify-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
               <ClassicSpaceLogo size={48} />
            </div>
          </div>
          <h1 className="text-4xl font-black text-lego-red uppercase tracking-tighter mb-2">Brick Tracker</h1>
          <p className="text-gray-500 font-bold mb-8 uppercase text-sm tracking-widest">Plan. Track. Save.</p>
          <div className="space-y-3">
            {signInError && (
              <div role="alert" className="bg-red-50 border-2 border-red-200 text-red-600 font-bold text-sm rounded-lg px-4 py-3 text-left">
                {signInError}
              </div>
            )}
            <button
              onClick={() => void handleSignIn()}
              className="lego-button bg-lego-blue w-full flex items-center justify-center gap-3"
            >
              <LogIn size={20} /> Login with Google
            </button>
            <button 
              onClick={() => setIsDemoMode(true)}
              className="w-full flex items-center justify-center gap-3 py-3 border-2 border-black rounded-lg font-black uppercase text-sm bg-white hover:bg-gray-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px] transition-all"
            >
              <Eye size={20} /> Try Demo Mode
            </button>
            {/* Built in, so it works on every deployment. This used to link a
                real registry on one site, which had since been deleted. */}
            <a
              href="/registry/demo"
              target="_blank"
              rel="noreferrer"
              className="w-full flex items-center justify-center gap-3 py-3 border-2 border-black rounded-lg font-black uppercase text-sm bg-lego-yellow text-black hover:brightness-95 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px] transition-all"
            >
              <Gift size={20} /> Check Demo Registry
            </a>
            <div className="pt-4 flex justify-center gap-6 text-center">
              <a href="https://zgyorkei.github.io/lego-tracker/" target="_blank" rel="noreferrer" className="text-xs font-bold text-gray-500 hover:text-black hover:underline uppercase tracking-wider transition-colors inline-block">
                How it works &amp; setup
              </a>
              <a href="https://github.com/zgyorkei/lego-tracker" target="_blank" rel="noreferrer" className="text-xs font-bold text-gray-500 hover:text-black hover:underline uppercase tracking-wider transition-colors inline-block">
                View on GitHub
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      <header className="bg-lego-yellow border-b-4 border-black p-4 sticky top-0 z-50 shadow-md">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-white border-2 border-black rounded shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <ClassicSpaceLogo size={24} />
             </div>
             <h1 className="text-2xl font-black uppercase tracking-tighter hidden sm:block">Brick Tracker</h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2">
               <label htmlFor="display-currency" className="sr-only">Display currency</label>
               <select
                 id="display-currency"
                 value={displayCurrency}
                 onChange={(e) => {
                   setDisplayCurrency(e.target.value);
                   writeStored('legoDisplayCurrency', e.target.value);
                 }}
                 className="px-2 py-1.5 bg-gray-100 border-2 border-black rounded font-black text-[10px] uppercase cursor-pointer outline-none hover:bg-gray-200 transition-colors"
               >
                 {SUPPORTED_CURRENCIES.map(c => (
                   <option key={c} value={c}>{c}</option>
                 ))}
               </select>
            </div>
            <button 
              onClick={() => setShowPriceSourcesSetting(true)}
              className="px-3 py-1.5 bg-black text-white rounded font-black text-[10px] uppercase flex items-center gap-2 hover:bg-gray-800 transition-colors"
            >
              <ShoppingBag size={14} /> <span className="hidden sm:inline">Sources</span>
            </button>
            {isDemoMode ? (
              <button 
                onClick={() => setIsDemoMode(false)}
                className="p-2 hover:bg-black/5 rounded-full transition-colors flex items-center gap-2 font-black text-xs uppercase"
              >
                <span className="hidden sm:inline text-red-600">Exit Demo</span>
                <LogOutIcon size={20} className="text-red-600" />
              </button>
            ) : (
              <button 
                onClick={signOut}
                className="p-2 hover:bg-black/5 rounded-full transition-colors flex items-center gap-2 font-black text-xs uppercase"
              >
                <span className="hidden sm:inline">{user?.displayName?.split(' ')[0]}</span>
                <LogOutIcon size={20} />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
        {isDemoMode && (
          <div role="status" className="mb-6 bg-white border-2 border-black rounded-lg px-4 py-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm font-bold text-gray-700">
              <span className="font-black uppercase text-lego-red mr-2">Demo</span>
              Sample sets with made-up prices. Look around freely: nothing is saved, and no prices are fetched.
            </p>
            <button
              onClick={() => setIsDemoMode(false)}
              className="shrink-0 px-3 py-1.5 bg-lego-blue text-white border-2 border-black rounded font-black text-xs uppercase"
            >
              Sign in to track your own
            </button>
          </div>
        )}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 p-1 bg-white border-2 border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <button 
                onClick={() => setFilter('all')}
                className={`px-4 py-1.5 text-xs font-black uppercase rounded ${filter === 'all' ? 'bg-lego-blue text-white' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                All
              </button>
              <button 
                onClick={() => setFilter('planned')}
                className={`px-4 py-1.5 text-xs font-black uppercase rounded ${filter === 'planned' ? 'bg-lego-yellow text-black' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                Planned
              </button>
              <button 
                onClick={() => setFilter('ordered')}
                className={`px-4 py-1.5 text-xs font-black uppercase rounded ${filter === 'ordered' ? 'bg-green-500 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                Purchased
              </button>
            </div>
            
            <select
               aria-label="Sort sets by"
               value={sortBy}
               onChange={(e) => setSortBy(e.target.value)}
               className="px-3 py-2 text-xs font-black uppercase rounded-lg border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-white cursor-pointer hover:bg-gray-50 focus:outline-none"
            >
               <option value="date-desc">Date (Newest)</option>
               <option value="date-asc">Date (Oldest)</option>
               <option value="priority-desc">Priority (High to Low)</option>
               <option value="priority-asc">Priority (Low to High)</option>
               <option value="name-asc">Name (A-Z)</option>
               <option value="name-desc">Name (Z-A)</option>
               <option value="set-asc">Set No (Low to High)</option>
               <option value="set-desc">Set No (High to Low)</option>
            </select>
          </div>
          
          <div className="flex flex-wrap items-center justify-end gap-4 shrink-0 sm:ml-auto mt-4 sm:mt-0 w-full sm:w-auto">
            {filter === 'planned' && (
              <button
                onClick={() => setShowGiftRegistry(true)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-white border-2 border-black px-4 py-1.5 rounded-lg font-black uppercase text-xs shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all"
                title="Gift Registry" aria-label="Gift Registry"
              >
                <Gift size={14} /> <span>Gift Registry</span>
              </button>
            )}
            {filter === 'planned' && !isDemoMode && (
              <button
                onClick={() => setShowPlannedList(true)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-white border-2 border-black px-4 py-1.5 rounded-lg font-black uppercase text-xs shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all"
                title="Planned Sets API" aria-label="Planned Sets API"
              >
                <Webhook size={14} /> <span>API</span>
              </button>
            )}
            {filter !== 'ordered' && filteredSets.length > 0 && (
              <div className="flex-1 sm:flex-none flex items-center w-full sm:w-auto">
              {isBatchRefreshing && batchProgress ? (
                <div className="flex-1 sm:w-48 flex items-center gap-2 bg-gray-100 border-2 border-black p-1.5 rounded-lg shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                  <Loader2 size={16} className="animate-spin text-lego-blue" />
                  <div className="flex-1 bg-gray-300 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-lego-blue h-full transition-all duration-300"
                      style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-black uppercase whitespace-nowrap">
                    {batchProgress.current} / {batchProgress.total}
                  </span>
                </div>
              ) : (
                <button
                  onClick={() => handleBatchRefresh()}
                  disabled={isBatchRefreshing || isDemoMode}
                  className="group w-full sm:w-auto flex items-center justify-center gap-2 bg-white border-2 border-black px-4 py-1.5 rounded-lg font-black uppercase text-xs shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {(() => {
                     const lastUpdatedTime = filteredSets.reduce((max, s) => Math.max(max, s.lastPricesRefreshTime || 0), 0);
                     const lastUpdatedStr = lastUpdatedTime > 0 ? 
                        new Date(lastUpdatedTime).toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 
                        'Never';

                     return (
                        <>
                           <RefreshCcw size={14} className="group-hover:animate-spin-once" />
                           {/* Both labels share one grid cell and only their
                               visibility toggles, so the button keeps the width
                               of the longer one. Swapping them with display:none
                               resized the button on hover and made it jump. */}
                           <span className="grid">
                             <span className="col-start-1 row-start-1 invisible group-hover:visible text-center whitespace-nowrap">Update All</span>
                             <span className="col-start-1 row-start-1 group-hover:invisible text-center whitespace-nowrap">Updated: {lastUpdatedStr}</span>
                           </span>
                        </>
                     );
                  })()}
                </button>
              )}
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-white border-4 border-lego-yellow p-4 rounded-lg shadow-xl">
              <p className="text-xs font-black uppercase opacity-50 mb-1">Planned</p>
              <p className="text-xl font-black truncate">{formatPrice(stats.orderedLegoRetail)} / {formatPrice(stats.plannedTotal)}</p>
            </div>
            <div className="bg-white border-4 border-green-500 p-4 rounded-lg shadow-xl">
              <p className="text-xs font-black uppercase opacity-50 mb-1">Purchased</p>
              <p className="text-xl font-black truncate flex items-center gap-1">
                 {formatPrice(stats.orderedTotal)} <span className={`font-bold ml-1 text-sm ${stats.savings < 0 ? 'text-red-500' : 'text-green-600'}`}>({formatPrice(stats.savings)})</span>
              </p>
            </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
             <motion.div 
               animate={{ rotate: 360 }}
               transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
               className="w-12 h-12 border-4 border-lego-blue border-t-transparent rounded-lg"
             />
             <p className="font-black uppercase text-gray-400 animate-pulse tracking-widest text-sm">Building bricks...</p>
          </div>
        ) : (
          <div className="columns-1 md:columns-2 gap-6">
            <AnimatePresence mode="popLayout">
              {filteredSets.map(set => (
                <div key={set.id} className="break-inside-avoid mb-6">
                  <SetCard
                    set={set}
                    onUpdate={updateSet}
                    onDelete={handleDeleteSet}
                    // Website only: hand the card's refreshes to the desktop
                    // app when it runs. Stable identity, so the memo holds.
                    delegateRefresh={!isDemoMode && !isDesktopApp ? delegate : undefined}
                    getPriceHistory={priceHistoryFor}
                    onAddPriceHistory={addPriceHistory}
                    priceSources={priceSources}
                    displayCurrency={displayCurrency}
                    exchangeRates={exchangeRates}
                    readOnly={isDemoMode}
                    onStatusUpdate={setActiveOperation}
                  />
                </div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* A load failure used to fall through to the empty state below, so a
            permissions or connectivity problem was indistinguishable from
            genuinely having no sets. */}
        {!loading && setsError && filteredSets.length === 0 && (
          <div
            role="alert"
            className="flex flex-col items-center justify-center py-20 bg-red-50 border-4 border-dashed border-red-200 rounded-2xl"
          >
            <AlertTriangle size={48} className="text-red-400 mb-4" />
            <p className="text-red-500 font-black uppercase tracking-widest text-center px-4">
              Could not load your sets
            </p>
            <p className="text-red-400 font-bold text-sm mt-2 text-center px-4">{setsError}</p>
          </div>
        )}

        {!loading && !setsError && filteredSets.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 bg-gray-50 border-4 border-dashed border-gray-200 rounded-2xl">
             <ShoppingBag size={48} className="text-gray-300 mb-4" />
             <p className="text-gray-400 font-black uppercase tracking-widest">No sets found in this category</p>
          </div>
        )}
      </main>

      {/* Replaces the blocking window.alert() calls that previously served as
          the error UI: non-modal, announced to screen readers, dismissible. */}
      <AnimatePresence>
         {actionError && (
            <motion.div
               role="alert"
               initial={{ opacity: 0, y: 50, scale: 0.9 }}
               animate={{ opacity: 1, y: 0, scale: 1 }}
               exit={{ opacity: 0, y: 50, scale: 0.9 }}
               className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-4 rounded-xl shadow-2xl z-50 flex items-center gap-4 min-w-[320px] max-w-[90vw]"
            >
               <AlertTriangle className="shrink-0" size={24} />
               <p className="flex-1 font-bold text-sm leading-tight">{actionError}</p>
               <button
                  onClick={() => setActionError(null)}
                  aria-label="Dismiss error"
                  className="shrink-0 hover:bg-red-700 rounded p-1 transition-colors"
               >
                  <X size={18} />
               </button>
            </motion.div>
         )}
      </AnimatePresence>

      <AnimatePresence>
         {activeOperation && (
            <motion.div
               initial={{ opacity: 0, y: 50, scale: 0.9 }}
               animate={{ opacity: 1, y: 0, scale: 1 }}
               exit={{ opacity: 0, y: 50, scale: 0.9 }}
               className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-black/90 text-white px-6 py-4 rounded-xl shadow-2xl z-50 flex items-center gap-4 min-w-[320px] max-w-[90vw]"
            >
               <RefreshCw className="animate-spin text-lego-blue shrink-0" size={24} />
               <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs text-gray-400 font-bold uppercase tracking-widest break-words truncate">
                     Set #{activeOperation.setId}
                  </div>
                  <div className="font-black text-sm break-words leading-tight">
                     {activeOperation.message}
                  </div>
               </div>
            </motion.div>
         )}
      </AnimatePresence>

      <button 
        onClick={() => setIsAdding(true)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 bg-lego-red text-white border-2 border-black rounded-full shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center hover:bg-red-600 hover:-translate-y-1 hover:shadow-[4px_6px_0px_0px_rgba(0,0,0,1)] active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] transition-all"
        title="Add New Set" aria-label="Add New Set"
      >
        <Plus size={24} />
      </button>

      <AnimatePresence>
        {showPriceSourcesSetting && (
          <Modal onClose={() => setShowPriceSourcesSetting(false)} label="Price sources">
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-lg border-4 border-black p-6 rounded-2xl relative z-10 shadow-2xl flex flex-col max-h-[90vh]"
            >
              <h2 className="text-2xl font-black uppercase mb-2 flex items-center gap-2">
                <ShoppingBag className="text-lego-blue" />
                Price Sources
              </h2>
              <p className="text-sm font-bold text-gray-600 mb-6">
                Configure websites to search for market prices. Use <code>{'{setNumber}'}</code> in the URL template where the Lego set number should go.{' '}
                {isDesktopApp
                  ? 'The desktop app reads these pages with its own browser. Teach a new shop once, and it is remembered on every device.'
                  : 'Gemini will scrape these URLs.'}
              </p>
              {priceSourcesError && (
                <div role="alert" className="mb-4 bg-red-50 border-2 border-red-200 text-red-600 font-bold text-sm rounded-lg px-4 py-3">
                  {priceSourcesError}
                </div>
              )}
              
              <div className="overflow-y-auto space-y-4 mb-4 pr-2">
                {priceSources.map((source, index) => {
                  const isPermanent = PERMANENT_SOURCE_IDS.includes(source.id);
                  const lockEdit = isDemoMode || isPermanent;
                  return (
                  // Keyed by id, not index: deleting a source mid-list used to
                  // re-key the survivors, so React reused the wrong DOM nodes
                  // and input state jumped to the neighbouring row.
                  <div key={source.id} className="bg-gray-50 border-2 border-black p-4 rounded-lg relative group">
                    {isPermanent && (
                      <span className="absolute top-2 right-2 text-[9px] font-black uppercase tracking-wider text-gray-400 pointer-events-none">Permanent</span>
                    )}
                    {!isDemoMode && !isPermanent && (
                      <button
                        onClick={() => {
                          const newSources = [...priceSources];
                          newSources.splice(index, 1);
                          savePriceSources(newSources);
                        }}
                        className="absolute top-2 right-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={16} />
                      </button>
                    )}
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <label htmlFor={`src-${source.id}-id`} className="block text-[10px] font-black uppercase text-gray-500 mb-1">ID (Short name)</label>
                        <SourceIdInput
                          inputId={`src-${source.id}-id`}
                          id={source.id}
                          disabled={lockEdit}
                          taken={priceSources.filter((_, i) => i !== index).map(s => s.id)}
                          onCommit={(value) =>
                            savePriceSources(priceSources.map((s, i) => i === index ? { ...s, id: value } : s))
                          }
                        />
                      </div>
                      <div>
                        <label htmlFor={`src-${source.id}-name`} className="block text-[10px] font-black uppercase text-gray-500 mb-1">Display Name</label>
                        <input
                          id={`src-${source.id}-name`}
                          type="text"
                          disabled={lockEdit}
                          value={source.name}
                          onChange={(e) => {
                             const value = e.target.value;
                             savePriceSources(priceSources.map((s, i) => i === index ? { ...s, name: value } : s));
                          }}
                          className="w-full bg-white border border-black p-2 rounded text-sm font-bold disabled:bg-gray-100 disabled:text-gray-500"
                        />
                      </div>
                    </div>
                    <div className="mb-2">
                      <label htmlFor={`src-${source.id}-url`} className="block text-[10px] font-black uppercase text-gray-500 mb-1">URL Template</label>
                      <input
                        id={`src-${source.id}-url`}
                        type="text"
                        disabled={lockEdit}
                        value={source.urlTemplate}
                        onChange={(e) => {
                           const urlTemplate = e.target.value;
                           savePriceSources(priceSources.map((s, i) => i === index ? withUrlTemplate(s, urlTemplate) : s));
                        }}
                        className="w-full bg-white border border-black p-2 rounded text-sm font-mono disabled:bg-gray-100 disabled:text-gray-500"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                         <label htmlFor={`src-${source.id}-currency`} className="block text-[10px] font-black uppercase text-gray-500 mb-1">Currency</label>
                         <select
                           id={`src-${source.id}-currency`}
                           value={source.currency}
                           disabled={lockEdit}
                           onChange={(e) => {
                              if (!isSupportedCurrency(e.target.value)) return;
                              const currency = e.target.value;
                              // Replace the entry rather than mutating it: the
                              // array spread is shallow, so assigning through
                              // it edited the object still held in state.
                              savePriceSources(
                                priceSources.map((s, i) =>
                                  i === index ? { ...s, currency } : s
                                )
                              );
                           }}
                           className="w-full bg-white border border-black p-2 rounded text-sm font-bold disabled:bg-gray-100 disabled:text-gray-500"
                         >
                           {SUPPORTED_CURRENCIES.map(c => (
                             <option key={c} value={c}>{c}</option>
                           ))}
                         </select>
                      </div>
                      <div>
                         <label htmlFor={`src-${source.id}-color`} className="block text-[10px] font-black uppercase text-gray-500 mb-1">Chart Color</label>
                         <div className="flex gap-2">
                            <input
                              id={`src-${source.id}-color`}
                              type="color"
                              disabled={lockEdit}
                              value={source.color}
                              onChange={(e) => {
                                 const color = e.target.value;
                                 savePriceSources(priceSources.map((s, i) => i === index ? { ...s, color } : s));
                              }}
                              className="h-9 w-12 cursor-pointer border border-black rounded disabled:opacity-50"
                            />
                            <input
                              type="text"
                              value={source.color}
                              readOnly
                              className="w-full bg-gray-100 border border-black p-2 rounded text-sm font-mono text-gray-500"
                            />
                         </div>
                      </div>
                    </div>
                    {isDesktopApp && !isPermanent && (
                      <TeachSourcePanel
                        source={source}
                        sampleSetNumbers={teachSamples}
                        onSave={(recipe) =>
                          savePriceSources(priceSources.map((s) => (s.id === source.id ? { ...s, scraper: recipe } : s)))
                        }
                      />
                    )}
                  </div>
                  );
                })}
              </div>
              
              {/* 15 matches MAX_SOURCES on the server and the userSettings rule. */}
              {!isDemoMode && priceSources.length < 15 && (
                <button
                  onClick={() => {
                     const newId = `source-${Date.now()}`;
                     const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
                     savePriceSources([...priceSources, { id: newId, name: 'New Source', urlTemplate: 'https://example.com/search?q={setNumber}', currency: 'EUR', color: randomColor }]);
                  }}
                  className="w-full py-3 mb-4 font-black uppercase text-sm border-2 border-dashed border-gray-400 text-gray-500 rounded-lg hover:bg-gray-50 hover:text-gray-900 transition-colors flex items-center justify-center gap-2"
                >
                  <Plus size={16} /> Add Price Source
                </button>
              )}

              <div className="mt-auto pt-2 grid grid-cols-2 gap-3 border-t-2 border-gray-100">
                <button 
                  onClick={() => !isDemoMode && savePriceSources(DEFAULT_PRICE_SOURCES)}
                  disabled={isDemoMode}
                  className="py-3 font-black uppercase text-[10px] text-gray-500 hover:text-gray-900 transition-colors underline text-left disabled:opacity-50 disabled:no-underline"
                >
                  Reset Defaults
                </button>
                <button 
                  onClick={() => setShowPriceSourcesSetting(false)}
                  className="py-3 font-black uppercase text-sm bg-lego-blue text-white border-2 border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px] transition-all"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showGiftRegistry && (
          <GiftRegistryDialog
            onClose={() => setShowGiftRegistry(false)}
            plannedSets={activeSets.filter(s => s.status === 'planned')}
            priceSources={priceSources}
            exchangeRates={exchangeRates}
            displayCurrency={displayCurrency}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPlannedList && (
          <PlannedListDialog onClose={() => setShowPlannedList(false)} state={plannedList} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAdding && (
          // Backdrop dismissal is suppressed mid-submit so an accidental click
          // cannot close the form while the set is being created.
          <Modal
            onClose={() => !searchingLego && setIsAdding(false)}
            label="Add a new set"
            closeOnBackdrop={!searchingLego}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-md border-4 border-black p-6 rounded-2xl relative z-10 shadow-2xl"
            >
              <h2 className="text-2xl font-black uppercase mb-6 flex items-center gap-2">
                <Package className="text-lego-red" /> 
                Add New Lego Set
              </h2>
              
              <form onSubmit={handleAddSet} className="space-y-6">
                <div>
                  <label htmlFor="new-set-number" className="block text-[10px] font-black uppercase text-gray-500 mb-1 ml-1 tracking-widest">Set Number</label>
                  <div className="relative">
                    <input
                      id="new-set-number"
                      type="text"
                      required
                      placeholder="e.g. 10305"
                      disabled={searchingLego}
                      value={newSetNumber}
                      onChange={(e) => setNewSetNumber(e.target.value)}
                      className="w-full bg-gray-100 border-2 border-black p-3 rounded-lg font-bold placeholder:text-gray-400 focus:outline-none focus:ring-4 focus:ring-lego-yellow transition-all"
                    />
                    {searchingLego && (
                      <div className="absolute right-3 top-3">
                         <motion.div 
                          animate={{ rotate: 360 }}
                          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                          className="w-5 h-5 border-2 border-lego-blue border-t-transparent rounded-full"
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <span className="block text-[10px] font-black uppercase text-gray-500 mb-1 ml-1 tracking-widest">Priority</span>
                  <div className="grid grid-cols-3 gap-2">
                    {(['low', 'medium', 'high'] as Priority[]).map(p => (
                      <button 
                        key={p}
                        type="button"
                        disabled={searchingLego}
                        onClick={() => setNewPriority(p)}
                        className={`py-2 px-1 rounded-lg border-2 border-black font-black text-[10px] uppercase transition-all ${
                          newPriority === p 
                            ? p === 'high' ? 'bg-red-500 text-white' : p === 'medium' ? 'bg-orange-400 text-white' : 'bg-gray-400 text-white'
                            : 'bg-white text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button 
                    type="button"
                    disabled={searchingLego}
                    onClick={() => {
                        setIsAdding(false);
                    }}
                    className="flex-1 py-3 font-black uppercase text-sm border-2 border-black rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={searchingLego || isDemoMode}
                    className="flex-1 py-3 font-black uppercase text-sm bg-lego-blue text-white border-2 border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {searchingLego ? 'Fetching...' : 'Track Set'}
                  </button>
                </div>
              </form>
            </motion.div>
          </Modal>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showThemeSelector && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed bottom-40 right-6 bg-white p-4 rounded-xl shadow-2xl border-4 border-black z-50 flex flex-col gap-2 min-w-[200px]"
          >
            <div className="flex justify-between items-center mb-2 border-b-2 border-gray-100 pb-2">
              <span className="font-black uppercase text-sm">Select Theme</span>
              <button onClick={() => setShowThemeSelector(false)} aria-label="Close theme selector" className="text-gray-400 hover:text-gray-900"><X size={16} /></button>
            </div>
            {AVAILABLE_THEMES.map(theme => (
              <button
                key={theme.id}
                onClick={() => {
                  setCurrentTheme(theme.id);
                  setShowThemeSelector(false);
                }}
                className={`text-left px-3 py-2 rounded-lg font-bold text-sm uppercase tracking-wider transition-colors ${currentTheme === theme.id ? 'bg-lego-yellow text-black' : 'hover:bg-gray-100 text-gray-600'}`}
              >
                {theme.name}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <button 
        onClick={() => setShowThemeSelector(!showThemeSelector)}
        className="fixed bottom-24 right-6 bg-white text-lego-blue w-12 h-12 flex items-center justify-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] border-2 border-black transition-transform hover:scale-110 hover:-rotate-12 z-40 rounded-full"
        title="Change Theme" aria-label="Change Theme"
      >
        <Palette size={24} className="animate-pulse" />
      </button>

    </div>
  );
}
