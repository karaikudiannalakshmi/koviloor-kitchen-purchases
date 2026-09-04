import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  billsForMonth, billsInRange, groupByVendor, deleteBill, unpaidBills, markBillPaid, markBillsPaid, listVendors, draftBills,
} from '../lib/db';
import { Cat } from '../components/Cat';
import { useCategories } from '../contexts/CategoriesContext';
import PrintSheet from '../components/PrintSheet';
import ReportActions from '../components/ReportActions';
import { inr, qty, prettyDate, prettyMonth, currentMonthKey, todayISO } from '../lib/format';

const isUnpaid = (b) => b.paid === false;
const isDraft = (b) => b.status === 'draft';

export default function BillsLedger() {
  const [params] = useSearchParams();
  const [view, setView] = useState(params.get('view') === 'drafts' ? 'drafts' : 'month'); // month | day | drafts | unpaid
  const nav = useNavigate();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bills Ledger</h1>
          <div className="sub">Purchases by vendor · drafts · settlement</div>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="pay-toggle">
            <button className={view === 'month' ? 'on' : ''} style={view === 'month' ? { background: 'var(--turmeric)' } : null} onClick={() => setView('month')}>By month</button>
            <button className={view === 'day' ? 'on' : ''} style={view === 'day' ? { background: 'var(--turmeric)' } : null} onClick={() => setView('day')}>By day</button>
            <button className={view === 'drafts' ? 'on' : ''} style={view === 'drafts' ? { background: 'var(--turmeric)' } : null} onClick={() => setView('drafts')}>Drafts</button>
            <button className={view === 'unpaid' ? 'on unpaid' : ''} onClick={() => setView('unpaid')}>Unpaid (settlement)</button>
          </div>
          <button className="btn btn-primary" onClick={() => nav('/bills/new')}>＋ New bill</button>
        </div>
      </div>
      {view === 'month' ? <MonthView setView={setView} /> : view === 'day' ? <DayView setView={setView} /> : view === 'drafts' ? <DraftsView /> : <UnpaidView />}
    </>
  );
}

/* ---------------- By-month vendor accordion ---------------- */
function MonthView({ setView }) {
  const nav = useNavigate();
  const cats = useCategories();
  const [params] = useSearchParams();
  const [month, setMonth] = useState(params.get('month') || currentMonthKey());
  const [sel, setSel] = useState(() => new Set());
  const [printMode, setPrintMode] = useState(null); // { scope:'all'|'selected', kind:'combined'|'individual' }
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openVendor, setOpenVendor] = useState({});
  const [openBill, setOpenBill] = useState({});
  const [totals, setTotals] = useState({ amount: 0, bills: 0 });
  const [draftCount, setDraftCount] = useState(0);

  async function load() {
    setLoading(true);
    const all = await billsForMonth(month);
    const bills = all.filter((b) => !isDraft(b)); // priced bills only in reports
    setDraftCount(all.length - bills.length);
    const g = groupByVendor(bills);
    setGroups(g);
    setTotals({ amount: bills.reduce((s, b) => s + (Number(b.totalAmount) || 0), 0), bills: bills.length });
    setOpenVendor(g[0] ? { [g[0].vendorId || g[0].vendorName]: true } : {});
    setOpenBill({});
    setLoading(false);
  }
  useEffect(() => { load(); }, [month]);

  function buildExport() {
    const billRows = [];
    const itemRows = [];
    groups.forEach((g) => g.bills.forEach((b) => {
      billRows.push({
        vendor: g.vendorName, billNo: b.billNo || '', date: prettyDate(b.billDate),
        items: (b.items || []).length, subtotal: Number(b.subtotal ?? b.totalAmount) || 0,
        gst: Number(b.gstTotal) || 0, total: Number(b.totalAmount) || 0,
        status: b.paid === false ? 'Unpaid' : 'Paid', paidOn: b.paid === false ? '' : prettyDate(b.paidDate),
      });
      (b.items || []).forEach((it) => itemRows.push({
        date: prettyDate(b.billDate), vendor: g.vendorName, billNo: b.billNo || '',
        item: it.name, category: cats.name(it.category), qty: Number(it.qty) || 0, unit: it.unit,
        rate: Number(it.rate) || 0, gstPct: it.gstPct || 0, amount: Number(it.amount) || 0,
        gross: Number(it.gross ?? it.amount) || 0,
      }));
    }));
    return {
      sheets: [
        { name: 'Line items (detailed)', columns: [
          { header: 'Date', key: 'date' }, { header: 'Vendor', key: 'vendor' }, { header: 'Bill No', key: 'billNo' },
          { header: 'Item', key: 'item' }, { header: 'Category', key: 'category' }, { header: 'Qty', key: 'qty' },
          { header: 'Unit', key: 'unit' }, { header: 'Rate', key: 'rate' }, { header: 'GST %', key: 'gstPct' },
          { header: 'Taxable', key: 'amount' }, { header: 'Amount', key: 'gross' },
        ], rows: itemRows },
        { name: 'Bill summary', columns: [
          { header: 'Vendor', key: 'vendor' }, { header: 'Bill No', key: 'billNo' }, { header: 'Date', key: 'date' },
          { header: 'Items', key: 'items' }, { header: 'Subtotal', key: 'subtotal' }, { header: 'GST', key: 'gst' },
          { header: 'Total', key: 'total' }, { header: 'Status', key: 'status' }, { header: 'Paid On', key: 'paidOn' },
        ], rows: billRows },
      ],
    };
  }

  // Vendor summary (one row per vendor) for the certified ledger — print & PDF. Works on any subset.
  function vendorSummary(gs) {
    const sorted = [...gs].sort((a, b) => a.vendorName.localeCompare(b.vendorName));
    const rows = sorted.map((g) => {
      const catNames = [...new Set((g.bills || []).flatMap((b) => (b.items || []).map((it) => cats.name(it.category))))];
      return {
        vendor: g.vendorName,
        category: catNames.join(', ') || '—',
        bills: g.billCount,
        amount: inr(g.totalAmount),
      };
    });
    const columns = [
      { header: 'Vendor / Party', key: 'vendor' },
      { header: 'Category', key: 'category' },
      { header: 'Bills', key: 'bills', align: 'right' },
      { header: 'Amount (₹)', key: 'amount', align: 'right' },
    ];
    const sumBills = sorted.reduce((s, g) => s + g.billCount, 0);
    const sumAmt = sorted.reduce((s, g) => s + g.totalAmount, 0);
    const total = { vendor: 'TOTAL BILLS', category: '', bills: sumBills, amount: inr(sumAmt) };
    return { columns, rows, total };
  }

  // Date-wise bills under each vendor for the certified ledger detail section. Works on any subset.
  function vendorDetail(gs) {
    const sorted = [...gs].sort((a, b) => a.vendorName.localeCompare(b.vendorName));
    const columns = [
      { header: 'Date', key: 'date' },
      { header: 'Bill No', key: 'billNo' },
      { header: 'Items', key: 'items', align: 'right' },
      { header: 'Amount (₹)', key: 'amount', align: 'right' },
    ];
    const detailGroups = sorted.map((g) => ({
      vendor: g.vendorName,
      rows: [...g.bills]
        .sort((a, b) => (a.billDate < b.billDate ? -1 : 1))
        .map((b) => ({
          date: prettyDate(b.billDate),
          billNo: b.billNo || '—',
          items: (b.items || []).length,
          amount: inr(b.totalAmount),
        })),
      total: { date: 'Subtotal', billNo: '', items: '', amount: inr(g.totalAmount) },
    }));
    return { columns, groups: detailGroups };
  }

  async function settle(b, e) {
    e.stopPropagation();
    await markBillPaid(b.id, todayISO());
    load();
  }
  async function remove(b, e) {
    e.stopPropagation();
    if (!confirm(`Delete bill ${b.billNo || ''} (${prettyDate(b.billDate)})?`)) return;
    await deleteBill(b.id);
    load();
  }

  const selectedGroups = groups.filter((g) => sel.has(g.vendorName));
  const individualGroups = sel.size ? selectedGroups : groups;
  const combinedGroups = printMode?.scope === 'selected' ? selectedGroups : groups;
  const cSummary = vendorSummary(combinedGroups);

  function toggleSel(name) {
    setSel((prev) => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  }
  const allSelected = groups.length > 0 && sel.size === groups.length;
  function selectAll() { setSel(new Set(groups.map((g) => g.vendorName))); }
  function selectNone() { setSel(new Set()); }

  useEffect(() => {
    if (!printMode) return undefined;
    const cls = printMode.kind === 'individual' ? 'printing-individual' : 'printing-certified';
    const t = setTimeout(async () => {
      const { printCertified } = await import('../lib/exporters');
      printCertified(cls);
      setPrintMode(null);
    }, 60);
    return () => clearTimeout(t);
  }, [printMode]);

  async function doExcel() {
    const { exportExcel } = await import('../lib/exporters');
    exportExcel(`koviloor-bills-${month}`, buildExport().sheets);
  }
  async function doPDF() {
    const { exportElementPDF } = await import('../lib/exporters');
    await exportElementPDF(document.getElementById('ps-bills'), `koviloor-bills-${month}`);
  }

  // ---- single bill: print one bill as an itemised voucher, or export just its items ----
  const [oneBill, setOneBill] = useState(null); // { bill, vendorName }
  useEffect(() => {
    if (!oneBill) return undefined;
    const t = setTimeout(async () => {
      const { printCertified } = await import('../lib/exporters');
      printCertified('printing-onebill');
      setOneBill(null);
    }, 60);
    return () => clearTimeout(t);
  }, [oneBill]);
  function printBill(bill, vendorName) { setOneBill({ bill, vendorName }); }
  async function exportBill(bill, vendorName) {
    const { exportExcel } = await import('../lib/exporters');
    const rows = (bill.items || []).map((it) => {
      const q = Number(it.qty) || 0; const gross = Number(it.gross ?? it.amount) || 0;
      const rate = it.effRate != null ? Number(it.effRate) : (q > 0 ? gross / q : Number(it.rate) || 0);
      return { item: it.name || it.freeText || '', category: cats.name(it.category), qty: q, unit: it.unit || '', rate: Math.round(rate * 100) / 100, gstPct: it.gstPct || 0, amount: Math.round(gross * 100) / 100 };
    });
    exportExcel(`bill-${(bill.billNo || 'nobillno')}-${vendorName}`.replace(/[^\w-]/g, '_'), [{
      name: 'Bill items',
      columns: [
        { header: 'Item', key: 'item' }, { header: 'Category', key: 'category' }, { header: 'Qty', key: 'qty' },
        { header: 'Unit', key: 'unit' }, { header: 'Rate', key: 'rate' }, { header: 'GST %', key: 'gstPct' }, { header: 'Amount', key: 'amount' },
      ],
      rows,
    }]);
  }
  const oneBillGroups = oneBill ? buildBillwise([{ vendorName: oneBill.vendorName, totalAmount: oneBill.bill.totalAmount, bills: [oneBill.bill] }]) : [];

  return (
    <>
      <PrintSheet id="ps-bills" title={printMode?.scope === 'selected' ? 'Purchase Bills — Selected Vendors' : 'Certified Purchase Bills'} period={prettyMonth(month)} columns={cSummary.columns} rows={cSummary.rows} total={cSummary.total} note="Abstract on the first page; each vendor's itemised bills follow, one vendor per page." billGroups={buildBillwise(combinedGroups)} billwiseLabel="Vendor-wise Bills (itemised)" />

      <div className="print-individual-wrap">
        {individualGroups.map((g, i) => {
          const sv = vendorSummary([g]);
          return <PrintSheet key={g.vendorName} id={`ps-vendor-${i}`} title="Vendor Bill Statement" period={`${prettyMonth(month)} · ${g.vendorName}`} columns={sv.columns} rows={sv.rows} total={sv.total} billGroups={buildBillwise([g])} billwiseLabel="Bills (itemised)" />;
        })}
      </div>

      <div className="page-head" style={{ marginBottom: 18 }}>
        <div className="sub">{prettyMonth(month)} · {totals.bills} bills · {inr(totals.amount)}</div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="report-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setPrintMode({ scope: 'all', kind: 'combined' })} disabled={loading || groups.length === 0}>🖨 Print all</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setPrintMode({ scope: 'selected', kind: 'combined' })} disabled={sel.size === 0} title="One sheet with only the ticked vendors">🖨 Print selected ({sel.size})</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setPrintMode({ scope: 'selected', kind: 'individual' })} disabled={sel.size === 0} title="A separate sheet per ticked vendor">🖨 Each separately</button>
            <button className="btn btn-ghost btn-sm" onClick={doExcel} disabled={loading || groups.length === 0}>⤓ Excel</button>
            <button className="btn btn-ghost btn-sm" onClick={doPDF} disabled={loading || groups.length === 0}>⤓ PDF</button>
          </div>
          <div className="field"><label>Month</label><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
        </div>
      </div>

      {draftCount > 0 && (
        <div className="flash" style={{ marginBottom: 14, background: '#fff3da', borderColor: '#eccfa0', color: '#a96c12', cursor: 'pointer' }} onClick={() => setView('drafts')}>
          🗒 {draftCount} draft{draftCount === 1 ? '' : 's'} this month awaiting pricing — click to open Drafts and add rates.
        </div>
      )}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="card"><div className="empty">No bills entered for {prettyMonth(month)}.</div></div>
      ) : (
        <>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>Tick vendors to print only those (individually or together). {sel.size > 0 ? `${sel.size} selected.` : ''}</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="btn-link" type="button" onClick={selectAll} disabled={allSelected} style={{ fontSize: 13 }}>Select all</button>
              <button className="btn-link" type="button" onClick={selectNone} disabled={sel.size === 0} style={{ fontSize: 13 }}>Clear</button>
            </span>
          </div>
      <div className="print-onebill-wrap">
        {oneBill && (
          <PrintSheet id="ps-onebill" title={`Bill ${oneBill.bill.billNo || ''}`} period={`${oneBill.vendorName} · ${prettyDate(oneBill.bill.billDate)}`} rows={[]} billGroups={oneBillGroups} billwiseLabel="" />
        )}
      </div>

          <VendorLedger groups={groups} openBill={openBill} setOpenBill={setOpenBill} settle={settle} remove={remove} nav={nav} selectable sel={sel} onToggleSel={toggleSel} onPrintBill={printBill} onExportBill={exportBill} />
        </>
      )}
    </>
  );
}

// Helper so we can return two sibling <tr> from a map without an extra wrapper element.
function FragmentRow({ children }) {
  return <>{children}</>;
}

// Reusable per-vendor ledger table (used by month & day views).
// ---- shared: per-vendor, per-bill itemised detail for printing ----
function buildBillwise(gs) {
  return [...gs].sort((a, b) => a.vendorName.localeCompare(b.vendorName)).map((g) => ({
    vendor: g.vendorName,
    vendorTotal: inr(g.totalAmount),
    bills: [...g.bills].sort((a, b) => (a.billDate < b.billDate ? -1 : 1)).map((b) => ({
      billNo: b.billNo || '—',
      date: prettyDate(b.billDate),
      total: inr(b.totalAmount),
      items: (b.items || []).map((it) => {
        const q = Number(it.qty) || 0;
        const gross = Number(it.gross ?? it.amount) || 0;
        const rate = it.effRate != null ? Number(it.effRate) : (q > 0 ? gross / q : Number(it.rate) || 0);
        return { name: it.name || it.freeText || '—', qty: q ? qty(q) : '', unit: it.unit || '', rate: inr(rate), amount: inr(gross) };
      }),
    })),
  }));
}

function VendorLedger({ groups, openBill, setOpenBill, settle, remove, nav, selectable, sel, onToggleSel, onPrintBill, onExportBill }) {
  return groups.map((g) => {
    const vKey = g.vendorId || g.vendorName;
    const unpaidAmt = g.bills.filter(isUnpaid).reduce((s, b) => s + (Number(b.totalAmount) || 0), 0);
    const ledgerBills = [...g.bills].sort((a, b) => (a.billDate < b.billDate ? -1 : 1));
    return (
      <div className="ledger-block" key={vKey}>
        <div className="ledger-vhead">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {selectable && (
              <input type="checkbox" checked={sel?.has(g.vendorName) || false} onChange={() => onToggleSel(g.vendorName)} title="Include this vendor when printing selected" style={{ width: 16, height: 16 }} />
            )}
            {g.vendorName}
          </h3>
          <div className="ledger-vmeta">
            {unpaidAmt > 0 && <span className="unpaid-amt">{inr(unpaidAmt)} unpaid</span>}
            <span className="muted">{g.billCount} bill{g.billCount > 1 ? 's' : ''}</span>
          </div>
        </div>

        <div className="card table-wrap">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th><th>Bill No</th><th className="num">Items</th><th>Status</th><th className="num">Amount</th><th style={{ width: 1 }} />
              </tr>
            </thead>
            <tbody>
              {ledgerBills.map((b) => {
                const bOpen = !!openBill[b.id];
                const up = isUnpaid(b);
                return (
                  <FragmentRow key={b.id}>
                    <tr className="ledger-row" onClick={() => setOpenBill((p) => ({ ...p, [b.id]: !p[b.id] }))}>
                      <td>{prettyDate(b.billDate)}</td>
                      <td className="muted">{b.billNo || '—'}</td>
                      <td className="num">{(b.items || []).length}</td>
                      <td>
                        <span className={`chip ${up ? 'unpaid' : 'paid'}`}>{up ? 'Unpaid' : 'Paid'}</span>
                        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={(e) => { e.stopPropagation(); nav(`/bills/${b.id}/edit`); }}>Edit</button>
                        {up && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={(e) => settle(b, e)}>Mark paid</button>}
                      </td>
                      <td className="num" style={{ fontWeight: 600 }}>{inr(b.totalAmount)}</td>
                      <td className="num"><span className={`chev ${bOpen ? 'open' : ''}`}>▶</span></td>
                    </tr>
                    {bOpen && (
                      <tr className="ledger-detail">
                        <td colSpan={6}>
                          <table className="inner">
                            <thead>
                              <tr><th>Item</th><th>Cat</th><th className="num">Qty</th><th>Unit</th><th className="num">Rate</th><th className="num">GST</th><th className="num">Amount</th></tr>
                            </thead>
                            <tbody>
                              {(b.items || []).map((it, i) => (
                                <tr key={i}>
                                  <td style={{ fontWeight: 500 }}>{it.name}</td>
                                  <td><Cat k={it.category} dot /></td>
                                  <td className="num">{qty(it.qty)}</td>
                                  <td className="muted">{it.unit}</td>
                                  <td className="num">{inr(it.rate)}</td>
                                  <td className="num muted">{it.gstPct ? `${it.gstPct}%` : '—'}</td>
                                  <td className="num">{inr(it.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="muted" style={{ fontSize: 13, marginTop: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                            {b.gstTotal > 0 && <span>Subtotal {inr(b.subtotal)} · GST {inr(b.gstTotal)}</span>}
                            <span>{up ? 'Outstanding' : `Paid on ${prettyDate(b.paidDate) || '—'}`}</span>
                            {b.notes && <span>📝 {b.notes}</span>}
                            <span className="bill-spacer" />
                            {onPrintBill && <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onPrintBill(b, g.vendorName); }}>🖨 Print bill</button>}
                            {onExportBill && <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onExportBill(b, g.vendorName); }}>⤓ Excel</button>}
                            <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); nav(`/bills/${b.id}/edit`); }}>Edit</button>
                            <button className="btn btn-danger btn-sm" onClick={(e) => remove(b, e)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="ledger-total">
                <td colSpan={4}>Total — {g.vendorName}</td>
                <td className="num">{inr(g.totalAmount)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  });
}

/* ---------------- By-day view (verification & reconciliation) ---------------- */
function DayView({ setView }) {
  const nav = useNavigate();
  const cats = useCategories();
  const [date, setDate] = useState(todayISO());
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openBill, setOpenBill] = useState({});
  const [totals, setTotals] = useState({ amount: 0, bills: 0 });
  const [draftCount, setDraftCount] = useState(0);

  async function load() {
    setLoading(true);
    const all = await billsInRange(date, date);
    const bills = all.filter((b) => !isDraft(b));
    setDraftCount(all.length - bills.length);
    const g = groupByVendor(bills);
    setGroups(g);
    setTotals({ amount: bills.reduce((s, b) => s + (Number(b.totalAmount) || 0), 0), bills: bills.length });
    setOpenBill({});
    setLoading(false);
  }
  useEffect(() => { load(); }, [date]);

  async function settle(b, e) { e.stopPropagation(); await markBillPaid(b.id, todayISO()); load(); }
  async function remove(b, e) {
    e.stopPropagation();
    if (!confirm(`Delete bill ${b.billNo || ''} (${prettyDate(b.billDate)})?`)) return;
    await deleteBill(b.id); load();
  }

  // Abstract: per-vendor summary for the day.
  function vendorSummary() {
    const sorted = [...groups].sort((a, b) => a.vendorName.localeCompare(b.vendorName));
    const rows = sorted.map((g) => {
      const catNames = [...new Set((g.bills || []).flatMap((b) => (b.items || []).map((it) => cats.name(it.category))))];
      return { vendor: g.vendorName, category: catNames.join(', ') || '—', bills: g.billCount, amount: inr(g.totalAmount) };
    });
    const columns = [
      { header: 'Vendor / Party', key: 'vendor' }, { header: 'Category', key: 'category' },
      { header: 'Bills', key: 'bills', align: 'right' }, { header: 'Amount (₹)', key: 'amount', align: 'right' },
    ];
    const total = { vendor: 'TOTAL FOR DAY', category: '', bills: totals.bills, amount: inr(totals.amount) };
    return { columns, rows, total };
  }

  // Detail: each bill as a block with its item lines, for ticking against physical bills.
  function billDetail() {
    const columns = [
      { header: 'Item', key: 'item' }, { header: 'Category', key: 'cat' },
      { header: 'Qty', key: 'qty', align: 'right' }, { header: 'Rate', key: 'rate', align: 'right' }, { header: 'Amount (₹)', key: 'amount', align: 'right' },
    ];
    const all = [];
    [...groups].sort((a, b) => a.vendorName.localeCompare(b.vendorName))
      .forEach((g) => g.bills.forEach((b) => all.push({ ...b, _vendor: g.vendorName })));
    const dgroups = all.map((b) => ({
      vendor: `${b._vendor}${b.billNo ? `  ·  Bill ${b.billNo}` : ''}  ·  ${b.paid === false ? 'Unpaid' : 'Paid'}`,
      rows: (b.items || []).map((it) => ({
        item: it.name, cat: cats.name(it.category), qty: `${qty(it.qty)} ${it.unit}`, rate: inr(it.rate), amount: inr(it.amount),
      })),
      total: { item: 'Bill total', cat: '', qty: '', rate: '', amount: inr(b.totalAmount) },
    }));
    return { columns, groups: dgroups };
  }

  function excelSheets() {
    const billRows = []; const itemRows = [];
    groups.forEach((g) => g.bills.forEach((b) => {
      billRows.push({ vendor: g.vendorName, billNo: b.billNo || '', items: (b.items || []).length, total: Number(b.totalAmount) || 0, status: b.paid === false ? 'Unpaid' : 'Paid' });
      (b.items || []).forEach((it) => itemRows.push({ vendor: g.vendorName, billNo: b.billNo || '', item: it.name, category: cats.name(it.category), qty: Number(it.qty) || 0, unit: it.unit, rate: Number(it.rate) || 0, amount: Number(it.amount) || 0 }));
    }));
    return [
      { name: 'Bills', columns: [{ header: 'Vendor', key: 'vendor' }, { header: 'Bill No', key: 'billNo' }, { header: 'Items', key: 'items' }, { header: 'Total', key: 'total' }, { header: 'Status', key: 'status' }], rows: billRows },
      { name: 'Item detail', columns: [{ header: 'Vendor', key: 'vendor' }, { header: 'Bill No', key: 'billNo' }, { header: 'Item', key: 'item' }, { header: 'Category', key: 'category' }, { header: 'Qty', key: 'qty' }, { header: 'Unit', key: 'unit' }, { header: 'Rate', key: 'rate' }, { header: 'Amount', key: 'amount' }], rows: itemRows },
    ];
  }

  const summary = vendorSummary();

  return (
    <>
      <PrintSheet id="ps-day" title="Daily Purchase Verification" period={prettyDate(date)} columns={summary.columns} rows={summary.rows} total={summary.total} detail={billDetail()} detailLabel="Bill-wise Detail (items)" note="Tick each item against the physical bill for the day's reconciliation." />

      <div className="page-head" style={{ marginBottom: 18 }}>
        <div className="sub">{prettyDate(date)} · {totals.bills} bill{totals.bills === 1 ? '' : 's'} · {inr(totals.amount)}</div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <ReportActions filename={`KAL-bills-day-${date}`} printSheetId="ps-day" excelSheets={excelSheets()} disabled={loading || groups.length === 0} />
          <div className="field"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
      </div>

      {draftCount > 0 && (
        <div className="flash" style={{ marginBottom: 14, background: '#fff3da', borderColor: '#eccfa0', color: '#a96c12', cursor: 'pointer' }} onClick={() => setView('drafts')}>
          🗒 {draftCount} draft{draftCount === 1 ? '' : 's'} on this day awaiting pricing — click to open Drafts.
        </div>
      )}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="card"><div className="empty">No bills entered for {prettyDate(date)}.</div></div>
      ) : (
        <VendorLedger groups={groups} openBill={openBill} setOpenBill={setOpenBill} settle={settle} remove={remove} nav={nav} />
      )}
    </>
  );
}

/* ---------------- Drafts (shopping lists awaiting pricing) ---------------- */
function DraftsView() {
  const nav = useNavigate();
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() { setLoading(true); setDrafts(await draftBills()); setLoading(false); }
  useEffect(() => { load(); }, []);

  async function remove(b) {
    if (!confirm(`Delete draft for ${b.vendorName} (${prettyDate(b.billDate)})?`)) return;
    await deleteBill(b.id); load();
  }

  const byDate = useMemo(() => {
    const m = new Map();
    drafts.forEach((b) => { const k = b.billDate; if (!m.has(k)) m.set(k, []); m.get(k).push(b); });
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [drafts]);

  if (loading) return <div className="empty">Loading drafts…</div>;
  if (drafts.length === 0) {
    return <div className="card"><div className="empty">No drafts. On a new bill, capture the shopping list and choose <b>“Save as draft”</b> — then come back here to add rates.</div></div>;
  }

  return (
    <>
      <div className="page-head" style={{ marginBottom: 14 }}>
        <div className="sub">{drafts.length} draft{drafts.length === 1 ? '' : 's'} awaiting pricing · add rates, then “Save bill” to finalise</div>
      </div>
      {byDate.map(([date, list]) => (
        <div className="ledger-block" key={date}>
          <div className="ledger-vhead"><h3>{prettyDate(date)}</h3><span className="muted">{list.length} draft{list.length === 1 ? '' : 's'}</span></div>
          <div className="card table-wrap">
            <table className="ledger-table">
              <thead><tr><th>Vendor</th><th className="num">Items</th><th className="num">Total Qty</th><th>Status</th><th style={{ width: 1 }} /></tr></thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600 }}>
                      {b.vendorName}
                      {b.flag && <span title={b.flagReason || 'Check this bill'} style={{ marginLeft: 6, cursor: 'help' }}>⚠️</span>}
                      {b.aiNote && <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>{b.aiNote}</div>}
                      {b.flag && b.flagReason && <div style={{ fontSize: 11, color: '#a96c12' }}>{b.flagReason}</div>}
                    </td>
                    <td className="num">{(b.items || []).length}</td>
                    <td className="num">{qty(b.totalQty)}</td>
                    <td><span className="chip" style={{ background: '#fff3da', color: '#a96c12' }}>Draft</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-primary btn-sm" onClick={() => nav(`/bills/${b.id}/edit`)}>Add rates →</button>{' '}
                      <button className="btn btn-danger btn-sm" onClick={() => remove(b)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

/* ---------------- Unpaid settlement view (all time) ---------------- */
function UnpaidView() {
  const nav = useNavigate();
  const [groups, setGroups] = useState([]);
  const [vendorsById, setVendorsById] = useState({});
  const [loading, setLoading] = useState(true);
  const [openVendor, setOpenVendor] = useState({});
  const [busy, setBusy] = useState(false);
  const [selBills, setSelBills] = useState(() => new Set());
  const [payDate, setPayDate] = useState(todayISO());
  const [debitAcct, setDebitAcct] = useState(() => { try { return localStorage.getItem('kal_debit_account') || ''; } catch { return ''; } });
  const [neftDebitAcct, setNeftDebitAcct] = useState(() => { try { return localStorage.getItem('kal_neft_debit_account') || ''; } catch { return ''; } });
  function saveNeftDebit(v) { const s = v.replace(/[^0-9]/g, '').slice(0, 20); setNeftDebitAcct(s); try { localStorage.setItem('kal_neft_debit_account', s); } catch {} }
  function saveDebit(v) {
    const d = String(v).replace(/[^0-9]/g, '').slice(0, 12);
    setDebitAcct(d);
    try { localStorage.setItem('kal_debit_account', d); } catch { /* ignore */ }
  }

  async function load() {
    setLoading(true);
    const [bills, vendors] = await Promise.all([unpaidBills(), listVendors()]);
    const g = groupByVendor(bills);
    setGroups(g);
    setVendorsById(Object.fromEntries(vendors.map((v) => [v.id, v])));
    setOpenVendor(Object.fromEntries(g.map((x) => [x.vendorId || x.vendorName, true]))); // open all
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const grand = useMemo(() => groups.reduce((s, g) => s + g.totalAmount, 0), [groups]);

  async function settleBill(id) { setBusy(true); await markBillPaid(id, todayISO()); await load(); setBusy(false); }

  // ---- bulk selection ----
  const allBillIds = useMemo(() => groups.flatMap((g) => g.bills.map((b) => b.id)), [groups]);
  function toggleBill(id) { setSelBills((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function toggleVendor(g, e) {
    if (e) e.stopPropagation();
    const ids = g.bills.map((b) => b.id);
    const allIn = ids.every((id) => selBills.has(id));
    setSelBills((p) => { const n = new Set(p); ids.forEach((id) => (allIn ? n.delete(id) : n.add(id))); return n; });
  }
  function selectAllBills() { setSelBills(new Set(allBillIds)); }
  function clearSel() { setSelBills(new Set()); }
  const selTotal = useMemo(() => groups.flatMap((g) => g.bills).filter((b) => selBills.has(b.id)).reduce((s, b) => s + (Number(b.totalAmount) || 0), 0), [groups, selBills]);
  async function markSelectedPaid() {
    if (selBills.size === 0) return;
    if (!confirm(`Mark ${selBills.size} selected bill(s) as paid on ${prettyDate(payDate)} (${inr(selTotal)})?`)) return;
    setBusy(true);
    await markBillsPaid([...selBills], payDate);
    clearSel();
    await load();
    setBusy(false);
  }
  async function settleVendor(g) {
    if (!confirm(`Mark all ${g.billCount} outstanding bill(s) from ${g.vendorName} as paid today (${inr(g.totalAmount)})?`)) return;
    setBusy(true);
    await markBillsPaid(g.bills.map((b) => b.id), todayISO());
    await load();
    setBusy(false);
  }

  const ageDays = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso + 'T00:00:00')) / 86400000));

  function buildExport() {
    const rows = [];
    groups.forEach((g) => g.bills.forEach((b) => rows.push({
      vendor: g.vendorName, billNo: b.billNo || '', date: prettyDate(b.billDate),
      age: ageDays(b.billDate), items: (b.items || []).length, amount: Number(b.totalAmount) || 0,
    })));
    return { columns: [
      { header: 'Vendor', key: 'vendor' }, { header: 'Bill No', key: 'billNo' }, { header: 'Date', key: 'date' },
      { header: 'Age (days)', key: 'age', align: 'right' }, { header: 'Items', key: 'items', align: 'right' },
      { header: 'Outstanding', key: 'amount', align: 'right' },
    ], rows };
  }

  // Certified outstanding statement — one row per vendor (for print & PDF).
  function vendorSummary() {
    const sorted = [...groups].sort((a, b) => a.vendorName.localeCompare(b.vendorName));
    const rows = sorted.map((g) => ({
      vendor: g.vendorName,
      bills: g.billCount,
      oldest: g.bills.length ? `${Math.max(...g.bills.map((b) => ageDays(b.billDate)))}d` : '—',
      amount: inr(g.totalAmount),
    }));
    const columns = [
      { header: 'Vendor / Party', key: 'vendor' },
      { header: 'Bills', key: 'bills', align: 'right' },
      { header: 'Oldest', key: 'oldest', align: 'right' },
      { header: 'Outstanding (₹)', key: 'amount', align: 'right' },
    ];
    const total = { vendor: 'TOTAL OUTSTANDING', bills: groups.reduce((s, g) => s + g.billCount, 0), oldest: '', amount: inr(grand) };
    return { columns, rows, total };
  }

  // Per-vendor date-wise outstanding bills — printed one vendor per page after the abstract.
  function unpaidDetail() {
    const sorted = [...groups].sort((a, b) => a.vendorName.localeCompare(b.vendorName));
    const columns = [
      { header: 'Date', key: 'date' },
      { header: 'Bill No', key: 'billNo' },
      { header: 'Age', key: 'age', align: 'right' },
      { header: 'Items', key: 'items', align: 'right' },
      { header: 'Amount (₹)', key: 'amount', align: 'right' },
    ];
    const detailGroups = sorted.map((g) => ({
      vendor: g.vendorName,
      rows: [...g.bills]
        .sort((a, b) => (a.billDate < b.billDate ? -1 : 1))
        .map((b) => ({
          date: prettyDate(b.billDate),
          billNo: b.billNo || '—',
          age: `${ageDays(b.billDate)}d`,
          items: (b.items || []).length,
          amount: inr(b.totalAmount),
        })),
      total: { date: 'Subtotal', billNo: '', age: '', items: '', amount: inr(g.totalAmount) },
    }));
    return { columns, groups: detailGroups };
  }

  // Per-vendor, per-bill itemised detail (like the Annakshetra statement) — one vendor per page.
  function billwiseDetail() {
    const sorted = [...groups].sort((a, b) => a.vendorName.localeCompare(b.vendorName));
    return sorted.map((g) => ({
      vendor: g.vendorName,
      vendorTotal: inr(g.totalAmount),
      bills: [...g.bills].sort((a, b) => (a.billDate < b.billDate ? -1 : 1)).map((b) => ({
        billNo: b.billNo || '—',
        date: prettyDate(b.billDate),
        total: inr(b.totalAmount),
        items: (b.items || []).map((it) => {
          const q = Number(it.qty) || 0;
          const gross = Number(it.gross ?? it.amount) || 0;
          const rate = it.effRate != null ? Number(it.effRate) : (q > 0 ? gross / q : Number(it.rate) || 0);
          return { name: it.name || it.freeText || '—', qty: q ? qty(q) : '', unit: it.unit || '', rate: inr(rate), amount: inr(gross) };
        }),
      })),
    }));
  }

  // ICICI CIB "PRB" payment-file (matches the bank's upload template). Pays by pre-registered
  // Bene ID. Transaction type auto: ICICI beneficiary (IFSC starts ICIC) → WIB, else → NFT.
  async function downloadBankFile() {
    const acct = String(debitAcct || '').replace(/[^0-9]/g, '');
    if (acct.length !== 12) { alert('Enter the 12-digit ICICI debit account (top of the Bank file section) before exporting.'); return; }

    const ready = []; const missing = [];
    [...groups].sort((a, b) => a.vendorName.localeCompare(b.vendorName)).forEach((g) => {
      const v = vendorsById[g.vendorId] || {};
      const bene = String(v.bankBeneId || '').trim();
      if (!bene) { missing.push(g.vendorName); return; }
      const ifsc = String(v.bankIfsc || '').toUpperCase();
      const txn = ifsc.startsWith('ICIC') ? 'WIB' : 'NFT';
      const remarks = `Veg ${new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`.slice(0, 30);
      ready.push([txn, acct, Math.round((Number(g.totalAmount) || 0) * 100) / 100, bene, remarks]);
    });

    if (ready.length === 0) { alert('No vendors have a Bene ID yet. Add the bank-registered Beneficiary ID on the Vendors page first.'); return; }

    const XLSX = await import('xlsx');
    const header = [
      'Transaction type \n(Within Bank (WIB)/\nNEFT (NFT)/\nRTGS (RTG)/\nIMPS (IFC))',
      'Debit Account no\nShould be exactly 12 digit',
      'Amount (₹)\n(Should not be more than 15 digits including decimals and paise)',
      'Bene ID\n(Should be pre-registered in CIB)',
      'Remarks\n(should not be more than 30 characters)',
    ];
    const ws = XLSX.utils.aoa_to_sheet([header, ...ready]);
    ws['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 26 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, 'Koviloor-CIB-payment.xls', { bookType: 'biff8' });

    if (missing.length) alert(`Payment file created for ${ready.length} vendor(s) (${ready.filter((r) => r[0] === 'WIB').length} WIB · ${ready.filter((r) => r[0] === 'NFT').length} NFT).\n\nLeft out — no Bene ID (register in CIB first): ${missing.join(', ')}.`);
  }

  // Excel date serial (days since 1899-12-30) — matches the numeric PYMT_DATE format
  // seen in the bank's own template (e.g. 04-Sep-2026 -> 46269).
  function excelDateSerial(d) {
    const epoch = Date.UTC(1899, 11, 30);
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - epoch) / 86400000);
  }

  async function downloadNeftBankFile() {
    const acct = String(neftDebitAcct || '').replace(/[^0-9]/g, '');
    if (!acct) { alert('Enter the debit account number (Bank file section) before exporting.'); return; }

    const ready = []; const missing = [];
    const paymentDate = excelDateSerial(new Date());
    const narr = `Purchases ${new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
    [...groups].sort((a, b) => a.vendorName.localeCompare(b.vendorName)).forEach((g) => {
      const v = vendorsById[g.vendorId] || {};
      const beneAcct = String(v.bankAccount || '').trim();
      const ifsc = String(v.bankIfsc || '').toUpperCase().trim();
      if (!beneAcct || !ifsc) { missing.push(g.vendorName); return; }
      ready.push([
        'PAB_VENDOR', 'NEFT', acct, g.vendorName, beneAcct, ifsc,
        Math.round((Number(g.totalAmount) || 0) * 100) / 100,
        '', narr, v.phone || '', '', '', paymentDate, '', '', '', '', '', '',
      ]);
    });

    if (ready.length === 0) { alert('No vendors have both a bank account number and IFSC yet. Add these on the Vendors page first.'); return; }

    const XLSX = await import('xlsx');
    const header = [
      'PYMT_PROD_TYPE_CODE', 'PYMT_MODE', 'DEBIT_ACC_NO', 'BNF_NAME', 'BENE_ACC_NO', 'BENE_IFSC',
      'AMOUNT', 'DEBIT_NARR', 'CREDIT_NARR', 'MOBILE_NUM', 'EMAIL_ID', 'REMARK', 'PYMT_DATE', 'REF_NO',
      'ADDL_INFO1', 'ADDL_INFO2', 'ADDL_INFO3', 'ADDL_INFO4', 'ADDL_INFO5',
    ];
    const ws = XLSX.utils.aoa_to_sheet([header, ...ready]);
    ws['!cols'] = header.map((h) => ({ wch: Math.max(12, h.length) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, 'Koviloor-NEFT-payment.xls', { bookType: 'biff8' });

    if (missing.length) alert(`Payment file created for ${ready.length} vendor(s).\n\nLeft out — missing bank account/IFSC (add on Vendors page): ${missing.join(', ')}.`);
  }

  if (loading) return <div className="empty">Loading outstanding bills…</div>;
  if (groups.length === 0) return <div className="card"><div className="empty">🎉 Nothing outstanding — every bill is settled.</div></div>;

  const summary = vendorSummary();
  const b = buildExport();
  const excelSheets = [{ name: 'Outstanding', columns: b.columns, rows: b.rows }];

  return (
    <>
      <PrintSheet id="ps-unpaid" title="Outstanding Bills — Settlement" period={`As on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`} columns={summary.columns} rows={summary.rows} total={summary.total} note="Abstract on the first page; each vendor's itemised bills follow, one vendor per page." billGroups={billwiseDetail()} billwiseLabel="Vendor-wise Bills (itemised)" />

      <div className="page-head" style={{ marginBottom: 12 }}>
        <div className="sub">Outstanding across all months</div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 'none' }}>
            <label>ICICI debit a/c (12 digit)</label>
            <input value={debitAcct} onChange={(e) => saveDebit(e.target.value)} inputMode="numeric" placeholder="012345678901" style={{ width: 150, fontFamily: 'var(--mono)' }} maxLength={12} />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={downloadBankFile} title="ICICI CIB payment file (.xls) for all outstanding vendors">🏦 Bank file (CIB)</button>
          <div className="field" style={{ flex: 'none' }}>
            <label>NEFT debit a/c</label>
            <input value={neftDebitAcct} onChange={(e) => saveNeftDebit(e.target.value)} inputMode="numeric" placeholder="051905001687" style={{ width: 150, fontFamily: 'var(--mono)' }} maxLength={20} />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={downloadNeftBankFile} title="NEFT vendor-payment upload file (.xls) for all outstanding vendors">🏦 Bank file (NEFT)</button>
          <ReportActions filename="koviloor-outstanding" printSheetId="ps-unpaid" excelSheets={excelSheets} />
        </div>
      </div>
      <div className="stats" style={{ marginBottom: 12 }}>
        <div className="stat" style={{ ['--bar']: 'var(--terracotta)' }}>
          <div className="stat-label">Total outstanding</div>
          <div className="stat-value tnum unpaid-amt">{inr(grand)}</div>
          <div className="stat-meta">{groups.length} vendor{groups.length > 1 ? 's' : ''} · {groups.reduce((s, g) => s + g.billCount, 0)} bills</div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}>
          <input type="checkbox" checked={allBillIds.length > 0 && selBills.size === allBillIds.length} onChange={(e) => (e.target.checked ? selectAllBills() : clearSel())} style={{ width: 16, height: 16 }} />
          Select all ({allBillIds.length})
        </label>
        <span className="muted" style={{ fontSize: 13 }}>{selBills.size > 0 ? `${selBills.size} selected · ${inr(selTotal)}` : 'Tick bills, then mark them paid together after you pay for the month.'}</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          Paid on <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
        </label>
        <button className="btn btn-primary btn-sm" disabled={busy || selBills.size === 0} onClick={markSelectedPaid}>✓ Mark {selBills.size || ''} paid</button>
        {selBills.size > 0 && <button className="btn btn-ghost btn-sm" onClick={clearSel}>Clear</button>}
      </div>

      {groups.map((g) => {
        const vKey = g.vendorId || g.vendorName;
        const vOpen = !!openVendor[vKey];
        const vIds = g.bills.map((b) => b.id);
        const vAllSel = vIds.length > 0 && vIds.every((id) => selBills.has(id));
        return (
          <div className="vendor-block" key={vKey}>
            <div className={`vendor-bar ${vOpen ? 'open' : ''}`} onClick={() => setOpenVendor((p) => ({ ...p, [vKey]: !p[vKey] }))}>
              <input type="checkbox" checked={vAllSel} onClick={(e) => e.stopPropagation()} onChange={(e) => toggleVendor(g, e)} title="Select all this vendor's bills" style={{ width: 16, height: 16, marginRight: 4 }} />
              <span className={`chev ${vOpen ? 'open' : ''}`}>▶</span>
              <span className="vendor-name">{g.vendorName}</span>
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={(e) => { e.stopPropagation(); settleVendor(g); }}>Settle all</button>
              <span className="vendor-tot">
                <div className="amt unpaid-amt">{inr(g.totalAmount)}</div>
                <div className="cnt">{g.billCount} unpaid</div>
              </span>
            </div>

            {vOpen && (
              <div className="bill-list">
                {g.bills.map((b) => (
                  <div className="bill-row" key={b.id}>
                    <div className="bill-head" style={{ cursor: 'default' }}>
                      <input type="checkbox" checked={selBills.has(b.id)} onChange={() => toggleBill(b.id)} title="Select this bill" style={{ width: 15, height: 15 }} />
                      <span className="bill-no">{b.billNo || '(no bill no.)'}</span>
                      <span className="bill-date">{prettyDate(b.billDate)}</span>
                      <span className="muted" style={{ fontSize: 12.5 }}>{ageDays(b.billDate)}d old</span>
                      <span className="bill-spacer" />
                      <span className="muted" style={{ fontSize: 12.5 }}>{(b.items || []).length} items</span>
                      <button className="btn btn-ghost btn-sm" onClick={() => nav(`/bills/${b.id}/edit`)}>Edit</button>
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => settleBill(b.id)}>Mark paid</button>
                      <span className="bill-amt unpaid-amt">{inr(b.totalAmount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
