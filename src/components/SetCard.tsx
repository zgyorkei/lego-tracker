import React, { useEffect, useState, useRef, useMemo, useCallback, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, TrendingUp, TrendingDown, Clock, CheckCircle, ExternalLink, AlertCircle, X, RefreshCw, Star, Check, ArrowRight, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Undo2 } from 'lucide-react';
import { LegoSet, PriceHistory, PriceSource, MinifigureStatus, SUPPORTED_CURRENCIES, isPriceQuote } from '../types';
import { format } from 'date-fns';
import { formatPrice as formatPriceUtil, convertFromHuf } from '../lib/currency';
import { Modal } from './Modal';

// Lazy so recharts (~350 kB with its d3 deps) is only fetched when a user
// actually opens the price-history panel.
const PriceHistoryChart = lazy(() => import('./PriceHistoryChart'));

interface SetCardProps {
  set: LegoSet;
  // These resolve so callers can await/catch them. They were typed as void,
  // which made the fire-and-forget call sites below silently unhandleable.
  onUpdate: (id: string, updates: Partial<LegoSet>) => Promise<void>;
  onDelete: (id: string) => void;
  getPriceHistory: (id: string) => Promise<PriceHistory[]>;
  onAddPriceHistory: (id: string, history: PriceHistory) => Promise<void>;
  priceSources?: PriceSource[];
  displayCurrency: string;
  exchangeRates: Record<string, number> | null;
  readOnly?: boolean;
  onStatusUpdate?: (status: {setId: string, message: string} | null) => void;
}

const SetCardComponent: React.FC<SetCardProps> = ({ set, onUpdate, onDelete, getPriceHistory, onAddPriceHistory, priceSources = [], displayCurrency, exchangeRates, readOnly = false, onStatusUpdate }) => {
  const [history, setHistory] = useState<PriceHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isEditingPurchaseDate, setIsEditingPurchaseDate] = useState(false);
  const [editedPurchaseDate, setEditedPurchaseDate] = useState('');

  const handlePurchaseDateClick = () => {
    if (readOnly) return;
    if (set.status === 'ordered') {
      setEditedPurchaseDate(set.orderedDate ? format(new Date(set.orderedDate), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
      setIsEditingPurchaseDate(true);
    }
  };

  const [isUpdatingDate, setIsUpdatingDate] = useState(false);

  const savePurchaseDate = async () => {
    if (editedPurchaseDate) {
      if (set.orderedCurrency && set.orderedCurrency !== 'HUF' && set.orderedOriginalPrice) {
        setIsUpdatingDate(true);
        try {
          const res = await fetch(`/api/exchange-rate/${editedPurchaseDate}`);
          const data = await res.json();
          let finalPriceHuf = set.orderedOriginalPrice;
          if (data.rates && data.rates.HUF) {
             const eurValue = set.orderedCurrency === 'EUR' ? finalPriceHuf : finalPriceHuf / (data.rates[set.orderedCurrency] || 1);
             finalPriceHuf = eurValue * data.rates.HUF;
          }
          onUpdate(set.id, { 
            orderedDate: new Date(editedPurchaseDate).toISOString(),
            orderedPriceHuf: Math.round(finalPriceHuf)
          });
        } catch (e) {
          console.error(e);
          onUpdate(set.id, { orderedDate: new Date(editedPurchaseDate).toISOString() });
        } finally {
          setIsUpdatingDate(false);
        }
      } else {
        onUpdate(set.id, { orderedDate: new Date(editedPurchaseDate).toISOString() });
      }
    }
    setIsEditingPurchaseDate(false);
  };
  
  const [loadingMarketPrices, setLoadingMarketPrices] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // useCallback so the effect below registers and removes the *same* function
  // reference on resize, rather than leaking a listener per re-render.
  const checkScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(checkScroll, 100);
    window.addEventListener('resize', checkScroll);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', checkScroll);
    };
  }, [set.marketPrices, priceSources, checkScroll]);

  const [loadingLegoInfo, setLoadingLegoInfo] = useState(false);
  const [loadingLegoPrice, setLoadingLegoPrice] = useState(false);
  
  const [showOrderDialog, setShowOrderDialog] = useState(false);
  const [orderPrice, setOrderPrice] = useState('');
  const [orderQuantity, setOrderQuantity] = useState(1);
  const [orderCurrency, setOrderCurrency] = useState<string>('HUF');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRevertConfirm, setShowRevertConfirm] = useState(false);
  
  const [isFlipped, setIsFlipped] = useState(false);
  const [currentWantedIndex, setCurrentWantedIndex] = useState(0);

  const formatPrice = (priceHuf: number) => formatPriceUtil(priceHuf, displayCurrency, exchangeRates);

  const wantedFigures = set.minifigures?.filter(f => set.minifiguresStatus?.[f.id] === 'wanted' && f.image) || [];

  useEffect(() => {
    if (wantedFigures.length > 1 && !isFlipped) {
      const interval = setInterval(() => {
        setCurrentWantedIndex(prev => prev + 1);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [wantedFigures.length, isFlipped]);

  const toggleMinifigureStatus = (figureId: string, currentStatus?: MinifigureStatus) => {
    if (readOnly) return;
    const nextStatus: MinifigureStatus =
      currentStatus === 'got' ? 'none' : currentStatus === 'wanted' ? 'got' : 'wanted';
    const newStatuses: Record<string, MinifigureStatus> = {
      ...(set.minifiguresStatus || {}),
      [figureId]: nextStatus,
    };
    onUpdate(set.id, { minifiguresStatus: newStatuses }).catch(() => {
      /* useSets already surfaced the failure */
    });
  };

  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (!showHistory) return;
    // Guards against a late response landing after the panel closed or the
    // card unmounted, which would otherwise setState on a dead component.
    let active = true;
    setLoadingHistory(true);
    getPriceHistory(set.id)
      .then(rows => {
        if (active) setHistory(rows);
      })
      .finally(() => {
        if (active) setLoadingHistory(false);
      });
    return () => {
      active = false;
    };
  }, [showHistory, set.id, getPriceHistory]);

  // Flattens the per-source history rows into chart points. Each row stores
  // one '<sourceId>PriceHuf' key per source (see the writer in App.tsx and
  // submitOrder below), so pick the cheapest available price per date.
  const chartData = useMemo(() => {
    return history
      .map(entry => {
        const prices = priceSources
          .map(s => entry[`${s.id}PriceHuf`])
          .filter((v): v is number => typeof v === 'number' && v > 0);
        if (prices.length === 0) return null;
        const lowestHuf = Math.min(...prices);
        return {
          date: entry.date,
          label: (() => {
            try {
              return format(new Date(entry.date), 'MMM d');
            } catch {
              return entry.date;
            }
          })(),
          value: convertFromHuf(lowestHuf, displayCurrency, exchangeRates),
        };
      })
      .filter((p): p is { date: string; label: string; value: number } => p !== null);
  }, [history, priceSources, displayCurrency, exchangeRates]);

  useEffect(() => {
    if (set.status === 'planned' || set.status === 'ordered') {
      if (!set.hasFetchedLegoInfo) {
         refreshLegoData(true, true);
      }
    }
  }, [set.setNumber, set.status]);

  const refreshLegoData = async (updateInfo: boolean, updatePrice: boolean) => {
    if (updateInfo) setLoadingLegoInfo(true);
    if (updatePrice) setLoadingLegoPrice(true);
    
    // Set global status update
    if (onStatusUpdate) {
       onStatusUpdate({
          setId: set.setNumber,
          message: updateInfo ? "Fetching Set Data & Image" : "Fetching Lego Data"
       });
    }

    try {
      const shouldSkipImage = !updateInfo;
      
      const res = await fetch(`/api/lego/${set.setNumber}?skipImage=${shouldSkipImage}`);
      if (res.status === 429) {
        throw new Error('Rate limit exceeded (429)');
      }
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      
      const updates: Partial<LegoSet> = {};
      
      if (updateInfo) {
         updates.name = data.name || set.name;
         updates.productImage = data.image || set.productImage;
         updates.hasFetchedLegoInfo = true;
         // Always save price if it came back when fetching info
         if (data.priceHuf > 0 && !set.legoPriceHuf) {
            updates.legoPriceHuf = data.priceHuf;
            updates.legoUrl = data.url || set.legoUrl;
         }
         
         if ((updates.name || '').toLowerCase().includes('minifigure') || set.setNumber.length > 5 || set.name.toLowerCase().includes('minifigure')) {
             if (onStatusUpdate && !set.minifigures) {
                onStatusUpdate({
                   setId: set.setNumber,
                   message: "Fetching Minifigures"
                });
             }
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
      }
      
      if (updatePrice) {
         updates.legoPriceHuf = data.priceHuf || set.legoPriceHuf;
         updates.legoUrl = data.url || set.legoUrl;
         updates.isTemporary = data.isTemporary || false;
         updates.releaseDate = data.releaseDate || null;
         updates.lastLegoPriceRefreshTime = Date.now();
         updates.legoPriceError = false;
      }
      
      onUpdate(set.id, updates);
    } catch (e) {
      const updates: Partial<LegoSet> = {};
      if (updateInfo) {
         updates.hasFetchedLegoInfo = true;
      }
      if (updatePrice) {
         updates.lastLegoPriceRefreshTime = Date.now();
         updates.legoPriceError = true;
      }
      onUpdate(set.id, updates);
    } finally {
      if (updateInfo) setLoadingLegoInfo(false);
      if (updatePrice) setLoadingLegoPrice(false);
      if (onStatusUpdate) onStatusUpdate(null);
    }
  };

  const refreshMarketPrices = async () => {
    setLoadingMarketPrices(true);
    
    if (onStatusUpdate) {
       onStatusUpdate({
          setId: set.setNumber,
          message: "Fetching Market Price using Gemini"
       });
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const res = await fetch(`/api/prices/${set.setNumber}`, { 
         method: 'POST', 
         headers, 
         body: JSON.stringify({ sources: priceSources }) 
      });
      if (res.status === 429) {
         throw new Error('Rate limit exceeded (429)');
      }
      if (!res.ok) throw new Error('API error');

      const data = await res.json();
      
      onUpdate(set.id, {
         marketPrices: data,
         lastPricesRefreshTime: Date.now()
      });

      if (set.status === 'planned') {
        const today = new Date().toISOString().split('T')[0];
        const historyEntry: PriceHistory = {
           date: today,
           exchangeRate: data.exchangeRate ?? 0
        };
        priceSources.forEach(s => {
           const quote = data[s.id];
           if (isPriceQuote(quote)) {
               historyEntry[`${s.id}Price`] = quote.price;
               // HUF-normalised companion so the chart can compare sources on
               // a single axis; '...Price' is in the source's own currency.
               historyEntry[`${s.id}PriceHuf`] = quote.priceHuf;
           }
        });
        onAddPriceHistory(set.id, historyEntry).catch(() => {
           /* surfaced by useSets */
        });
      }
    } catch (e) {
      onUpdate(set.id, {
         marketPrices: { ...(set.marketPrices || {}), error: true } as any,
         lastPricesRefreshTime: Date.now()
      });
    } finally {
      setLoadingMarketPrices(false);
      if (onStatusUpdate) onStatusUpdate(null);
    }
  };

  const refreshLegoInfoOnly = () => refreshLegoData(true, false);
  const refreshLegoPriceOnly = () => refreshLegoData(false, true);

  const calculateDiff = (price: number) => {
    if (!set.legoPriceHuf) return 0;
    return ((price - set.legoPriceHuf) / set.legoPriceHuf) * 100;
  };

  const openOrderDialog = (initialPriceHuf?: number, initialCurrency: string = 'HUF', initialPrice?: number) => {
    if (readOnly) return;
    if (initialCurrency !== 'HUF' && initialPrice) {
      setOrderPrice(initialPrice.toString());
      setOrderCurrency(initialCurrency);
    } else {
      setOrderPrice(initialPriceHuf ? initialPriceHuf.toString() : (set.legoPriceHuf || 0).toString());
      setOrderCurrency('HUF');
    }
    setOrderDate(new Date().toISOString().split('T')[0]);
    setShowOrderDialog(true);
  };

  const submitOrder = async () => {
    if (orderPrice === '' || isNaN(parseFloat(orderPrice))) return;
    setIsSubmittingOrder(true);
    try {
      let finalPriceHuf = parseFloat(orderPrice);
      if (orderCurrency !== 'HUF') {
         const res = await fetch(`/api/exchange-rate/${orderDate}`);
         const data = await res.json();
         if (data.rates && data.rates.HUF) {
             const eurValue = orderCurrency === 'EUR' ? finalPriceHuf : finalPriceHuf / (data.rates[orderCurrency] || 1);
             finalPriceHuf = eurValue * data.rates.HUF;
         }
      }
      onUpdate(set.id, {
        status: 'ordered',
        orderedPriceHuf: Math.round(finalPriceHuf),
        orderedDate: new Date(orderDate).toISOString(),
        orderedOriginalPrice: parseFloat(orderPrice),
        orderedCurrency: orderCurrency,
        quantity: orderQuantity
      });
      setShowOrderDialog(false);
    } catch (e) {
      console.error(e);
      setOrderError('Could not save the purchase. Please check the price and try again.');
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const revertToPlanned = () => {
    if (readOnly) return;
    setShowRevertConfirm(true);
  };

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`bg-white rounded-lg shadow-xl overflow-hidden border-4 flex flex-col relative group ${
        set.status === 'ordered' ? 'border-green-500' : 'border-lego-yellow'
      }`}
    >
      {isCollapsed ? (
         <button
           type="button"
           className="w-full text-left p-4 flex justify-between items-center cursor-pointer bg-white"
           onClick={() => setIsCollapsed(false)}
           aria-label={`Expand ${set.name}`}
           aria-expanded={false}
         >
           <h3 className="text-sm font-black text-gray-900 uppercase tracking-tight truncate pr-4">{set.name} ({set.setNumber})</h3>
           <ChevronDown size={20} className="text-gray-400 shrink-0" />
         </button>
      ) : (
         <>
      {/* The collapse control lives in the header button row rather than being
          absolutely pinned to the card corner. Pinned at `top-2 right-2` it
          landed on top of the refresh/delete buttons in the md:flex-row
          layout, masking the delete icon and (because opacity-0 still accepts
          pointer events) swallowing its clicks. It was also hover-only, so it
          never appeared on touch devices at all. */}
      <AnimatePresence mode="wait">
        {!isFlipped ? (
          <motion.div 
            key="front"
            initial={{ opacity: 0, rotateY: -90 }}
            animate={{ opacity: 1, rotateY: 0 }}
            exit={{ opacity: 0, rotateY: 90 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col flex-1 w-full h-full"
          >
            <div className="flex flex-col md:flex-row border-b border-gray-100 flex-1">
              <div className="w-full md:w-48 h-48 bg-white flex items-center justify-center relative overflow-hidden shrink-0 md:border-r border-gray-100 group">
              {wantedFigures.length > 0 ? (
                <div className="w-full h-full relative overflow-hidden bg-white">
                  <AnimatePresence mode="wait">
                    <motion.img 
                      key={wantedFigures[currentWantedIndex % wantedFigures.length].id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.3 }}
                      src={wantedFigures[currentWantedIndex % wantedFigures.length].image!} 
                      alt={wantedFigures[currentWantedIndex % wantedFigures.length].name} 
                      className="object-contain w-full h-full p-2 absolute inset-0" 
                      referrerPolicy="no-referrer"
                    />
                  </AnimatePresence>
                  <div className="absolute top-2 right-2 bg-lego-blue text-white text-[9px] font-black uppercase px-2 py-0.5 rounded-full shadow z-10">
                    Wanted {((currentWantedIndex % wantedFigures.length) + 1)}/{wantedFigures.length}
                  </div>
                </div>
              ) : set.productImage ? (
                <img src={set.productImage} alt={set.name} className="object-contain w-full h-full p-2" referrerPolicy="no-referrer" />
              ) : (
                <div className="text-gray-400 flex flex-col items-center">
                  <AlertCircle size={32} />
                  <span className="text-xs uppercase font-bold mt-1">No Image</span>
                </div>
              )}
              {set.minifigures && set.minifigures.length > 0 && (
                <button
                  onClick={() => setIsFlipped(true)}
                  className="absolute bottom-2 left-2 right-2 z-20 bg-lego-blue hover:bg-blue-600 text-white text-[10px] font-black uppercase tracking-wider py-1.5 rounded opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                >
                  View Checklist
                </button>
              )}
          <span className={`absolute top-2 left-2 px-2 py-1 rounded text-[10px] font-black uppercase ${
            set.priority === 'high' ? 'bg-red-500 text-white' : 
            set.priority === 'medium' ? 'bg-orange-400 text-white' : 'bg-gray-400 text-white'
          }`}>
            {set.priority}
          </span>
        </div>

        <div className="flex-1 p-4 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-xl font-black text-gray-900 leading-tight uppercase tracking-tight pr-8">{set.name}</h3>
                {set.legoUrl ? (
                   <a href={set.legoUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-blue-500 hover:text-blue-600 hover:underline flex items-center gap-1 transition-colors w-fit mt-0.5">
                     #{set.setNumber} <ExternalLink size={12} />
                   </a>
                ) : (
                   <p className="text-sm font-bold text-gray-500 mt-0.5">#{set.setNumber}</p>
                )}
              </div>
              <div className="flex items-center space-x-1 whitespace-nowrap">
                <button 
                  onClick={() => readOnly ? null : refreshLegoInfoOnly()}
                  disabled={loadingLegoInfo || readOnly}
                  className="text-gray-400 hover:text-blue-500 transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Refresh Name/Image" aria-label="Refresh name and image"
                >
                  <RefreshCw size={18} className={loadingLegoInfo ? "animate-spin" : ""} />
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-gray-400 hover:text-red-500 transition-colors p-1 disabled:opacity-50"
                  title="Remove Set" aria-label="Remove set"
                >
                  <Trash2 size={18} />
                </button>
                <button
                  onClick={() => setIsCollapsed(true)}
                  className="text-gray-400 hover:text-black transition-colors p-1"
                  title="Collapse" aria-label="Collapse card"
                  aria-expanded={true}
                >
                  <ChevronUp size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center">
            <div className="flex gap-4 items-center">
               {set.legoPriceHuf ? (
                 <div className="flex flex-col items-start relative group">
                   <p className="text-[10px] uppercase font-black text-gray-400 tracking-wider leading-none mb-1">
                     {set.isTemporary ? 'UNRELEASED / LEAKED' : 'OFFICIAL PRICE'} {set.quantity && set.quantity > 1 ? `(x${set.quantity})` : ''}
                   </p>
                   <p className={`text-sm font-black tracking-tight flex items-center gap-1 ${set.isTemporary ? 'text-gray-500 line-through decoration-orange-400' : 'text-lego-blue'}`}>
                     {formatPrice((set.legoPriceHuf || 0) * (set.quantity || 1))}
                     {!readOnly && (
                       <button onClick={() => refreshLegoPriceOnly()} disabled={loadingLegoPrice} className="text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50 inline-flex">
                          <RefreshCw size={12} className={loadingLegoPrice ? 'animate-spin' : ''} />
                       </button>
                     )}
                   </p>
                   {set.isTemporary && set.releaseDate && (
                     <p className="text-[9px] font-bold text-gray-600">Expected: {set.releaseDate}</p>
                   )}
                 </div>
               ) : loadingLegoPrice ? (
                 <div className="text-gray-400 flex flex-col items-start">
                    <p className="text-[10px] uppercase font-black tracking-wider leading-none mb-1">OFFICIAL PRICE</p>
                    <div className="flex items-center gap-1">
                       <RefreshCw size={14} className="animate-spin" />
                    </div>
                 </div>
               ) : set.legoPriceError ? (
                 <button
                   type="button"
                   disabled={readOnly}
                   onClick={() => !readOnly && refreshLegoPriceOnly()}
                   aria-label="Official price lookup failed. Retry."
                   className="text-left text-red-500 flex flex-col items-start group cursor-pointer disabled:cursor-default"
                 >
                    <p className="text-[10px] uppercase font-black tracking-wider leading-none mb-1">Official Price</p>
                    <p className="text-sm font-black flex items-center gap-1">
                      <AlertCircle size={14} /> Fetch Failed
                      {!readOnly && <RefreshCw size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
                    </p>
                 </button>
               ) : (
                 <button
                   type="button"
                   disabled={readOnly}
                   onClick={() => !readOnly && refreshLegoPriceOnly()}
                   aria-label="Official price unknown. Fetch it."
                   className="text-left text-gray-400 flex flex-col items-start group cursor-pointer disabled:cursor-default"
                 >
                    <p className="text-[10px] uppercase font-black tracking-wider leading-none mb-1">Official Price</p>
                    <p className="text-sm font-black flex items-center gap-1">
                      UNKNOWN
                      {!readOnly && <RefreshCw size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
                    </p>
                 </button>
               )}
            </div>

            {set.status === 'planned' && !readOnly && (
               <button 
                 onClick={() => openOrderDialog(set.legoPriceHuf)}
                 className="bg-green-500 text-white text-xs font-black uppercase px-4 py-2 rounded-full hover:bg-green-600 transition-colors shadow-sm whitespace-nowrap ml-4"
               >
                 Purchased
               </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white border-t border-gray-100 flex overflow-hidden lg:min-h-0 min-h-[50px] mt-auto">
        {set.status === 'ordered' ? (
          <div className="space-y-1 bg-green-50 p-4 w-full h-full flex flex-col justify-between">
            <div className="mb-auto flex items-start justify-between gap-2">
               <p className="text-[10px] uppercase font-black text-green-600 tracking-wider">
                 PURCHASED FOR {set.quantity && set.quantity > 1 ? `(x${set.quantity})` : ''}
               </p>
               {!readOnly && (
                 <button
                   onClick={revertToPlanned}
                   title="Revert to planned" aria-label="Revert to planned"
                   className="text-[10px] font-bold text-green-600 hover:text-green-900 flex items-center gap-0.5 whitespace-nowrap transition-colors shrink-0"
                 >
                   <Undo2 size={10} /> Revert
                 </button>
               )}
            </div>
            <div className="mt-2 text-sm font-black text-green-700 tracking-tight flex items-end justify-between">
              {formatPrice((set.orderedPriceHuf || 0) * (set.quantity || 1))}
              {isEditingPurchaseDate || isUpdatingDate ? (
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={editedPurchaseDate}
                    onChange={(e) => setEditedPurchaseDate(e.target.value)}
                    className="text-xs p-1 border rounded w-28 bg-white text-black"
                    autoFocus
                    disabled={isUpdatingDate}
                    onBlur={savePurchaseDate}
                    onKeyDown={(e) => e.key === 'Enter' && savePurchaseDate()}
                  />
                  {isUpdatingDate && <RefreshCw size={12} className="animate-spin text-green-700" />}
                </div>
              ) : (
                <span 
                  className="text-[10px] font-bold text-green-600 flex items-center gap-1 cursor-pointer hover:text-green-800 transition-colors"
                  onClick={handlePurchaseDateClick}
                >
                  <CheckCircle size={10} /> {set.orderedDate ? format(new Date(set.orderedDate), 'yyyy.MM.dd') : ''}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="relative group w-full h-full flex flex-col">
             {loadingMarketPrices && (
                <div className="absolute top-2 right-2 text-gray-400 z-10">
                  <RefreshCw size={14} className="animate-spin" />
                </div>
             )}
             {!loadingMarketPrices && (
                 <button 
                   onClick={() => readOnly ? null : refreshMarketPrices()} 
                   disabled={readOnly}
                   className="absolute top-2 right-2 text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10 disabled:opacity-50 disabled:cursor-not-allowed"
                   title="Refresh Market Prices" aria-label="Refresh market prices"
                 >
                   <RefreshCw size={14} />
                 </button>
             )}

             {(() => {
                const hasPreviousData = set.marketPrices && Object.keys(set.marketPrices).some(k => k !== 'error' && k !== 'exchangeRate');
                const hasPricesFallback = set.prices && Object.keys(set.prices).length > 0;
                const marketData = set.marketPrices;
                
                if (marketData?.error && !hasPreviousData && !hasPricesFallback) {
                  return (
                   <button
                     type="button"
                     disabled={readOnly}
                     onClick={() => !readOnly && refreshMarketPrices()}
                     aria-label="Market price lookup failed. Retry."
                     className="text-left flex-1 p-4 flex flex-col justify-between bg-red-50 cursor-pointer hover:bg-red-100 disabled:cursor-default transition-colors relative"
                   >
                      <p className="text-[10px] uppercase font-black text-red-500 tracking-wider">Market Prices</p>
                      <div className="mt-2">
                        <p className="text-sm font-black text-red-600 flex items-center gap-1">
                          <AlertCircle size={14} /> Fetch Failed
                        </p>
                      </div>
                   </button>
                  );
                }
                
                if (!marketData && !hasPricesFallback) {
                   return (
                     <div className="flex-1 flex items-center justify-center p-4">
                        <div className="text-xs text-gray-500 font-bold uppercase text-center p-2">Wait for market prices...</div>
                     </div>
                   );
                }
                
                let mergedPrices = marketData || { exchangeRate: exchangeRates?.EUR || 400, error: false };
                if (hasPricesFallback && !hasPreviousData) {
                   const simulated: any = { exchangeRate: mergedPrices.exchangeRate, error: mergedPrices.error };
                   priceSources.forEach(s => {
                      if (set.prices && set.prices[s.id]) {
                          simulated[s.id] = { 
                             price: set.prices[s.id], 
                             store: s.name, 
                             url: s.urlTemplate.replace('{setNumber}', set.setNumber).replace('{name}', encodeURIComponent(set.name))
                          };
                          if (s.currency === 'EUR' && exchangeRates) {
                             simulated[s.id].priceHuf = set.prices[s.id] * exchangeRates.EUR;
                          } else {
                             simulated[s.id].priceHuf = set.prices[s.id];
                          }
                      }
                   });
                   mergedPrices = simulated;
                }

                return (
                 <div className={`flex-1 relative group/scroll min-w-0 w-full overflow-hidden ${mergedPrices.error ? 'bg-red-50' : ''}`}>
                   {mergedPrices.error && (
                      <div className="absolute top-1 left-2 z-20 flex items-center gap-1">
                        <AlertCircle size={10} className="text-red-500" />
                        <span className="text-[8px] font-bold text-red-500 uppercase tracking-widest">Update Failed</span>
                      </div>
                   )}
                   {canScrollLeft && (
                     <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-white to-transparent pointer-events-none z-10 flex items-center justify-start pointer-events-auto">
                        <button onClick={(e) => { e.stopPropagation(); scrollContainerRef.current?.scrollBy({ left: -200, behavior: 'smooth' }) }} className="bg-white rounded-full shadow p-1 ml-1 text-gray-500 hover:text-black hover:scale-110 transition-all pointer-events-auto">
                           <ChevronLeft size={14} />
                        </button>
                     </div>
                   )}
                   {canScrollRight && (
                     <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent pointer-events-none z-10 flex items-center justify-end pointer-events-auto">
                        <button onClick={(e) => { e.stopPropagation(); scrollContainerRef.current?.scrollBy({ left: 200, behavior: 'smooth' }) }} className="bg-white rounded-full shadow p-1 mr-1 text-gray-500 hover:text-black hover:scale-110 transition-all pointer-events-auto">
                           <ChevronRight size={14} />
                        </button>
                     </div>
                   )}
                   <div 
                     ref={scrollContainerRef}
                     onScroll={checkScroll}
                     className="flex overflow-x-auto divide-x divide-gray-100 snap-x hide-scrollbar h-full"
                   >
                      {priceSources.map((source) => {
                     const priceData = mergedPrices[source.id];
                     if (!isPriceQuote(priceData)) return <div key={source.id} className="p-4 flex flex-col justify-between h-full min-w-[140px] snap-start shrink-0"><p className="text-[10px] font-black text-gray-400 mt-auto mb-auto">{source.name.toUpperCase()} (N/A)</p></div>;

                     const priceDiff = (priceData.priceHuf && set.legoPriceHuf) ? calculateDiff(priceData.priceHuf) : 0;
                     const isGreatDeal = priceDiff <= -30 && set.legoPriceHuf > 0;

                     // The source link and the "mark as purchased" action are
                     // siblings rather than a link nested in a clickable div:
                     // the old markup was keyboard-unreachable, and an <a>
                     // inside a <button> would be invalid HTML.
                     return (
                      <div
                        key={source.id}
                        className={`text-left ${isGreatDeal ? 'bg-green-500 text-white shadow-inner' : (mergedPrices.error ? 'bg-red-50' : 'bg-white')} transition-colors relative flex flex-col min-w-[160px] snap-start shrink-0`}
                      >
                         <div className="px-4 pt-5">
                           {priceData.url ? (
                              <a href={priceData.url} target="_blank" rel="noreferrer" className={`group/link text-[10px] font-black ${isGreatDeal ? 'text-white' : 'text-blue-500'} hover:underline leading-none inline-flex items-center gap-1 uppercase tracking-wider`}>
                                {source.name} <ExternalLink size={8} />
                              </a>
                           ) : (
                              <p className={`text-[10px] font-black ${isGreatDeal ? 'text-green-50' : 'text-gray-400'} leading-none uppercase tracking-wider`}>{source.name}</p>
                           )}
                           {priceData.store && priceData.store.toLowerCase() !== source.name.toLowerCase() && (
                               <p className={`text-[9px] font-bold ${isGreatDeal ? 'text-green-100' : 'text-gray-500'} truncate mt-1`}>{priceData.store}</p>
                           )}
                         </div>
                         <button
                           type="button"
                           disabled={readOnly}
                           onClick={() => openOrderDialog(priceData.priceHuf, source.currency, priceData.price)}
                           aria-label={`Mark as purchased at the ${source.name} price`}
                           className={`text-left px-4 pb-4 pt-2 mt-auto w-full transition-colors ${readOnly ? 'cursor-default' : `cursor-pointer ${isGreatDeal ? 'hover:bg-green-600' : 'hover:bg-gray-50'}`}`}
                         >
                           <div className="flex justify-between items-end">
                            <div>
                               <p className={`text-sm font-black ${isGreatDeal ? 'text-white' : 'text-gray-700'} tracking-tight`}>{priceData.priceHuf ? formatPrice(priceData.priceHuf) : "-"}</p>
                            </div>
                            <div className={`text-[10px] font-bold flex items-center gap-0.5 ${(priceData.priceHuf && priceDiff <= 0) ? (isGreatDeal ? 'text-white bg-green-600 px-1.5 py-0.5 rounded' : 'text-green-500') : 'text-red-500'}`}>
                                {priceData.priceHuf ? priceDiff.toFixed(1) : 0}%
                                {(priceData.priceHuf && priceDiff <= 0) ? <TrendingDown size={10} /> : <TrendingUp size={10} />}
                             </div>
                          </div>
                        </button>
                      </div>
                     );
                  })}
               </div>
               </div>
                );
             })()}
          </div>
        )}

        {/* Price history. The data has been written to Firestore all along but
            nothing ever read it back, because showHistory was never set true. */}
        {!isCollapsed && (
          <div className="border-t border-gray-100 bg-white">
            <button
              onClick={() => setShowHistory(v => !v)}
              aria-expanded={showHistory}
              aria-controls={`price-history-${set.id}`}
              className="w-full flex items-center justify-between px-4 py-2 text-[10px] font-black uppercase tracking-wider text-gray-500 hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Clock size={11} /> Price History
              </span>
              {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            <AnimatePresence initial={false}>
              {showHistory && (
                <motion.div
                  id={`price-history-${set.id}`}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-3 h-44">
                    {loadingHistory ? (
                      <div className="h-full flex items-center justify-center text-gray-400">
                        <RefreshCw className="animate-spin" size={16} />
                      </div>
                    ) : chartData.length < 2 ? (
                      <div className="h-full flex items-center justify-center text-center px-4">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                          {chartData.length === 0
                            ? 'No price history recorded yet'
                            : 'Need at least two refreshes to draw a trend'}
                        </p>
                      </div>
                    ) : (
                      <Suspense
                        fallback={
                          <div className="h-full flex items-center justify-center text-gray-400">
                            <RefreshCw className="animate-spin" size={16} />
                          </div>
                        }
                      >
                        <PriceHistoryChart data={chartData} displayCurrency={displayCurrency} />
                      </Suspense>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
          </motion.div>
        ) : (
          <motion.div
            key="back"
            initial={{ opacity: 0, rotateY: 90 }}
            animate={{ opacity: 1, rotateY: 0 }}
            exit={{ opacity: 0, rotateY: -90 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col border-b border-gray-100 bg-gray-50/50 flex-1 w-full"
          >
            <div className="bg-white flex items-center justify-between px-4 py-3 border-b border-gray-200 sticky top-0 z-10 shadow-sm">
                <h3 className="font-black text-gray-900 uppercase text-xs">Series Checklist</h3>
                <button onClick={() => setIsFlipped(false)} className="text-[10px] font-black uppercase text-gray-500 hover:text-gray-900 flex items-center gap-1 bg-gray-100 hover:bg-gray-200 py-1.5 px-3 rounded transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px]">
                   Back to Info <ArrowRight size={12} />
                </button>
            </div>
            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 max-h-[60vh] overflow-y-auto w-full">
                {set.minifigures?.map((fig) => {
                    const status = set.minifiguresStatus?.[fig.id] || 'none';
                    return (
                        <div key={fig.id} className="bg-white border-2 border-black rounded shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex flex-col group relative overflow-hidden transition-all hover:-translate-y-1 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] min-h-[220px]">
                            <div className="h-32 min-h-32 bg-gray-50 p-2 relative flex items-center justify-center border-b-2 border-black shrink-0">
                                {fig.image ? <img src={fig.image} alt={fig.name} className="w-full h-full object-contain" referrerPolicy="no-referrer" /> : <AlertCircle className="text-gray-300" />}
                                {status === 'got' && (
                                    <div className="absolute inset-0 bg-green-500/20 backdrop-blur-[1px] flex items-center justify-center">
                                       <CheckCircle className="text-green-600 drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)] w-12 h-12" />
                                    </div>
                                )}
                                {status === 'wanted' && (
                                    <div className="absolute inset-0 bg-lego-blue/10 flex items-start justify-end p-2 pointer-events-none">
                                       <Star className="text-lego-blue fill-lego-blue drop-shadow w-5 h-5" />
                                    </div>
                                )}
                            </div>
                            <div className="p-2 flex-grow flex flex-col">
                                <span className="text-[9px] font-black text-gray-400 leading-none uppercase shrink-0">{fig.id}</span>
                                <h4 className="text-[11px] font-bold leading-tight my-1.5 shrink-0 line-clamp-3">{fig.name}</h4>
                                <div className="mt-auto flex gap-1 content-end pt-2 shrink-0">
                                    <button 
                                        onClick={() => toggleMinifigureStatus(fig.id, status === 'wanted' ? 'wanted' : 'none')}
                                        className={`flex-1 py-1.5 flex items-center justify-center rounded border border-black transition-colors ${status === 'wanted' ? 'bg-lego-blue text-white shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                                        title="Want it" aria-label="Mark minifigure as wanted"
                                    >
                                        <Star size={12} className={status === 'wanted' ? 'fill-current' : ''} />
                                    </button>
                                    <button 
                                        onClick={() => toggleMinifigureStatus(fig.id, status === 'got' ? 'got' : (status === 'wanted' ? 'got' : 'none'))}
                                        className={`flex-1 py-1.5 flex items-center justify-center rounded border border-black transition-colors ${status === 'got' ? 'bg-green-500 text-white shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                                        title="Got it" aria-label="Mark minifigure as collected"
                                    >
                                        <Check size={12} strokeWidth={status === 'got' ? 3 : 2} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showOrderDialog && (
          <Modal onClose={() => setShowOrderDialog(false)} label={`Mark ${set.name} as purchased`}>
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm relative"
            >
              <button
                onClick={() => setShowOrderDialog(false)}
                aria-label="Close"
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-900"
              >
                <X size={20} />
              </button>
              <h2 className="text-xl font-black text-gray-900 uppercase">Set to Purchased</h2>
              
              <div className="mt-4 space-y-4">
                 <div>
                   <label htmlFor={`order-price-${set.id}`} className="block text-xs font-bold text-gray-500 uppercase">Unit Price</label>
                   <div className="flex gap-2 mt-1">
                      <input
                        id={`order-price-${set.id}`}
                        type="number"
                        value={orderPrice}
                        onChange={(e) => setOrderPrice(e.target.value)}
                        className="flex-1 bg-gray-50 border border-gray-200 rounded px-3 py-2 outline-none focus:border-lego-blue font-bold text-gray-900"
                        placeholder="Price per unit..."
                      />
                      <select
                        aria-label="Purchase currency"
                        value={orderCurrency}
                        onChange={(e) => setOrderCurrency(e.target.value)}
                        className="bg-gray-50 border border-gray-200 rounded px-3 py-2 outline-none focus:border-lego-blue font-bold text-gray-900"
                      >
                        {SUPPORTED_CURRENCIES.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                   </div>
                 </div>

                 <div>
                   <label htmlFor={`order-qty-${set.id}`} className="block text-xs font-bold text-gray-500 uppercase">Quantity</label>
                   <input
                     id={`order-qty-${set.id}`}
                     type="number"
                     min="1"
                     value={orderQuantity}
                     onChange={(e) => setOrderQuantity(parseInt(e.target.value) || 1)}
                     className="mt-1 w-full bg-gray-50 border border-gray-200 rounded px-3 py-2 outline-none focus:border-lego-blue font-bold text-gray-900"
                   />
                 </div>

                 <div>
                   <label htmlFor={`order-date-${set.id}`} className="block text-xs font-bold text-gray-500 uppercase">Purchase Date</label>
                   <input
                     id={`order-date-${set.id}`}
                     type="date"
                     value={orderDate}
                     onChange={(e) => setOrderDate(e.target.value)}
                     className="mt-1 w-full bg-gray-50 border border-gray-200 rounded px-3 py-2 outline-none focus:border-lego-blue font-bold text-gray-900"
                   />
                 </div>

                 {orderError && (
                   <p role="alert" className="mt-3 text-xs font-bold text-red-600">{orderError}</p>
                 )}

                 <button
                   onClick={submitOrder}
                   disabled={isSubmittingOrder || !orderPrice || isNaN(parseFloat(orderPrice))}
                   className="w-full bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-black uppercase tracking-wider py-3 rounded-lg mt-4 transition-colors flex items-center justify-center gap-2"
                 >
                   {isSubmittingOrder ? (
                     <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }} className="w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                   ) : 'Confirm Purchase'}
                 </button>
              </div>
            </motion.div>
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteConfirm && (
          // closeOnBackdrop is off: this is destructive, so a stray click
          // outside should not silently dismiss the confirmation.
          <Modal
            onClose={() => setShowDeleteConfirm(false)}
            label={`Remove ${set.name}?`}
            closeOnBackdrop={false}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-xs relative text-center border-4 border-black"
            >
              <Trash2 className="mx-auto text-red-500 mb-4" size={32} />
              <h2 className="text-lg font-black text-gray-900 uppercase">Remove Set?</h2>
              <p className="text-sm text-gray-500 font-bold mb-6 mt-1">This action cannot be undone.</p>

              <div className="flex gap-2">
                 <button
                   onClick={() => setShowDeleteConfirm(false)}
                   className="flex-1 font-black text-xs uppercase bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded"
                 >
                   Cancel
                 </button>
                 <button
                   onClick={() => {
                     setShowDeleteConfirm(false);
                     onDelete(set.id);
                   }}
                   className="flex-1 font-black text-xs uppercase bg-red-500 hover:bg-red-600 text-white py-3 rounded"
                 >
                   Remove
                 </button>
              </div>
            </motion.div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Replaces a blocking window.confirm(), which could not be styled,
          announced, or dismissed with the keyboard consistently. */}
      <AnimatePresence>
        {showRevertConfirm && (
          <Modal
            onClose={() => setShowRevertConfirm(false)}
            label={`Move ${set.name} back to planned?`}
            closeOnBackdrop={false}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-xs relative text-center border-4 border-black"
            >
              <Undo2 className="mx-auto text-lego-blue mb-4" size={32} />
              <h2 className="text-lg font-black text-gray-900 uppercase">Back to Planned?</h2>
              <p className="text-sm text-gray-500 font-bold mb-6 mt-1">
                This clears the recorded purchase for this set.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowRevertConfirm(false)}
                  className="flex-1 font-black text-xs uppercase bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowRevertConfirm(false);
                    onUpdate(set.id, { status: 'planned' }).catch(() => {
                      /* surfaced by useSets */
                    });
                  }}
                  className="flex-1 font-black text-xs uppercase bg-lego-blue hover:opacity-90 text-white py-3 rounded"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </Modal>
        )}
      </AnimatePresence>
      </>
      )}
    </motion.div>
  );
};

// Memoised because App re-renders on every keystroke, theme toggle and
// batch-progress tick, and each card carries motion layout animations. This
// only pays off because the callbacks from useSets are useCallback'd and the
// onDelete prop is hoisted -- otherwise every render brings new prop
// identities and the comparison always fails.
export const SetCard = React.memo(SetCardComponent);

