import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, TrendingUp, TrendingDown, Clock, CheckCircle, ExternalLink, AlertCircle, X, RefreshCw } from 'lucide-react';
import { LegoSet, PriceHistory } from '../types';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';

interface SetCardProps {
  set: LegoSet;
  onUpdate: (id: string, updates: Partial<LegoSet>) => void;
  onDelete: (id: string) => void;
  getPriceHistory: (id: string) => Promise<PriceHistory[]>;
  onAddPriceHistory: (id: string, history: PriceHistory) => void;
}

const shouldRefresh = (lastRefreshTime?: number) => {
  if (!lastRefreshTime) return true;
  
  const now = new Date();
  const today10am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0).getTime();
  
  if (now.getTime() < today10am) {
    const yesterday10am = today10am - 24 * 60 * 60 * 1000;
    return lastRefreshTime < yesterday10am;
  } else {
    return lastRefreshTime < today10am;
  }
};

export const SetCard: React.FC<SetCardProps> = ({ set, onUpdate, onDelete, getPriceHistory, onAddPriceHistory }) => {
  const [history, setHistory] = useState<PriceHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  
  const [loadingMarketPrices, setLoadingMarketPrices] = useState(false);
  const [loadingLegoInfo, setLoadingLegoInfo] = useState(false);
  const [loadingLegoPrice, setLoadingLegoPrice] = useState(false);
  
  const [showOrderDialog, setShowOrderDialog] = useState(false);
  const [orderPrice, setOrderPrice] = useState('');
  const [orderCurrency, setOrderCurrency] = useState<'HUF' | 'EUR'>('HUF');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (showHistory) {
      getPriceHistory(set.id).then(setHistory);
    }
  }, [showHistory, set.id]);

  useEffect(() => {
    if (set.status === 'planned') {
      const needsInfo = !set.hasFetchedLegoInfo;
      const needsLegoPrice = shouldRefresh(set.lastLegoPriceRefreshTime);
      
      if (needsInfo || needsLegoPrice) {
        refreshLegoData(needsInfo, needsLegoPrice);
      }
      
      if (shouldRefresh(set.lastPricesRefreshTime)) {
        refreshMarketPrices();
      }
    } else if (set.status === 'ordered') {
      if (!set.hasFetchedLegoInfo) {
         refreshLegoData(true, false);
      }
    }
  }, [set.setNumber, set.status]);

  const refreshLegoData = async (updateInfo: boolean, updatePrice: boolean) => {
    if (updateInfo) setLoadingLegoInfo(true);
    if (updatePrice) setLoadingLegoPrice(true);
    
    try {
      const shouldSkipImage = !!set.productImage;
      const res = await fetch(`/api/lego/${set.setNumber}${shouldSkipImage ? '?skipImage=true' : ''}`);
      if (res.status === 429) {
        return;
      }
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      
      const updates: Partial<LegoSet> = {};
      
      if (updateInfo) {
         updates.name = data.name || set.name;
         updates.productImage = data.image || set.productImage;
         updates.hasFetchedLegoInfo = true;
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
    }
  };

  const refreshMarketPrices = async () => {
    setLoadingMarketPrices(true);
    try {
      const res = await fetch(`/api/prices/${set.setNumber}`);
      if (res.status === 429) {
         return;
      }
      if (!res.ok) throw new Error('API error');

      const data = await res.json();
      
      onUpdate(set.id, {
         marketPrices: data,
         lastPricesRefreshTime: Date.now()
      });

      if (set.status === 'planned' && data.amazon && data.arukereso) {
        const today = new Date().toISOString().split('T')[0];
        onAddPriceHistory(set.id, {
            date: today,
            amazonPriceEur: data.amazon.priceEur,
            arukeresoPriceHuf: data.arukereso.priceHuf,
            arukeresoStore: data.arukereso.store,
            exchangeRate: data.exchangeRate
        });
      }
    } catch (e) {
      onUpdate(set.id, {
         marketPrices: { error: true },
         lastPricesRefreshTime: Date.now()
      });
    } finally {
      setLoadingMarketPrices(false);
    }
  };

  const refreshLegoInfoOnly = () => refreshLegoData(true, false);
  const refreshLegoPriceOnly = () => refreshLegoData(false, true);

  const calculateDiff = (price: number) => {
    if (!set.legoPriceHuf) return 0;
    return ((price - set.legoPriceHuf) / set.legoPriceHuf) * 100;
  };

  const openOrderDialog = (initialPriceHuf?: number, initialCurrency: 'HUF' | 'EUR' = 'HUF', initialPriceEur?: number) => {
    if (initialCurrency === 'EUR' && initialPriceEur) {
      setOrderPrice(initialPriceEur.toString());
      setOrderCurrency('EUR');
    } else {
      setOrderPrice(initialPriceHuf ? initialPriceHuf.toString() : set.legoPriceHuf.toString());
      setOrderCurrency('HUF');
    }
    setOrderDate(new Date().toISOString().split('T')[0]);
    setShowOrderDialog(true);
  };

  const submitOrder = async () => {
    if (!orderPrice || isNaN(parseFloat(orderPrice))) return;
    setIsSubmittingOrder(true);
    try {
      let finalPriceHuf = parseFloat(orderPrice);
      if (orderCurrency === 'EUR') {
         const res = await fetch(`/api/exchange-rate/${orderDate}`);
         const data = await res.json();
         if (data.hufRate) {
           finalPriceHuf = finalPriceHuf * data.hufRate;
         }
      }
      onUpdate(set.id, {
        status: 'ordered',
        orderedPriceHuf: Math.round(finalPriceHuf),
        orderedDate: new Date(orderDate).toISOString()
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
      className={`bg-white rounded-lg shadow-xl overflow-hidden border-4 ${
        set.status === 'ordered' ? 'border-green-500' : 'border-lego-yellow'
      }`}
    >
      <div className="flex flex-col md:flex-row border-b border-gray-100">
        <div className="w-full md:w-48 h-48 bg-white flex items-center justify-center relative overflow-hidden shrink-0 md:border-r border-gray-100">
          {set.productImage ? (
            <img src={set.productImage} alt={set.name} className="object-contain w-full h-full p-2" />
          ) : (
            <div className="text-gray-400 flex flex-col items-center">
              <AlertCircle size={32} />
              <span className="text-xs uppercase font-bold mt-1">No Image</span>
            </div>
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
                <p className="text-sm font-bold text-gray-500">#{set.setNumber}</p>
              </div>
              <div className="flex items-center space-x-1 whitespace-nowrap">
                <button 
                  onClick={refreshLegoInfoOnly}
                  disabled={loadingLegoInfo}
                  className="text-gray-400 hover:text-blue-500 transition-colors p-1 disabled:opacity-50"
                  title="Refresh Name/Image"
                >
                  <RefreshCw size={18} className={loadingLegoInfo ? "animate-spin" : ""} />
                </button>
                <button 
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-gray-400 hover:text-red-500 transition-colors p-1"
                  title="Remove Set"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center">
            <button 
              onClick={() => setShowHistory(!showHistory)}
              className="text-xs font-black text-lego-blue flex items-center gap-1 uppercase tracking-widest hover:bg-blue-50 px-2 py-1 rounded"
            >
              {showHistory ? 'Hide History' : 'Show History'}
            </button>
            <div className="flex gap-2">
               {set.status === 'planned' && (
                  <button 
                    onClick={() => openOrderDialog(set.legoPriceHuf)}
                    className="bg-green-500 text-white text-[10px] font-black uppercase px-3 py-1.5 rounded-full hover:bg-green-600 transition-colors shadow-sm"
                  >
                    Ordered
                  </button>
               )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white grid grid-cols-1 sm:grid-cols-3 border-t border-gray-100 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
        <div className="relative group h-full">
          {loadingLegoPrice && (
            <div className="absolute top-2 right-2 text-gray-400">
              <RefreshCw size={14} className="animate-spin" />
            </div>
          )}
          {!loadingLegoPrice && (
             <button 
               onClick={refreshLegoPriceOnly} 
               className="absolute top-2 right-2 text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10"
               title="Refresh Official Price"
             >
               <RefreshCw size={14} />
             </button>
          )}

          {set.legoPriceError ? (
            <div className="h-full p-4 flex flex-col justify-between bg-red-50 hover:bg-red-100 transition-colors cursor-pointer relative" onClick={refreshLegoPriceOnly}>
              <p className="text-[10px] uppercase font-black text-red-500 tracking-wider">Official Price</p>
              <div className="mt-2">
                <p className="text-sm font-black text-red-600 flex items-center gap-1">
                  <AlertCircle size={14} /> Fetch Failed
                </p>
              </div>
              <div className="absolute top-2 right-2 text-red-400">
                <RefreshCw size={14} className="group-hover:rotate-180 transition-transform duration-500" />
              </div>
            </div>
          ) : (
            <div className="h-full p-4 hover:bg-gray-50 transition-colors flex flex-col justify-between">
              <div className="mb-auto">
                {set.legoUrl && !set.isTemporary ? (
                  <a href={set.legoUrl} target="_blank" rel="noreferrer" className="group/link text-[10px] font-black text-blue-500 hover:underline leading-none flex items-center gap-1 uppercase tracking-wider">
                    OFFICIAL PRICE <ExternalLink size={8} />
                  </a>
                ) : (
                  <p className="text-[10px] uppercase font-black text-gray-400 tracking-wider leading-none">
                    {set.isTemporary ? 'UNRELEASED / LEAKED' : 'OFFICIAL PRICE'}
                  </p>
                )}
              </div>
              <div className="mt-2">
                {set.isTemporary ? (
                  <>
                    <p className="text-sm font-black text-gray-500 line-through decoration-orange-400 tracking-tight">{set.legoPriceHuf?.toLocaleString() || '-'} HUF</p>
                    {set.releaseDate && (
                       <p className="text-[9px] font-bold text-gray-600">Expected: {set.releaseDate}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm font-black text-lego-blue tracking-tight">{set.legoPriceHuf?.toLocaleString() || '-'} HUF</p>
                )}
              </div>
            </div>
          )}
        </div>

        {set.status === 'ordered' ? (
          <div className="space-y-1 bg-green-50 p-4 sm:col-span-2 flex flex-col justify-between">
            <div className="mb-auto">
               <p className="text-[10px] uppercase font-black text-green-600 tracking-wider">ORDERED FOR</p>
            </div>
            <div className="mt-2 text-sm font-black text-green-700 tracking-tight flex items-end justify-between">
              {set.orderedPriceHuf?.toLocaleString()} HUF
              <span className="text-[10px] font-bold text-green-600 flex items-center gap-1">
                <CheckCircle size={10} /> {set.orderedDate ? format(new Date(set.orderedDate), 'yyyy.MM.dd') : ''}
              </span>
            </div>
          </div>
        ) : (
          <div className="relative group sm:col-span-2">
             {loadingMarketPrices && (
                <div className="absolute top-2 right-2 text-gray-400 z-10">
                  <RefreshCw size={14} className="animate-spin" />
                </div>
             )}
             {!loadingMarketPrices && (
                 <button 
                   onClick={refreshMarketPrices} 
                   className="absolute top-2 right-2 text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                   title="Refresh Market Prices"
                 >
                   <RefreshCw size={14} />
                 </button>
             )}

             {set.marketPrices?.error ? (
               <div className="h-full p-4 flex flex-col justify-between bg-red-50 cursor-pointer hover:bg-red-100 transition-colors relative" onClick={refreshMarketPrices}>
                  <p className="text-[10px] uppercase font-black text-red-500 tracking-wider">Market Prices</p>
                  <div className="mt-2">
                    <p className="text-sm font-black text-red-600 flex items-center gap-1">
                      <AlertCircle size={14} /> Fetch Failed
                    </p>
                  </div>
               </div>
             ) : (set.marketPrices && !set.marketPrices.error) ? (
               <div className="grid grid-cols-1 sm:grid-cols-2 h-full divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
                  {set.marketPrices.amazon ? (
                    <div 
                      onClick={() => openOrderDialog(set.marketPrices!.amazon!.priceHuf, 'EUR', set.marketPrices!.amazon!.priceEur)}
                      className="text-left cursor-pointer hover:bg-gray-50 p-4 transition-colors relative flex flex-col justify-between"
                    >
                       <div className="mb-auto">
                         {set.marketPrices.amazon.url ? (
                            <a href={set.marketPrices.amazon.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="group/link text-[10px] font-black text-blue-500 hover:underline leading-none flex items-center gap-1 uppercase tracking-wider">
                              AMAZON.DE <ExternalLink size={8} />
                            </a>
                         ) : (
                            <p className="text-[10px] font-black text-gray-400 leading-none uppercase tracking-wider">AMAZON.DE</p>
                         )}
                       </div>
                       <div className="flex justify-between items-end mt-2">
                        <div>
                           <p className="text-sm font-black text-gray-700 tracking-tight">{set.marketPrices.amazon.priceHuf?.toLocaleString() || '-'} HUF</p>
                        </div>
                        <div className={`text-[10px] font-bold flex items-center gap-0.5 ${(set.marketPrices.amazon.priceHuf && calculateDiff(set.marketPrices.amazon.priceHuf) <= 0) ? 'text-green-500' : 'text-red-500'}`}>
                           {set.marketPrices.amazon.priceHuf ? calculateDiff(set.marketPrices.amazon.priceHuf).toFixed(1) : 0}% 
                           {(set.marketPrices.amazon.priceHuf && calculateDiff(set.marketPrices.amazon.priceHuf) <= 0) ? <TrendingDown size={10} /> : <TrendingUp size={10} />}
                        </div>
                      </div>
                    </div>
                  ) : <div className="p-4 flex flex-col justify-between h-full"><p className="text-[10px] font-black text-gray-400 mt-auto mb-auto">N/A</p></div>}

                  {set.marketPrices.arukereso ? (
                    <div 
                      onClick={() => openOrderDialog(set.marketPrices!.arukereso!.priceHuf)}
                      className="text-left cursor-pointer hover:bg-gray-50 p-4 transition-colors relative flex flex-col justify-between"
                    >
                       <div className="mb-auto">
                         {set.marketPrices.arukereso.url ? (
                            <a href={set.marketPrices.arukereso.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="group/link text-[10px] font-black text-blue-500 hover:underline leading-none flex items-center gap-1 uppercase tracking-wider">
                              ARUKERESO <ExternalLink size={8} />
                            </a>
                         ) : (
                            <p className="text-[10px] font-black text-gray-400 leading-none uppercase tracking-wider">ARUKERESO</p>
                         )}
                       </div>
                       <div className="flex justify-between items-end mt-2">
                        <div>
                           <p className="text-sm font-black text-gray-700 tracking-tight">{set.marketPrices.arukereso.priceHuf?.toLocaleString() || '-'} HUF</p>
                        </div>
                        <div className={`text-[10px] font-bold flex items-center gap-0.5 ${(set.marketPrices.arukereso.priceHuf && calculateDiff(set.marketPrices.arukereso.priceHuf) <= 0) ? 'text-green-500' : 'text-red-500'}`}>
                           {set.marketPrices.arukereso.priceHuf ? calculateDiff(set.marketPrices.arukereso.priceHuf).toFixed(1) : 0}% 
                           {(set.marketPrices.arukereso.priceHuf && calculateDiff(set.marketPrices.arukereso.priceHuf) <= 0) ? <TrendingDown size={10} /> : <TrendingUp size={10} />}
                        </div>
                      </div>
                    </div>
                  ) : <div className="p-4 flex flex-col justify-between h-full"><p className="text-[10px] font-black text-gray-400 mt-auto mb-auto">N/A</p></div>}
               </div>
             ) : (
               <div className="h-full flex items-center justify-center">
                  <div className="text-xs text-gray-500 font-bold uppercase text-center p-2">Wait for market prices...</div>
               </div>
             )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showHistory && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-gray-50 border-t"
          >
            <div className="p-4 h-48 w-full">
              {history.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <XAxis dataKey="date" hide />
                    <YAxis hide />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      labelStyle={{ fontWeight: 'bold', fontSize: '10px' }}
                    />
                    <Line type="monotone" dataKey="amazonPriceEur" stroke="#2563eb" strokeWidth={3} dot={false} name="Amazon (€)" />
                    <Line type="monotone" dataKey="arukeresoPriceHuf" stroke="#10b981" strokeWidth={3} dot={false} name="Arukereso (HUF)" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400 text-xs font-bold uppercase">
                  No pricing data collected yet
                </div>
              )}
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
              <h2 className="text-xl font-black text-gray-900 uppercase">Set to Ordered</h2>
              
              <div className="mt-4 space-y-4">
                 <div>
                   <label className="block text-xs font-bold text-gray-500 uppercase">Price</label>
                   <div className="flex gap-2 mt-1">
                      <input 
                        type="number"
                        value={orderPrice}
                        onChange={(e) => setOrderPrice(e.target.value)}
                        className="flex-1 bg-gray-50 border border-gray-200 rounded px-3 py-2 outline-none focus:border-lego-blue font-bold text-gray-900"
                        placeholder="Price..."
                      />
                      <select 
                        value={orderCurrency}
                        onChange={(e) => setOrderCurrency(e.target.value as 'HUF' | 'EUR')}
                        className="bg-gray-50 border border-gray-200 rounded px-3 py-2 outline-none focus:border-lego-blue font-bold text-gray-900"
                      >
                        <option value="HUF">HUF</option>
                        <option value="EUR">EUR</option>
                      </select>
                   </div>
                 </div>

                 <div>
                   <label className="block text-xs font-bold text-gray-500 uppercase">Order Date</label>
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
                   ) : 'Confirm Order'}
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

