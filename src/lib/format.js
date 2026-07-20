// Currency in Indian format (₹1,23,456.50)
export function inr(n, decimals = 2) {
  const v = Number(n) || 0;
  return '₹' + v.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Plain Indian-grouped number
export function num(n, decimals = 2) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Quantity: trim trailing zeros (e.g. 5, 2.5, 0.75)
export function qty(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

// 'YYYY-MM-DD' -> '12 Jun 2026'
export function prettyDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00');
  if (isNaN(d)) return isoDate;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// 'YYYY-MM' -> 'June 2026'
export function prettyMonth(monthKey) {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

// 'YYYY-MM' short -> "Jun '26"
export function shortMonth(monthKey) {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'short' }) + " '" + y.slice(2);
}

// Current month key 'YYYY-MM'
export function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Today 'YYYY-MM-DD'
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Build last N month keys ending at (and including) the given month key, oldest first.
export function lastNMonths(endMonthKey, n) {
  const [y, m] = endMonthKey.split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// 'YYYY-MM' -> first/last day ISO strings
export function monthRange(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { first, last };
}
