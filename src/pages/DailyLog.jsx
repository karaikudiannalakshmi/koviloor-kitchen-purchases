import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { listVendors, listIngredients, getDailyLog, saveDailyLog, markDailyLogBilled, addBill } from '../lib/db';
import { inr, currentMonthKey, prettyMonth } from '../lib/format';

// Days in a given 'YYYY-MM' month key.
function daysInMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function dayLabel(monthKey, day) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1, day);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
}
function dayISO(monthKey, day) {
  return `${monthKey}-${String(day).padStart(2, '0')}`;
}

export default function DailyLog() {
  const nav = useNavigate();
  const [vendors, setVendors] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading] = useState(true);

  const [vendorId, setVendorId] = useState(() => { try { return localStorage.getItem('dlog_vendor') || ''; } catch { return ''; } });
  const [ingredientId, setIngredientId] = useState(() => { try { return localStorage.getItem('dlog_ingredient') || ''; } catch { return ''; } });
  const [monthKey, setMonthKey] = useState(currentMonthKey());

  const [entries, setEntries] = useState({}); // { '01': {qty, rate} }
  const [billed, setBilled] = useState(false);
  const [billId, setBillId] = useState(null);
  const [saveState, setSaveState] = useState(''); // '', 'saving', 'saved'
  const [creating, setCreating] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    (async () => {
      const [v, i] = await Promise.all([listVendors(), listIngredients()]);
      setVendors(v.filter((x) => x.active !== false));
      setIngredients(i.filter((x) => x.active !== false));
      setLoading(false);
    })();
  }, []);

  const vendor = useMemo(() => vendors.find((v) => v.id === vendorId), [vendors, vendorId]);
  const ingredient = useMemo(() => ingredients.find((i) => i.id === ingredientId), [ingredients, ingredientId]);

  useEffect(() => { try { localStorage.setItem('dlog_vendor', vendorId); } catch {} }, [vendorId]);
  useEffect(() => { try { localStorage.setItem('dlog_ingredient', ingredientId); } catch {} }, [ingredientId]);

  // Load the log whenever vendor/ingredient/month changes.
  useEffect(() => {
    if (!vendorId || !ingredientId) { setEntries({}); setBilled(false); setBillId(null); return; }
    (async () => {
      const log = await getDailyLog(vendorId, ingredientId, monthKey);
      setEntries(log?.entries || {});
      setBilled(!!log?.billed);
      setBillId(log?.billId || null);
    })();
  }, [vendorId, ingredientId, monthKey]);

  const days = useMemo(() => Array.from({ length: daysInMonth(monthKey) }, (_, i) => String(i + 1).padStart(2, '0')), [monthKey]);
  const lastRateEntered = useMemo(() => {
    for (let i = days.length - 1; i >= 0; i--) {
      const e = entries[days[i]];
      if (e && e.rate) return e.rate;
    }
    return '';
  }, [entries, days]);

  const totalQty = useMemo(() => days.reduce((s, d) => s + (Number(entries[d]?.qty) || 0), 0), [days, entries]);
  const totalAmount = useMemo(() => days.reduce((s, d) => {
    const e = entries[d]; const q = Number(e?.qty) || 0; const r = Number(e?.rate) || 0;
    return s + q * r;
  }, 0), [days, entries]);
  const filledDays = useMemo(() => days.filter((d) => Number(entries[d]?.qty) > 0).length, [days, entries]);

  const scheduleSave = useCallback((nextEntries) => {
    if (!vendorId || !ingredientId) return;
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await saveDailyLog(vendorId, ingredientId, monthKey, { entries: nextEntries, vendorName: vendor?.name || '', ingredientName: ingredient?.name || '', unit: ingredient?.unit || '' });
      setSaveState('saved');
      setTimeout(() => setSaveState(''), 1500);
    }, 500);
  }, [vendorId, ingredientId, monthKey, vendor, ingredient]);

  function setDay(day, field, value) {
    setEntries((prev) => {
      const next = { ...prev, [day]: { ...prev[day], [field]: value } };
      scheduleSave(next);
      return next;
    });
  }
  function fillRateDown(fromDay, rate) {
    setEntries((prev) => {
      const next = { ...prev };
      let apply = false;
      days.forEach((d) => {
        if (d === fromDay) apply = true;
        if (apply && (!next[d] || !next[d].rate)) next[d] = { ...next[d], rate };
      });
      scheduleSave(next);
      return next;
    });
  }

  async function createDraftBill() {
    if (!vendor || !ingredient) return;
    const items = days
      .filter((d) => Number(entries[d]?.qty) > 0)
      .map((d) => {
        const q = Number(entries[d].qty) || 0;
        const r = Number(entries[d].rate) || 0;
        const amount = Math.round(q * r * 100) / 100;
        return {
          ingredientId: ingredient.id,
          name: `${ingredient.name} — ${dayLabel(monthKey, Number(d))}`,
          category: ingredient.category,
          unit: ingredient.unit || 'litre',
          freeText: false,
          qty: q, rate: r, amount, gstPct: 0, gstAmt: 0, gross: amount, effRate: r,
        };
      });
    if (items.length === 0) { alert('No days have a quantity entered yet.'); return; }
    if (!confirm(`Create a draft bill for ${vendor.name} — ${ingredient.name}, ${prettyMonth(monthKey)}?\n${items.length} day(s), total ${inr(totalAmount)}. You can review and edit before finalising.`)) return;

    setCreating(true);
    const lastDay = [...days].reverse().find((d) => Number(entries[d]?.qty) > 0);
    const payload = {
      vendorId: vendor.id, vendorName: vendor.name,
      billNo: '', billDate: dayISO(monthKey, Number(lastDay)), monthKey,
      items,
      totalQty: items.reduce((s, it) => s + it.qty, 0),
      subtotal: totalAmount, gstMode: '%', gstValue: 0, gstTotal: 0, totalAmount,
      notes: `Daily delivery log — ${prettyMonth(monthKey)}`,
      paid: false, paidDate: '', status: 'draft',
      aiNote: '', flag: false, flagReason: '',
    };
    const ref = await addBill(payload);
    await markDailyLogBilled(vendor.id, ingredient.id, monthKey, ref.id);
    setBilled(true); setBillId(ref.id);
    setCreating(false);
    nav('/bills?view=drafts');
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Daily Log</h1>
          <div className="sub">For items delivered every day, billed once a month — e.g. milk</div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
          <div className="field">
            <label>Vendor</label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={{ minWidth: 180 }}>
              <option value="">— choose —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Item</label>
            <select value={ingredientId} onChange={(e) => setIngredientId(e.target.value)} style={{ minWidth: 180 }}>
              <option value="">— choose —</option>
              {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Month</label>
            <input type="month" value={monthKey} onChange={(e) => setMonthKey(e.target.value)} />
          </div>
          <div style={{ flex: 1 }} />
          <div className="muted" style={{ fontSize: 12.5, alignSelf: 'center' }}>
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && '✓ Saved'}
          </div>
        </div>
      </div>

      {!vendorId || !ingredientId ? (
        <div className="card"><div className="empty">Choose a vendor and item to start logging daily deliveries.</div></div>
      ) : loading ? (
        <div className="empty">Loading…</div>
      ) : (
        <>
          {billed && (
            <div className="flash" style={{ marginBottom: 14, background: '#fff3da', borderColor: '#eccfa0', color: '#a96c12' }}>
              🗒 This month is already billed. <a href={`/bills/${billId}/edit`} onClick={(e) => { e.preventDefault(); nav(`/bills/${billId}/edit`); }} style={{ fontWeight: 600 }}>Open the bill</a> to edit it, or keep logging here if more deliveries came after billing (you can create a follow-up bill for the extra days).
            </div>
          )}

          <div className="stats" style={{ marginBottom: 16 }}>
            <div className="stat">
              <div className="stat-label">Days logged</div>
              <div className="stat-value tnum">{filledDays} / {days.length}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Total quantity</div>
              <div className="stat-value tnum">{totalQty} {ingredient?.unit || ''}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Total amount</div>
              <div className="stat-value tnum">{inr(totalAmount)}</div>
            </div>
          </div>

          <div className="table-wrap" style={{ marginBottom: 16 }}>
            <table className="ledger-table">
              <thead>
                <tr><th>Date</th><th className="num">Qty ({ingredient?.unit || ''})</th><th className="num">Rate (₹)</th><th className="num">Amount (₹)</th><th></th></tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const e = entries[d] || {};
                  const q = Number(e.qty) || 0; const r = Number(e.rate) || 0;
                  return (
                    <tr key={d}>
                      <td>{dayLabel(monthKey, Number(d))}</td>
                      <td className="num">
                        <input type="number" step="any" min="0" value={e.qty ?? ''} onChange={(ev) => setDay(d, 'qty', ev.target.value)} style={{ width: 90, textAlign: 'right' }} />
                      </td>
                      <td className="num">
                        <input type="number" step="any" min="0" value={e.rate ?? ''} onChange={(ev) => setDay(d, 'rate', ev.target.value)} style={{ width: 90, textAlign: 'right' }} />
                      </td>
                      <td className="num">{q && r ? inr(q * r) : '—'}</td>
                      <td>
                        {!e.rate && lastRateEntered ? (
                          <button className="btn-link" type="button" style={{ fontSize: 12 }} onClick={() => fillRateDown(d, lastRateEntered)}>use {inr(lastRateEntered)} onward</button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button className="btn btn-primary" onClick={createDraftBill} disabled={creating || totalQty === 0}>
            {creating ? 'Creating…' : `🗒 Create draft bill for ${prettyMonth(monthKey)}`}
          </button>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Creates one draft bill with a line for each day you've entered — review and finalise it from the Drafts tab. Entries save automatically as you type, so you can come back and add days through the month.
          </div>
        </>
      )}
    </>
  );
}
