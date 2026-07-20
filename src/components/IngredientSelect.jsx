import { useEffect, useMemo, useRef, useState } from 'react';
import { ingredientMatches, phoneticOf } from '../lib/ingredientSearch';
import { useCategories } from '../contexts/CategoriesContext';
import { Cat } from './Cat';

// Searchable ingredient picker. Displays Tamil names; matches typed text against the Tamil
// name, a phonetic romanization (thakkaali...), the translated English, and any per-item search.
export default function IngredientSelect({ ingredients, value, onPick, placeholder = '— select —', initialQuery = '' }) {
  const cats = useCategories();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const selected = ingredients.find((i) => i.id === value) || null;

  const catOrder = (key) => { const idx = cats.categories.findIndex((c) => c.key === key); return idx < 0 ? 99 : idx; };

  const results = useMemo(() => {
    const list = q.trim() ? ingredients.filter((i) => ingredientMatches(i, q)) : ingredients;
    return [...list].sort((a, b) => catOrder(a.category) - catOrder(b.category)).slice(0, 60);
  }, [ingredients, q, cats.categories]);

  useEffect(() => { setHi(0); }, [q]);

  useEffect(() => {
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);
  useEffect(() => { if (open && initialQuery && q === '') setQ(initialQuery); }, [open]); // eslint-disable-line

  function choose(i) { onPick(i ? i.id : ''); setOpen(false); setQ(''); }

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[hi]) choose(results[hi]); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  return (
    <div className="combo" ref={wrapRef}>
      <button type="button" className={`combo-btn ${selected ? '' : 'ph'}`} onClick={() => setOpen((o) => !o)}>
        <span className="combo-val">{selected ? selected.name : placeholder}</span>
        {selected && <Cat k={selected.category} />}
        <span className="combo-caret">▾</span>
      </button>

      {open && (
        <div className="combo-pop">
          <input
            ref={inputRef}
            className="combo-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type English (thakkali) or Tamil…"
          />
          <div className="combo-list">
            {results.length === 0 ? (
              <div className="combo-empty">No match</div>
            ) : results.map((i, idx) => (
              <div
                key={i.id}
                className={`combo-item ${idx === hi ? 'hi' : ''} ${i.id === value ? 'sel' : ''}`}
                onMouseEnter={() => setHi(idx)}
                onMouseDown={(e) => { e.preventDefault(); choose(i); }}
              >
                <span className="cat-dot" style={{ background: cats.color(i.category) }} />
                <span className="combo-name">
                  {i.name}
                  {phoneticOf(i) && <span className="combo-ph"> · {phoneticOf(i)}</span>}
                </span>
                <Cat k={i.category} />
                <span className="combo-unit">{i.unit}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
