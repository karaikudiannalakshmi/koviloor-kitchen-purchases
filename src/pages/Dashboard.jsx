import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell } from 'recharts';
import { billsForMonth, billsInRange, rollupByIngredient, spendTrend, unpaidBills } from '../lib/db';
import { useCategories } from '../contexts/CategoriesContext';
import ReportActions from '../components/ReportActions';
import PrintSheet from '../components/PrintSheet';
import { Cat } from '../components/Cat';
import { inr, qty, prettyMonth, shortMonth, currentMonthKey, todayISO } from '../lib/format';
import { resolveCommodity } from '../lib/marketRateMap';

// Only these categories appear on the dashboard.


// Tiny inline price-trend line for an item's rate history.
function Sparkline({ values, color = '#4f7a34', width = 84, height = 22 }) {
  if (!values || values.length < 2) return null;
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const n = values.length;
  const pt = (v, i) => {
    const x = pad + (i * innerW) / (n - 1);
    const y = pad + innerH - ((v - min) / span) * innerH;
    return [x, y];
  };
  const poly = values.map((v, i) => pt(v, i).join(',')).join(' ');
  const [lx, ly] = pt(values[n - 1], n - 1);
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={poly} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="2.2" fill={color} />
    </svg>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const cats = useCategories();
  const [month, setMonth] = useState(currentMonthKey());
  const [rows, setRows] = useState([]);
  const [bills, setBills] = useState([]);
  const [trend, setTrend] = useState([]);
  const [outstanding, setOutstanding] = useState({ amount: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [topCat, setTopCat] = useState('all');
  const [moveThreshold, setMoveThreshold] = useState(20);
  const [allBills, setAllBills] = useState([]);

  // Show every category on the dashboard (no restriction).
  const isAllowed = useMemo(() => () => true, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const all = await billsForMonth(month);
      const b = all.filter((x) => x.status !== 'draft'); // drafts have no prices yet
      setBills(b);
      setRows(rollupByIngredient(b));
      setTrend(await spendTrend(month, 6));
      const up = await unpaidBills();
      setOutstanding({ amount: up.reduce((s, x) => s + (Number(x.totalAmount) || 0), 0), count: up.length });
      setLoading(false);
    })();
  }, [month]);

  // All priced bills across every month, for price-movement tracking from the beginning.
  useEffect(() => {
    (async () => {
      const rng = await billsInRange('2000-01-01', todayISO());
      setAllBills(rng.filter((x) => x.status !== 'draft'));
    })();
  }, []);

  const allowedRows = useMemo(() => rows.filter((r) => isAllowed(r.category)), [rows, isAllowed]);
  const total = useMemo(() => allowedRows.reduce((s, r) => s + r.totalAmount, 0), [allowedRows]);
  // ---- Near-Koviloor market-rate comparison (Sivaganga / Madurai / Trichy region) ----
  // Match purchased items to a known Agmarknet commodity, using each item's MOST RECENT
  // purchase rate (not a monthly average) so it's a fair like-for-like against today's mandi price.
  const marketMatches = useMemo(() => {
    const latestByKey = new Map(); // key -> { date, rate, name, category, unit }
    allBills.forEach((b) => (b.items || []).forEach((it) => {
      if (!isAllowed(it.category)) return;
      const key = it.ingredientId || it.name;
      const q = Number(it.qty) || 0;
      const gross = Number(it.gross ?? it.amount) || 0;
      const rate = it.effRate != null ? Number(it.effRate) : (q > 0 ? gross / q : Number(it.rate) || 0);
      if (!(rate > 0) || !b.billDate) return;
      const prev = latestByKey.get(key);
      if (!prev || b.billDate > prev.date) {
        latestByKey.set(key, { date: b.billDate, rate, name: it.name, category: it.category, unit: it.unit });
      }
    }));
    const seen = new Map();
    latestByKey.forEach((v) => {
      const commodity = resolveCommodity(v.name);
      if (!commodity || seen.has(commodity)) return;
      seen.set(commodity, { commodity, itemName: v.name, avgRate: v.rate, unit: v.unit, lastPurchaseDate: v.date });
    });
    return [...seen.values()].sort((a, b) => (b.lastPurchaseDate || '').localeCompare(a.lastPurchaseDate || ''));
  }, [allBills, isAllowed]);

  const [marketRates, setMarketRates] = useState({}); // commodity -> {ok, modalPerKg, date, ...}
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState('');
  const [marketApiNote, setMarketApiNote] = useState('');
  const [marketDebug, setMarketDebug] = useState(null);
  const marketKey = marketMatches.map((m) => m.commodity).sort().join(',');
  useEffect(() => {
    if (!marketKey) { setMarketRates({}); return; }
    setMarketLoading(true); setMarketError(''); setMarketApiNote('');
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 25000);
    fetch(`/api/market-rate?commodities=${encodeURIComponent(marketKey)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) { setMarketRates(data.results || {}); if (data.note) setMarketApiNote(data.note); setMarketDebug(data.debug || null); }
        else setMarketError(data.error || 'Could not load market rates.');
      })
      .catch((e) => setMarketError(e.name === 'AbortError' ? 'Timed out — try reloading.' : 'Could not reach the market-rate service.'))
      .finally(() => { clearTimeout(timeout); setMarketLoading(false); });
    return () => { clearTimeout(timeout); ctrl.abort(); };
  }, [marketKey]);

  const marketRows = useMemo(() => marketMatches.map((m) => {
    const mr = marketRates[m.commodity];
    if (!mr || !mr.ok) {
      const reasonLabel = mr?.reason === 'rate_limited' ? 'rate-limited, retry later'
        : mr?.reason === 'no_data' ? 'no recent mandi record'
        : mr?.reason === 'fetch_failed' ? 'unavailable'
        : 'loading…';
      return { ...m, market: null, reasonLabel };
    }
    const gapPct = mr.modalPerKg > 0 ? ((m.avgRate - mr.modalPerKg) / mr.modalPerKg) * 100 : null;
    return { ...m, market: mr, gapPct };
  }), [marketMatches, marketRates]);
  const marketNote = marketApiNote;

  const perCat = useMemo(() => cats.categories
    .filter((c) => isAllowed(c.key))
    .map((c) => ({ ...c, amount: allowedRows.filter((r) => r.category === c.key).reduce((s, r) => s + r.totalAmount, 0) }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount), [allowedRows, cats.categories, isAllowed]);

  const topItems = useMemo(() => {
    const list = topCat === 'all' ? allowedRows : allowedRows.filter((r) => r.category === topCat);
    return list.slice(0, 8);
  }, [allowedRows, topCat]);
  const topMax = topItems.length ? topItems[0].totalAmount : 1;

  // Price movement since each item's FIRST recorded price (baseline auto-shifts if you add earlier months).
  const baselineMonth = useMemo(() => {
    if (!allBills.length) return '';
    return allBills.reduce((min, b) => (b.billDate && b.billDate < min ? b.billDate : min), allBills[0].billDate || '').slice(0, 7);
  }, [allBills]);

  // Every allowed item that has at least two priced purchases → its price change first→latest.
  const allMovers = useMemo(() => {
    const map = new Map();
    allBills.forEach((b) => (b.items || []).forEach((it) => {
      if (!isAllowed(it.category)) return;
      const key = it.ingredientId || it.name;
      const q = Number(it.qty) || 0;
      const gross = Number(it.gross ?? it.amount) || 0;
      const rate = it.effRate != null ? Number(it.effRate) : (q > 0 ? gross / q : Number(it.rate) || 0);
      if (!(rate > 0)) return;
      if (!map.has(key)) map.set(key, { name: it.name, category: it.category, points: [] });
      map.get(key).points.push({ date: b.billDate, rate, billId: b.id });
    }));
    const out = [];
    map.forEach((v) => {
      v.points.sort((a, b) => (a.date < b.date ? -1 : 1));
      if (v.points.length < 2) return;
      const first = v.points[0]; const last = v.points[v.points.length - 1];
      if (!(first.rate > 0)) return;
      const pct = ((last.rate - first.rate) / first.rate) * 100;
      // A price swing of 4× or more between two purchases is almost always a qty/rate entry slip
      // (e.g. a whole-bag amount typed where the per-kg rate belongs).
      const hi = Math.max(first.rate, last.rate); const lo = Math.min(first.rate, last.rate);
      const suspect = lo > 0 && hi / lo >= 4;
      out.push({
        name: v.name, category: v.category, pct, suspect,
        firstRate: first.rate, firstDate: first.date, firstBillId: first.billId,
        lastRate: last.rate, lastDate: last.date, lastBillId: last.billId,
      });
    });
    out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    return out;
  }, [allBills, isAllowed]);

  const dataIssues = useMemo(() => allMovers.filter((m) => m.suspect), [allMovers]);

  const thr = Number(moveThreshold) || 0;
  const priceMovers = useMemo(() => allMovers.filter((m) => Math.abs(m.pct) >= thr), [allMovers, thr]);



  // Per-ingredient rate history (date-ordered) for price-trend sparklines.
  const rateSeries = useMemo(() => {
    const map = new Map();
    bills.forEach((b) => (b.items || []).forEach((it) => {
      const key = it.ingredientId || it.name;
      const q = Number(it.qty) || 0;
      const gross = Number(it.gross ?? it.amount) || 0;
      const rate = it.effRate != null ? Number(it.effRate) : (q > 0 ? gross / q : Number(it.rate) || 0);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ date: b.billDate, rate });
    }));
    map.forEach((arr) => arr.sort((a, b) => (a.date < b.date ? -1 : 1)));
    return map;
  }, [bills]);

  // dynamic stacked trend
  const trendCats = useMemo(() => {
    const keys = new Set();
    trend.forEach((t) => Object.keys(t.cats || {}).forEach((k) => keys.add(k)));
    return cats.categories.filter((c) => keys.has(c.key) && isAllowed(c.key));
  }, [trend, cats.categories, isAllowed]);
  const trendData = trend.map((t) => {
    const row = { month: shortMonth(t.monthKey) };
    trendCats.forEach((c) => { row[c.name] = Math.round((t.cats || {})[c.key] || 0); });
    return row;
  });

  function excelSheets() {
    return [{
      name: 'Summary',
      columns: [
        { header: 'Ingredient', key: 'name' }, { header: 'Category', key: 'category' },
        { header: 'Total Qty', key: 'totalQty' }, { header: 'Unit', key: 'unit' },
        { header: 'Avg Cost/Unit (incl GST)', key: 'avgRate' }, { header: 'Total Spent', key: 'totalAmount' },
      ],
      rows: allowedRows.map((r) => ({
        name: r.name, category: cats.name(r.category), totalQty: r.totalQty, unit: r.unit,
        avgRate: Math.round(r.avgRate * 100) / 100, totalAmount: Math.round(r.totalAmount * 100) / 100,
      })),
    }];
  }
  const printCols = [
    { header: 'Ingredient', key: 'name' }, { header: 'Category', key: 'category' },
    { header: 'Total Qty', key: 'qty', align: 'right' }, { header: 'Avg Cost/Unit', key: 'avg', align: 'right' }, { header: 'Total Spent', key: 'amount', align: 'right' },
  ];
  const printRows = allowedRows.map((r) => ({
    name: r.name, category: cats.name(r.category), qty: `${qty(r.totalQty)} ${r.unit}`, avg: inr(r.avgRate), amount: inr(r.totalAmount),
  }));
  const printTotal = { name: 'Total', category: '', qty: '', avg: '', amount: inr(total) };

  return (
    <>
      <PrintSheet id="ps-dash" title="Purchase Summary" period={prettyMonth(month)} sign={false} columns={printCols} rows={printRows} total={printTotal} />

      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">{prettyMonth(month)} · the purchase manager's snapshot</div>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <ReportActions filename={`KAL-dashboard-${month}`} printSheetId="ps-dash" excelSheets={excelSheets()} disabled={loading || rows.length === 0} />
          <div className="field"><label>Month</label><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          <button className="btn btn-primary" onClick={() => nav('/bills/new')}>＋ New bill</button>
        </div>
      </div>

      {loading ? <div className="empty">Loading…</div> : (
        <>
          <div className="stats" style={{ marginBottom: 22 }}>
            <div className="stat"><div className="stat-label">Total spend</div><div className="stat-value tnum">{inr(total, 0)}</div><div className="stat-meta">{bills.length} bills · {new Set(bills.map((b) => b.vendorId)).size} vendors</div></div>
            {perCat.map((c) => (
              <div className="stat" key={c.key} style={{ cursor: 'pointer' }} onClick={() => setTopCat(c.key)}>
                <span className="stat-bar" style={{ background: c.color }} />
                <div className="stat-label">{c.name}</div>
                <div className="stat-value tnum">{inr(c.amount, 0)}</div>
                <div className="stat-meta">{total ? Math.round(c.amount / total * 100) : 0}% of spend</div>
              </div>
            ))}
            {outstanding.amount > 0 && (
              <div className="stat" onClick={() => nav('/bills')} style={{ cursor: 'pointer' }}>
                <span className="stat-bar" style={{ background: 'var(--terracotta)' }} />
                <div className="stat-label">Outstanding (all time)</div>
                <div className="stat-value tnum unpaid-amt">{inr(outstanding.amount, 0)}</div>
                <div className="stat-meta">{outstanding.count} unpaid bills → settle</div>
              </div>
            )}
          </div>

          {dataIssues.length > 0 && (
            <>
              <div className="section-title" style={{ color: '#a5471f' }}>⚠️ Possible data-entry errors — {dataIssues.length} item{dataIssues.length === 1 ? '' : 's'}</div>
              <div className="card card-pad" style={{ marginBottom: 22, borderColor: '#ecc11f55', background: '#fff9ec' }}>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
                  These items jumped 4× or more between two purchases — usually a whole-bag amount typed where the per-kg rate belongs, or a missing quantity. Open the odd bill and fix its qty/rate.
                </div>
                <div className="table-wrap">
                  <table className="ledger-table">
                    <thead><tr><th>Item</th><th>Category</th><th className="num">Price A</th><th className="num">Price B</th><th>Fix</th></tr></thead>
                    <tbody>
                      {dataIssues.map((m) => {
                        const hiFirst = m.firstRate >= m.lastRate;
                        return (
                          <tr key={'iss' + (m.category || '') + m.name}>
                            <td style={{ fontWeight: 600 }}>{m.name}</td>
                            <td><Cat k={m.category} /></td>
                            <td className="num" style={{ color: hiFirst ? '#c0392b' : 'inherit', fontWeight: hiFirst ? 700 : 400 }}>{inr(m.firstRate)} <span className="muted" style={{ fontSize: 11 }}>{shortMonth(m.firstDate.slice(0, 7))}</span></td>
                            <td className="num" style={{ color: !hiFirst ? '#c0392b' : 'inherit', fontWeight: !hiFirst ? 700 : 400 }}>{inr(m.lastRate)} <span className="muted" style={{ fontSize: 11 }}>{shortMonth(m.lastDate.slice(0, 7))}</span></td>
                            <td>
                              <button className="btn btn-ghost btn-sm" onClick={() => nav(`/bills/${m.firstBillId}/edit`)}>Edit {shortMonth(m.firstDate.slice(0, 7))}</button>{' '}
                              <button className="btn btn-ghost btn-sm" onClick={() => nav(`/bills/${m.lastBillId}/edit`)}>Edit {shortMonth(m.lastDate.slice(0, 7))}</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>The red figure is the likely-wrong one (far from the item's normal price). Fixing these will clean up the price-movers below.</div>
              </div>
            </>
          )}

          <div className="section-title">Market rate check — your last purchase vs nearby mandi</div>
          <div className="card card-pad" style={{ marginBottom: 22 }}>
            {marketMatches.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>None of your purchased items are matched to a mandi commodity yet.</div>
            ) : marketLoading ? (
              <div className="muted" style={{ fontSize: 13 }}>Checking nearby mandi rates…</div>
            ) : marketError ? (
              <div className="muted" style={{ fontSize: 13 }}>Couldn't load market rates right now ({marketError}). Try again shortly.</div>
            ) : (
              <>
                {marketNote && <div className="muted" style={{ fontSize: 12.5, marginBottom: 8, color: '#a5471f' }}>⚠️ {marketNote}</div>}
                <div className="table-wrap">
                  <table className="ledger-table">
                    <thead><tr><th>Item</th><th className="num">Your last rate (₹/kg)</th><th className="num">Mandi modal (₹/kg)</th><th>Market · as on</th><th className="num">Gap</th></tr></thead>
                    <tbody>
                      {marketRows.map((m) => (
                        <tr key={m.commodity}>
                          <td style={{ fontWeight: 600 }}>{m.itemName}</td>
                          <td className="num">{inr(m.avgRate)} <span className="muted" style={{ fontSize: 11 }}>({m.lastPurchaseDate})</span></td>
                          <td className="num">{m.market ? inr(m.market.modalPerKg) : <span className="muted" style={{ fontSize: 12 }}>{m.reasonLabel}</span>}</td>
                          <td className="muted" style={{ fontSize: 12 }}>
                            {m.market ? (
                              <>{m.market.market}{m.market.tier === 'tamil_nadu' && <span style={{ color: '#a5471f' }}> (other TN market)</span>} · {m.market.date}</>
                            ) : '—'}
                          </td>
                          <td className="num" style={{ fontWeight: 700, color: m.gapPct == null ? undefined : (m.gapPct >= 0 ? '#c0392b' : '#3f7a34') }}>
                            {m.gapPct == null ? '—' : `${m.gapPct >= 0 ? '+' : ''}${m.gapPct.toFixed(0)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                  "Your last rate" is the price from your most recent purchase of that item, whatever month it was in — compared against the mandi's most recently reported price. Prefers markets near Koviloor (Sivaganga, Madurai, Tiruchirappalli, Pudukkottai, Ramanathapuram), and only falls to other Tamil Nadu markets as a last resort — labelled "(other TN market)". This is a wholesale mandi price — your vendor rate naturally runs higher (retail delivery, handling, margin). Treat a large or sudden gap as worth a look, not proof of overcharging. Source: Agmarknet / data.gov.in.
                </div>
                {marketDebug && (
                  <details style={{ marginTop: 8, fontSize: 11 }}>
                    <summary className="muted" style={{ cursor: 'pointer' }}>Diagnostic info (for troubleshooting)</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: 10.5, background: '#f7f1e3', padding: 8, borderRadius: 6, maxHeight: 220, overflow: 'auto' }}>{JSON.stringify(marketDebug, null, 2)}</pre>
                  </details>
                )}
              </>
            )}
          </div>

          <div className="section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span>Price movers{baselineMonth ? ` — since ${prettyMonth(baselineMonth)}` : ''}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 400 }}>
              moved ≥
              <input type="number" min="0" max="500" value={moveThreshold} onChange={(e) => setMoveThreshold(e.target.value)} style={{ width: 66, textAlign: 'right' }} />
              %
            </span>
          </div>
          <div className="card card-pad" style={{ marginBottom: 22 }}>
            {allMovers.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>Not enough data yet — an item needs at least two priced purchases before a change can be shown. Enter more bills and movers will appear here.</div>
            ) : priceMovers.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>No item has moved {thr}% or more. Lower the % above to see smaller movements ({allMovers.length} item{allMovers.length === 1 ? '' : 's'} tracked).</div>
            ) : (
              <>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{priceMovers.length} of {allMovers.length} tracked item{allMovers.length === 1 ? '' : 's'} moved {thr}% or more since first purchase.{priceMovers.length > 25 ? ' Chart shows the top 25; full list in the table below.' : ''}</div>
                <ResponsiveContainer width="100%" height={Math.max(160, Math.min(priceMovers.length, 25) * 32 + 46)}>
                  <BarChart data={priceMovers.slice(0, 25).map((m) => ({ name: m.name, pct: Math.round(m.pct) }))} layout="vertical" margin={{ top: 6, right: 54, left: 8, bottom: 4 }}>
                    <CartesianGrid stroke="#e4d8c2" strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#6b5d4c' }} tickFormatter={(v) => `${v}%`} domain={[(min) => Math.min(0, Math.floor(min)), (max) => Math.max(0, Math.ceil(max))]} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: '#3a2f23' }} />
                    <Tooltip formatter={(v) => `${v > 0 ? '+' : ''}${v}%`} contentStyle={{ borderRadius: 8, border: '1px solid #e4d8c2', fontFamily: 'DM Sans' }} />
                    <Bar dataKey="pct" radius={[0, 4, 4, 0]} label={{ position: 'right', formatter: (v) => `${v > 0 ? '+' : ''}${v}%`, fontSize: 11, fill: '#6b5d4c' }}>
                      {priceMovers.slice(0, 25).map((m, i) => <Cell key={i} fill={m.pct >= 0 ? '#c0392b' : '#3f7a34'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="table-wrap" style={{ marginTop: 10 }}>
                  <table className="ledger-table">
                    <thead><tr><th>Item</th><th>Category</th><th className="num">First (₹/unit)</th><th className="num">Now (₹/unit)</th><th className="num">Change</th></tr></thead>
                    <tbody>
                      {priceMovers.map((m) => (
                        <tr key={(m.category || '') + m.name}>
                          <td style={{ fontWeight: 600 }}>{m.name}{m.suspect && <span title="Large swing — likely a data-entry error; see the errors section above" style={{ marginLeft: 6, color: '#c0392b' }}>⚠️</span>}</td>
                          <td><Cat k={m.category} /></td>
                          <td className="num">{inr(m.firstRate)} <span className="muted" style={{ fontSize: 11 }}>{shortMonth(m.firstDate.slice(0, 7))}</span></td>
                          <td className="num">{inr(m.lastRate)} <span className="muted" style={{ fontSize: 11 }}>{shortMonth(m.lastDate.slice(0, 7))}</span></td>
                          <td className="num" style={{ color: m.pct >= 0 ? '#c0392b' : '#3f7a34', fontWeight: 700 }}>{m.pct >= 0 ? '▲' : '▼'} {Math.abs(m.pct).toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Red ▲ = price up, green ▼ = price down, comparing each item's latest purchase to its first recorded purchase (per-unit, incl. GST). Set the % to 0 to see every item.</div>
              </>
            )}
          </div>

          {total === 0 ? (
            <div className="card"><div className="empty">No purchases recorded for {prettyMonth(month)}. Enter a bill to populate the dashboard.</div></div>
          ) : (
            <>
              <div className="card card-pad">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 10 }}>
                  <h3 style={{ fontFamily: 'var(--serif)', fontSize: 18 }}>Top items this month</h3>
                  <select value={topCat} onChange={(e) => setTopCat(e.target.value)} style={{ width: 'auto' }}>
                    <option value="all">All categories</option>
                    {cats.categories.filter((c) => isAllowed(c.key)).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                  </select>
                </div>
                <div className="rank-list">
                  {topItems.map((r, i) => {
                    const series = rateSeries.get(r.ingredientId || r.name) || [];
                    const vals = series.map((p) => p.rate);
                    let trend = null;
                    if (vals.length >= 2) {
                      const first = vals[0]; const last = vals[vals.length - 1];
                      const pct = first > 0 ? ((last - first) / first) * 100 : 0;
                      const flat = Math.abs(pct) < 0.5;
                      const up = last > first;
                      trend = (
                        <>
                          <Sparkline values={vals} color={cats.color(r.category)} />
                          <span className={`trend ${flat ? 'flat' : up ? 'up' : 'down'}`}>
                            {flat ? '■' : up ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}%
                          </span>
                          <span className="muted">now {inr(last)}</span>
                        </>
                      );
                    }
                    return (
                      <div className="rank-row" key={r.ingredientId || r.name} onClick={() => nav('/ledger')} style={{ cursor: 'pointer' }} title="Open price trend in Ingredient Ledger">
                        <div className="rank-no">{i + 1}</div>
                        <div className="rank-name">
                          {r.name} <Cat k={r.category} dot />
                          <div className="rank-bar"><span style={{ width: `${Math.max(6, (r.totalAmount / topMax) * 100)}%`, background: cats.color(r.category) }} /></div>
                          <div className="rank-meta">
                            <span className="muted">{qty(r.totalQty)} {r.unit} · avg {inr(r.avgRate)}</span>
                            {trend}
                          </div>
                        </div>
                        <div className="rank-amt">{inr(r.totalAmount, 0)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="section-title">Spend trend — last 6 months</div>
              <div className="card chart-card">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={trendData} margin={{ top: 8, right: 18, left: 6, bottom: 4 }}>
                    <CartesianGrid stroke="#e4d8c2" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b5d4c' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#6b5d4c' }} width={64} tickFormatter={(v) => '₹' + (v / 1000) + 'k'} />
                    <Tooltip formatter={(v) => inr(v, 0)} contentStyle={{ borderRadius: 8, border: '1px solid #e4d8c2', fontFamily: 'DM Sans' }} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    {trendCats.map((c, i) => (
                      <Bar key={c.key} dataKey={c.name} stackId="a" fill={c.color} radius={i === trendCats.length - 1 ? [5, 5, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
