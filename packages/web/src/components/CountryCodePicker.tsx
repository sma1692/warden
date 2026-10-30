import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { findCountry, flagEmoji, searchCountries } from '../data/countries';

interface CountryCodePickerProps {
  value: string;
  onChange: (iso: string) => void;
  detectedIso?: string;
}

/** Dial-code dropdown, searchable by country name, ISO code, or dial code. */
export const CountryCodePicker: React.FC<CountryCodePickerProps> = ({ value, onChange, detectedIso }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = findCountry(value);
  const results = useMemo(() => searchCountries(query), [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    searchRef.current?.focus();
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    // Keep the current selection highlighted when the list resets.
    const idx = results.findIndex((c) => c.iso === value);
    setActive(query || idx < 0 ? 0 : idx);
  }, [results, query, value]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[active]) pick(results[active].iso);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selected ? `Country code: ${selected.name} +${selected.dial}` : 'Select country code'}
        className="flex h-full items-center gap-1.5 rounded-xl border border-[#2D3440] bg-[#101216] px-3 py-2.5 text-sm font-mono text-slate-100 hover:border-[#C6A664]/50 focus:outline-none focus:border-[#C6A664]/50"
      >
        <span className="text-base leading-none">{selected ? flagEmoji(selected.iso) : '🌐'}</span>
        <span>+{selected?.dial ?? '—'}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>

      {open && (
        <div
          className="absolute left-0 z-50 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-[#2D3440] bg-[#14171C] shadow-2xl"
          onKeyDown={onKeyDown}
        >
          <div className="flex items-center gap-2 border-b border-[#2D3440] px-3 py-2">
            <Search className="h-3.5 w-3.5 text-slate-500" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country or code (e.g. India, +91)"
              aria-label="Search countries"
              className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          <ul ref={listRef} role="listbox" className="max-h-60 overflow-y-auto py-1">
            {results.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">No matches</li>}
            {results.map((c, idx) => (
              <li
                key={c.iso}
                role="option"
                aria-selected={c.iso === value}
                onMouseEnter={() => setActive(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c.iso);
                }}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs ${
                  idx === active ? 'bg-[#C6A664]/15 text-slate-100' : 'text-slate-300'
                }`}
              >
                <span className="text-base leading-none">{flagEmoji(c.iso)}</span>
                <span className="flex-1 truncate">{c.name}</span>
                {c.iso === detectedIso && (
                  <span className="rounded bg-[#C6A664]/15 px-1 text-[9px] uppercase tracking-wide text-[#D4B475]">
                    Detected
                  </span>
                )}
                <span className="font-mono text-slate-400">+{c.dial}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
