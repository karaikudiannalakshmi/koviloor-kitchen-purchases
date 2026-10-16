import { Fragment, useEffect, useMemo, useState } from 'react';
import { billsInRange, rollupByIngredient } from '../lib/db';
import { computeVariance, sumRows } from '../lib/variance';
import { loadMerges, saveMerges, applyMerges } from '../lib/varianceMerges';
import ReportActions from '../components/ReportActions';
import PrintSheet from '../components/PrintSheet';
import { inr, qty, prettyMonth, shortMonth, currentMonthKey, lastNMonths, monthRange } from '../lib/format';

const CLASSES = [
  { key: 'grocery', label: 'Grocery' },
  { key: 'vegetable', label: 'Vegetable' },
];

// Default to the last 3 COMPLETE months -- the running month is only part-way
// through, so comparing it against full months would show a false "saving".
function defaultEndMonth() {
  const [y, m] = currentMonthKey().split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const sgn = (n) => (n > 0 ? '+' : n < 0 ? '−' : '');
const money = (n) => `${sgn(n)}${inr(Math.abs(n), 0)}`;
const pct = (n) => (n == null ? '—' : `${sgn(n)}${Math.abs(n).toFixed(1)}%`);
const tone = (n) => (Math.abs(n) < 0.5 ? undefined : n > 0 ? 'var(--terracotta, #b4432a)' : 'var(--veg, #4f7a34)');

export default function Variance() {
  const [endMonth, setEndMonth] = useState(defaultEndMonth());
  const [loading, setLoading] = useState(true);
  const [rollups, setRollups] = useState(null);
  const [minPct, setMinPct] = useState(0);
  const [onlyMoved, setOnlyMoved] = useState(false);
  const [q, setQ] = useState('');
  const [pairs, setPairs] = useState([]); // renamed-item pairs (old name folded into new name)
  const [mergeBusy, setMergeBusy] = useState(false);
  useEffect(() => { loadMerges().then(setPairs); }, []);
  async function persist(next) {
    setMergeBusy(true);
    try { await saveMerges(next); setPairs(next); } catch (e) { alert('Could not save: ' + (e.message || e)); }
    setMergeBusy(false);
  }
  const addPair = (o, n) => persist([...pairs.filter((x) => x.fromKey !== o.key), { fromKey: o.key, toKey: n.key, fromName: o.name, toName: n.name }]);
  const removePair = (p) => persist(pairs.filter((x) => !(x.fromKey === p.fromKey && x.toKey === p.toKey)));
  const mergedChip = (r) => {
    const from = pairs.filter((p) => p.toKey === r.key).map((p) => p.fromName);
    return from.length ? <span className="chip" style={{ marginLeft: 6, background: 'var(--paper-2)' }} title={`Combined with: ${from.join(', ')}`}>⇄ {from.join(', ')}</span> : null;
  };

  const months = useMemo(() => lastNMonths(endMonth, 3), [endMonth]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const bills = (await billsInRange(monthRange(months[0]).first, monthRange(months[2]).last))
        .filter((b) => b.status !== 'draft'); // drafts have no prices yet
      const buckets = months.map((mk) => bills.filter((b) => (b.monthKey || (b.billDate || '').slice(0, 7)) === mk));
      if (alive) { setRollups(buckets.map((bs) => rollupByIngredient(bs))); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [months]);

  const { all, others } = useMemo(() => {
    if (!rollups) return { all: [], others: 0 };
    const { rows } = computeVariance(applyMerges(rollups, pairs));
    const keep = rows.filter((r) => CLASSES.some((c) => c.key === r.category));
    return { all: keep, others: rows.length - keep.length };
  }, [rollups, pairs]);

  const visible = useMemo(() => all.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (onlyMoved && Math.abs(r.variance) < 1) return false;
    if (minPct > 0) {
      // new / stopped items have no % to compare, so they always stay visible
      if (r.variancePct != null && Math.abs(r.variancePct) < minPct) return false;
    }
    return true;
  }), [all, q, onlyMoved, minPct]);

  const pickList = [...all].sort((a, b) => {
    const rank = (r) => (r.status === 'stopped' ? 0 : r.status === 'new' ? 1 : 2);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
  const hasStopped = all.some((r) => r.status === 'stopped');
  const hasNew = all.some((r) => r.status === 'new');

  const byClass = CLASSES.map((c) => {
    const rows = visible.filter((r) => r.category === c.key);
    const allRows = all.filter((r) => r.category === c.key);
    return { ...c, rows, tot: sumRows(rows, 3), fullTot: sumRows(allRows, 3) };
  });
  const grand = sumRows(all, 3);

  const [m1, m2, m3] = months;
  const label = (mk) => shortMonth(mk);
  const baseLabel = `${label(m1)}–${label(m2)} avg`;

  /* ---------- exports ---------- */
  const excelCols = [
    { header: 'Ingredient', key: 'name' }, { header: 'Unit', key: 'unit' },
    ...months.flatMap((mk, i) => ([
      { header: `${label(mk)} Qty`, key: `q${i}` }, { header: `${label(mk)} Rate`, key: `r${i}` }, { header: `${label(mk)} Amount`, key: `a${i}` },
    ])),
    { header: `Baseline Qty (${baseLabel})`, key: 'bq' }, { header: 'Baseline Rate', key: 'br' }, { header: 'Baseline Amount', key: 'ba' },
    { header: 'Qty change %', key: 'qp' }, { header: 'Rate change %', key: 'rp' },
    { header: 'Quantity effect', key: 'qe' }, { header: 'Price effect', key: 'pe' },
    { header: 'Total variance', key: 'tv' }, { header: 'Variance %', key: 'vp' }, { header: 'Note', key: 'note' },
  ];
  const r2 = (n) => Math.round(n * 100) / 100;
  const excelRow = (r) => {
    const o = { name: r.name, unit: r.unit };
    r.months.forEach((m, i) => { o[`q${i}`] = r2(m.qty); o[`r${i}`] = r2(m.rate); o[`a${i}`] = r2(m.amount); });
    Object.assign(o, {
      bq: r2(r.baseQty), br: r2(r.baseRate), ba: r2(r.baseAmt),
      qp: r.qtyPct == null ? '' : r2(r.qtyPct), rp: r.ratePct == null ? '' : r2(r.ratePct),
      qe: r2(r.qtyEffect), pe: r2(r.priceEffect), tv: r2(r.variance), vp: r.variancePct == null ? '' : r2(r.variancePct),
      note: r.status === 'new' ? 'New this month' : r.status === 'stopped' ? 'Not bought this month' : '',
    });
    return o;
  };
  const excelSheets = () => [
    {
      name: 'Summary',
      columns: [{ header: 'Class', key: 'c' }, ...months.map((mk, i) => ({ header: `${label(mk)} spend`, key: `m${i}` })),
        { header: 'Baseline monthly avg', key: 'b' }, { header: 'Quantity effect', key: 'qe' }, { header: 'Price effect', key: 'pe' },
        { header: 'Total variance', key: 'v' }, { header: 'Variance %', key: 'p' }],
      rows: [...byClass.map((c) => ({ ...c.fullTot, label: c.label })), { ...grand, label: 'Total' }].map((t) => {
        const o = { c: t.label, b: r2(t.baseAmt), qe: r2(t.qtyEffect), pe: r2(t.priceEffect), v: r2(t.variance), p: t.variancePct == null ? '' : r2(t.variancePct) };
        t.monthAmounts.forEach((a, i) => { o[`m${i}`] = r2(a); });
        return o;
      }),
    },
    ...byClass.map((c) => ({ name: c.label, columns: excelCols, rows: c.rows.map(excelRow) })),
  ];

  const printCols = [
    { header: 'Ingredient', key: 'name' },
    { header: `Base qty`, key: 'bq', align: 'right' }, { header: 'Base rate', key: 'br', align: 'right' },
    { header: `${label(m3)} qty`, key: 'cq', align: 'right' }, { header: `${label(m3)} rate`, key: 'cr', align: 'right' },
    { header: 'Qty %', key: 'qp', align: 'right' }, { header: 'Rate %', key: 'rp', align: 'right' },
    { header: 'Qty effect ₹', key: 'qe', align: 'right' }, { header: 'Price effect ₹', key: 'pe', align: 'right' },
    { header: 'Variance ₹', key: 'tv', align: 'right' },
  ];
  const printRows = byClass.flatMap((c) => ([
    ...c.rows.map((r) => ({
      name: r.status === 'new' ? `${r.name} (new)` : r.status === 'stopped' ? `${r.name} (not bought)` : r.name,
      bq: `${qty(r.baseQty)} ${r.unit}`, br: inr(r.baseRate), cq: `${qty(r.curQty)} ${r.unit}`, cr: r.curRate ? inr(r.curRate) : '—',
      qp: pct(r.qtyPct), rp: pct(r.ratePct), qe: money(r.qtyEffect), pe: money(r.priceEffect), tv: money(r.variance),
    })),
    { name: `${c.label.toUpperCase()} — subtotal`, bq: '', br: '', cq: '', cr: '', qp: '', rp: '', qe: money(c.tot.qtyEffect), pe: money(c.tot.priceEffect), tv: money(c.tot.variance) },
  ]));
  const printTotal = { name: 'Total (shown items)', qe: money(sumRows(visible, 3).qtyEffect), pe: money(sumRows(visible, 3).priceEffect), tv: money(sumRows(visible, 3).variance) };

  const COLS = 15;

  return (
    <>
      <PrintSheet
        id="ps-variance" title="Purchase Variance Analysis" sign={false}
        period={`${prettyMonth(m3)} vs average of ${prettyMonth(m1)} & ${prettyMonth(m2)}`}
        columns={printCols} rows={printRows} total={printTotal}
        note="Variance ₹ = this month's spend minus baseline monthly spend (positive = spent more). Quantity effect = (qty change × baseline rate); Price effect = (rate change × this month's qty). The two add up to the variance. Rates include GST."
      />

      <div className="page-head">
        <div>
          <h1>Variance Analysis</h1>
          <div className="sub">
            {prettyMonth(m3)} compared with the average of {prettyMonth(m1)} &amp; {prettyMonth(m2)} — quantity vs price
          </div>
        </div>
      </div>

      <div className="toolbar">
        <div className="field"><label>Latest month (3-month window ends)</label>
          <input type="month" value={endMonth} onChange={(e) => e.target.value && setEndMonth(e.target.value)} /></div>
        <div className="field"><label>Hide variance below %</label>
          <input type="number" min="0" step="5" value={minPct} onChange={(e) => setMinPct(Number(e.target.value) || 0)} style={{ width: 90 }} /></div>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', paddingBottom: 8 }}>
          <input type="checkbox" checked={onlyMoved} onChange={(e) => setOnlyMoved(e.target.checked)} /> Only items with a variance
        </label>
        <div className="field" style={{ flex: 1 }}><label>Search</label><input placeholder="ingredient…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <ReportActions filename={`Variance-${m3}`} printSheetId="ps-variance" excelSheets={excelSheets()} disabled={loading || visible.length === 0} />
      </div>

      {endMonth === currentMonthKey() && (
        <div className="card card-pad" style={{ marginBottom: 14, borderColor: 'var(--turmeric)' }}>
          ⚠ {prettyMonth(endMonth)} is still running, so its quantities are part-month and will look lower than the baseline. Pick the last complete month for a fair comparison.
        </div>
      )}

      <RenamePanel pairs={pairs} items={pickList} nameOf={(r) => r.name} onAdd={addPair} onRemove={removePair} hint={hasStopped && hasNew} busy={mergeBusy} />

      {/* ---- Summary by class ---- */}
      <div className="stats" style={{ marginBottom: 18 }}>
        {[...byClass.map((c) => ({ label: c.label, t: c.fullTot })), { label: 'Grocery + Vegetable', t: grand }].map(({ label: l, t }) => (
          <div className="card card-pad" key={l}>
            <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>{l}</div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{inr(t.curAmt, 0)}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>baseline {inr(t.baseAmt, 0)} / month</div>
            <div style={{ marginTop: 8, fontWeight: 700, color: tone(t.variance) }}>{money(t.variance)} ({pct(t.variancePct)})</div>
            <div style={{ fontSize: 12.5, marginTop: 4 }}>
              <span style={{ color: tone(t.qtyEffect) }}>Quantity {money(t.qtyEffect)}</span>
              {' · '}
              <span style={{ color: tone(t.priceEffect) }}>Price {money(t.priceEffect)}</span>
            </div>
          </div>
        ))}
      </div>

      {loading ? <div className="card card-pad muted">Loading {months.map(prettyMonth).join(', ')}…</div> : byClass.map((c) => (
        <div key={c.key} style={{ marginBottom: 22 }}>
          <h2 style={{ fontSize: 20, margin: '4px 0 8px' }}>{c.label} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>· {c.rows.length} items</span></h2>
          <div className="card table-wrap">
            <table style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th rowSpan={2} style={{ position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 }}>Ingredient</th>
                  {months.map((mk) => <th key={mk} colSpan={2} className="num" style={{ textAlign: 'center' }}>{label(mk)}</th>)}
                  <th colSpan={2} className="num" style={{ textAlign: 'center' }}>Baseline ({baseLabel})</th>
                  <th colSpan={2} className="num" style={{ textAlign: 'center' }}>Change in {label(m3)}</th>
                  <th colSpan={4} className="num" style={{ textAlign: 'center' }}>Effect on spend (₹)</th>
                </tr>
                <tr>
                  {[...months, 'base'].map((mk) => (<Fragment key={mk}><th className="num">Qty</th><th className="num">Rate</th></Fragment>))}
                  <th className="num">Qty</th><th className="num">Rate</th>
                  <th className="num">Quantity</th><th className="num">Price</th><th className="num">Total</th><th className="num">%</th>
                </tr>
              </thead>
              <tbody>
                {c.rows.length === 0 ? (
                  <tr><td colSpan={COLS} className="empty">Nothing to show for these months / filters.</td></tr>
                ) : c.rows.map((r) => (
                  <tr key={r.key}>
                    <td style={{ fontWeight: 600, position: 'sticky', left: 0, background: 'var(--card)' }}>
                      {r.name} <span className="muted" style={{ fontWeight: 400 }}>/{r.unit}</span>{mergedChip(r)}
                      {r.status === 'new' && <span className="chip unpaid" style={{ marginLeft: 6 }}>new</span>}
                      {r.status === 'stopped' && <span className="chip" style={{ marginLeft: 6, background: 'var(--paper-2)' }}>not bought</span>}
                    </td>
                    {r.months.map((m, i) => (<Fragment key={i}><td className="num">{m.qty ? qty(m.qty) : '—'}</td><td className="num muted">{m.qty ? inr(m.rate) : '—'}</td></Fragment>))}
                    <td className="num">{r.baseQty ? qty(r.baseQty) : '—'}</td>
                    <td className="num muted">{r.baseQty ? inr(r.baseRate) : '—'}</td>
                    <td className="num" style={{ color: tone(r.qtyEffect) }}>{pct(r.qtyPct)}</td>
                    <td className="num" style={{ color: tone(r.priceEffect) }}>{pct(r.ratePct)}</td>
                    <td className="num" style={{ color: tone(r.qtyEffect) }}>{money(r.qtyEffect)}</td>
                    <td className="num" style={{ color: tone(r.priceEffect) }}>{money(r.priceEffect)}</td>
                    <td className="num" style={{ fontWeight: 700, color: tone(r.variance) }}>{money(r.variance)}</td>
                    <td className="num" style={{ color: tone(r.variance) }}>{pct(r.variancePct)}</td>
                  </tr>
                ))}
              </tbody>
              {c.rows.length > 0 && (
                <tfoot>
                  <tr style={{ background: 'var(--paper-2)', fontWeight: 700 }}>
                    <td style={{ padding: '12px 14px' }}>{c.label} total</td>
                    <td colSpan={6} className="num muted" style={{ fontWeight: 400 }}>
                      spend: {c.tot.monthAmounts.map((a, i) => `${label(months[i])} ${inr(a, 0)}`).join(' · ')}
                    </td>
                    <td colSpan={2} className="num">{inr(c.tot.baseAmt, 0)} / mo</td>
                    <td colSpan={2} />
                    <td className="num" style={{ color: tone(c.tot.qtyEffect) }}>{money(c.tot.qtyEffect)}</td>
                    <td className="num" style={{ color: tone(c.tot.priceEffect) }}>{money(c.tot.priceEffect)}</td>
                    <td className="num" style={{ color: tone(c.tot.variance) }}>{money(c.tot.variance)}</td>
                    <td className="num" style={{ color: tone(c.tot.variance) }}>{pct(c.tot.variancePct)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      ))}

      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
        <b>How to read this.</b> Baseline = average monthly quantity of the two earlier months, at their quantity-weighted average rate. Variance = {prettyMonth(m3)} spend minus baseline spend; red = spent more, green = spent less.
        {' '}<b>Quantity effect</b> shows how much of the change is simply buying more or less; <b>Price effect</b> shows how much is paying more or less per unit — together they add up exactly to the total. Rates include GST. Draft bills are excluded.
        {others > 0 && ` ${others} item(s) in other categories are not shown.`}
      </div>
    </>
  );
}

/* ---------- Renamed / rebranded items: tell the report two names are one product ---------- */
function RenamePanel({ pairs, items, nameOf, onAdd, onRemove, hint, busy }) {
  const [open, setOpen] = useState(false);
  const [oldK, setOldK] = useState('');
  const [newK, setNewK] = useState('');
  const o = items.find((i) => i.key === oldK);
  const n = items.find((i) => i.key === newK);
  const unitWarn = o && n && o.unit !== n.unit;
  const tag = (r) => (r.status === 'stopped' ? ' · not bought this month' : r.status === 'new' ? ' · new this month' : '');
  const opt = (r) => <option key={r.key} value={r.key}>{nameOf(r)} /{r.unit}{tag(r)}</option>;
  return (
    <div className="card card-pad" style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, cursor: 'pointer', flexWrap: 'wrap' }} onClick={() => setOpen(!open)}>
        <b>Renamed / rebranded items</b>
        <span className="muted" style={{ fontSize: 13 }}>
          {pairs.length ? `${pairs.length} combined` : 'none combined yet'}{hint && !pairs.length ? ' · some items may need matching' : ''} {open ? '▲' : '▼'}
        </span>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
            If a product changed its name or brand, the old name shows as “not bought” and the new name as “new”, which hides the real variance.
            Pick the <b>old name</b> and the <b>new name</b> below to treat them as one item — quantities and amounts are added together under the new name.
            Your bills and ingredient list are not changed.
          </div>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <div className="field" style={{ flex: 1 }}><label>Old name</label>
              <select value={oldK} onChange={(e) => setOldK(e.target.value)}>
                <option value="">— choose —</option>
                {items.map(opt)}
              </select></div>
            <div className="field" style={{ flex: 1 }}><label>New name (kept)</label>
              <select value={newK} onChange={(e) => setNewK(e.target.value)}>
                <option value="">— choose —</option>
                {items.filter((i) => i.key !== oldK).map(opt)}
              </select></div>
            <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-end' }} disabled={!o || !n || busy}
              onClick={() => { onAdd(o, n); setOldK(''); setNewK(''); }}>Treat as same item</button>
          </div>
          {unitWarn && <div style={{ fontSize: 12.5, color: 'var(--terracotta, #b4432a)', marginBottom: 8 }}>⚠ Units differ ({o.unit} vs {n.unit}) — only combine if the quantities are in the same unit.</div>}
          {pairs.length > 0 && (
            <table style={{ fontSize: 13 }}>
              <tbody>
                {pairs.map((p) => (
                  <tr key={p.fromKey + '>' + p.toKey}>
                    <td>{p.fromName} <span className="muted">→</span> <b>{p.toName}</b></td>
                    <td style={{ width: 1 }}><button className="btn btn-danger btn-sm" disabled={busy} onClick={() => onRemove(p)}>Undo</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
