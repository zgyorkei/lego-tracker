import { useState } from 'react';
import { Check, GraduationCap, Loader2, X } from 'lucide-react';
import type { PriceSource } from '../types';
import type { ScrapeRecipe } from '../../lib/scrapeRecipe';
import type { TeachResult } from '../../lib/teachSource';
import { scrapingStatus } from '../lib/priceSources';

interface TeachSourcePanelProps {
  source: PriceSource;
  /** Planned set numbers to try the shop with (up to three). */
  sampleSetNumbers: string[];
  onSave: (recipe: ScrapeRecipe) => void;
}

const STATUS_LABEL = {
  taught: { text: 'Taught', cls: 'bg-green-100 text-green-700' },
  'built-in': { text: 'Built-in rules', cls: 'bg-blue-100 text-blue-700' },
  'not-taught': { text: 'Not taught yet', cls: 'bg-amber-100 text-amber-700' },
} as const;

/**
 * Desktop only. Teaches the app how to read a shop: the local browser opens
 * the source's search page for a few planned sets, Gemini writes a recipe, and
 * the recipe is run on those pages. The prices it found are shown before the
 * user decides to save it, so a bad recipe never silently feeds the chart.
 */
export function TeachSourcePanel({ source, sampleSetNumbers, onSave }: TeachSourcePanelProps) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TeachResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const status = STATUS_LABEL[scrapingStatus(source)];
  const urlOk = source.urlTemplate.includes('{setNumber}') && /^https?:\/\//.test(source.urlTemplate);
  const found = result?.samples.filter((s) => s.result?.price != null).length ?? 0;

  const teach = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/teach-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: { name: source.name, urlTemplate: source.urlTemplate, currency: source.currency },
          setNumbers: sampleSetNumbers,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `Teaching failed (HTTP ${res.status}).`);
        return;
      }
      setResult(body as TeachResult);
    } catch {
      setError('Could not reach the desktop app. Try again.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-gray-200">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${status.cls}`}>{status.text}</span>
        <button
          type="button"
          onClick={() => void teach()}
          disabled={running || !urlOk || sampleSetNumbers.length === 0}
          title={urlOk ? undefined : 'The URL template needs http(s) and {setNumber}'}
          className="px-3 py-1.5 bg-white hover:bg-gray-100 border-2 border-black rounded font-black text-[10px] uppercase flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <GraduationCap size={12} />}
          {scrapingStatus(source) === 'taught' ? 'Re-teach' : 'Teach'}
        </button>
      </div>

      {running && (
        <p className="mt-2 text-xs font-bold text-gray-500" role="status">
          Reading {source.name} for sets {sampleSetNumbers.join(', ')} and writing instructions. This takes a minute or two.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs font-bold text-red-600">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-2 text-xs font-bold">
          <ul className="space-y-1 mb-2">
            {result.samples.map((s) => (
              <li key={s.setNumber} className="flex justify-between gap-2">
                <span>{s.setNumber}</span>
                <span className={s.result?.price != null ? 'text-green-700' : 'text-gray-400'}>
                  {s.result?.price != null
                    ? `${s.result.price.toLocaleString('hu-HU')} ${source.currency}`
                    : s.result?.blocked
                      ? 'blocked'
                      : 'no price'}
                </span>
              </li>
            ))}
          </ul>
          {result.error && <p className="text-red-600 mb-2">{result.error}</p>}
          {result.recipe && found > 0 && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onSave(result.recipe!);
                  setResult(null);
                }}
                className="px-3 py-1.5 bg-lego-blue text-white border-2 border-black rounded font-black text-[10px] uppercase flex items-center gap-1"
              >
                <Check size={12} /> Save ({found}/{result.samples.length} found)
              </button>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="px-3 py-1.5 bg-gray-100 border-2 border-black rounded font-black text-[10px] uppercase flex items-center gap-1"
              >
                <X size={12} /> Discard
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
