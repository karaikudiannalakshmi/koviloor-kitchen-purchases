// Remembers which items are the SAME product under a changed name (e.g. after a brand
// change), so the variance report compares them as one item instead of showing the old
// name as "not bought" and the new name as "new".
//
// Nothing in the bills or ingredient list is changed -- the pairing is stored in one
// small Firestore document and applied only when the variance report is calculated.
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const REF = () => doc(db, 'variance_settings', 'merges');
const keyOf = (r) => r.ingredientId || r.name;

export async function loadMerges() {
  try {
    const snap = await getDoc(REF());
    return snap.exists() ? (snap.data().pairs || []) : [];
  } catch (e) {
    return [];
  }
}

// pairs: [{ fromKey, toKey, fromName, toName }]  -- fromKey (old name) is folded into toKey (new name)
export async function saveMerges(pairs) {
  await setDoc(REF(), { pairs, updatedAt: Date.now() });
}

// Fold each month's rollup rows so renamed items are combined under their new name.
export function applyMerges(rollups, pairs) {
  if (!pairs || pairs.length === 0) return rollups;
  const toOf = new Map(pairs.map((p) => [p.fromKey, p.toKey]));
  const resolve = (k) => { let cur = k; for (let i = 0; i < 6 && toOf.has(cur); i++) cur = toOf.get(cur); return cur; };

  const meta = new Map(); // key -> first row seen (name / category / unit of the surviving item)
  rollups.forEach((arr) => arr.forEach((r) => { if (!meta.has(keyOf(r))) meta.set(keyOf(r), r); }));

  return rollups.map((arr) => {
    const out = new Map();
    arr.forEach((r) => {
      const target = resolve(keyOf(r));
      const m = meta.get(target) || r;
      if (!out.has(target)) {
        out.set(target, { ingredientId: m.ingredientId, name: m.name, category: m.category, unit: m.unit, totalQty: 0, totalAmount: 0, billCount: 0 });
      }
      const o = out.get(target);
      o.totalQty += r.totalQty; o.totalAmount += r.totalAmount; o.billCount += r.billCount || 0;
    });
    return [...out.values()];
  });
}
