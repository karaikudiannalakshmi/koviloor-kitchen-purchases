import { useEffect, useState } from 'react';
import { listVendors, addVendor, updateVendor, deleteVendor } from '../lib/db';
import { useCategories } from '../contexts/CategoriesContext';
import { Cat } from '../components/Cat';

const BLANK = { name: '', phone: '', address: '', supplies: [] };

// Backward-compatible: read a vendor's supplied categories whether stored as the new
// `supplies` array or the old `type` string.
function vendorSupplies(v) {
  if (Array.isArray(v.supplies)) return v.supplies;
  if (v.type === 'grocery') return ['grocery'];
  if (v.type === 'vegetable') return ['vegetable'];
  if (v.type === 'both') return ['vegetable', 'grocery'];
  return [];
}

export default function Vendors() {
  const cats = useCategories();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // {mode, data}

  async function load() {
    setLoading(true);
    setVendors(await listVendors());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function openEdit(v) {
    setModal({ mode: 'edit', data: { ...v, supplies: vendorSupplies(v) } });
  }

  function toggleSupply(key) {
    const cur = modal.data.supplies || [];
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    setModal({ ...modal, data: { ...modal.data, supplies: next } });
  }

  async function save() {
    const d = modal.data;
    if (!d.name.trim()) return;
    const patch = {
      name: d.name, phone: d.phone || '', address: d.address || '', supplies: d.supplies || [],
      bankHolder: d.bankHolder || '', bankAccount: d.bankAccount || '', bankIfsc: d.bankIfsc || '', bankName: d.bankName || '', bankBeneId: d.bankBeneId || '',
    };
    if (modal.mode === 'add') await addVendor(patch);
    else await updateVendor(d.id, patch);
    setModal(null);
    load();
  }

  async function remove(v) {
    if (!confirm(`Delete vendor "${v.name}"? Bills already entered keep their vendor name.`)) return;
    await deleteVendor(v.id);
    load();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Vendors</h1>
          <div className="sub">Suppliers tagged by the categories they supply</div>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({ mode: 'add', data: { ...BLANK } })}>＋ Add vendor</button>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Supplies</th><th>Phone</th><th>Address</th><th style={{ width: 1 }} /></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="empty">Loading…</td></tr>
            ) : vendors.length === 0 ? (
              <tr><td colSpan={5} className="empty">No vendors yet. Add your first supplier.</td></tr>
            ) : vendors.map((v) => {
              const sup = vendorSupplies(v);
              return (
                <tr key={v.id}>
                  <td style={{ fontWeight: 600 }}>{v.name}</td>
                  <td>
                    {sup.length === 0 ? <span className="muted">—</span> : (
                      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                        {sup.map((k) => <Cat key={k} k={k} />)}
                      </span>
                    )}
                  </td>
                  <td className="muted">{v.phone || '—'}</td>
                  <td className="muted">{v.address || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(v)}>Edit</button>{' '}
                    <button className="btn btn-danger btn-sm" onClick={() => remove(v)}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <div className="modal-head">{modal.mode === 'add' ? 'Add vendor' : 'Edit vendor'}</div>
            <div className="modal-body">
              <div className="field">
                <label>Vendor name *</label>
                <input autoFocus value={modal.data.name} onChange={(e) => setModal({ ...modal, data: { ...modal.data, name: e.target.value } })} />
              </div>

              <div className="field">
                <label>Supplies (tick all that apply)</label>
                {cats.categories.length === 0 ? (
                  <div className="muted" style={{ fontSize: 13 }}>No categories yet — add them on the Categories page.</div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
                    {cats.categories.map((c) => {
                      const on = (modal.data.supplies || []).includes(c.key);
                      return (
                        <label key={c.key} className="supply-chip" data-on={on}>
                          <input type="checkbox" checked={on} onChange={() => toggleSupply(c.key)} />
                          <span className="cat-dot" style={{ background: c.color }} />
                          {c.name}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="row">
                <div className="field">
                  <label>Phone</label>
                  <input value={modal.data.phone} onChange={(e) => setModal({ ...modal, data: { ...modal.data, phone: e.target.value } })} />
                </div>
              </div>

              <div className="field">
                <label>Bank details (for monthly settlement / NEFT)</label>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>Used to build the bank upload file. Leave blank for cash vendors.</div>
              </div>
              <div className="row">
                <div className="field" style={{ flex: 2 }}>
                  <label>Account holder name</label>
                  <input value={modal.data.bankHolder || ''} onChange={(e) => setModal({ ...modal, data: { ...modal.data, bankHolder: e.target.value } })} placeholder="as per bank" />
                </div>
                <div className="field" style={{ flex: 2 }}>
                  <label>Account number</label>
                  <input value={modal.data.bankAccount || ''} onChange={(e) => setModal({ ...modal, data: { ...modal.data, bankAccount: e.target.value.replace(/[^0-9]/g, '') } })} inputMode="numeric" />
                </div>
              </div>
              <div className="row">
                <div className="field">
                  <label>IFSC</label>
                  <input value={modal.data.bankIfsc || ''} onChange={(e) => setModal({ ...modal, data: { ...modal.data, bankIfsc: e.target.value.toUpperCase().replace(/\s/g, '') } })} placeholder="e.g. ICIC0001234" />
                </div>
                <div className="field" style={{ flex: 2 }}>
                  <label>Bank name (optional)</label>
                  <input value={modal.data.bankName || ''} onChange={(e) => setModal({ ...modal, data: { ...modal.data, bankName: e.target.value } })} />
                </div>
              </div>
              <div className="row">
                <div className="field">
                  <label>Beneficiary ID (bank-registered)</label>
                  <input value={modal.data.bankBeneId || ''} onChange={(e) => setModal({ ...modal, data: { ...modal.data, bankBeneId: e.target.value.trim() } })} placeholder="bank's registered bene ID" />
                </div>
              </div>

              <div className="field">
                <label>Address</label>
                <textarea rows={2} value={modal.data.address} onChange={(e) => setModal({ ...modal, data: { ...modal.data, address: e.target.value } })} />
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
