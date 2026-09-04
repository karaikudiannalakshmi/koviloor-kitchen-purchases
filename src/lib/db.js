import { db } from '../firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, setDoc,
  query, where, orderBy, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { monthRange, lastNMonths } from './format';

/* =========================================================================
   COLLECTIONS
   vendors      { name, phone, address, type:'grocery'|'vegetable'|'both', active, createdAt }
   ingredients  { name, nameTamil, category:'grocery'|'vegetable', unit, active, createdAt }
   bills        { vendorId, vendorName, billNo, billDate:'YYYY-MM-DD', monthKey:'YYYY-MM',
                  items:[{ ingredientId, name, category, unit, qty, rate, amount }],
                  totalQty, totalAmount, notes, createdAt }
   ========================================================================= */

const VENDORS = 'vendors';
const INGREDIENTS = 'ingredients';
const BILLS = 'bills';
const CATEGORIES = 'categories';

/* ---------------------------- Categories -------------------------------- */
// { key (immutable slug), name, color (hex), creditDefault (bool), order }
export const DEFAULT_CATEGORIES = [
  { key: 'vegetable', name: 'Vegetable', color: '#4f7a34', creditDefault: true, order: 1 },
  { key: 'grocery', name: 'Grocery', color: '#b07a1a', creditDefault: false, order: 2 },
];

export function slugify(name) {
  return (name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cat';
}

export async function listCategories() {
  const snap = await getDocs(collection(db, CATEGORIES));
  let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (rows.length === 0) {
    // First run — create the two defaults with fixed IDs (= key) so they can never be
    // duplicated even if this seeding runs from two tabs at once.
    const batch = writeBatch(db);
    DEFAULT_CATEGORIES.forEach((c) => batch.set(doc(db, CATEGORIES, c.key), { ...c, createdAt: serverTimestamp() }));
    await batch.commit();
    const s2 = await getDocs(collection(db, CATEGORIES));
    rows = s2.docs.map((d) => ({ id: d.id, ...d.data() }));
  } else {
    // Self-heal: if older runs created duplicate records sharing the same `key`,
    // keep one per key and delete the extras. Bills reference the key, so this is safe.
    const seen = new Map();
    const dupes = [];
    rows.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.id).localeCompare(String(b.id)));
    rows.forEach((r) => {
      if (seen.has(r.key)) dupes.push(r);
      else seen.set(r.key, r);
    });
    if (dupes.length) {
      const batch = writeBatch(db);
      dupes.forEach((d) => batch.delete(doc(db, CATEGORIES, d.id)));
      await batch.commit();
      rows = [...seen.values()];
    }
  }

  rows.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
  return rows;
}
export function addCategory(c) {
  return addDoc(collection(db, CATEGORIES), { ...c, createdAt: serverTimestamp() });
}
export function updateCategory(id, c) {
  return updateDoc(doc(db, CATEGORIES, id), c);
}
export function deleteCategory(id) {
  return deleteDoc(doc(db, CATEGORIES, id));
}

/* ----------------------------- Vendors ---------------------------------- */
export async function listVendors() {
  const snap = await getDocs(query(collection(db, VENDORS), orderBy('name')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export function addVendor(v) {
  return addDoc(collection(db, VENDORS), { ...v, active: true, createdAt: serverTimestamp() });
}
export function updateVendor(id, v) {
  return updateDoc(doc(db, VENDORS, id), v);
}
export function deleteVendor(id) {
  return deleteDoc(doc(db, VENDORS, id));
}

/* --------------------------- Ingredients -------------------------------- */
export async function listIngredients() {
  const snap = await getDocs(collection(db, INGREDIENTS));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ta'));
  return rows;
}
export function addIngredient(i) {
  return addDoc(collection(db, INGREDIENTS), { ...i, active: true, createdAt: serverTimestamp() });
}
export function updateIngredient(id, i) {
  return updateDoc(doc(db, INGREDIENTS, id), i);
}
export function deleteIngredient(id) {
  return deleteDoc(doc(db, INGREDIENTS, id));
}

// One-time bulk import. Skips any ingredient whose name already exists
// (case-insensitive), so it is safe to run more than once.
// Returns { added, skipped }.
export async function seedIngredients(seed) {
  const existing = await listIngredients();
  const have = new Set(existing.map((i) => (i.name || '').trim().toLowerCase()));
  const toAdd = seed.filter((i) => !have.has((i.name || '').trim().toLowerCase()));

  let added = 0;
  // Firestore batches cap at 500 writes.
  for (let i = 0; i < toAdd.length; i += 450) {
    const slice = toAdd.slice(i, i + 450);
    const batch = writeBatch(db);
    for (const item of slice) {
      const ref = doc(collection(db, INGREDIENTS));
      batch.set(ref, { ...item, active: true, createdAt: serverTimestamp() });
    }
    await batch.commit();
    added += slice.length;
  }
  return { added, skipped: seed.length - toAdd.length };
}

/* --------------------------- Daily delivery log --------------------------
   For items delivered every day but billed once a month (e.g. milk).
   One doc per vendor+ingredient+month: { vendorId, vendorName, ingredientId,
   ingredientName, unit, monthKey, entries: { '01': {qty, rate}, ... },
   billed: false, billId: null }. Doc id = `${vendorId}_${ingredientId}_${monthKey}`. */
const DAILY_LOGS = 'dailyLogs';

export function dailyLogId(vendorId, ingredientId, monthKey) {
  return `${vendorId}_${ingredientId}_${monthKey}`;
}
export async function getDailyLog(vendorId, ingredientId, monthKey) {
  const snap = await getDoc(doc(db, DAILY_LOGS, dailyLogId(vendorId, ingredientId, monthKey)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
export async function saveDailyLog(vendorId, ingredientId, monthKey, data) {
  const id = dailyLogId(vendorId, ingredientId, monthKey);
  await setDoc(doc(db, DAILY_LOGS, id), { ...data, vendorId, ingredientId, monthKey, updatedAt: serverTimestamp() }, { merge: true });
  return id;
}
export async function markDailyLogBilled(vendorId, ingredientId, monthKey, billId) {
  await setDoc(doc(db, DAILY_LOGS, dailyLogId(vendorId, ingredientId, monthKey)), { billed: true, billId, updatedAt: serverTimestamp() }, { merge: true });
}

/* ------------------------------- Bills ---------------------------------- */
export function addBill(b) {
  return addDoc(collection(db, BILLS), { ...b, createdAt: serverTimestamp() });
}
export function updateBill(id, b) {
  return updateDoc(doc(db, BILLS, id), b);
}
export function deleteBill(id) {
  return deleteDoc(doc(db, BILLS, id));
}
export async function getBill(id) {
  const snap = await getDoc(doc(db, BILLS, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Maintenance: re-point every bill line's CATEGORY to the current ingredient master
// (keeps name, qty, rate, amount, GST untouched). Use after reclassifying ingredients so
// past bills and reports reflect the latest classification. Item names are intentionally
// left as they were entered. Returns counts of what changed.
export async function resyncBillsToMaster() {
  const [ingSnap, billSnap] = await Promise.all([
    getDocs(collection(db, INGREDIENTS)),
    getDocs(collection(db, BILLS)),
  ]);
  const master = {};
  ingSnap.docs.forEach((d) => { master[d.id] = { category: d.data().category }; });

  const ops = [];
  let itemsChanged = 0;
  billSnap.docs.forEach((d) => {
    const b = d.data();
    let changed = false;
    const items = (b.items || []).map((it) => {
      const m = it.ingredientId && master[it.ingredientId];
      if (m && m.category && m.category !== it.category) {
        changed = true; itemsChanged++;
        return { ...it, category: m.category }; // category only — name preserved
      }
      return it;
    });
    if (changed) ops.push({ id: d.id, items });
  });

  for (let i = 0; i < ops.length; i += 450) {
    const batch = writeBatch(db);
    ops.slice(i, i + 450).forEach((o) => batch.update(doc(db, BILLS, o.id), { items: o.items }));
    await batch.commit();
  }
  return { billsChanged: ops.length, itemsChanged };
}

// All bills in a single month (by monthKey equality — no composite index needed).
export async function billsForMonth(monthKey) {
  const snap = await getDocs(query(collection(db, BILLS), where('monthKey', '==', monthKey)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => (a.billDate < b.billDate ? 1 : -1)); // newest first
  return rows;
}

// Bills within an inclusive date range (billDate is sortable 'YYYY-MM-DD' string).
export async function billsInRange(startISO, endISO) {
  const snap = await getDocs(query(
    collection(db, BILLS),
    where('billDate', '>=', startISO),
    where('billDate', '<=', endISO),
    orderBy('billDate', 'asc'),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// All outstanding (unpaid) bills across all time — for the settlement view.
// Single equality filter, so no composite index needed; sorted client-side (oldest first).
export async function unpaidBills() {
  const snap = await getDocs(query(collection(db, BILLS), where('paid', '==', false)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((b) => b.status !== 'draft');
  rows.sort((a, b) => (a.billDate < b.billDate ? -1 : 1));
  return rows;
}

// Draft bills = shopping lists captured (qty only) with pricing still pending.
export async function draftBills() {
  const snap = await getDocs(query(collection(db, BILLS), where('status', '==', 'draft')));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => (a.billDate < b.billDate ? 1 : -1));
  return rows;
}

export function markBillPaid(id, paidDate) {
  return updateDoc(doc(db, BILLS, id), { paid: true, paidDate });
}
export function markBillUnpaid(id) {
  return updateDoc(doc(db, BILLS, id), { paid: false, paidDate: '' });
}
// Settle several bills at once (e.g. all of a vendor's outstanding bills).
export async function markBillsPaid(ids, paidDate) {
  const batch = writeBatch(db);
  ids.forEach((id) => batch.update(doc(db, BILLS, id), { paid: true, paidDate }));
  await batch.commit();
}

/* =========================================================================
   AGGREGATION
   ========================================================================= */

// GST-inclusive line value ("what was paid"). Falls back to amount for older bills.
const grossOf = (it) => Number(it.gross != null ? it.gross : it.amount) || 0;
// GST-inclusive cost per unit (cost per kg). Falls back gracefully.
function unitCostOf(it) {
  const q = Number(it.qty) || 0;
  if (q > 0) return grossOf(it) / q;
  return Number(it.effRate != null ? it.effRate : it.rate) || 0;
}

// Group a flat bill list by vendor -> { vendorId, vendorName, billCount, totalAmount, totalQty, bills[] }
export function groupByVendor(bills) {
  const map = new Map();
  for (const b of bills) {
    const key = b.vendorId || b.vendorName || '—';
    if (!map.has(key)) {
      map.set(key, {
        vendorId: b.vendorId,
        vendorName: b.vendorName || 'Unknown vendor',
        billCount: 0,
        totalAmount: 0,
        totalQty: 0,
        bills: [],
      });
    }
    const g = map.get(key);
    g.billCount += 1;
    g.totalAmount += Number(b.totalAmount) || 0;
    g.totalQty += Number(b.totalQty) || 0;
    g.bills.push(b);
  }
  const out = [...map.values()];
  out.forEach((g) => g.bills.sort((a, b) => (a.billDate < b.billDate ? 1 : -1)));
  out.sort((a, b) => b.totalAmount - a.totalAmount);
  return out;
}

// Roll up every line item across a bill list, keyed by ingredient.
// -> [{ ingredientId, name, category, unit, totalQty, totalAmount, avgRate, billCount }]
export function rollupByIngredient(bills) {
  const map = new Map();
  for (const b of bills) {
    for (const it of b.items || []) {
      const key = it.ingredientId || it.name;
      if (!map.has(key)) {
        map.set(key, {
          ingredientId: it.ingredientId,
          name: it.name,
          category: it.category,
          unit: it.unit,
          totalQty: 0,
          totalAmount: 0,
          billCount: 0,
        });
      }
      const r = map.get(key);
      r.totalQty += Number(it.qty) || 0;
      r.totalAmount += grossOf(it);
      r.billCount += 1;
    }
  }
  const out = [...map.values()];
  out.forEach((r) => { r.avgRate = r.totalQty > 0 ? r.totalAmount / r.totalQty : 0; });
  out.sort((a, b) => b.totalAmount - a.totalAmount);
  return out;
}

// Pull every purchase line for one ingredient out of a bill list, as dated rows.
// -> [{ billId, billNo, billDate, vendorName, qty, rate, amount, unit }]
export function ingredientLines(bills, ingredientId) {
  const lines = [];
  for (const b of bills) {
    for (const it of b.items || []) {
      if (it.ingredientId === ingredientId) {
        lines.push({
          billId: b.id,
          billNo: b.billNo,
          billDate: b.billDate,
          vendorName: b.vendorName,
          qty: Number(it.qty) || 0,
          rate: unitCostOf(it),   // GST-inclusive cost per unit
          amount: grossOf(it),    // GST-inclusive line value
          unit: it.unit,
        });
      }
    }
  }
  lines.sort((a, b) => (a.billDate < b.billDate ? -1 : 1)); // oldest first for trend
  return lines;
}

// Monthly average rate for one ingredient over the last N months (for price-trend chart).
// Returns [{ monthKey, avgRate, totalQty }] oldest first. Does N getDocs reads.
export async function priceTrend(ingredientId, endMonthKey, n = 6) {
  const months = lastNMonths(endMonthKey, n);
  const out = [];
  for (const mk of months) {
    const bills = await billsForMonth(mk);
    let qtySum = 0, amtSum = 0;
    for (const b of bills) {
      for (const it of b.items || []) {
        if (it.ingredientId === ingredientId) {
          qtySum += Number(it.qty) || 0;
          amtSum += grossOf(it);
        }
      }
    }
    out.push({ monthKey: mk, avgRate: qtySum > 0 ? amtSum / qtySum : null, totalQty: qtySum });
  }
  return out;
}

// Monthly spend per category over last N months, for the dashboard trend.
export async function spendTrend(endMonthKey, n = 6) {
  const months = lastNMonths(endMonthKey, n);
  const out = [];
  for (const mk of months) {
    const bills = await billsForMonth(mk);
    const cats = {};
    let total = 0;
    for (const b of bills) {
      for (const it of b.items || []) {
        const amt = grossOf(it);
        const k = it.category || 'other';
        cats[k] = (cats[k] || 0) + amt;
        total += amt;
      }
    }
    out.push({ monthKey: mk, cats, total });
  }
  return out;
}

export { monthRange };
