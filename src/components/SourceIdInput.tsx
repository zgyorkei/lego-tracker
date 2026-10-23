import { useEffect, useState } from 'react';

interface SourceIdInputProps {
  inputId: string;
  id: string;
  disabled: boolean;
  /** Ids of the other sources; a duplicate would be rejected. */
  taken: string[];
  onCommit: (id: string) => void;
}

const clean = (v: string) => v.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

/**
 * The price-source id field. It edits a local draft and commits on blur or
 * Enter, not per keystroke: each source card is keyed by its id, so changing
 * the id while typing remounted the card and threw focus out of the field
 * after every character. An empty or duplicate id is reverted, since the id
 * keys the card, the stored quote and the price-history columns.
 */
export function SourceIdInput({ inputId, id, disabled, taken, onCommit }: SourceIdInputProps) {
  const [draft, setDraft] = useState(id);
  useEffect(() => setDraft(id), [id]);

  const commit = () => {
    const value = clean(draft);
    if (!value || taken.includes(value)) {
      setDraft(id);
      return;
    }
    if (value !== id) onCommit(value);
  };

  return (
    <input
      id={inputId}
      type="text"
      disabled={disabled}
      value={draft}
      onChange={(e) => setDraft(clean(e.target.value))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(id);
      }}
      className="w-full bg-white border border-black p-2 rounded text-sm font-bold disabled:bg-gray-100 disabled:text-gray-500"
    />
  );
}
