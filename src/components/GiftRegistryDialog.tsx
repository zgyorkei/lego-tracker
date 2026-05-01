import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Check, Image as ImageIcon, Download, Share2 } from 'lucide-react';
import { LegoSet } from '../types';
import { toPng } from 'html-to-image';

interface GiftRegistryDialogProps {
  onClose: () => void;
  plannedSets: LegoSet[];
}

export function GiftRegistryDialog({ onClose, plannedSets }: GiftRegistryDialogProps) {
  const [selectedSetIds, setSelectedSetIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [batchImages, setBatchImages] = useState<Record<string, string>>({});
  
  const registryRef = useRef<HTMLDivElement>(null);

  const toggleSet = (id: string) => {
    const newKeys = new Set(selectedSetIds);
    if (newKeys.has(id)) newKeys.delete(id);
    else newKeys.add(id);
    setSelectedSetIds(newKeys);
  };

  const selectedSets = plannedSets.filter(s => selectedSetIds.has(s.id));

  const generateImage = async () => {
    if (!registryRef.current || selectedSetIds.size === 0) return;
    setGenerating(true);
    try {
      // Find sets that have missing or failed proxy images, and query gemini!
      // But actually, we already show the proxy image URLs in the DOM. Wait, the proxy fails 403.
      // So let's batch fetch new image URLs for all selected sets!
      const setNumbersToFetch = selectedSets.map(s => s.setNumber);
      
      const reqApiKey = localStorage.getItem('brickTrackerApiKey');
      const headers = reqApiKey ? { 'x-gemini-api-key': reqApiKey, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
      
      const searchRes = await fetch('/api/batch-images', {
         method: 'POST',
         headers,
         body: JSON.stringify({ setNumbers: setNumbersToFetch })
      });
      
      let newImageMap: Record<string, string> = {};
      if (searchRes.ok) {
         newImageMap = await searchRes.json();
      } else {
         console.warn('Batch search failed, falling back to existing images if any');
      }

      // We need to wait for DOM to update with new images or inject them manually before canvas 
      // Instead, we will store them in state and wait a tick
      if (Object.keys(newImageMap).length > 0) {
          setBatchImages(newImageMap);
          // Wait for images to load
          await new Promise(r => setTimeout(r, 2000));
      }

      const dataUrl = await toPng(registryRef.current, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      });
      setGeneratedImage(dataUrl);
    } catch (e) {
      console.error(e);
      alert('Failed to generate image. Some external images might be blocked by CORS.');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!generatedImage) return;
    const link = document.createElement('a');
    link.download = 'gift-registry.png';
    link.href = generatedImage;
    link.click();
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

        {!generatedImage ? (
          <div>
            <h2 className="text-2xl font-black text-gray-900 uppercase mb-4 flex items-center gap-2">
              <ImageIcon /> Gift Registry
            </h2>
            <p className="text-gray-500 font-bold mb-6">Select planned sets and generate an image to share.</p>

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
                onClick={generateImage}
                disabled={selectedSetIds.size === 0 || generating}
                className="px-6 py-3 font-black text-sm uppercase bg-lego-blue text-white rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:shadow-[4px_6px_0px_0px_rgba(0,0,0,1)] flex items-center gap-2 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? 'Generating...' : 'Generate Sharing Image'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <h2 className="text-2xl font-black text-gray-900 uppercase mb-4 flex items-center gap-2">
              <ImageIcon /> Registry Generated
            </h2>
            <div className="flex-1 bg-gray-100 rounded-lg border-2 border-gray-200 overflow-hidden flex items-center justify-center p-4">
              <img src={generatedImage} alt="Gift Registry" className="max-w-full max-h-[60vh] object-contain shadow-lg" />
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button 
                onClick={() => setGeneratedImage(null)}
                className="px-6 py-3 font-black text-sm uppercase text-gray-500 hover:bg-gray-100 rounded-lg transition-colors border-2 border-transparent"
              >
                Back
              </button>
              <button 
                onClick={handleDownload}
                className="px-6 py-3 font-black text-sm uppercase bg-lego-blue text-white rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:shadow-[4px_6px_0px_0px_rgba(0,0,0,1)] flex items-center gap-2 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] transition-all"
              >
                <Download size={18} /> Download
              </button>
            </div>
          </div>
        )}
        
        {/* Hidden Container for off-screen rendering */}
        <div className="pointer-events-none absolute" style={{ top: -9999, left: -9999 }}>
          <div ref={registryRef} className="bg-white p-8 w-[800px] border-8 border-black font-sans text-gray-900" style={{ fontFamily: '"Inter", sans-serif' }}>
            <h1 className="text-4xl font-black uppercase text-center mb-2 tracking-tighter text-lego-red">My Gift Registry</h1>
            <p className="text-center font-bold text-gray-500 mb-8 uppercase tracking-widest text-sm">Sets I'm missing from my collection</p>
            
            <div className="grid grid-cols-2 gap-6">
              {selectedSets.map(set => {
                const finalImgUrl = batchImages[set.setNumber] || set.productImage;
                return (
                <div key={set.id} className="border-4 border-black p-4 bg-gray-50 flex flex-col items-center">
                  <div className="h-48 w-full bg-white mb-4 border-2 border-dashed border-gray-300 flex items-center justify-center relative">
                    {finalImgUrl && <img src={`/api/proxy-image?url=${encodeURIComponent(finalImgUrl)}`} alt={set.name} className="max-w-full max-h-full object-contain p-2 mix-blend-multiply" crossOrigin="anonymous" />}
                  </div>
                  <div className="w-full text-center mb-4">
                    <span className="bg-lego-blue text-white font-black px-3 py-1 text-sm inline-block shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] mb-2">
                       #{set.setNumber}
                    </span>
                    <h3 className="font-black text-lg uppercase leading-tight line-clamp-2">{set.name}</h3>
                  </div>

                  {set.minifigures && set.minifigures.length > 0 && (
                     <div className="w-full mt-auto pt-4 border-t-2 border-black">
                        <p className="font-black text-xs uppercase text-gray-500 mb-2">Wanted Minifigures:</p>
                        <div className="flex flex-wrap gap-2 justify-center">
                           {set.minifigures
                              .filter(f => set.minifiguresStatus?.[f.id] === 'wanted')
                              .map(f => (
                                <div key={f.id} className="w-12 h-12 bg-white border-2 border-black relative rounded p-1 group flex items-center justify-center shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                  {f.image && <img src={`/api/proxy-image?url=${encodeURIComponent(f.image)}`} alt={f.name} className="w-full h-full object-contain" crossOrigin="anonymous" />}
                                </div>
                              ))}
                           {set.minifigures.filter(f => set.minifiguresStatus?.[f.id] === 'wanted').length === 0 && (
                              <p className="text-xs text-green-600 font-bold">None missing!</p>
                           )}
                        </div>
                     </div>
                  )}
                </div>
              )})}
            </div>
            
            <div className="mt-8 text-center text-xs font-bold text-gray-400 flex items-center justify-center gap-2 uppercase tracking-widest">
               <ImageIcon size={12} /> Generated by Brick Tracker
            </div>
          </div>
        </div>

      </motion.div>
    </div>
  );
}
