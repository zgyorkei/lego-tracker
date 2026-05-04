import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Check, Share2, ClipboardList, Link as LinkIcon } from 'lucide-react';
import { LegoSet } from '../types';
import { collection, doc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

interface GiftRegistryDialogProps {
  onClose: () => void;
  plannedSets: LegoSet[];
}

export function GiftRegistryDialog({ onClose, plannedSets }: GiftRegistryDialogProps) {
  const [selectedSetIds, setSelectedSetIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  const toggleSet = (id: string) => {
    const newKeys = new Set(selectedSetIds);
    if (newKeys.has(id)) newKeys.delete(id);
    else newKeys.add(id);
    setSelectedSetIds(newKeys);
  };

  const selectedSets = plannedSets.filter(s => selectedSetIds.has(s.id));

  const generateLink = async () => {
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

      // Generate a crypto random token
      const array = new Uint8Array(12);
      window.crypto.getRandomValues(array);
      const token = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
      
      const setsData = selectedSets.map(s => ({
        ...s,
        productImage: newImageMap[s.setNumber] || s.productImage
      }));

      await setDoc(doc(db, 'registries', token), {
         userId: auth.currentUser.uid,
         title: "My Lego Gift Registry",
         sets: setsData,
         createdAt: new Date().toISOString()
      });
      
      setCreatedLink(`${window.location.origin}/registry/${token}`);
    } catch (e) {
      console.error(e);
      alert('Failed to generate link.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!createdLink) return;
    navigator.clipboard.writeText(createdLink);
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

        {!createdLink ? (
          <div>
            <h2 className="text-2xl font-black text-gray-900 uppercase mb-4 flex items-center gap-2">
              <ClipboardList /> Gift Registry
            </h2>
            <p className="text-gray-500 font-bold mb-6">Select your wanted sets to create a shareable registry link. Visitors can reserve sets to prevent duplicate gifts.</p>

            {plannedSets.length === 0 ? (
              <p className="text-gray-400 font-bold text-center py-8">No planned sets available.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-6 max-h-[50vh] overflow-y-auto border-t border-b py-4">
                {plannedSets.map(set => {
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
                         {set.productImage ? <img src={set.productImage} alt={set.name} className="max-w-full max-h-full object-contain" /> : <div className="text-gray-300 text-xs">No img</div>}
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
                onClick={onClose}
                className="px-6 py-3 font-black text-sm uppercase text-gray-500 hover:bg-gray-100 rounded-lg transition-colors border-2 border-transparent"
              >
                Cancel
              </button>
              <button 
                onClick={generateLink}
                disabled={selectedSetIds.size === 0 || generating}
                className="px-6 py-3 font-black text-sm uppercase bg-lego-blue text-white rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:shadow-[4px_6px_0px_0px_rgba(0,0,0,1)] flex items-center gap-2 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? 'Generating...' : 'Create Shareable Link'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full items-center justify-center py-8">
            <h2 className="text-2xl font-black text-gray-900 uppercase mb-4 flex items-center gap-2">
              <Share2 /> Registry Created!
            </h2>
            <p className="text-gray-500 font-bold mb-6 text-center max-w-md">
              Your gift registry is ready. Share this link with friends and family. They do not need an account to view and reserve sets.
            </p>
            
            <div className="flex w-full max-w-lg items-center bg-gray-100 rounded-lg border-2 border-gray-300 p-2 mb-8">
              <input 
                readOnly 
                value={createdLink} 
                className="flex-1 bg-transparent border-none focus:ring-0 text-sm font-mono text-gray-700 outline-none px-2"
              />
              <button 
                onClick={handleCopy}
                className="ml-2 px-4 py-2 bg-black text-white font-black text-xs uppercase rounded hover:bg-gray-800 transition-colors flex items-center gap-2"
              >
                {copied ? <Check size={14} /> : <LinkIcon size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div className="flex justify-center gap-3">
              <button 
                onClick={onClose}
                className="px-6 py-3 font-black text-sm uppercase text-gray-500 hover:bg-gray-100 rounded-lg transition-colors border-2 border-transparent"
              >
                Close
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
