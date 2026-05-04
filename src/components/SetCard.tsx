import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, TrendingUp, TrendingDown, Clock, CheckCircle, ExternalLink, AlertCircle, X, RefreshCw, Star, Check, ArrowRight } from 'lucide-react';
import { LegoSet, PriceHistory, PriceSource } from '../types';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';

interface SetCardProps {
  set: LegoSet;
  onUpdate: (id: string, updates: Partial<LegoSet>) => void;
  onDelete: (id: string) => void;
  getPriceHistory: (id: string) => Promise<PriceHistory[]>;
  onAddPriceHistory: (id: string, history: PriceHistory) => void;
  priceSources?: PriceSource[];
  displayCurrency: string;
  exchangeRates: Record<string, number> | null;
  readOnly?: boolean;
  onStatusUpdate?: (status: {setId: string, message: string} | null) => void;
}

export const SetCard: React.FC<SetCardProps> = ({ set, onUpdate, onDelete, getPriceHistory, onAddPriceHistory, priceSources = [], displayCurrency, exchangeRates, readOnly = false, onStatusUpdate }) => {
  const [history, setHistory] = useState<PriceHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);
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
  const [loadingLegoInfo, setLoadingLegoInfo] = useState(false);
  const [loadingLegoPrice, setLoadingLegoPrice] = useState(false);
  
  const [showOrderDialog, setShowOrderDialog] = useState(false);
  const [orderPrice, setOrderPrice] = useState('');
  const [orderQuantity, setOrderQuantity] = useState(1);
  const [orderCurrency, setOrderCurrency] = useState<string>('HUF');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  const [isFlipped, setIsFlipped] = useState(false);
  const [currentWantedIndex, setCurrentWantedIndex] = useState(0);

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

  const getPriceValue = (priceHuf: number) => {
    if (displayCurrency === 'HUF' || !exchangeRates) return priceHuf;
    const priceEur = priceHuf / exchangeRates.HUF;
    const targetRate = exchangeRates[displayCurrency] || 1;
    return priceEur * targetRate;
  };

  const wantedFigures = set.minifigures?.filter(f => set.minifiguresStatus?.[f.id] === 'wanted' && f.image) || [];

  useEffect(() => {
    if (wantedFigures.length > 1 && !isFlipped) {
      const interval = setInterval(() => {
        setCurrentWantedIndex(prev => prev + 1);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [wantedFigures.length, isFlipped]);

  const toggleMinifigureStatus = (figureId: string, currentStatus?: 'wanted' | 'got' | 'none') => {
    if (readOnly) return;
    const nextStatus = currentStatus === 'got' ? 'none' : (currentStatus === 'wanted' ? 'got' : 'wanted');
    const newStatuses = { ...(set.minifiguresStatus || {}), [figureId]: nextStatus };
    onUpdate(set.id, { minifiguresStatus: newStatuses });
  };

  useEffect(() => {
    if (showHistory) {
      getPriceHistory(set.id).then(setHistory);
    }
  }, [showHistory, set.id]);

  useEffect(() => {
    if (set.status === 'planned' || set.status === 'ordered') {
      if (!set.hasFetchedLegoInfo) {
         refreshLegoData(true, false);
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
      const shouldSkipImage = !!set.productImage;
      const apiKey = localStorage.getItem('brickTrackerApiKey') || '';
      const headers: Record<string, string> = apiKey ? { 'x-gemini-api-key': apiKey } : {};
      const res = await fetch(`/api/lego/${set.setNumber}${shouldSkipImage ? '?skipImage=true' : ''}`, { headers });
      if (res.status === 429) {
        if (onStatusUpdate) onStatusUpdate(null);
        return;
      }
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      
      const updates: Partial<LegoSet> = {};
      
      if (updateInfo) {
         updates.name = data.name || set.name;
         updates.productImage = data.image || set.productImage;
         updates.hasFetchedLegoInfo = true;
         
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
      const apiKey = localStorage.getItem('brickTrackerApiKey') || '';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['x-gemini-api-key'] = apiKey;
      const res = await fetch(`/api/prices/${set.setNumber}`, { 
         method: 'POST', 
         headers, 
         body: JSON.stringify({ sources: priceSources }) 
      });
      if (res.status === 429) {
         if (onStatusUpdate) onStatusUpdate(null);
         return;
      }
      if (!res.ok) throw new Error('API error');

      const data = await res.json();
      
      onUpdate(set.id, {
         marketPrices: data,
         lastPricesRefreshTime: Date.now()
      });

      if (set.status === 'planned') {
        const today = new Date().toISOString().split('T')[0];
        const historyEntry: any = {
           date: today,
           exchangeRate: data.exchangeRate
        };
        priceSources.forEach(s => {
           if (data[s.id]) {
               historyEntry[`${s.id}Price`] = data[s.id].price;
           }
        });
        onAddPriceHistory(set.id, historyEntry);
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
      alert('Failed to get exchange rate or update order.');
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`bg-white rounded-lg shadow-xl overflow-hidden border-4 flex flex-col h-full ${
        set.status === 'ordered' ? 'border-green-500' : 'border-lego-yellow'
      }`}
    >
      <AnimatePresence mode="wait">
        {!isFlipped ? (
          <motion.div 
            key="front"
            initial={{ opacity: 0, rotateY: -90 }}
            animate={{ opacity: 1, rotateY: 0 }}
            exit={{ opacity: 0, rotateY: 90 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col flex-1 w-full"
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
                    />
                  </AnimatePresence>
                  <div className="absolute top-2 right-2 bg-lego-blue text-white text-[9px] font-black uppercase px-2 py-0.5 rounded-full shadow z-10">
                    Wanted {((currentWantedIndex % wantedFigures.length) + 1)}/{wantedFigures.length}
                  </div>
                </div>
              ) : set.productImage ? (
                <img src={set.productImage} alt={set.name} className="object-contain w-full h-full p-2" />
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
                  title="Refresh Name/Image"
                >
                  <RefreshCw size={18} className={loadingLegoInfo ? "animate-spin" : ""} />
                </button>
                <button 
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-gray-400 hover:text-red-500 transition-colors p-1 disabled:opacity-50"
                  title="Remove Set"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-end">
            <div />
            <div className="flex gap-4 items-center">
               {set.legoPriceHuf ? (
                 <div className="flex flex-col items-end relative group">
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
                 <div className="text-gray-400 flex flex-col items-end">
                    <p className="text-[10px] uppercase font-black tracking-wider leading-none mb-1">OFFICIAL PRICE</p>
                    <div className="flex items-center gap-1">
                       <RefreshCw size={14} className="animate-spin" />
                    </div>
                 </div>
               ) : set.legoPriceError ? (
                 <div className="text-red-500 flex flex-col items-end group cursor-pointer" onClick={() => !readOnly && refreshLegoPriceOnly()}>
                    <p className="text-[10px] uppercase font-black tracking-wider leading-none mb-1">Official Price</p>
                    <p className="text-sm font-black flex items-center gap-1">
                      <AlertCircle size={14} /> Fetch Failed
                      {!readOnly && <RefreshCw size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
                    </p>
                 </div>
               ) : null}

               {set.status === 'planned' && !readOnly && (
                  <button 
                    onClick={() => openOrderDialog(set.legoPriceHuf)}
                    className="bg-green-500 text-white text-xs font-black uppercase px-4 py-2 rounded-full hover:bg-green-600 transition-colors shadow-sm whitespace-nowrap"
                  >
                    Purchased
                  </button>
               )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border-t border-gray-100 flex overflow-hidden min-h-[100px]">
        {set.status === 'ordered' ? (
          <div className="space-y-1 bg-green-50 p-4 w-full h-full flex flex-col justify-between">
            <div className="mb-auto">
               <p className="text-[10px] uppercase font-black text-green-600 tracking-wider">
                 PURCHASED FOR {set.quantity && set.quantity > 1 ? `(x${set.quantity})` : ''}
               </p>
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
                   title="Refresh Market Prices"
                 >
                   <RefreshCw size={14} />
                 </button>
             )}

             {set.marketPrices?.error ? (
               <div className="flex-1 p-4 flex flex-col justify-between bg-red-50 cursor-pointer hover:bg-red-100 transition-colors relative" onClick={() => !readOnly && refreshMarketPrices()}>
                  <p className="text-[10px] uppercase font-black text-red-500 tracking-wider">Market Prices</p>
                  <div className="mt-2">
                    <p className="text-sm font-black text-red-600 flex items-center gap-1">
                      <AlertCircle size={14} /> Fetch Failed
                    </p>
                  </div>
               </div>
             ) : (set.marketPrices && !set.marketPrices.error) ? (
               <div className="flex-1 flex overflow-x-auto divide-x divide-gray-100 snap-x hide-scrollbar">
                  {priceSources.map((source) => {
                     const priceData = set.marketPrices![source.id] as any;
                     if (!priceData) return <div key={source.id} className="p-4 flex flex-col justify-between h-full min-w-[140px] snap-start shrink-0"><p className="text-[10px] font-black text-gray-400 mt-auto mb-auto">{source.name.toUpperCase()} (N/A)</p></div>;
                     
                     return (
                      <div 
                        key={source.id}
                        onClick={() => openOrderDialog(priceData.priceHuf, source.currency as any, priceData.price)}
                        className={`text-left ${readOnly ? '' : 'cursor-pointer hover:bg-gray-50'} p-4 transition-colors relative flex flex-col justify-between min-w-[160px] snap-start shrink-0`}
                      >
                         <div className="mb-auto">
                           {priceData.url ? (
                              <a href={priceData.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="group/link text-[10px] font-black text-blue-500 hover:underline leading-none flex items-center gap-1 uppercase tracking-wider">
                                {source.name} <ExternalLink size={8} />
                              </a>
                           ) : (
                              <p className="text-[10px] font-black text-gray-400 leading-none uppercase tracking-wider">{source.name}</p>
                           )}
                           {priceData.store && priceData.store.toLowerCase() !== source.name.toLowerCase() && (
                               <p className="text-[9px] font-bold text-gray-500 truncate mt-1">{priceData.store}</p>
                           )}
                         </div>
                         <div className="flex justify-between items-end mt-2">
                          <div>
                             <p className="text-sm font-black text-gray-700 tracking-tight">{priceData.priceHuf ? formatPrice(priceData.priceHuf) : '-'}</p>
                          </div>
                          <div className={`text-[10px] font-bold flex items-center gap-0.5 ${(priceData.priceHuf && calculateDiff(priceData.priceHuf) <= 0) ? 'text-green-500' : 'text-red-500'}`}>
                             {priceData.priceHuf ? calculateDiff(priceData.priceHuf).toFixed(1) : 0}% 
                             {(priceData.priceHuf && calculateDiff(priceData.priceHuf) <= 0) ? <TrendingDown size={10} /> : <TrendingUp size={10} />}
                          </div>
                        </div>
                      </div>
                     );
                  })}
               </div>
             ) : (
               <div className="flex-1 flex items-center justify-center">
                  <div className="text-xs text-gray-500 font-bold uppercase text-center p-2">Wait for market prices...</div>
               </div>
             )}
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
                                {fig.image ? <img src={fig.image} alt={fig.name} className="w-full h-full object-contain" /> : <AlertCircle className="text-gray-300" />}
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
                                        title="Want it"
                                    >
                                        <Star size={12} className={status === 'wanted' ? 'fill-current' : ''} />
                                    </button>
                                    <button 
                                        onClick={() => toggleMinifigureStatus(fig.id, status === 'got' ? 'got' : (status === 'wanted' ? 'got' : 'none'))}
                                        className={`flex-1 py-1.5 flex items-center justify-center rounded border border-black transition-colors ${status === 'got' ? 'bg-green-500 text-white shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                                        title="Got it"
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
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          >
            <motion.div 
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm relative"
            >
              <button 
                onClick={() => setShowOrderDialog(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-900"
              >
                <X size={20} />
              </button>
              <h2 className="text-xl font-black text-gray-900 uppercase">Set to Purchased</h2>
              
              <div className="mt-4 space-y-4">
                 <div>
                   <label className="block text-xs font-bold text-gray-500 uppercase">Unit Price</label>
                   <div className="flex gap-2 mt-1">
                      <input 
                        type="number"
                        value={orderPrice}
                        onChange={(e) => setOrderPrice(e.target.value)}
                        className="flex-1 bg-gray-50 border border-gray-200 rounded px-3 py-2 outline-none focus:border-lego-blue font-bold text-gray-900"
                        placeholder="Price per unit..."
                      />
                      <select 
                        value={orderCurrency}
                        onChange={(e) => setOrderCurrency(e.target.value)}
                        className="bg-gray-50 border border-gray-200 rounded px-3 py-2 outline-none focus:border-lego-blue font-bold text-gray-900"
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
                 </div>

                 <div>
                   <label className="block text-xs font-bold text-gray-500 uppercase">Quantity</label>
                   <input 
                     type="number"
                     min="1"
                     value={orderQuantity}
                     onChange={(e) => setOrderQuantity(parseInt(e.target.value) || 1)}
                     className="mt-1 w-full bg-gray-50 border border-gray-200 rounded px-3 py-2 outline-none focus:border-lego-blue font-bold text-gray-900"
                   />
                 </div>

                 <div>
                   <label className="block text-xs font-bold text-gray-500 uppercase">Purchase Date</label>
                   <input 
                     type="date"
                     value={orderDate}
                     onChange={(e) => setOrderDate(e.target.value)}
                     className="mt-1 w-full bg-gray-50 border border-gray-200 rounded px-3 py-2 outline-none focus:border-lego-blue font-bold text-gray-900"
                   />
                 </div>

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
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
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
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

