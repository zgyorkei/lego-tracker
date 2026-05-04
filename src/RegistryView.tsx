import React, { useEffect, useState } from 'react';
import { db } from './lib/firebase';
import { doc, getDoc, collection, onSnapshot, setDoc } from 'firebase/firestore';
import { Registry, RegistryReservation } from './types';
import { Gift, Check } from 'lucide-react';

export default function RegistryView({ registryId }: { registryId: string }) {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [loading, setLoading] = useState(true);
  const [reservations, setReservations] = useState<Record<string, RegistryReservation>>({});
  const [reservingSet, setReservingSet] = useState<string | null>(null);
  const [visitorName, setVisitorName] = useState('');

  useEffect(() => {
    const fetchRegistry = async () => {
      try {
        const docRef = doc(db, 'registries', registryId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setRegistry({ id: docSnap.id, ...docSnap.data() } as Registry);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetchRegistry();

    // Listen to reservations real-time
    const resRef = collection(db, 'registries', registryId, 'reservations');
    const unsub = onSnapshot(resRef, (snap) => {
      const resData: Record<string, RegistryReservation> = {};
      snap.forEach(doc => {
        resData[doc.id] = doc.data() as RegistryReservation;
      });
      setReservations(resData);
    });

    return () => unsub();
  }, [registryId]);

  const handleReserve = async (setId: string) => {
    if (!visitorName.trim()) {
      alert("Please enter your name to reserve this set.");
      return;
    }
    try {
      const resRef = doc(db, 'registries', registryId, 'reservations', setId);
      await setDoc(resRef, {
        setId,
        reservedBy: visitorName.trim(),
        createdAt: new Date().toISOString()
      });
      setReservingSet(null);
    } catch (e) {
      console.error(e);
      alert("Failed to reserve. Maybe someone else just got it?");
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center font-black uppercase text-xl">Loading...</div>;

  if (!registry) return <div className="min-h-screen flex items-center justify-center font-black uppercase text-xl text-red-500">Registry not found</div>;

  return (
    <div className="min-h-screen bg-[#F4F4F4] text-black font-sans pb-20">
      <header className="bg-lego-red text-white p-6 shadow-md text-center">
        <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter flex items-center justify-center gap-3">
          <Gift size={32} />
          {registry.title}
        </h1>
        <p className="mt-2 font-bold opacity-90">Find the perfect gift and reserve it so there are no duplicates!</p>
      </header>
      
      <main className="max-w-5xl mx-auto p-4 sm:p-6 mt-6">
        <div className="bg-lego-yellow p-4 border-4 border-black font-bold text-center mb-8 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <p>Browse the sets below. If you plan to buy one, click "Reserve" and enter your name.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {registry.sets.map(set => {
            const isReserved = !!reservations[set.id];
            const reservation = reservations[set.id];
            
            return (
              <div key={set.id} className="bg-white border-4 border-black rounded-xl overflow-hidden flex flex-col shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] relative">
                {isReserved && (
                  <div className="absolute inset-0 bg-white/70 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center p-6 text-center">
                    <div className="bg-green-500 text-white p-4 rounded-full border-4 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] mb-4 transform -rotate-12">
                      <Check size={32} strokeWidth={4} />
                    </div>
                    <h3 className="font-black text-2xl uppercase text-black bg-white px-2 border-2 border-black">Reserved</h3>
                    <p className="font-bold text-lg mt-2 text-black bg-white px-2 border-2 border-black">by {reservation.reservedBy}</p>
                  </div>
                )}
                
                <div className="h-48 p-4 bg-gray-50 flex items-center justify-center relative border-b-4 border-black">
                   {set.productImage ? (
                      <img src={set.productImage} alt={set.name} className="max-w-full max-h-full object-contain drop-shadow-md mix-blend-multiply" />
                   ) : (
                      <div className="text-gray-300 font-bold uppercase">No Image</div>
                   )}
                   <div className="absolute top-2 left-2 bg-lego-blue text-white font-black px-2 py-1 text-sm border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                     #{set.setNumber}
                   </div>
                </div>
                
                <div className="p-4 flex flex-col flex-1">
                  <h3 className="font-black text-lg uppercase leading-tight mb-2 flex-1">{set.name}</h3>
                  
                  {set.minifigures && set.minifigures.length > 0 && (
                     <div className="mt-4 pt-4 border-t-2 border-dashed border-gray-200">
                        <p className="text-xs font-black uppercase text-gray-500 mb-2">Wanted Minifigs:</p>
                        <div className="flex flex-wrap gap-2">
                           {set.minifigures.filter(f => set.minifiguresStatus?.[f.id] === 'wanted').map(f => (
                              <img key={f.id} src={f.image || ''} alt={f.name} className="w-8 h-8 object-contain border border-gray-200 rounded block" title={f.name} />
                           ))}
                           {set.minifigures.filter(f => set.minifiguresStatus?.[f.id] === 'wanted').length === 0 && <span className="text-xs text-gray-400 font-bold">None missing</span>}
                        </div>
                     </div>
                  )}

                  <div className="mt-6">
                    {reservingSet === set.id ? (
                      <div className="flex flex-col gap-2">
                        <input 
                          type="text"
                          placeholder="Your Name"
                          value={visitorName}
                          onChange={e => setVisitorName(e.target.value)}
                          className="w-full border-2 border-black p-2 font-bold font-sans text-sm focus:outline-none focus:ring-2 focus:ring-lego-blue"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === 'Enter') handleReserve(set.id); }}
                        />
                        <div className="flex gap-2">
                          <button 
                            onClick={() => setReservingSet(null)}
                            className="flex-1 py-2 font-black uppercase text-xs border-2 border-black bg-gray-200 hover:bg-gray-300 transition-colors"
                          >
                            Cancel
                          </button>
                          <button 
                            onClick={() => handleReserve(set.id)}
                            className="flex-1 py-2 font-black uppercase text-xs border-2 border-black bg-lego-blue text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:-translate-x-[1px] hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
                          >
                            Confirm
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button 
                        onClick={() => setReservingSet(set.id)}
                        className="w-full py-3 font-black uppercase text-sm border-2 border-black bg-white text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:-translate-x-[2px] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all active:shadow-none active:translate-x-[4px] active:translate-y-[4px]"
                      >
                        Reserve This Gift
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
