import { useEffect, useMemo, useState } from 'react';
import { listIngredients, addIngredient, updateIngredient, deleteIngredient, seedIngredients, resyncBillsToMaster } from '../lib/db';
import { SEED_INGREDIENTS } from '../lib/ingredientSeed';
import { useCategories } from '../contexts/CategoriesContext';
import { ingredientMatches } from '../lib/ingredientSearch';
import { exportExcel } from '../lib/exporters';
import { Cat } from '../components/Cat';

const UNITS = ['kg', 'g', 'litre', 'ml', 'nos', 'bunch', 'packet', 'dozen', 'bag'];

export default function Ingredients() {
  const cats = useCategories();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [seeding, setSeeding] = useState(false);
  const [flash, setFlash] = useState('');
  const [resyncing, setResyncing] = useState(false);

  const defaultCat = () => cats.categories[0]?.key || 'grocery';

  function exportList() {
    const list = filtered.length ? filtered : items;
    const sorted = [...list].sort((a, b) => (cats.name(a.category) + a.name).localeCompare(cats.name(b.category) + b.name));
    exportExcel(`KAL-ingredients-${new Date().toISOString().slice(0, 10)}`, [{
      name: 'Ingredients',
      columns: [
        { header: 'Name (Tamil)', key: 'name' },
        { header: 'Search keyword (English)', key: 'search' },
        { header: 'Category', key: 'category' },
        { header: 'Unit', key: 'unit' },
        { header: 'Active', key: 'active' },
      ],
      rows: sorted.map((i) => ({
        name: i.name || '', search: i.search || '', category: cats.name(i.category),
        unit: i.unit || '', active: i.active === false ? 'No' : 'Yes',
      })),
    }]);
  }

  async function load() {
    setLoading(true);
    setItems(await listIngredients());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function runSeed() {
    if (!confirm(`Import the starter list of ${SEED_INGREDIENTS.length} ingredients? Items that already exist (by name) are skipped.`)) return;
    setSeeding(true);
    try {
      const { added, skipped } = await seedIngredients(SEED_INGREDIENTS);
      setFlash(`Imported ${added} ingredient${added === 1 ? '' : 's'}${skipped ? ` · ${skipped} already existed` : ''}.`);
      await load();
    } catch (e) {
      alert('Import failed: ' + e.message);
    } finally {
      setSeeding(false);
    }
  }

  const [importing, setImporting] = useState(false);
  const fileRef = { current: null };

  // Import ingredients from an Excel/CSV exported from another app (or hand-made).
  // Accepts columns: Name (Tamil) / Name, Search keyword / Search, Category, Unit, Active. Only Name is required.
  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { setFlash('That file had no rows.'); setImporting(false); return; }

      const keyOf = (obj, ...names) => {
        const keys = Object.keys(obj);
        for (const n of names) {
          const hit = keys.find((k) => k.toLowerCase().replace(/[^a-z]/g, '').includes(n));
          if (hit) return hit;
        }
        return null;
      };
      const sample = rows[0];
      const kName = keyOf(sample, 'name', 'tamil', 'item', 'ingredient');
      const kSearch = keyOf(sample, 'search', 'keyword', 'english');
      const kCat = keyOf(sample, 'category', 'cat');
      const kUnit = keyOf(sample, 'unit');
      const kActive = keyOf(sample, 'active');

      // category name/key → existing category key
      const catByName = {};
      cats.categories.forEach((c) => { catByName[String(c.name).toLowerCase()] = c.key; catByName[String(c.key).toLowerCase()] = c.key; });
      const resolveCat = (v) => {
        const s = String(v || '').trim().toLowerCase();
        return catByName[s] || (cats.categories[0]?.key || 'grocery');
      };

      const existing = await listIngredients();
      const byName = new Map(existing.map((i) => [String(i.name).trim().toLowerCase(), i]));

      let added = 0; let updated = 0; let skipped = 0;
      for (const r of rows) {
        const name = String(kName ? r[kName] : '').trim();
        if (!name) { skipped += 1; continue; }
        const rec = {
          name,
          search: kSearch ? String(r[kSearch] || '').trim() : '',
          category: resolveCat(kCat ? r[kCat] : ''),
          unit: kUnit ? (String(r[kUnit] || '').trim() || 'kg') : 'kg',
          active: kActive ? !/^(no|false|0|inactive)$/i.test(String(r[kActive]).trim()) : true,
        };
        const found = byName.get(name.toLowerCase());
        if (found) {
          await updateIngredient(found.id, { name: rec.name, category: rec.category, unit: rec.unit, search: rec.search, active: rec.active });
          updated += 1;
        } else {
          await addIngredient(rec);
          added += 1;
        }
      }
      setFlash(`Import done — ${added} added, ${updated} updated${skipped ? `, ${skipped} skipped (no name)` : ''}.`);
      await load();
    } catch (err) {
      alert('Import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  }

  async function runResync() {
    if (!confirm('Re-sync past bills to current categories?\n\nThis updates only the CLASSIFICATION on bills you already entered, so reports match your latest setup. Item names, quantities and amounts are left exactly as entered.')) return;
    setResyncing(true);
    try {
      const { billsChanged, itemsChanged } = await resyncBillsToMaster();
      setFlash(billsChanged === 0 ? 'Everything already in sync — no bills needed updating.' : `Re-synced ${itemsChanged} item${itemsChanged === 1 ? '' : 's'} across ${billsChanged} bill${billsChanged === 1 ? '' : 's'}.`);
    } catch (e) {
      alert('Re-sync failed: ' + e.message);
    } finally {
      setResyncing(false);
    }
  }

  const filtered = useMemo(() => items.filter((i) => {
    if (cat !== 'all' && i.category !== cat) return false;
    if (q && !ingredientMatches(i, q)) return false;
    return true;
  }), [items, q, cat]);

  async function save() {
    const d = modal.data;
    if (!d.name.trim()) return;
    if (modal.mode === 'add') await addIngredient(d);
    else await updateIngredient(d.id, { name: d.name, category: d.category, unit: d.unit, search: d.search || '' });
    setModal(null);
    load();
  }
  async function remove(i) {
    if (!confirm(`Delete ingredient "${i.name}"?`)) return;
    await deleteIngredient(i.id);
    load();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ingredients</h1>
          <div className="sub">{items.length} items in the master</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={exportList} disabled={loading || items.length === 0} title="Download the ingredient list as Excel">
            ⤒ Export to Excel
          </button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={importing} title="Upload an ingredient list (Excel/CSV) to add or update items">
            {importing ? 'Importing…' : '⤓ Import from Excel'}
          </button>
          <input ref={(el) => { fileRef.current = el; }} type="file" accept=".xlsx,.xls,.csv" hidden onChange={handleImportFile} />
          <button className="btn btn-ghost" onClick={runResync} disabled={resyncing} title="Update past bills to current names & categories">
            {resyncing ? 'Re-syncing…' : '↻ Re-sync bills'}
          </button>
          <button className="btn btn-ghost" onClick={runSeed} disabled={seeding}>
            {seeding ? 'Importing…' : `⤓ Import starter list (${SEED_INGREDIENTS.length})`}
          </button>
          <button className="btn btn-primary" onClick={() => setModal({ mode: 'add', data: { name: '', category: defaultCat(), unit: 'kg', search: '' } })}>＋ Add ingredient</button>
        </div>
      </div>

      {flash && <div className="flash">{flash}</div>}

      <div className="toolbar">
        <div className="field" style={{ flex: 2 }}>
          <label>Search</label>
          <input placeholder="Tamil or English (thakkali, tomato)…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="field">
          <label>Category</label>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">All</option>
            {cats.categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Category</th><th>Unit</th><th style={{ width: 1 }} /></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="empty">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} className="empty">No ingredients match.</td></tr>
            ) : filtered.map((i) => (
              <tr key={i.id}>
                <td style={{ fontWeight: 600 }}>{i.name}</td>
                <td><Cat k={i.category} /></td>
                <td className="muted">{i.unit}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setModal({ mode: 'edit', data: { ...i } })}>Edit</button>{' '}
                  <button className="btn btn-danger btn-sm" onClick={() => remove(i)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <div className="modal-head">{modal.mode === 'add' ? 'Add ingredient' : 'Edit ingredient'}</div>
            <div className="modal-body">
              <div className="field">
                <label>Name (Tamil) *</label>
                <input autoFocus value={modal.data.name} onChange={(e) => setModal({ ...modal, data: { ...modal.data, name: e.target.value } })} placeholder="உதா: தக்காளி" />
              </div>
              <div className="field">
                <label>English / search keyword <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
                <input value={modal.data.search || ''} onChange={(e) => setModal({ ...modal, data: { ...modal.data, search: e.target.value } })} placeholder="e.g. tomato — lets you find it by typing English" />
              </div>
              <div className="row">
                <div className="field">
                  <label>Category</label>
                  <select value={modal.data.category} onChange={(e) => setModal({ ...modal, data: { ...modal.data, category: e.target.value } })}>
                    {cats.categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Default unit</label>
                  <select value={modal.data.unit} onChange={(e) => setModal({ ...modal, data: { ...modal.data, unit: e.target.value } })}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
