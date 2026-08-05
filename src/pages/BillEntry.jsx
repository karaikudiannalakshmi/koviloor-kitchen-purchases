import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { listVendors, listIngredients, addBill, updateBill, getBill } from '../lib/db';
import IngredientSelect from '../components/IngredientSelect';
import { ingredientMatches, norm } from '../lib/ingredientSearch';
import { useCategories } from '../contexts/CategoriesContext';
import { inr, todayISO } from '../lib/format';

const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

// Total quantity as the model returned it (it already applies bags×kg per the prompt).
// Legacy fallback: if only packCount/unitSize are present, multiply them.
function totalQtyFromItem(it) {
  const q = parseFloat(it.qty);
  if (!isNaN(q) && q > 0) return q;
  const pc = parseFloat(it.packCount); const us = parseFloat(it.unitSize);
  if (!isNaN(pc) && pc > 0 && !isNaN(us) && us > 0) return r2(pc * us);
  return isNaN(q) ? 0 : q;
}

// Build a line's money so the bill's printed Amount is authoritative (a qty slip can't corrupt it).
// Returns { qty, amount, rate, driver } with rate as a per-unit figure derived from amount÷qty.
function lineMoney(it) {
  const q = totalQtyFromItem(it);
  const billAmt = parseFloat(it.amount);
  const billRate = parseFloat(it.rate);
  let amount = billAmt;
  if (isNaN(amount)) amount = (!isNaN(billRate) && billRate && q) ? r2(q * billRate) : NaN;
  if (!isNaN(amount)) {
    const perUnit = q > 0 ? r2(amount / q) : (isNaN(billRate) ? 0 : billRate);
    return { qty: q, amount, rate: perUnit, driver: 'amount' };
  }
  if (!isNaN(billRate)) return { qty: q, amount: q ? r2(q * billRate) : 0, rate: billRate, driver: 'rate' };
  return { qty: q, amount: 0, rate: 0, driver: 'amount' };
}

const sigTok = (t) => t.length >= 4;
const tokensOf = (s) => norm(s).split(' ').filter(Boolean);
// Generic category words shared by many items — a match must NOT rest on these alone, or every
// "…கிழங்கு" row would collapse onto one tuber, every "…காய்" onto one gourd, etc.
const GENERIC_TOKENS = new Set(['கிழங்கு', 'காய்', 'இலை', 'பழம்', 'கீரை', 'பொடி', 'மாவு', 'பருப்பு', 'வெல்லம்']);

// Confidence-scored resolver. Auto-accepts only strong matches; weak/ambiguous → null (pending pick).
//  100 exact name / search-keyword · 92 "<query> (variant)" · ~80 shared SPECIFIC Tamil token · <70 → reject
function resolveIngredient(name, ingredients) {
  const q = String(name || '').trim();
  if (!q) return null;
  const qn = norm(q);
  const qt = tokensOf(q);
  let best = null; let bestScore = 0;
  for (const i of ingredients) {
    const nn = norm(i.name);
    let score = 0;
    if (qn && (nn === qn || norm(i.search || '') === qn)) {
      score = 100;
    } else {
      const raw = i.name.trim();
      const rest = raw.startsWith(q) ? raw.slice(q.length).trim() : null;
      if (rest !== null && (rest === '' || rest.startsWith('('))) {
        score = 92; // canonical variant, e.g. "தக்காளி (நறுக்கியது)"
      } else {
        const ct = tokensOf(i.name);
        const shared = qt.filter((t) => sigTok(t) && !GENERIC_TOKENS.has(t) && ct.includes(t));
        if (shared.length) score = 82 - (ct.length - 1) * 6; // prefer the cleaner/shorter master name
        else if (qn.length >= 4 && nn.includes(qn)) score = 50; // vague substring → not confident
        else if (nn.length >= 4 && qn.includes(nn)) score = 48;
      }
    }
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return bestScore >= 70 ? best : null;
}

function pickKey(keys, needles) {
  return keys.find((k) => needles.some((n) => k.toLowerCase().trim().includes(n)));
}

// ---- Invoice OCR-text parser (offline, best-effort) ----
const INV_SKIP = /(total|g\.?s\.?t|sgst|cgst|igst|\btax\b|signature|declaration|terms|condition|disclaimer|jurisdiction|phone|mobile|www\.|gstin|bill\s*no|^date|party|purchase\s*order|hsn|description|s\.?\s*no|amount\s*(before|after)|receiver|authorised|brand\s*name|no\.?\s*of\s*bags|^to\b|m\/s|e\.?\s*&\s*o|invoice|cash\s*bill|land\s*mark|chennai|street|warranty|counter|karaikudi|annalaksh|ramadavam|students|\boff\b|jurisdiction)/i;

// standalone numbers only (not embedded in model codes like 2570XL or O1)
function invNumbers(s) {
  const m = s.match(/(?<![A-Za-z\u0B80-\u0BFF\d])\d[\d,]*\.?\d*(?![A-Za-z\u0B80-\u0BFF\d])/g) || [];
  return m.map((x) => parseFloat(x.replace(/,/g, ''))).filter((n) => !isNaN(n));
}

function parseInvoice(text, ingredients, vendors) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let billNo = '';
  const bn = text.match(/bill\s*no\.?\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-\/ ]*)/i);
  if (bn) billNo = bn[1].split(/\||date|gst/i)[0].replace(/\s+/g, '').trim();

  let billDate = '';
  const dm = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (dm) {
    let d = +dm[1]; let mo = +dm[2]; let y = +dm[3];
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) billDate = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  let vendorId = '';
  const tl = text.toLowerCase();
  for (const v of vendors) {
    const n = String(v.name || '').trim().toLowerCase();
    if (n.length >= 3 && tl.includes(n)) { vendorId = v.id; break; }
  }

  const items = [];
  lines.forEach((line) => {
    if (INV_SKIP.test(line)) return;
    const nums = invNumbers(line);
    const letters = line.replace(/[^A-Za-z\u0B80-\u0BFF]/g, '');
    if (nums.length === 0 || letters.length < 2) return;
    let desc = line.replace(/^\s*\d+[.)]\s*/, '');                 // drop leading serial
    desc = desc.replace(/(?<![A-Za-z\u0B80-\u0BFF\d])\d[\d,]*\.?\d*(?![A-Za-z\u0B80-\u0BFF\d])/g, ' ')
      .replace(/[|:।]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (desc.replace(/[^A-Za-z\u0B80-\u0BFF]/g, '').length < 2) return;
    let qty = ''; let rate = ''; let amount = '';
    if (nums.length >= 3) { qty = nums[0]; rate = nums[1]; amount = nums[nums.length - 1]; }
    else if (nums.length === 2) { qty = nums[0]; amount = nums[1]; }
    else { amount = nums[0]; }
    items.push({ name: desc, qty, rate, amount });
  });

  return { billNo, billDate, vendorId, items };
}

// ---- Pasted transcription parsing (markdown tables or plain rows; one or many bills) ----
// Parse a quantity/number cell incl. fractions: 2½, ¼, 1¼, "1 1/2", "1/2", "25/28"→25, "—"→blank.
function numCell(s) {
  let t = String(s ?? '').replace(/\(\?\)/g, '').replace(/[*₹,]/g, '').trim();
  if (t === '' || t === '—' || t === '-' || t === '–') return NaN;
  const uni = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375 };
  let m = t.match(/^(\d+)\s*([½¼¾⅓⅔⅛⅜])$/); if (m) return parseInt(m[1], 10) + uni[m[2]];
  if (uni[t] != null) return uni[t];
  m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/); if (m) return parseInt(m[1], 10) + parseInt(m[2], 10) / parseInt(m[3], 10);
  m = t.match(/^(\d+)\/(\d+)$/); if (m) return parseInt(m[1], 10) / parseInt(m[2], 10);
  m = t.match(/^(\d+(?:\.\d+)?)\s*\/\s*\d+/); if (m) return parseFloat(m[1]); // "25/28" range → first
  const f = parseFloat(t); return isNaN(f) ? NaN : f;
}

function splitCells(l) {
  const p = (l.includes('|') ? l.split('|') : l.split('\t')).map((s) => s.trim());
  if (p.length && p[0] === '') p.shift();
  if (p.length && p[p.length - 1] === '') p.pop();
  return p;
}

// Split a paste into separate bills on "Bill No"/"Invoice no" header lines (markdown headings ok).
function splitBills(text) {
  const headerRe = /^\s*#{0,6}\s*(bill\s*no|invoice\s*no|பில்)/i;
  const blocks = []; let cur = null;
  text.split(/\r?\n/).forEach((ln) => {
    if (headerRe.test(ln)) { if (cur) blocks.push(cur); cur = { head: ln, body: [] }; }
    else { if (!cur) cur = { head: '', body: [] }; cur.body.push(ln); }
  });
  if (cur) blocks.push(cur);
  return blocks.filter((b) => b.head || b.body.some((x) => x.trim()));
}

function billHeaderInfo(block) {
  const hay = [block.head, ...block.body.slice(0, 4)].join(' ');
  let billNo = '';
  const bn = hay.match(/(?:bill|invoice)\s*no\.?\s*[:\-—]?\s*([A-Za-z0-9][A-Za-z0-9\-/]*)/i);
  if (bn) billNo = bn[1];
  let billDate = '';
  const dm = hay.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (dm) { let d = +dm[1]; let mo = +dm[2]; let y = +dm[3]; if (y < 100) y += 2000; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) billDate = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  return { billNo, billDate };
}

// Parse the item rows of one bill block — markdown table (by header) or plain positional rows.
function parseBillItems(lines) {
  const tableLines = lines.filter((l) => l.includes('|') || l.includes('\t'));
  if (tableLines.length >= 2) {
    let cols = null; const items = [];
    for (const l of tableLines) {
      const cells = splitCells(l);
      const lc = cells.map((c) => c.toLowerCase());
      if (!cols) {
        const qi = lc.findIndex((c) => /\bkg\b|qty|quant|கிலோ|எடை|quantity/.test(c));
        const ii = lc.findIndex((c) => /பொருள|item|name|descrip|goods/.test(c));
        const ri = lc.findIndex((c) => /விலை|rate|price/.test(c));
        const ai = lc.findIndex((c) => /தொகை|amount|ரூ|total|value/.test(c));
        if (ii >= 0 && (qi >= 0 || ai >= 0)) { cols = { qi, ii, ri, ai }; }
        continue;
      }
      if (/^[\s|:\-—]+$/.test(l)) continue; // markdown separator row
      const name = String(cells[cols.ii] || '').replace(/\(\?\)/g, '').replace(/\*\*/g, '').trim();
      if (!name || /மொத்தம|total/i.test(name) || /மொத்தம|total/i.test(l)) continue;
      const qty = cols.qi >= 0 ? numCell(cells[cols.qi]) : NaN;
      const rate = cols.ri >= 0 ? numCell(cells[cols.ri]) : NaN;
      const amount = cols.ai >= 0 ? numCell(cells[cols.ai]) : NaN;
      if (isNaN(qty) && isNaN(amount)) continue;
      items.push({ name, qty: isNaN(qty) ? null : qty, rate: isNaN(rate) ? null : rate, amount: isNaN(amount) ? null : amount, unit: 'kg' });
    }
    if (items.length) return items;
  }
  // Fallback: plain positional rows.
  const r = parseInvoice(lines.join('\n'), [], []);
  return r.items.map((it) => ({ ...it, unit: it.unit || 'kg' }));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Downscale a photo before upload — keeps the request small and the token cost low.
function downscaleImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale); const h = Math.round(img.height * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = c.toDataURL('image/jpeg', quality);
      resolve({ data: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

function blankLine() {
  // driver = which field the user typed ('rate' or 'amount'); the other is derived.
  // pendingName = imported text that didn't match a master ingredient yet.
  // freeText = a custom (off-master) item, e.g. a non-food line from an invoice.
  return { ingredientId: '', name: '', category: '', unit: '', qty: '', rate: '', amount: '', driver: 'rate', pendingName: '', freeText: false };
}

export default function BillEntry() {
  const nav = useNavigate();
  const { id } = useParams();
  const editing = Boolean(id);
  const cats = useCategories();

  const [vendors, setVendors] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [vendorId, setVendorId] = useState('');
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([blankLine()]);
  const [gstMode, setGstMode] = useState('pct'); // 'pct' | 'amt'
  const [gstValue, setGstValue] = useState('');   // % or ₹ depending on mode
  const [paid, setPaid] = useState(true);
  const [paidDate, setPaidDate] = useState(todayISO());
  const [paidTouched, setPaidTouched] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [invoiceText, setInvoiceText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [pasteVendor, setPasteVendor] = useState('');
  const imgRef = useRef(null);
  const defaultCatKey = () => cats.categories[0]?.key || 'grocery';
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!editing);
  const [importMsg, setImportMsg] = useState(null); // {ok, text}
  const fileRef = useRef(null);

  // Shared: fill the form from a parsed bill ({ billNo, billDate, vendorId?, vendorName?, items[], gstPct?, gstAmount? }).
  function applyParsed(p) {
    if (p.billNo) setBillNo(String(p.billNo));
    if (p.billDate && /^\d{4}-\d{2}-\d{2}$/.test(p.billDate)) setBillDate(p.billDate);

    let vid = p.vendorId || '';
    if (!vid && p.vendorName) {
      const n = String(p.vendorName).trim().toLowerCase();
      const v = vendors.find((x) => { const m = String(x.name || '').trim().toLowerCase(); return m && (m === n || n.includes(m) || m.includes(n)); });
      if (v) vid = v.id;
    }
    if (vid) setVendorId(vid);

    const items = Array.isArray(p.items) ? p.items : [];
    const imported = []; const pending = [];
    items.forEach((it) => {
      const name = String(it.name || '').trim();
      if (!name) return;
      const ing = resolveIngredient(name, ingredients);
      const line = {
        ...blankLine(),
        ingredientId: ing ? ing.id : '', name: ing ? ing.name : '', category: ing ? ing.category : '',
        unit: it.unit ? String(it.unit) : (ing ? ing.unit : ''), pendingName: ing ? '' : name,
      };
      const m = lineMoney(it);
      line.qty = m.qty ? String(m.qty) : '';
      line.amount = m.amount ? String(m.amount) : '';
      line.rate = m.rate ? String(m.rate) : '';
      line.driver = m.driver;
      (ing ? imported : pending).push(line);
    });

    setLines((prev) => {
      const kept = prev.filter((l) => l.ingredientId || l.qty || l.rate || l.amount || l.pendingName || l.freeText);
      const next = [...kept, ...imported, ...pending];
      return next.length ? next : [blankLine()];
    });

    const gp = parseFloat(p.gstPct); const ga = parseFloat(p.gstAmount);
    if (!isNaN(gp) && gp > 0) { setGstMode('pct'); setGstValue(String(gp)); }
    else if (!isNaN(ga) && ga > 0) { setGstMode('amt'); setGstValue(String(ga)); }

    return {
      count: items.length, pending: pending.length,
      billNo: p.billNo || '', billDate: (/^\d{4}-\d{2}-\d{2}$/.test(p.billDate || '') ? p.billDate : ''),
      vendorMatched: !!vid,
    };
  }

  function applyInvoiceToDrafts() {
    const blocks = splitBills(invoiceText);
    let saved = 0; let totalItems = 0; const errs = [];
    setAiBusy(true);
    (async () => {
      for (const block of blocks) {
        const { billNo, billDate } = billHeaderInfo(block);
        const items = parseBillItems(block.body.length ? block.body : [block.head]);
        if (!items.length) continue;
        try {
          const payload = buildDraftPayload({ billNo, billDate, vendorName: '', items }, pasteVendor);
          await addBill(payload); saved += 1; totalItems += items.length;
        } catch (e) { errs.push(e.message); }
      }
      setAiBusy(false);
      if (saved > 0) { setShowInvoice(false); setInvoiceText(''); nav('/bills?view=drafts'); return; }
      setImportMsg({ ok: false, text: `No bills found. Paste tables with item rows (and ideally a "Bill No" / date line per bill).${errs.length ? ' ' + errs.slice(0, 2).join(' · ') : ''}` });
    })();
  }

  async function parseBillFile(file) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    let data; let mediaType;
    if (isPdf) {
      if (file.size > 4_000_000) throw new Error('PDF too large (>4MB) — use a photo');
      data = await fileToBase64(file); mediaType = 'application/pdf';
    } else {
      const r = await downscaleImage(file, 2200, 0.9); data = r.data; mediaType = r.mediaType;
    }
    const resp = await fetch('/api/parse-bill', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data, mediaType }) });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok || !j.ok) throw new Error(j && j.error ? j.error : 'HTTP ' + resp.status);
    return j.bill || {};
  }

  // Build a complete draft-bill record straight from parsed JSON (for bulk upload → drafts).
  function buildDraftPayload(bill, vendorIdOverride) {
    const items = (Array.isArray(bill.items) ? bill.items : []).map((it) => {
      const name = String(it.name || '').trim();
      if (!name) return null;
      const ing = resolveIngredient(name, ingredients);
      const m = lineMoney(it);
      return {
        ingredientId: ing ? ing.id : '', name: ing ? ing.name : name,
        category: ing ? ing.category : defaultCatKey(), unit: it.unit ? String(it.unit) : (ing ? ing.unit : 'kg'),
        freeText: !ing, qty: m.qty, rate: m.rate, amount: m.amount, gstPct: 0, gstAmt: 0, gross: r2(m.amount), effRate: m.rate,
      };
    }).filter(Boolean);

    let vid = vendorIdOverride || '';
    if (!vid && bill.vendorName) {
      const n = String(bill.vendorName).trim().toLowerCase();
      const v = vendors.find((x) => { const m = String(x.name || '').trim().toLowerCase(); return m && (m === n || n.includes(m) || m.includes(n)); });
      if (v) vid = v.id;
    }
    const billDate = (/^\d{4}-\d{2}-\d{2}$/.test(bill.billDate || '')) ? bill.billDate : todayISO();
    const subtotal = r2(items.reduce((s, i) => s + i.amount, 0));

    const gstAmt = parseFloat(bill.gstAmount); const gstPct = parseFloat(bill.gstPct);
    const gstTotal = (!isNaN(gstAmt) && gstAmt > 0) ? r2(gstAmt) : 0;
    const usePct = !isNaN(gstPct) && gstPct > 0;
    const grand = r2(subtotal + gstTotal);

    // Flag a draft when its line amounts (+GST) don't reconcile to the bill's printed total.
    const printed = parseFloat(bill.totalAmount);
    let flag = false; let flagReason = '';
    if (!isNaN(printed) && printed > 0) {
      const diff = Math.abs(grand - printed);
      if (diff > Math.max(2, printed * 0.01)) { flag = true; flagReason = `Lines total ₹${grand.toLocaleString('en-IN')} but bill shows ₹${printed.toLocaleString('en-IN')} — check for a missed/misread line.`; }
    }
    if (items.some((i) => !(i.qty > 0) || !(i.amount > 0))) { flag = true; flagReason = flagReason || 'Some lines have no quantity or amount — review.'; }

    return {
      vendorId: vid,
      vendorName: vid ? (vendors.find((v) => v.id === vid)?.name || bill.vendorName) : (bill.vendorName || 'Unknown vendor'),
      billNo: String(bill.billNo || '').trim(), billDate, monthKey: billDate.slice(0, 7),
      items, totalQty: r2(items.reduce((s, i) => s + i.qty, 0)), subtotal,
      gstMode: usePct ? 'pct' : 'amt', gstValue: usePct ? gstPct : gstTotal, gstTotal, totalAmount: grand,
      notes: '', status: 'draft', paid: false, paidDate: '',
      aiNote: bill.note || '', flag, flagReason,
    };
  }

  async function bulkToDrafts(files) {
    setAiBusy(true);
    let saved = 0; const errs = [];
    for (let i = 0; i < files.length; i++) {
      setImportMsg({ ok: true, text: `Reading bill ${i + 1} of ${files.length}… (saving each as a draft)` });
      try {
        const bill = await parseBillFile(files[i]);
        const payload = buildDraftPayload(bill);
        if (payload.items.length === 0) { errs.push(`${files[i].name}: no items read`); continue; }
        await addBill(payload);
        saved += 1;
      } catch (e) { errs.push(`${files[i].name}: ${e.message}`); }
    }
    setAiBusy(false);
    if (saved > 0) { nav('/bills?view=drafts'); return; }
    setImportMsg({ ok: false, text: `No drafts saved. ${errs.slice(0, 4).join(' · ')}` });
  }

  async function handleBillImage(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (files.length === 0) return;
    if (files.length > 20) { setImportMsg({ ok: false, text: 'Please upload up to 20 bills at a time.' }); return; }

    if (files.length > 1) { await bulkToDrafts(files); return; } // many → each becomes a draft

    const file = files[0];
    setAiBusy(true);
    setImportMsg({ ok: true, text: 'Reading the bill with AI…' });
    try {
      const bill = await parseBillFile(file);
      const res = applyParsed(bill);
      const bits = [`AI read ${res.count} item${res.count === 1 ? '' : 's'}${res.billNo ? `, bill ${res.billNo}` : ''}${res.billDate ? `, dated ${res.billDate}` : ''}${res.vendorMatched ? ', vendor matched' : ''}.`];
      if (bill && bill.note) bits.push(`(${bill.note})`);
      if (res.pending) bits.push(`${res.pending} not in master — pick each, or “keep as custom item”.`);
      bits.push('Please verify quantities and rates before saving.');
      setImportMsg({ ok: res.pending === 0, text: bits.join(' ') });
    } catch (err) {
      setImportMsg({ ok: false, text: 'Upload failed: ' + err.message });
    }
    setAiBusy(false);
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing same file
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false })
        .map((r) => r || []).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
      if (raw.length === 0) { setImportMsg({ ok: false, text: 'That sheet looks empty.' }); return; }

      // A data row has a numeric quantity in the 2nd column; if row 1 doesn't, it's a header row.
      const looksData = (row) => row.length >= 2 && String(row[1] ?? '').trim() !== '' && !isNaN(parseFloat(row[1]));
      const hasHeader = !looksData(raw[0]);

      // Normalise to records: { name, qty, rate, amount, unit }
      let recs = [];
      if (hasHeader) {
        const lc = raw[0].map((c) => String(c ?? '').toLowerCase().trim());
        const find = (needles) => lc.findIndex((h) => needles.some((n) => h.includes(n)));
        const iName = find(['name', 'item', 'ingredient', 'பொருள', 'பெயர', 'காய்', 'வகை']);
        const iQty = find(['qty', 'quant', 'அளவ', 'எடை', 'weight', 'nos']);
        const iRate = find(['rate', 'price', 'விலை', 'cost']);
        const iUnit = find(['unit', 'அலக']);
        const iAmt = find(['amount', 'total', 'மொத்த', 'value']);
        if (iName < 0) { setImportMsg({ ok: false, text: 'Couldn’t find an item-name column. Either add a header like "Item"/"பொருள்", or put item name in the first column with no header.' }); return; }
        recs = raw.slice(1).map((r) => ({
          name: r[iName], qty: iQty >= 0 ? r[iQty] : '', rate: iRate >= 0 ? r[iRate] : '',
          amount: iAmt >= 0 ? r[iAmt] : '', unit: iUnit >= 0 ? r[iUnit] : '',
        }));
      } else {
        // No header: column 1 = name, column 2 = qty, then a text column is the unit and a numeric one is the rate.
        recs = raw.map((r) => {
          const rec = { name: r[0], qty: r[1], rate: '', amount: '', unit: '' };
          [r[2], r[3]].forEach((c) => {
            if (c === undefined || c === '' || c === null) return;
            if (isNaN(parseFloat(c))) rec.unit = rec.unit || String(c);
            else rec.rate = rec.rate || c;
          });
          return rec;
        });
      }

      const imported = []; const pending = [];
      recs.forEach((rec) => {
        const nm = String(rec.name ?? '').trim();
        if (!nm) return;
        const qv = parseFloat(rec.qty);
        const rv = parseFloat(rec.rate);
        const av = parseFloat(rec.amount);
        const ing = resolveIngredient(nm, ingredients);
        const line = {
          ingredientId: ing ? ing.id : '', name: ing ? ing.name : '', category: ing ? ing.category : '',
          unit: rec.unit ? String(rec.unit) : (ing ? ing.unit : ''),
          qty: isNaN(qv) ? '' : String(qv), rate: '', amount: '', driver: 'rate',
          pendingName: ing ? '' : nm,
        };
        if (!isNaN(rv) && rv) { line.rate = String(rv); line.driver = 'rate'; if (!isNaN(qv) && qv) line.amount = String(r2(qv * rv)); }
        else if (!isNaN(av) && av) { line.amount = String(av); line.driver = 'amount'; if (!isNaN(qv) && qv) line.rate = String(r2(av / qv)); }
        if (ing) imported.push(line); else pending.push(line);
      });

      const all = [...imported, ...pending]; // matched first, then the ones needing a pick
      if (all.length === 0) { setImportMsg({ ok: false, text: 'No item rows found.' }); return; }

      setLines((prev) => {
        const kept = prev.filter((l) => l.ingredientId || l.qty || l.rate || l.amount || l.pendingName);
        const next = [...kept, ...all];
        return next.length ? next : [blankLine()];
      });

      const parts = [`Imported ${imported.length} matched item${imported.length === 1 ? '' : 's'} — please glance over them, then set/adjust rates.`];
      if (pending.length) parts.push(`${pending.length} couldn’t be matched and are highlighted below — tap the ingredient box on each to choose the right one (its search opens pre-filled with the list name).`);
      setImportMsg({ ok: pending.length === 0, text: parts.join(' ') });
    } catch (err) {
      setImportMsg({ ok: false, text: 'Could not read that file: ' + err.message });
    }
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([
      ['Item', 'Qty', 'Unit', 'Rate'],
      ['தக்காளி (நறுக்கியது)', 10, 'kg', 30],
      ['அவரைக்காய்', 5, 'kg', 25],
    ]);
    ws['!cols'] = [{ wch: 30 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Shopping list');
    XLSX.writeFile(wb, 'KAL-shopping-list-template.xlsx');
  }

  useEffect(() => {
    (async () => {
      const [v, ing] = await Promise.all([listVendors(), listIngredients()]);
      setVendors(v); setIngredients(ing);
      if (editing) {
        const b = await getBill(id);
        if (b) {
          setVendorId(b.vendorId || '');
          setBillNo(b.billNo || '');
          setBillDate(b.billDate || todayISO());
          setNotes(b.notes || '');
          setLines((b.items || []).map((it) => {
            const off = !it.ingredientId && !!it.name; // off-master item (unmatched / custom) — keep its name visible & editable
            return {
              ingredientId: it.ingredientId || '', name: it.name, category: it.category, unit: it.unit,
              qty: String(it.qty ?? ''), rate: it.rate ? String(it.rate) : '',
              amount: String(it.amount ?? ''), driver: it.rate ? 'rate' : 'amount',
              pendingName: '', freeText: it.freeText || off,
            };
          }));
          // Restore bill-level GST (with graceful fallback for older bills).
          if (b.gstMode) { setGstMode(b.gstMode); setGstValue(b.gstValue != null ? String(b.gstValue) : ''); }
          else if (b.gstTotal) { setGstMode('amt'); setGstValue(String(b.gstTotal)); }
          setPaid(b.paid !== false);
          setPaidDate(b.paidDate || b.billDate || todayISO());
          setPaidTouched(true);
        }
        setLoaded(true);
      }
    })();
  }, [id, editing]);

  // Edit one field; keep rate <-> amount in sync via the line's "driver".
  function setField(idx, field, value) {
    setLines((prev) => prev.map((l, i) => {
      if (i !== idx) return l;
      const n = { ...l, [field]: value };
      if (field === 'rate') n.driver = 'rate';
      if (field === 'amount') n.driver = 'amount';
      const q = parseFloat(n.qty) || 0;
      if (n.driver === 'amount') {
        const a = parseFloat(n.amount) || 0;
        n.rate = q > 0 && a ? String(r2(a / q)) : '';
      } else {
        const rt = parseFloat(n.rate) || 0;
        if (q > 0 && rt) n.amount = String(r2(q * rt));
      }
      return n;
    }));
  }

  function pickIngredient(idx, ingId) {
    const ing = ingredients.find((x) => x.id === ingId);
    setLines((prev) => prev.map((l, i) => i === idx
      ? (ing ? { ...l, ingredientId: ing.id, name: ing.name, category: ing.category, unit: ing.unit, pendingName: '', freeText: false }
             : { ...l, ingredientId: '', name: '', category: '', unit: '' })
      : l));
  }

  function toFreeText(idx) {
    setLines((prev) => prev.map((l, i) => i === idx
      ? { ...l, freeText: true, name: l.pendingName || l.name || '', category: l.category || defaultCatKey(), unit: l.unit || 'kg', ingredientId: '', pendingName: '' }
      : l));
  }
  function toMaster(idx) {
    setLines((prev) => prev.map((l, i) => i === idx
      ? { ...l, freeText: false, ingredientId: '', pendingName: l.name || '', name: '', category: '' }
      : l));
  }

  const lineTaxable = (l) => parseFloat(l.amount) || 0;
  const subtotal = useMemo(() => lines.reduce((s, l) => s + lineTaxable(l), 0), [lines]);
  const totalQty = useMemo(() => lines.reduce((s, l) => s + (parseFloat(l.qty) || 0), 0), [lines]);
  const gstTotal = useMemo(() => {
    const v = parseFloat(gstValue) || 0;
    return gstMode === 'pct' ? r2(subtotal * v / 100) : r2(v);
  }, [gstMode, gstValue, subtotal]);
  const grand = useMemo(() => r2(subtotal + gstTotal), [subtotal, gstTotal]);

  useEffect(() => {
    if (paidTouched) return;
    const picked = lines.filter((l) => l.ingredientId || (l.freeText && String(l.name).trim()));
    setPaid(!(picked.length > 0 && picked.every((l) => cats.isCredit(l.category))));
  }, [lines, paidTouched, cats]);

  useEffect(() => { if (!paidTouched) setPaidDate(billDate); }, [billDate, paidTouched]);

  function setPaidStatus(v) { setPaid(v); setPaidTouched(true); }

  // Distribute the single bill GST across lines by taxable value; last line absorbs rounding.
  function buildItems() {
    const picked = lines.filter((l) => (l.ingredientId || (l.freeText && String(l.name).trim())) && (parseFloat(l.qty) || 0) > 0);
    const sub = picked.reduce((s, l) => s + lineTaxable(l), 0);
    const effPct = sub > 0 ? gstTotal / sub * 100 : 0;
    let allocated = 0;
    return picked.map((l, i) => {
      const q = parseFloat(l.qty) || 0;
      const taxable = lineTaxable(l);
      let gstAmt;
      if (i === picked.length - 1) gstAmt = r2(gstTotal - allocated);
      else { gstAmt = r2(sub > 0 ? gstTotal * (taxable / sub) : 0); allocated = r2(allocated + gstAmt); }
      const gross = r2(taxable + gstAmt);
      return {
        ingredientId: l.ingredientId || '',
        name: l.name,
        category: l.category || defaultCatKey(),
        unit: l.unit,
        freeText: !!l.freeText,
        qty: q,
        rate: parseFloat(l.rate) || (q > 0 ? r2(taxable / q) : 0),
        amount: taxable,
        gstPct: r2(effPct),
        gstAmt,
        gross,
        effRate: q > 0 ? r2(gross / q) : 0,
      };
    });
  }

  async function saveAs(status) {
    if (!vendorId) return alert('Select a vendor.');
    const items = buildItems();
    if (items.length === 0) return alert('Add at least one item with a quantity.');
    if (status === 'final') {
      const unpriced = items.filter((it) => !(Number(it.amount) > 0)).length;
      if (unpriced > 0 && !confirm(`${unpriced} item(s) have no rate yet.\n\nSave as a FINAL bill anyway? (Cancel, then use “Save as draft” to finish pricing later.)`)) return;
    }

    const vendor = vendors.find((v) => v.id === vendorId);
    const payload = {
      vendorId,
      vendorName: vendor ? vendor.name : 'Unknown',
      billNo: billNo.trim(),
      billDate,
      monthKey: billDate.slice(0, 7),
      items,
      totalQty,
      subtotal: r2(subtotal),
      gstMode,
      gstValue: parseFloat(gstValue) || 0,
      gstTotal: r2(gstTotal),
      totalAmount: r2(grand), // GST-inclusive
      notes: notes.trim(),
      status, // 'draft' = shopping list captured, pricing pending · 'final' = priced bill
      paid: status === 'draft' ? false : paid,
      paidDate: (status !== 'draft' && paid) ? (paidDate || billDate) : '',
    };

    setBusy(true);
    try {
      if (editing) await updateBill(id, payload);
      else await addBill(payload);
      nav(status === 'draft' ? '/bills?view=drafts' : `/bills?month=${billDate.slice(0, 7)}`);
    } catch (e) {
      alert('Save failed: ' + e.message);
      setBusy(false);
    }
  }

  if (!loaded) return <div className="empty">Loading bill…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{editing ? 'Edit bill' : 'New purchase bill'}</h1>
          <div className="sub">Enter qty + rate, or just qty + amount — the other fills in automatically</div>
        </div>
      </div>

      {vendors.length === 0 && (
        <div className="flash" style={{ background: '#fbeada', color: '#a96c12', borderColor: '#eccfa0' }}>
          No vendors yet — add one under <b>Vendors</b> first.
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>Vendor *</label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">— select vendor —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Bill / invoice no.</label>
            <input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="optional" />
          </div>
          <div className="field">
            <label>Bill date *</label>
            <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="item-grid head">
          <div>Ingredient</div><div>Qty</div><div>Unit</div><div>Rate (₹)</div><div style={{ textAlign: 'right' }}>Amount (₹)</div><div />
        </div>
        {lines.map((l, idx) => {
          const pending = !!l.pendingName && !l.ingredientId && !l.freeText;
          return (
            <div className={`item-grid ${pending ? 'needs-pick' : ''} ${l.freeText ? 'free-text' : ''}`} key={idx} style={{ marginBottom: 8 }}>
              <div>
                {l.freeText ? (
                  <>
                    <input value={l.name} onChange={(e) => setField(idx, 'name', e.target.value)} placeholder="custom item name" />
                    <div className="pick-hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span>custom item ·</span>
                      <select value={l.category || ''} onChange={(e) => setField(idx, 'category', e.target.value)} style={{ padding: '2px 6px', fontSize: 12 }}>
                        {cats.categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                      </select>
                      <button className="btn-link" type="button" onClick={() => toMaster(idx)} style={{ fontSize: 12 }}>pick from list instead</button>
                    </div>
                  </>
                ) : (
                  <>
                    <IngredientSelect
                      ingredients={ingredients}
                      value={l.ingredientId}
                      onPick={(ingId) => pickIngredient(idx, ingId)}
                      initialQuery={l.pendingName || ''}
                      placeholder={pending ? `⚠ choose for “${l.pendingName}”` : '— select —'}
                    />
                    {pending && (
                      <div className="pick-hint">
                        From your list: <b>{l.pendingName}</b> — not in master.{' '}
                        <button className="btn-link" type="button" onClick={() => toFreeText(idx)} style={{ fontSize: 12 }}>keep “{l.pendingName}” as a custom item</button>
                      </div>
                    )}
                  </>
                )}
              </div>
              <input className="num-input" inputMode="decimal" value={l.qty} onChange={(e) => setField(idx, 'qty', e.target.value)} placeholder="0" />
              <input value={l.unit} onChange={(e) => setField(idx, 'unit', e.target.value)} placeholder="unit" style={{ textAlign: 'center' }} />
              <input className="num-input" inputMode="decimal" value={l.rate} onChange={(e) => setField(idx, 'rate', e.target.value)} placeholder="auto" title={l.driver === 'amount' ? 'auto-calculated from amount' : ''} />
              <input className="num-input" inputMode="decimal" value={l.amount} onChange={(e) => setField(idx, 'amount', e.target.value)} placeholder="0.00" title={l.driver === 'rate' ? 'auto-calculated from rate' : ''} />
              <button className="x-btn" title="Remove line" onClick={() => setLines((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : [blankLine()]))}>×</button>
            </div>
          );
        })}

        <div className="add-line" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setLines((p) => [...p, blankLine()])}>＋ Add line</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setLines((p) => [...p, { ...blankLine(), freeText: true, category: defaultCatKey() }])}>＋ Custom item</button>
          <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)' }} />
          <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>⤓ Import from Excel</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setPasteVendor(vendorId); setShowInvoice(true); }}>📄 Paste transcribed bills</button>
          <button className="btn-link" type="button" onClick={downloadTemplate} style={{ fontSize: 13 }}>excel template</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={handleImportFile} />
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Tip: pick one bill to fill this form, or select several to save each as a draft for pricing later.</div>
        {importMsg && (
          <div className="flash" style={{ marginTop: 12, background: importMsg.ok ? '#e9f2e2' : '#fbeada', color: importMsg.ok ? '#3f7a34' : '#a96c12', borderColor: importMsg.ok ? '#cfe3bf' : '#eccfa0' }}>
            {importMsg.text}
          </div>
        )}

        <div className="row" style={{ marginTop: 18, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 2 }}>
            <label>Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional — e.g. cash / credit, vehicle, etc." />
          </div>
          <div className="field" style={{ flex: 'none' }}>
            <label>GST (whole bill)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="num-input" style={{ width: 90 }} inputMode="decimal" value={gstValue} placeholder="0" onChange={(e) => setGstValue(e.target.value)} />
              <div className="pay-toggle">
                <button type="button" className={gstMode === 'pct' ? 'on' : ''} style={gstMode === 'pct' ? { background: 'var(--turmeric)' } : null} onClick={() => setGstMode('pct')}>%</button>
                <button type="button" className={gstMode === 'amt' ? 'on' : ''} style={gstMode === 'amt' ? { background: 'var(--turmeric)' } : null} onClick={() => setGstMode('amt')}>₹</button>
              </div>
            </div>
          </div>
          <div className="field" style={{ flex: 'none' }}>
            <label>Payment</label>
            <div className="pay-toggle">
              <button type="button" className={paid ? 'on' : ''} onClick={() => setPaidStatus(true)}>Paid</button>
              <button type="button" className={!paid ? 'on unpaid' : ''} onClick={() => setPaidStatus(false)}>Unpaid</button>
            </div>
          </div>
          {paid && (
            <div className="field" style={{ flex: 'none' }}>
              <label>Paid on</label>
              <input type="date" value={paidDate} onChange={(e) => { setPaidDate(e.target.value); setPaidTouched(true); }} />
            </div>
          )}
        </div>
        {!paid && <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>Outstanding — will appear under <b>Bills Ledger → Unpaid (settlement)</b>.</div>}
        {gstTotal > 0 && <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>GST is split across items by value, so each ingredient's cost/{lines[0]?.unit || 'kg'} includes its share.</div>}

        <div className="bill-foot" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div className="muted" style={{ fontSize: 13.5 }}>Total qty: <span className="tnum">{totalQty.toLocaleString('en-IN', { maximumFractionDigits: 3 })}</span></div>
          <div className="muted" style={{ fontSize: 13.5 }}>Subtotal: <span className="tnum">{inr(subtotal)}</span></div>
          {gstTotal > 0 && <div className="muted" style={{ fontSize: 13.5 }}>GST{gstMode === 'pct' && gstValue ? ` (${gstValue}%)` : ''}: <span className="tnum">{inr(gstTotal)}</span></div>}
          <div><span className="muted" style={{ fontSize: 13 }}>Bill total&nbsp;</span><span className="grand">{inr(grand)}</span></div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={() => nav('/bills')}>Cancel</button>
        <button className="btn btn-ghost" onClick={() => saveAs('draft')} disabled={busy} title="Capture the shopping list now; add rates later">{busy ? '…' : '🗒 Save as draft'}</button>
        <button className="btn btn-primary" onClick={() => saveAs('final')} disabled={busy}>{busy ? 'Saving…' : (editing ? 'Save bill' : 'Save bill')}</button>
      </div>

      {showInvoice && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setShowInvoice(false)}>
          <div className="modal" style={{ maxWidth: 680 }}>
            <div className="modal-head">Paste transcribed bills → drafts</div>
            <div className="modal-body">
              <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
                Paste one or more bills (markdown tables or plain rows). Each bill — split on its “Bill No” / date line — is saved as a separate draft. Tamil item names, fractions (½, 1¼) and the totals row are handled. Verify and price each in the Drafts tab.
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>Vendor for these bills (optional)</label>
                <select value={pasteVendor} onChange={(e) => setPasteVendor(e.target.value)}>
                  <option value="">— set later on each draft —</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <textarea rows={12} value={invoiceText} onChange={(e) => setInvoiceText(e.target.value)} placeholder="Paste the transcribed bill tables here…" style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 13 }} />
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setShowInvoice(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={applyInvoiceToDrafts} disabled={!invoiceText.trim() || aiBusy}>{aiBusy ? 'Saving…' : 'Parse & save as draft(s)'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
