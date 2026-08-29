// Vercel serverless function: fetches recent mandi prices near Koviloor Kitchen
// (Sivaganga / Madurai / Tiruchirappalli region) from the government's open
// data API (data.gov.in) for a list of commodities. The API key stays
// server-side (set DATA_GOV_IN_API_KEY in Vercel env vars).
//
// Source: "Current Daily Price of Various Commodities from Various Markets (Mandi)"
// Ministry of Agriculture & Farmers Welfare, resource 9ef84268-d588-465a-a308-a864a43d0070.
// Prices in that dataset are per QUINTAL (100 kg); this function converts to per-KG.
//
// Strategy: try nearby districts first (Sivaganga, Madurai, Trichy, Pudukkottai,
// Ramanathapuram); fall back to any Tamil Nadu market only if nothing nearby
// has reported, and say so plainly (market name + a "fallback" flag).
const RESOURCE_ID = '9ef84268-d588-465a-a308-a864a43d0070';
// Koviloor Kitchen (Sanatana Dharma Trust) is near Karaikudi, in Sivaganga district,
// between Madurai and Tiruchirappalli (Trichy). There's no single flagship wholesale
// market the way Chennai has Koyambedu, so the first-choice tier is these nearby
// districts' farmers' markets (Uzhavar Sandhai) rather than one named market.
const NEAR_DISTRICTS = ['Sivaganga', 'Madurai', 'Thiruchirappalli', 'Tiruchirappalli', 'Pudukkottai', 'Ramanathapuram'];
const CONCURRENCY = 6; // how many commodities to query at once -- fast enough to stay under serverless time limits

function toISO(d) {
  const [dd, mm, yyyy] = (d || '').split('/');
  return dd && mm && yyyy ? `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` : '';
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (r.status === 429) { const e = new Error('rate_limited'); e.code = 'rate_limited'; throw e; }
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.code = 'http_' + r.status; throw e; }
  return r.json();
}

async function fetchWithRetry(url, tries) {
  tries = tries || 2;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetchJson(url);
    } catch (e) {
      lastErr = e;
      const wait = e.code === 'rate_limited' ? 500 * (i + 1) : 250 * (i + 1);
      if (i < tries - 1) await new Promise((res) => setTimeout(res, wait));
    }
  }
  throw lastErr;
}

async function runThrottled(items, worker, concurrency) {
  const results = new Array(items.length);
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const my = idx++;
      results[my] = await worker(items[my]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  return results;
}

async function queryOnce(apiKey, params, districtFilter) {
  const qs = Object.entries(params).map(function (kv) { return kv[0] + '=' + encodeURIComponent(kv[1]); }).join('&');
  const url = 'https://api.data.gov.in/resource/' + RESOURCE_ID + '?api-key=' + encodeURIComponent(apiKey) + '&format=json&limit=200&' + qs;
  const data = await fetchWithRetry(url);
  if (data && data.success === false) {
    const e = new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error || 'api_error'));
    e.code = 'api_error';
    throw e;
  }
  const records = Array.isArray(data.records) ? data.records : [];
  let parsed = records.map(function (r) {
    return {
      date: r.arrival_date, min: parseFloat(r.min_price), max: parseFloat(r.max_price),
      modal: parseFloat(r.modal_price), variety: r.variety || '', market: r.market || '', district: r.district || '',
    };
  }).filter(function (r) { return !isNaN(r.modal); });
  if (districtFilter) {
    parsed = parsed.filter(function (r) { return districtFilter.some(function (d) { return r.district.toLowerCase().indexOf(d.toLowerCase()) >= 0; }); });
  }
  if (parsed.length === 0) return { latest: null, rawCount: records.length };
  parsed.sort(function (a, b) { return toISO(b.date).localeCompare(toISO(a.date)); });
  return { latest: parsed[0], rawCount: records.length };
}

// Simple in-process cache: once a commodity succeeds, remember it for this
// warm server instance so a later dashboard load doesn't re-query (and
// re-risk rate-limiting) an item that already worked. TTL 6 hours.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = globalThis.__marketRateCache || (globalThis.__marketRateCache = new Map());

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const apiKey = process.env.DATA_GOV_IN_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: 'DATA_GOV_IN_API_KEY is not configured on the server.' });
    }
    const commodities = (req.query.commodities || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (commodities.length === 0) {
      return res.status(400).json({ ok: false, error: 'Pass ?commodities=Onion,Potato,Tomato' });
    }

    const results = {};
    const debug = {};
    const now = Date.now();
    const toFetch = [];
    for (const commodity of commodities) {
      const hit = cache.get(commodity);
      if (hit && hit.ok && (now - hit.at) < CACHE_TTL_MS) {
        results[commodity] = hit.data;
        debug[commodity] = { cached: true };
      } else {
        toFetch.push(commodity);
      }
    }

    await runThrottled(toFetch, async function (commodity) {
      try {
        const r1 = await queryOnce(apiKey, { 'filters[state.keyword]': 'Tamil Nadu', 'filters[commodity]': commodity }, NEAR_DISTRICTS);
        let usedMarket = r1.latest ? (r1.latest.market || 'Near Koviloor (other market)') : null;
        let usedTier = 'near_koviloor';
        let latest = r1.latest;
        debug[commodity] = { nearRawCount: r1.rawCount };

        if (!latest) {
          const r2 = await queryOnce(apiKey, { 'filters[state.keyword]': 'Tamil Nadu', 'filters[commodity]': commodity });
          debug[commodity].tnRawCount = r2.rawCount;
          latest = r2.latest;
          usedTier = 'tamil_nadu';
          usedMarket = latest ? (latest.market || 'Tamil Nadu (other market)') : null;
        }
        if (!latest) { results[commodity] = { ok: false, reason: 'no_data' }; return null; }
        results[commodity] = {
          ok: true, date: toISO(latest.date), variety: latest.variety, market: usedMarket, tier: usedTier,
          fallback: usedTier !== 'near_koviloor',
          minPerKg: Math.round((latest.min / 100) * 100) / 100,
          maxPerKg: Math.round((latest.max / 100) * 100) / 100,
          modalPerKg: Math.round((latest.modal / 100) * 100) / 100,
        };
        cache.set(commodity, { ok: true, at: now, data: results[commodity] });
      } catch (e) {
        results[commodity] = { ok: false, reason: e.code === 'rate_limited' ? 'rate_limited' : 'fetch_failed' };
        debug[commodity] = Object.assign({}, debug[commodity] || {}, { error: e.message });
      }
      return null;
    }, CONCURRENCY);

    const values = Object.values(results);
    const anyOk = values.some(function (r) { return r.ok; });
    const allRateLimited = values.length > 0 && values.every(function (r) { return !r.ok && r.reason === 'rate_limited'; });

    res.setHeader('Cache-Control', anyOk ? 's-maxage=21600, stale-while-revalidate=43200' : 'no-store');
    return res.status(200).json({
      ok: true,
      market: 'Near Koviloor',
      results: results,
      note: allRateLimited ? 'The government price API is rate-limiting this key right now -- try again in a few minutes.' : undefined,
      debug: debug,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Unknown error' });
  }
}
