import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  LogIn, 
  LogOut, 
  Filter, 
  Package, 
  ShoppingBag, 
  ChevronDown, 
  Search,
  Wallet,
  PiggyBank,
  TrendingDown,
  RefreshCcw,
  RefreshCw,
  Loader2,
  Key,
  X,
  Eye,
  LogOut as LogOutIcon,
  Palette,
  Gift
} from 'lucide-react';
import { useSets } from './hooks/useSets';
import { signInWithGoogle, signOut } from './lib/firebase';
import { ClassicSpaceLogo } from './components/ClassicSpaceLogo';
import { SetCard } from './components/SetCard';
import { GiftRegistryDialog } from './components/GiftRegistryDialog';
import { Status, Priority, PriceSource, DEFAULT_PRICE_SOURCES, LegoSet } from './types';
import { DEMO_SETS } from './demoData';

const getMockSets = (): LegoSet[] => {
  let sourceSets = DEMO_SETS;
  try {
    const cached = localStorage.getItem('cachedSets');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        sourceSets = parsed;
      }
    }
  } catch (e) {
    console.error("Failed to parse cached sets", e);
  }

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
  { id: 'star-wars', name: 'Star Wars' },
  { id: 'ninjago', name: 'Ninjago' },
  { id: 'hidden-side', name: 'Hidden Side' },
  { id: 'bionicle', name: 'Bionicle' },
  { id: 'technic', name: 'Technic' },
  { id: 'friends', name: 'Friends' },
  { id: 'castle', name: 'Castle/City' }
];

export default function App() {
  const { sets, loading, addSet, updateSet, deleteSet, addPriceHistory, getPriceHistory, user } = useSets();
  const [showApiModal, setShowApiModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [mockSets, setMockSets] = useState<LegoSet[]>(() => getMockSets());

  // Cache sets whenever they change
  useEffect(() => {
    if (sets && sets.length > 0) {
      localStorage.setItem('cachedSets', JSON.stringify(sets));
    }
  }, [sets]);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [sortBy, setSortBy] = useState<string>('date-desc');
  const [isAdding, setIsAdding] = useState(false);
  const [newSetNumber, setNewSetNumber] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('medium');
  const [searchingLego, setSearchingLego] = useState(false);
  const [activeOperation, setActiveOperation] = useState<{setId: string, message: string} | null>(null);
  const [isBatchRefreshing, setIsBatchRefreshing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number} | null>(null);
  const [showPriceSourcesSetting, setShowPriceSourcesSetting] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(() => localStorage.getItem('brickTrackerTheme') || 'classic');
  const [showThemeSelector, setShowThemeSelector] = useState(false);
  const [showGiftRegistry, setShowGiftRegistry] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState<string>(() => localStorage.getItem('legoDisplayCurrency') || 'HUF');
  const [exchangeRates, setExchangeRates] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    if (currentTheme === 'classic') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', currentTheme);
    }
    localStorage.setItem('brickTrackerTheme', currentTheme);
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

  const [priceSources, setPriceSources] = useState<PriceSource[]>(() => {
    const saved = localStorage.getItem('legoPriceSources');
    return saved ? JSON.parse(saved) : DEFAULT_PRICE_SOURCES;
  });

  const savePriceSources = (newSources: PriceSource[]) => {
     setPriceSources(newSources);
     localStorage.setItem('legoPriceSources', JSON.stringify(newSources));
  };

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

  const handleBatchRefresh = async () => {
    if (isBatchRefreshing || filteredSets.length === 0) return;
    setIsBatchRefreshing(true);
    
    setBatchProgress({ current: 0, total: filteredSets.length });
    
    for (let i = 0; i < filteredSets.length; i++) {
        setBatchProgress({ current: i + 1, total: filteredSets.length });
        const set = filteredSets[i];
        
        // Add a delay between requests to avoid hitting rate limits
        if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        try {
            const reqApiKey = localStorage.getItem('brickTrackerApiKey') || '';
            const headers = reqApiKey ? { 'x-gemini-api-key': reqApiKey } : {};

            setActiveOperation({ setId: set.setNumber, message: 'Fetching Set Data & Image' });

            // refresh lego info
            const legoRes = await fetch(`/api/lego/${set.setNumber}`, { headers });
            if (legoRes.ok) {
                const legoData = await legoRes.json();
                if (legoData && legoData.priceHuf) {
                    const finalName = legoData.name || set.name;
                    const updates: any = {
                       name: finalName,
                       legoPriceHuf: legoData.priceHuf,
                       ...(legoData.image ? { productImage: legoData.image } : {}),
                       legoUrl: legoData.url || set.legoUrl,
                       legoPriceError: false,
                       isTemporary: legoData.isTemporary || false,
                       releaseDate: legoData.releaseDate || null,
                       hasFetchedLegoInfo: true,
                       lastLegoPriceRefreshTime: Date.now()
                    };
                    
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
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));

            setActiveOperation({ setId: set.setNumber, message: 'Fetching Market Price' });
            // refresh market info
            const marketRes = await fetch(`/api/prices/${set.setNumber}`, { 
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ sources: priceSources })
            });
            if (marketRes.ok) {
                const marketPrices = await marketRes.json();
                await updateSet(set.id, {
                    marketPrices,
                    lastPricesRefreshTime: Date.now()
                });
                
                const today = new Date().toISOString().split('T')[0];
                
                const historyEntry: any = {
                    date: today,
                    exchangeRate: marketPrices.exchangeRate
                };
                
                priceSources.forEach(s => {
                    if (marketPrices[s.id]) {
                        historyEntry[`${s.id}Price`] = marketPrices[s.id].price;
                    }
                });
                
                await addPriceHistory(set.id, historyEntry);
            }
        } catch (e) {
            console.error('Batch update failed for set', set.setNumber, e);
        }
    }
    
    setIsBatchRefreshing(false);
    setBatchProgress(null);
    setActiveOperation(null);
  };

  const formatPrice = (priceHuf: number) => {
    if (displayCurrency === 'HUF' || !exchangeRates) {
      return `${priceHuf.toLocaleString()} HUF`;
    }
    const priceEur = priceHuf / exchangeRates.HUF;
    const targetRate = exchangeRates[displayCurrency] || 1;
    const finalPrice = priceEur * targetRate;
    
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: displayCurrency,
      maximumFractionDigits: displayCurrency === 'HUF' ? 0 : 2
    }).format(finalPrice);
  };

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

  const handleAddSet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSetNumber) return;
    
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
            <button 
              onClick={signInWithGoogle}
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
            <div className="pt-4 text-center">
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
               <select
                 value={displayCurrency}
                 onChange={(e) => {
                   setDisplayCurrency(e.target.value);
                   localStorage.setItem('legoDisplayCurrency', e.target.value);
                 }}
                 className="px-2 py-1.5 bg-gray-100 border-2 border-black rounded font-black text-[10px] uppercase cursor-pointer outline-none hover:bg-gray-200 transition-colors"
               >
                 <option value="HUF">HUF</option>
                 <option value="EUR">EUR</option>
                 <option value="USD">USD</option>
                 <option value="GBP">GBP</option>
                 <option value="CHF">CHF</option>
                 <option value="PLN">PLN</option>
                 <option value="CZK">CZK</option>
                 <option value="DKK">DKK</option>
                 <option value="SEK">SEK</option>
                 <option value="NOK">NOK</option>
                 <option value="RON">RON</option>
                 <option value="BGN">BGN</option>
                 <option value="ISK">ISK</option>
               </select>
            </div>
            <button 
              onClick={() => setShowPriceSourcesSetting(true)}
              className="px-3 py-1.5 bg-black text-white rounded font-black text-[10px] uppercase flex items-center gap-2 hover:bg-gray-800 transition-colors"
            >
              <ShoppingBag size={14} /> <span className="hidden sm:inline">Sources</span>
            </button>
            <button 
              onClick={() => {
                const current = localStorage.getItem('brickTrackerApiKey') || '';
                setApiKeyInput(current);
                setShowApiModal(true);
              }}
              className="px-3 py-1.5 bg-blue-600 border-2 border-transparent text-white rounded font-black text-[10px] uppercase flex items-center gap-2 hover:bg-blue-700 transition-colors"
              title="Set custom Gemini API Key"
            >
              <Key size={14} /> <span className="hidden sm:inline">API Key</span>
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
                title="Gift Registry"
              >
                <Gift size={14} /> <span>Gift Registry</span>
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
                  onClick={handleBatchRefresh}
                  disabled={isBatchRefreshing || isDemoMode}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white border-2 border-black px-4 py-1.5 rounded-lg font-black uppercase text-xs shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCcw size={14} /> Update All
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <AnimatePresence mode="popLayout">
              {filteredSets.map(set => (
                <SetCard 
                  key={set.id} 
                  set={set} 
                  onUpdate={updateSet} 
                  onDelete={(id) => isDemoMode ? setMockSets(mockSets.filter(s => s.id !== id)) : deleteSet(id)}
                  getPriceHistory={getPriceHistory}
                  onAddPriceHistory={addPriceHistory}
                  priceSources={priceSources}
                  displayCurrency={displayCurrency}
                  exchangeRates={exchangeRates}
                  readOnly={isDemoMode}
                  onStatusUpdate={setActiveOperation}
                />
              ))}
            </AnimatePresence>
          </div>
        )}

        {!loading && filteredSets.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 bg-gray-50 border-4 border-dashed border-gray-200 rounded-2xl">
             <ShoppingBag size={48} className="text-gray-300 mb-4" />
             <p className="text-gray-400 font-black uppercase tracking-widest">No sets found in this category</p>
          </div>
        )}
      </main>

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
        title="Add New Set"
      >
        <Plus size={24} />
      </button>

      <AnimatePresence>
        {showPriceSourcesSetting && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPriceSourcesSetting(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
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
                Configure websites to search for market prices. Use <code>{'{setNumber}'}</code> in the URL template where the Lego set number should go. Gemini will scrape these URLs.
              </p>
              
              <div className="overflow-y-auto space-y-4 mb-4 pr-2">
                {priceSources.map((source, index) => (
                  <div key={index} className="bg-gray-50 border-2 border-black p-4 rounded-lg relative group">
                    {!isDemoMode && (
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
                        <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">ID (Short name)</label>
                        <input 
                          type="text" 
                          disabled={isDemoMode}
                          value={source.id} 
                          onChange={(e) => {
                             const newSources = [...priceSources];
                             newSources[index].id = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                             savePriceSources(newSources);
                          }}
                          className="w-full bg-white border border-black p-2 rounded text-sm font-bold disabled:bg-gray-100 disabled:text-gray-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Display Name</label>
                        <input 
                          type="text" 
                          disabled={isDemoMode}
                          value={source.name} 
                          onChange={(e) => {
                             const newSources = [...priceSources];
                             newSources[index].name = e.target.value;
                             savePriceSources(newSources);
                          }}
                          className="w-full bg-white border border-black p-2 rounded text-sm font-bold disabled:bg-gray-100 disabled:text-gray-500"
                        />
                      </div>
                    </div>
                    <div className="mb-2">
                      <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">URL Template</label>
                      <input 
                        type="text" 
                        disabled={isDemoMode}
                        value={source.urlTemplate} 
                        onChange={(e) => {
                           const newSources = [...priceSources];
                           newSources[index].urlTemplate = e.target.value;
                           savePriceSources(newSources);
                        }}
                        className="w-full bg-white border border-black p-2 rounded text-sm font-mono disabled:bg-gray-100 disabled:text-gray-500"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                         <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Currency</label>
                         <select 
                           value={source.currency}
                           disabled={isDemoMode}
                           onChange={(e) => {
                              const newSources = [...priceSources];
                              newSources[index].currency = e.target.value;
                              savePriceSources(newSources);
                           }}
                           className="w-full bg-white border border-black p-2 rounded text-sm font-bold disabled:bg-gray-100 disabled:text-gray-500"
                         >
                           <option value="HUF">HUF</option>
                           <option value="EUR">EUR</option>
                           <option value="USD">USD</option>
                           <option value="GBP">GBP</option>
                           <option value="CHF">CHF</option>
                           <option value="PLN">PLN</option>
                           <option value="CZK">CZK</option>
                           <option value="DKK">DKK</option>
                           <option value="SEK">SEK</option>
                           <option value="NOK">NOK</option>
                           <option value="RON">RON</option>
                           <option value="BGN">BGN</option>
                           <option value="ISK">ISK</option>
                         </select>
                      </div>
                      <div>
                         <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Chart Color</label>
                         <div className="flex gap-2">
                            <input 
                              type="color" 
                              disabled={isDemoMode}
                              value={source.color} 
                              onChange={(e) => {
                                 const newSources = [...priceSources];
                                 newSources[index].color = e.target.value;
                                 savePriceSources(newSources);
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
                  </div>
                ))}
              </div>
              
              {!isDemoMode && (
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
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showGiftRegistry && (
          <GiftRegistryDialog
            onClose={() => setShowGiftRegistry(false)}
            plannedSets={activeSets.filter(s => s.status === 'planned')}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showApiModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowApiModal(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-sm border-4 border-black p-6 rounded-2xl relative z-10 shadow-2xl flex flex-col"
            >
              <h2 className="text-2xl font-black uppercase mb-2 flex items-center gap-2">
                <Key className="text-lego-blue" />
                API Key
              </h2>
              <p className="text-sm font-bold text-gray-600 mb-6">
                Enter your Google Gemini API Key for features like Batch Image Search or resolving unreleased sets info. Your key is stored locally in your browser.
              </p>
              
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-gray-50 border-2 border-black p-3 rounded text-sm font-mono mb-6"
              />

              <div className="flex gap-3 mt-auto">
                <button 
                  onClick={() => setShowApiModal(false)}
                  className="flex-1 py-3 font-black uppercase text-sm border-2 border-black bg-gray-200 text-black hover:bg-gray-300 rounded shadow-md transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    const trimmed = apiKeyInput.trim();
                    if (trimmed) {
                      localStorage.setItem('brickTrackerApiKey', trimmed);
                    } else {
                      localStorage.removeItem('brickTrackerApiKey');
                    }
                    setShowApiModal(false);
                  }}
                  className="flex-1 py-3 font-black uppercase text-sm bg-lego-blue text-white border-2 border-black rounded shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px] transition-all"
                >
                  Save
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !searchingLego && setIsAdding(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
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
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-1 ml-1 tracking-widest">Set Number</label>
                  <div className="relative">
                    <input 
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
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-1 ml-1 tracking-widest">Priority</label>
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
          </div>
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
              <button onClick={() => setShowThemeSelector(false)} className="text-gray-400 hover:text-gray-900"><X size={16} /></button>
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
        title="Change Theme"
      >
        <Palette size={24} className="animate-pulse" />
      </button>

    </div>
  );
}
