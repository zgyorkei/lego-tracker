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
  TrendingDown
} from 'lucide-react';
import { useSets } from './hooks/useSets';
import { signInWithGoogle, signOut } from './lib/firebase';
import { SetCard } from './components/SetCard';
import { Status, Priority } from './types';

export default function App() {
  const { sets, loading, addSet, updateSet, deleteSet, addPriceHistory, getPriceHistory, user } = useSets();
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [isAdding, setIsAdding] = useState(false);
  const [newSetNumber, setNewSetNumber] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('medium');
  const [searchingLego, setSearchingLego] = useState(false);

  const filteredSets = useMemo(() => {
    if (filter === 'all') return sets;
    return sets.filter(s => s.status === filter);
  }, [sets, filter]);

  const stats = useMemo(() => {
    const ordered = sets.filter(s => s.status === 'ordered');
    
    const plannedTotal = sets.reduce((acc, s) => acc + (s.legoPriceHuf || 0), 0);
    const orderedTotal = ordered.reduce((acc, s) => acc + (s.orderedPriceHuf || 0), 0);
    const savings = ordered.reduce((acc, s) => acc + (s.legoPriceHuf - (s.orderedPriceHuf || 0)), 0);

    return { plannedTotal, orderedTotal, savings };
  }, [sets]);

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

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="lego-card p-8 max-w-md w-full text-center"
        >
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-lego-yellow rounded-xl border-4 border-black flex items-center justify-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
               <Package size={40} className="text-black" />
            </div>
          </div>
          <h1 className="text-4xl font-black text-lego-red uppercase tracking-tighter mb-2">Brick Tracker</h1>
          <p className="text-gray-500 font-bold mb-8 uppercase text-sm tracking-widest">Plan. Track. Save.</p>
          <button 
            onClick={signInWithGoogle}
            className="lego-button bg-lego-blue w-full flex items-center justify-center gap-3"
          >
            <LogIn size={20} /> Login with Google
          </button>
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
                <Package size={24} className="text-lego-red" />
             </div>
             <h1 className="text-2xl font-black uppercase tracking-tighter hidden sm:block">Lego Tracker</h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden lg:flex gap-6 items-center border-x-2 border-black/10 px-6 mx-2">
               <div className="text-right">
                  <p className="text-[10px] font-black opacity-60 uppercase">Planned</p>
                  <p className="text-sm font-black">{stats.plannedTotal.toLocaleString()} HUF</p>
               </div>
               <div className="text-right">
                  <p className="text-[10px] font-black opacity-60 uppercase">Ordered</p>
                  <p className="text-sm font-black">{stats.orderedTotal.toLocaleString()} HUF</p>
               </div>
               <div className="text-right text-green-700">
                  <p className="text-[10px] font-black opacity-60 uppercase">Saved</p>
                  <p className="text-sm font-black flex items-center justify-end gap-1">
                    <PiggyBank size={14} /> {stats.savings.toLocaleString()} HUF
                  </p>
               </div>
            </div>

            <button 
              onClick={signOut}
              className="p-2 hover:bg-black/5 rounded-full transition-colors flex items-center gap-2 font-black text-xs uppercase"
            >
              <span className="hidden sm:inline">{user.displayName?.split(' ')[0]}</span>
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
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
              Ordered
            </button>
          </div>
        </div>

        {/* Mobile Stats */}
        <div className="lg:hidden grid grid-cols-3 gap-2 mb-8">
            <div className="bg-white border-2 border-black p-2 rounded shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <p className="text-[10px] font-black uppercase opacity-50">Planned</p>
              <p className="text-xs font-black truncate">{stats.plannedTotal.toLocaleString()} HUF</p>
            </div>
            <div className="bg-white border-2 border-black p-2 rounded shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <p className="text-[10px] font-black uppercase opacity-50">Ordered</p>
              <p className="text-xs font-black truncate">{stats.orderedTotal.toLocaleString()} HUF</p>
            </div>
            <div className="bg-green-100 border-2 border-black p-2 rounded shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <p className="text-[10px] font-black uppercase text-green-700">Saved</p>
              <p className="text-xs font-black text-green-800 truncate">{stats.savings.toLocaleString()} HUF</p>
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
                  onDelete={deleteSet}
                  getPriceHistory={getPriceHistory}
                  onAddPriceHistory={addPriceHistory}
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

      <button 
        onClick={() => setIsAdding(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-lego-red text-white border-2 border-black rounded-full shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center hover:bg-red-600 hover:-translate-y-1 hover:shadow-[4px_6px_0px_0px_rgba(0,0,0,1)] active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] transition-all"
        title="Add New Set"
      >
        <Plus size={32} />
      </button>

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
                    disabled={searchingLego}
                    className="flex-1 py-3 font-black uppercase text-sm bg-lego-blue text-white border-2 border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px] transition-all disabled:opacity-50"
                  >
                    {searchingLego ? 'Fetching...' : 'Track Set'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
