// Price–volume variance analysis across a run of months (oldest first).
//
// Input: one rollupByIngredient() result per month, e.g. [Jul, Aug, Sep].
// The LAST month is the one being judged; the months before it form the
// baseline (average monthly qty, and a quantity-weighted average rate).
//
// For every ingredient the change in total spend is split in two:
//   Quantity effect = (cur qty - base qty) x base rate     -> "we bought more/less"
//   Price effect    = (cur rate - base rate) x cur qty     -> "it cost more/less per unit"
//   Quantity effect + Price effect = current spend - baseline spend   (exact)
// Positive = spent MORE than baseline (adverse), negative = spent less.
//
// An ingredient bought only this month ('new') has its whole spend counted as
// quantity effect; one bought in the baseline but not this month ('stopped')
// shows the baseline spend as a negative quantity effect. No price effect is
// invented where there is nothing to compare a rate against.

const keyOf = (r) => r.ingredientId || r.name;

export function computeVariance(monthRollups, basis = 'avg') {
  const n = monthRollups.length;
  if (n < 2) return { rows: [], totals: {} };
  const k = basis === 'prev' ? 1 : n - 1; // number of baseline months

  const index = monthRollups.map((arr) => {
    const m = new Map();
    arr.forEach((r) => m.set(keyOf(r), r));
    return m;
  });

  const keys = new Set();
  monthRollups.forEach((arr) => arr.forEach((r) => keys.add(keyOf(r))));

  const rows = [];
  keys.forEach((key) => {
    let meta = null;
    const months = index.map((m) => {
      const r = m.get(key);
      if (r && !meta) meta = r;
      return r
        ? { qty: r.totalQty, amount: r.totalAmount, rate: r.totalQty > 0 ? r.totalAmount / r.totalQty : 0 }
        : { qty: 0, amount: 0, rate: 0 };
    });

    const prior = months.slice(n - 1 - k, n - 1);
    const cur = months[k];
    const priorQty = prior.reduce((s, m) => s + m.qty, 0);
    const priorAmt = prior.reduce((s, m) => s + m.amount, 0);
    const baseQty = priorQty / k;       // average monthly quantity
    const baseAmt = priorAmt / k;       // average monthly spend
    const baseRate = priorQty > 0 ? priorAmt / priorQty : 0;

    let status = 'both';
    let qtyEffect; let priceEffect;
    if (priorQty <= 0 && cur.qty > 0) { status = 'new'; qtyEffect = cur.amount; priceEffect = 0; }
    else if (priorQty > 0 && cur.qty <= 0) { status = 'stopped'; qtyEffect = -baseAmt; priceEffect = 0; }
    else {
      qtyEffect = (cur.qty - baseQty) * baseRate;
      priceEffect = (cur.rate - baseRate) * cur.qty;
    }

    const variance = cur.amount - baseAmt;
    rows.push({
      key, name: meta.name, category: meta.category, unit: meta.unit, status,
      months, baseQty, baseRate, baseAmt,
      curQty: cur.qty, curRate: cur.rate, curAmt: cur.amount,
      qtyPct: baseQty > 0 ? ((cur.qty - baseQty) / baseQty) * 100 : null,
      ratePct: baseRate > 0 && cur.rate > 0 ? ((cur.rate - baseRate) / baseRate) * 100 : null,
      qtyEffect, priceEffect, variance,
      variancePct: baseAmt > 0 ? (variance / baseAmt) * 100 : null,
    });
  });

  rows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
  return { rows };
}

// Roll a set of rows up into one summary line (for class subtotals / grand total).
export function sumRows(rows, monthCount) {
  const t = {
    count: rows.length, baseAmt: 0, curAmt: 0, qtyEffect: 0, priceEffect: 0, variance: 0,
    monthAmounts: Array.from({ length: monthCount }, () => 0),
  };
  rows.forEach((r) => {
    t.baseAmt += r.baseAmt; t.curAmt += r.curAmt;
    t.qtyEffect += r.qtyEffect; t.priceEffect += r.priceEffect; t.variance += r.variance;
    r.months.forEach((m, i) => { t.monthAmounts[i] += m.amount; });
  });
  t.variancePct = t.baseAmt > 0 ? (t.variance / t.baseAmt) * 100 : null;
  return t;
}
