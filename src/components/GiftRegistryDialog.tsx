import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Check, Share2, ClipboardList, Link as LinkIcon, Plus, Edit2, Trash2, Gift } from 'lucide-react';
import { LegoSet, Registry, PriceSource } from '../types';
import { collection, doc, setDoc, query, where, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

interface GiftRegistryDialogProps {
  onClose: () => void;
  plannedSets: LegoSet[];
  priceSources: PriceSource[];
  exchangeRates: Record<string, number> | null;
  displayCurrency: string;
}

export function GiftRegistryDialog({ onClose, plannedSets, priceSources, exchangeRates, displayCurrency }: GiftRegistryDialogProps) {
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list');
  const [registries, setRegistries] = useState<Registry[]>([]);
  const [editingRegistryId, setEditingRegistryId] = useState<string | null>(null);
  
  const [registryTitle, setRegistryTitle] = useState("My Lego Gift Registry");
  const [selectedSetIds, setSelectedSetIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(collection(db, 'registries'), where('userId', '==', auth.currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      const parts: Registry[] = [];
      snap.forEach(d => {
        parts.push({ id: d.id, ...d.data() } as Registry);
      });
      setRegistries(parts.sort((a,b) => b.createdAt.localeCompare(a.createdAt)));
    });
    return () => unsub();
  }, []);

  const startCreate = () => {
    setRegistryTitle("My Lego Gift Registry");
    setSelectedSetIds(new Set());
    setCreatedLink(null);
    setView('create');
  };

  const [deletingRegistryId, setDeletingRegistryId] = useState<string | null>(null);

  const startEdit = (registry: Registry) => {
     setRegistryTitle(registry.title || "My Lego Gift Registry");
     setSelectedSetIds(new Set(registry.sets.map(s => s.id)));
     setEditingRegistryId(registry.id);
     setCreatedLink(null);
     setView('edit');
  };

  const confirmDelete = async (id: string) => {
     try {
        await deleteDoc(doc(db, 'registries', id));
     } catch(e) {
        console.error(e);
     } finally {
        setDeletingRegistryId(null);
     }
  };

  const toggleSet = (id: string) => {
    const newKeys = new Set(selectedSetIds);
    if (newKeys.has(id)) newKeys.delete(id);
    else newKeys.add(id);
    setSelectedSetIds(newKeys);
  };

  // Build a union of planned sets and existing registry sets so they can edit even if status changed
  const editingRegistry = registries.find(r => r.id === editingRegistryId);
  const allChoicesMap = new Map<string, LegoSet>();
  if (editingRegistry) {
    editingRegistry.sets.forEach(s => allChoicesMap.set(s.id, s));
  }
  plannedSets.forEach(s => allChoicesMap.set(s.id, s));
  
  const availableSets = Array.from(allChoicesMap.values());
  const selectedSets = availableSets.filter(s => selectedSetIds.has(s.id));

  const saveRegistry = async () => {
    if (selectedSetIds.size === 0) return;
    if (!auth.currentUser) {
       alert("You must be signed in to create a registry.");
       return;
    }
    setGenerating(true);
    try {
      const setNumbersToFetch = selectedSets.map(s => s.setNumber);
      const headers = { 'Content-Type': 'application/json' };
      const searchRes = await fetch('/api/batch-images', {
         method: 'POST',
         headers,
         body: JSON.stringify({ setNumbers: setNumbersToFetch })
      });
      
      let newImageMap: Record<string, string> = {};
      if (searchRes.ok) {
         newImageMap = await searchRes.json();
      }

      let token = editingRegistryId;
      if (!token) {
        // Generate a crypto random token for new
        const array = new Uint8Array(12);
        window.crypto.getRandomValues(array);
        token = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
      }
      
      const formatPrice = (priceVal: number, curr: string) => {
        return new Intl.NumberFormat('hu-HU', {
          style: 'currency',
          currency: curr,
          maximumFractionDigits: curr === 'HUF' ? 0 : 2
        }).format(priceVal);
      };

      const setsData = selectedSets.map(s => {
         let lowestPrices: { sourceName: string, url: string, priceText: string }[] = [];
         
         if (s.marketPrices) {
            const availablePrices = Object.entries(s.marketPrices).map(([sourceId, priceData]) => {
               if (sourceId === 'error' || sourceId === 'exchangeRate' || !priceData) return null;
               const source = priceSources.find(ps => ps.id === sourceId);
               if (!source) return null;
               
               const costValueHuf = priceData.priceHuf || (exchangeRates && source.currency === 'EUR' && priceData.price ? priceData.price * exchangeRates.EUR : priceData.price) || 0;
               
               if (costValueHuf <= 0) return null;
               
               return {
                  sourceName: source.name,
                  url: priceData.url || source.urlTemplate.replace('{setNumber}', s.setNumber).replace('{name}', encodeURIComponent(s.name)),
                  priceText: formatPrice(costValueHuf, 'HUF'),
                  costValueHuf
               }
            }).filter(Boolean) as { sourceName: string, url: string, priceText: string, costValueHuf: number }[];
            
            availablePrices.sort((a, b) => a.costValueHuf - b.costValueHuf);
            lowestPrices = availablePrices.slice(0, 2).map(p => ({
               sourceName: p.sourceName,
               url: p.url,
               priceText: p.priceText
            }));
         }
         
         return {
           ...s,
           productImage: newImageMap[s.setNumber] || s.productImage,
           lowestPrices
         };
      });

      await setDoc(doc(db, 'registries', token!), {
         userId: auth.currentUser.uid,
         title: registryTitle,
         sets: setsData,
         createdAt: editingRegistry ? editingRegistry.createdAt : new Date().toISOString()
      }, { merge: true });
      
      setCreatedLink(`https://lego.gykovacszoltan.hu/registry/${token}`);
    } catch (e) {
      console.error(e);
      alert('Failed to save registry.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = (link: string) => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-4xl relative min-h-[300px]"
      >
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-900 z-10"
        >
          <X size={24} />
        </button>

        {view === 'list' && (
          <div>
            <h2 className="text-2xl font-black text-gray-900 uppercase mb-4 flex items-center gap-2">
              <ClipboardList /> My Registries
            </h2>
            <p className="text-gray-500 font-bold mb-6">Manage your gift registries and share them with others.</p>
            
            <div className="space-y-4 mb-6">
               {registries.length === 0 ? (
                 <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <p className="text-gray-500 font-bold uppercase">No registries found</p>
                 </div>
               ) : (
                 registries.map(reg => (
                   <div key={reg.id} className="border-4 border-black p-4 rounded-lg flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all">
                     <div>
                       <h3 className="font-black text-lg uppercase">{reg.title || 'Untitled Registry'}</h3>
                       <p className="text-gray-500 font-bold text-sm">{reg.sets.length} items</p>
                     </div>
                     <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                        <button 
                          onClick={() => handleCopy(`https://lego.gykovacszoltan.hu/registry/${reg.id}`)}
                          className="px-3 py-2 bg-gray-100 hover:bg-gray-200 border-2 border-black rounded font-black text-xs uppercase flex items-center gap-2 transition-colors"
                        >
                          <LinkIcon size={14} /> Copy Link
                        </button>
                        <a 
                          href={`https://lego.gykovacszoltan.hu/registry/${reg.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-2 bg-white hover:bg-gray-50 border-2 border-black rounded font-black text-xs uppercase flex items-center gap-2 transition-colors"
                        >
                          <Share2 size={14} /> View
                        </a>
                        <button 
                          onClick={() => startEdit(reg)}
                          className="px-3 py-2 bg-lego-blue hover:brightness-110 text-white border-2 border-black rounded font-black text-xs uppercase flex items-center gap-2 transition-colors"
                        >
                          <Edit2 size={14} /> Edit
                        </button>
                        {deletingRegistryId === reg.id ? (
                           <div className="flex items-center gap-2">
                             <button
                               onClick={() => setDeletingRegistryId(null)}
                               className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-black border-2 border-black rounded font-black text-xs uppercase transition-colors"
                             >
                               Cancel
                             </button>
                             <button
                               onClick={() => confirmDelete(reg.id)}
                               className="px-3 py-2 bg-red-600 hover:brightness-110 text-white border-2 border-black rounded font-black text-xs uppercase transition-colors"
                             >
                               Confirm Delete
                             </button>
                           </div>
                        ) : (
                          <button 
                            onClick={() => setDeletingRegistryId(reg.id)}
                            className="px-3 py-2 bg-lego-red hover:brightness-110 text-white border-2 border-black rounded font-black text-xs uppercase flex items-center gap-2 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                     </div>
                   </div>
                 ))
               )}
            </div>
            
            <div className="flex justify-between items-center mt-6">
              <button 
                onClick={onClose}
                className="px-6 py-3 font-black text-sm uppercase text-gray-500 hover:bg-gray-100 rounded-lg transition-colors border-2 border-transparent"
              >
                Close
              </button>
              <button 
                onClick={startCreate}
                className="px-6 py-3 font-black text-sm uppercase bg-lego-blue text-white rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:shadow-[4px_6px_0px_0px_rgba(0,0,0,1)] flex items-center gap-2 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] transition-all"
              >
                <Plus size={18} /> Create New Registry
              </button>
            </div>
          </div>
        )}

        {(view === 'create' || view === 'edit') && !createdLink && (
          <div>
            <h2 className="text-2xl font-black text-gray-900 uppercase mb-4 flex items-center gap-2">
              <Gift /> {view === 'create' ? 'Create' : 'Edit'} Registry
            </h2>
            <div className="mb-4">
               <label className="block text-xs font-black uppercase text-gray-500 mb-1">Registry Title</label>
               <input 
                 type="text" 
                 value={registryTitle}
                 onChange={(e) => setRegistryTitle(e.target.value)}
                 className="w-full border-2 border-black p-2 font-bold focus:outline-none focus:border-lego-blue"
                 placeholder="My Awesome Lego Wishlist"
               />
            </div>
            <p className="text-gray-500 font-bold mb-4 text-sm">Select sets to include in this registry. Visitors can reserve sets to prevent duplicate gifts.</p>

            {availableSets.length === 0 ? (
              <p className="text-gray-400 font-bold text-center py-8">No planned sets available.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-6 max-h-[40vh] overflow-y-auto border-t border-b py-4">
                {availableSets.map(set => {
                   const isSelected = selectedSetIds.has(set.id);
                   return (
                     <div 
                       key={set.id} 
                       onClick={() => toggleSet(set.id)}
                       className={`border-4 rounded-lg p-3 cursor-pointer transition-all flex gap-3 items-center ${isSelected ? 'border-lego-blue bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                     >
                       <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 ${isSelected ? 'bg-lego-blue border-lego-blue text-white' : 'border-gray-300'}`}>
                         {isSelected && <Check size={16} />}
                       </div>
                       <div className="w-16 h-16 bg-white rounded shadow-sm border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden">
                         {set.productImage ? <img src={set.productImage} alt={set.name} className="max-w-full max-h-full object-contain" referrerPolicy="no-referrer" /> : <div className="text-gray-300 text-xs">No img</div>}
                       </div>
                       <div className="flex-1 min-w-0">
                         <p className="font-bold text-xs truncate">{set.setNumber}</p>
                         <p className="font-black text-sm uppercase truncate" title={set.name}>{set.name}</p>
                       </div>
                     </div>
                   );
                })}
              </div>
            )}

            <div className="flex justify-end gap-3 mt-4">
              <button 
                onClick={() => setView('list')}
                className="px-6 py-3 font-black text-sm uppercase text-gray-500 hover:bg-gray-100 rounded-lg transition-colors border-2 border-transparent"
              >
                Back
              </button>
              <button 
                onClick={saveRegistry}
                disabled={selectedSetIds.size === 0 || generating}
                className="px-6 py-3 font-black text-sm uppercase bg-lego-blue text-white rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:shadow-[4px_6px_0px_0px_rgba(0,0,0,1)] flex items-center gap-2 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? 'Saving...' : 'Save Registry'}
              </button>
            </div>
          </div>
        )}

        {createdLink && (
          <div className="flex flex-col h-full items-center justify-center py-8">
            <h2 className="text-2xl font-black text-gray-900 uppercase mb-4 flex items-center gap-2">
              <Share2 /> Registry {view === 'create' ? 'Created' : 'Updated'}!
            </h2>
            <p className="text-gray-500 font-bold mb-6 text-center max-w-md">
              Your gift registry is ready. Share this link with friends and family. They do not need an account to view and reserve sets.
            </p>
            
            <div className="flex w-full max-w-lg items-center bg-gray-100 rounded-lg border-2 border-gray-300 p-2 mb-8">
              <input 
                readOnly 
                value={createdLink} 
                className="flex-1 bg-transparent border-none focus:ring-0 text-sm font-mono text-gray-700 outline-none px-2 cursor-text"
              />
              <button 
                onClick={() => handleCopy(createdLink)}
                className="ml-2 px-4 py-2 bg-black text-white font-black text-xs uppercase rounded hover:bg-gray-800 transition-colors flex items-center gap-2"
              >
                {copied ? <Check size={14} /> : <LinkIcon size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div className="flex justify-center gap-3">
              <button 
                onClick={() => { setCreatedLink(null); setView('list'); }}
                className="px-6 py-3 font-black text-sm uppercase text-gray-500 hover:bg-gray-100 rounded-lg transition-colors border-2 border-transparent"
              >
                Back to Registries
              </button>
              <a 
                href={createdLink} 
                target="_blank" 
                rel="noopener noreferrer"
                className="px-6 py-3 font-black text-sm uppercase bg-lego-blue text-white rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:shadow-[4px_6px_0px_0px_rgba(0,0,0,1)] flex items-center gap-2 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] transition-all"
              >
                Open Registry Preview
              </a>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
