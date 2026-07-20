import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  billsForMonth, billsInRange, rollupByIngredient, ingredientLines, listIngredients,
} from '../lib/db';
import IngredientSelect from '../components/IngredientSelect';
import ReportActions from '../components/ReportActions';
import PrintSheet from '../components/PrintSheet';
import { Cat } from '../components/Cat';
import { useCategories } from '../contexts/CategoriesContext';
import { inr, qty, prettyDate, prettyMonth, currentMonthKey, monthRange } from '../lib/format';

export default function IngredientLedger() {
  const [tab, setTab] = useState('month'); // 'month' | 'single'
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ingredient Ledger</h1>
          <div className="sub">What was bought, how much, and at what price</div>
        </div>
        <div className="row">
          <button className={`btn ${tab === 'month' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('month')}>Month roll-up</button>
          <button className={`btn ${tab === 'single' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('single')}>Single ingredient</button>
        </div>
      </div>
      {tab === 'month' ? <MonthRollup /> : <SingleIngredient />}
    </>
  );
}

/* ---------------- Month roll-up: every ingredient with totals ---------------- */
function MonthRollup() {
  const cats = useCategories();
  const [month, setMonth] = useState(currentMonthKey());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const bills = await billsForMonth(month);
      setRows(rollupByIngredient(bills));
      setLoading(false);
    })();
  }, [month]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (cat !== 'all' && r.category !== cat) return false;
    if (q && !r.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [rows, cat, q]);

  const total = filtered.reduce((s, r) => s + r.totalAmount, 0);

  function excelSheets() {
    return [{
      name: 'Ingredients',
      columns: [
        { header: 'Ingredient', key: 'name' }, { header: 'Category', key: 'category' },
        { header: 'Total Qty', key: 'totalQty' }, { header: 'Unit', key: 'unit' },
        { header: 'Avg Cost/Unit (incl GST)', key: 'avgRate' },
        { header: 'Total Spent', key: 'totalAmount' }, { header: 'Bills', key: 'billCount' },
      ],
      rows: filtered.map((r) => ({
        name: r.name, category: cats.name(r.category), totalQty: r.totalQty, unit: r.unit,
        avgRate: Math.round(r.avgRate * 100) / 100, totalAmount: Math.round(r.totalAmount * 100) / 100, billCount: r.billCount,
      })),
    }];
  }

  const printCols = [
    { header: 'Ingredient', key: 'name' }, { header: 'Category', key: 'category' },
    { header: 'Total Qty', key: 'qty', align: 'right' }, { header: 'Avg Cost/Unit', key: 'avg', align: 'right' },
    { header: 'Total Spent', key: 'amount', align: 'right' }, { header: 'Bills', key: 'bills', align: 'right' },
  ];
  const printRows = filtered.map((r) => ({
    name: r.name, category: cats.name(r.category), qty: `${qty(r.totalQty)} ${r.unit}`,
    avg: inr(r.avgRate), amount: inr(r.totalAmount), bills: r.billCount,
  }));
  const printTotal = { name: `Total — ${filtered.length} ingredients`, category: '', qty: '', avg: '', amount: inr(total), bills: '' };

  return (
    <>
      <PrintSheet id="ps-ingmonth" title="Ingredient Roll-up" period={prettyMonth(month)} sign={false} columns={printCols} rows={printRows} total={printTotal} />

      <div className="toolbar">
        <div className="field"><label>Month</label><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
        <div className="field"><label>Category</label>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">All</option>
            {cats.categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}><label>Search</label><input placeholder="ingredient…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <ReportActions filename={`KAL-ingredients-${month}`} printSheetId="ps-ingmonth" excelSheets={excelSheets()} disabled={loading || filtered.length === 0} />
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ingredient</th><th>Category</th>
              <th className="num">Total Qty</th><th>Unit</th>
              <th className="num">Avg Cost/Unit</th><th className="num">Total Spent</th><th className="num">Bills</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="empty">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="empty">No purchases recorded for {prettyMonth(month)}.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.ingredientId || r.name}>
                <td style={{ fontWeight: 600 }}>{r.name}</td>
                <td><Cat k={r.category} /></td>
                <td className="num">{qty(r.totalQty)}</td>
                <td className="muted">{r.unit}</td>
                <td className="num">{inr(r.avgRate)}</td>
                <td className="num" style={{ fontWeight: 600 }}>{inr(r.totalAmount)}</td>
                <td className="num muted">{r.billCount}</td>
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr style={{ background: 'var(--paper-2)', fontWeight: 600 }}>
                <td colSpan={5} style={{ padding: '12px 14px' }}>Total — {filtered.length} ingredients</td>
                <td className="num" style={{ padding: '12px 14px' }}>{inr(total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

/* ---------------- Single ingredient over a period + price trend ---------------- */
function SingleIngredient() {
  const [ingredients, setIngredients] = useState([]);
  const [ingId, setIngId] = useState('');
  const { first } = monthRange(currentMonthKey());
  const [from, setFrom] = useState(addMonths(first, -3));
  const [to, setTo] = useState(monthRange(currentMonthKey()).last);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { (async () => setIngredients(await listIngredients()))(); }, []);

  useEffect(() => {
    if (!ingId) { setLines([]); return; }
    (async () => {
      setLoading(true);
      const bills = await billsInRange(from, to);
      setLines(ingredientLines(bills, ingId));
      setLoading(false);
    })();
  }, [ingId, from, to]);

  const summary = useMemo(() => {
    if (lines.length === 0) return null;
    const totalQty = lines.reduce((s, l) => s + l.qty, 0);
    const totalAmount = lines.reduce((s, l) => s + l.amount, 0);
    const rates = lines.map((l) => l.rate).filter((r) => r > 0);
    return {
      totalQty, totalAmount,
      avgRate: totalQty > 0 ? totalAmount / totalQty : 0,
      minRate: rates.length ? Math.min(...rates) : 0,
      maxRate: rates.length ? Math.max(...rates) : 0,
      unit: lines[0].unit,
    };
  }, [lines]);

  const chartData = lines.map((l) => ({ date: prettyDate(l.billDate).replace(/ \d{4}$/, ''), rate: l.rate }));
  const ing = ingredients.find((i) => i.id === ingId);

  function buildExport() {
    return {
      columns: [
        { header: 'Date', key: 'date' }, { header: 'Vendor', key: 'vendor' }, { header: 'Bill', key: 'bill' },
        { header: 'Qty', key: 'qty', align: 'right' }, { header: 'Unit', key: 'unit' },
        { header: 'Cost/Unit (incl GST)', key: 'rate', align: 'right' }, { header: 'Amount', key: 'amount', align: 'right' },
      ],
      rows: lines.map((l) => ({
        date: prettyDate(l.billDate), vendor: l.vendorName, bill: l.billNo || '',
        qty: l.qty, unit: l.unit, rate: Math.round(l.rate * 100) / 100, amount: Math.round(l.amount * 100) / 100,
      })),
    };
  }

  function excelSheets() {
    return [{
      name: 'Purchases',
      columns: [
        { header: 'Date', key: 'date' }, { header: 'Vendor', key: 'vendor' }, { header: 'Bill', key: 'bill' },
        { header: 'Qty', key: 'qty' }, { header: 'Unit', key: 'unit' },
        { header: 'Cost/Unit (incl GST)', key: 'rate' }, { header: 'Amount', key: 'amount' },
      ],
      rows: lines.map((l) => ({
        date: prettyDate(l.billDate), vendor: l.vendorName, bill: l.billNo || '',
        qty: l.qty, unit: l.unit, rate: Math.round(l.rate * 100) / 100, amount: Math.round(l.amount * 100) / 100,
      })),
    }];
  }
  const printCols = [
    { header: 'Date', key: 'date' }, { header: 'Vendor', key: 'vendor' }, { header: 'Bill', key: 'bill' },
    { header: 'Qty', key: 'qty', align: 'right' }, { header: 'Cost/Unit', key: 'rate', align: 'right' }, { header: 'Amount', key: 'amount', align: 'right' },
  ];
  const printRows = lines.map((l) => ({
    date: prettyDate(l.billDate), vendor: l.vendorName, bill: l.billNo || '—',
    qty: `${qty(l.qty)} ${l.unit}`, rate: inr(l.rate), amount: inr(l.amount),
  }));
  const printTotal = summary ? { date: 'Total', vendor: '', bill: '', qty: `${qty(summary.totalQty)} ${summary.unit}`, rate: `avg ${inr(summary.avgRate)}`, amount: inr(summary.totalAmount) } : null;

  return (
    <>
      {ingId && lines.length > 0 && (
        <PrintSheet id="ps-ingsingle" title={`${ing?.name || 'Ingredient'} — Purchases`} period={`${prettyDate(from)} to ${prettyDate(to)}`} sign={false} columns={printCols} rows={printRows} total={printTotal} />
      )}
      <div className="toolbar">
        <div className="field" style={{ flex: 1, minWidth: 220 }}><label>Ingredient</label>
          <IngredientSelect ingredients={ingredients} value={ingId} onPick={setIngId} placeholder="— select an ingredient —" />
        </div>
        <div className="field"><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        {ingId && lines.length > 0 && (
          <ReportActions filename={`KAL-${(ing?.name || 'ingredient')}-${from}_${to}`} printSheetId="ps-ingsingle" excelSheets={excelSheets()} />
        )}
      </div>

      {!ingId ? (
        <div className="card"><div className="empty">Pick an ingredient to see every purchase and its price trend.</div></div>
      ) : loading ? (
        <div className="empty">Loading…</div>
      ) : lines.length === 0 ? (
        <div className="card"><div className="empty">No purchases of {ing?.name} in this period.</div></div>
      ) : (
        <>
          <div className="stats" style={{ marginBottom: 18 }}>
            <div className="stat"><div className="stat-label">Total bought</div><div className="stat-value tnum">{qty(summary.totalQty)} {summary.unit}</div></div>
            <div className="stat"><div className="stat-label">Total spent</div><div className="stat-value tnum">{inr(summary.totalAmount)}</div></div>
            <div className="stat"><div className="stat-label">Avg cost/unit</div><div className="stat-value tnum">{inr(summary.avgRate)}</div><div className="stat-meta">per {summary.unit}, incl GST</div></div>
            <div className="stat"><div className="stat-label">Cost range</div><div className="stat-value tnum" style={{ fontSize: 19 }}>{inr(summary.minRate)} – {inr(summary.maxRate)}</div></div>
          </div>

          <div className="card chart-card" style={{ marginBottom: 18 }}>
            <h3>Price trend — {ing?.name} (₹ per {summary.unit}, incl. GST)</h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData} margin={{ top: 8, right: 18, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#e4d8c2" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b5d4c' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6b5d4c' }} width={48} />
                <Tooltip formatter={(v) => inr(v)} contentStyle={{ borderRadius: 8, border: '1px solid #e4d8c2', fontFamily: 'DM Sans' }} />
                <Line type="monotone" dataKey="rate" stroke="#b5491f" strokeWidth={2.5} dot={{ r: 3, fill: '#c9851f' }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Vendor</th><th>Bill</th><th className="num">Qty</th><th className="num">Cost/Unit</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {[...lines].reverse().map((l, i) => (
                  <tr key={i}>
                    <td>{prettyDate(l.billDate)}</td>
                    <td>{l.vendorName}</td>
                    <td className="muted">{l.billNo || '—'}</td>
                    <td className="num">{qty(l.qty)} {l.unit}</td>
                    <td className="num">{inr(l.rate)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{inr(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function addMonths(iso, delta) {
  const d = new Date(iso + 'T00:00:00');
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
