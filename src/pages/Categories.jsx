import { useState } from 'react';
import { addCategory, updateCategory, deleteCategory, slugify } from '../lib/db';
import { useCategories } from '../contexts/CategoriesContext';

const SWATCHES = ['#4f7a34', '#b07a1a', '#b5491f', '#3f7d8c', '#7a5cad', '#b03a6e', '#5a8f3c', '#c9851f', '#8a6d3b', '#2f6f5e'];
const BLANK = { name: '', color: SWATCHES[0], creditDefault: false };

export default function Categories() {
  const cats = useCategories();
  const [modal, setModal] = useState(null);

  async function save() {
    const d = modal.data;
    if (!d.name.trim()) return;
    if (modal.mode === 'add') {
      await addCategory({ key: slugify(d.name), name: d.name.trim(), color: d.color, creditDefault: !!d.creditDefault, order: (cats.categories.length + 1) });
    } else {
      // key stays immutable so existing ingredients keep matching
      await updateCategory(d.id, { name: d.name.trim(), color: d.color, creditDefault: !!d.creditDefault });
    }
    setModal(null);
    cats.reload();
  }

  async function remove(c) {
    if (!confirm(`Delete category "${c.name}"? Ingredients already tagged with it keep the tag, but it won't appear in dropdowns.`)) return;
    await deleteCategory(c.id);
    cats.reload();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Categories</h1>
          <div className="sub">Group purchases — e.g. Vegetable, Leaf, Grocery, Dairy, Masala, Oil</div>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({ mode: 'add', data: { ...BLANK } })}>＋ Add category</button>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Category</th><th>Colour</th><th>Default payment</th><th style={{ width: 1 }} /></tr>
          </thead>
          <tbody>
            {!cats.ready ? (
              <tr><td colSpan={4} className="empty">Loading…</td></tr>
            ) : cats.categories.map((c) => (
              <tr key={c.id}>
                <td><span className="cat-badge" style={{ background: c.color + '22', color: c.color }}><span className="cat-dot" style={{ background: c.color }} />{c.name}</span></td>
                <td><span className="cat-dot" style={{ background: c.color, width: 16, height: 16 }} /> <span className="muted tnum">{c.color}</span></td>
                <td className="muted">{c.creditDefault ? 'Unpaid (credit)' : 'Paid on the spot'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setModal({ mode: 'edit', data: { ...c } })}>Edit</button>{' '}
                  <button className="btn btn-danger btn-sm" onClick={() => remove(c)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>
        "Default payment" decides how a new bill is pre-set: if every item on a bill belongs to credit categories, the bill defaults to <b>Unpaid</b>. You can always override per bill.
      </div>

      {modal && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <div className="modal-head">{modal.mode === 'add' ? 'Add category' : 'Edit category'}</div>
            <div className="modal-body">
              <div className="field">
                <label>Name *</label>
                <input autoFocus value={modal.data.name} onChange={(e) => setModal({ ...modal, data: { ...modal.data, name: e.target.value } })} placeholder="e.g. Leaf / Greens" />
              </div>
              <div className="field">
                <label>Colour</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {SWATCHES.map((s) => (
                    <button key={s} type="button" onClick={() => setModal({ ...modal, data: { ...modal.data, color: s } })}
                      style={{ width: 28, height: 28, borderRadius: 8, background: s, border: modal.data.color === s ? '3px solid var(--ink)' : '1px solid var(--line)', cursor: 'pointer' }} />
                  ))}
                </div>
              </div>
              <label className="check-row">
                <input type="checkbox" checked={!!modal.data.creditDefault} onChange={(e) => setModal({ ...modal, data: { ...modal.data, creditDefault: e.target.checked } })} style={{ width: 'auto' }} />
                <span>Usually bought on credit (default new bills to Unpaid)</span>
              </label>
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
