// Vercel serverless function: fetches recent mandi (wholesale market) prices from the
// government's open data API (data.gov.in) for a list of commodities, for the
// Koviloor Kitchen (Sanatana Dharma Trust Annadhanam -- near Madurai/Trichy/Sivaganga).
// The API key stays server-side (set DATA_GOV_IN_API_KEY in Vercel env vars).
//
// Source: "Current Daily Price of Various Commodities from Various Markets (Mandi)"
// Ministry of Agriculture & Farmers Welfare, resource 9ef84268-d588-465a-a308-a864a43d0070.
// Prices in that dataset are per QUINTAL (100 kg); this function converts to per-KG.
//
// Lookup order per commodity:
//   1. Karaikudi market specifically (closest market to Koviloor)
//   2. Markets in nearby districts (Sivaganga, Madurai, Tiruchirappalli, Pudukkottai,
//      Ramanathapuram) -- filtered client-side since the API only filters by
//      market/commodity/state directly, not district
//   3. Any market in Tamil Nadu (widest fallback)
//
// The public API is prone to 429 (rate limited) and, from some hosting providers,
// outright connection failures -- this hits it gently (a few requests at a time,
// not all at once), with retries/backoff and browser-like headers (see fetchJson),
// and reports the real reason ('rate_limited' / 'no_data' / 'fetch_failed') plus a
// debug object so the UI's "Diagnostic info" panel can show what actually happened
// instead of a blanket "unavailable".

const RESOURCE_ID = '9ef84268-d588-465a-a308-a864a43d0070';
const STATE = 'Tamil Nadu';
const PRIORITY_MARKET = 'Karaikudi';
const NEAR_DISTRICTS = ['Sivaganga', 'Madurai', 'Tiruchirappalli', 'Pudukkottai', 'Ramanathapuram'];
const CONCURRENCY = 6; // how many commodities to query at once -- keep gentle on the shared API

// Run this function from Vercel's Mumbai region instead of the US default.
// Indian government sites commonly block/drop connections from foreign
// datacenter IP ranges (which is what a US-region Vercel function looks like
// to them) while allowing connections that originate from India -- this is a
// strong second suspect now that browser-like headers alone didn't fix it.
export const config = { maxDuration: 30, regions: ['bom1'] };

async function fetchJson(url) {
  let r;
  const ac = new AbortController();
  const killer = setTimeout(() => ac.abort(), 12000); // don't let one bad connection eat the whole function budget
  try {
    r = await fetch(url, {
      signal: ac.signal,
      headers: {
        // Node's default fetch() sends almost no headers, which some government
        // anti-bot/WAF filters silently reject (drop the connection) rather than
        // return a proper HTTP error. Real browsers always send these two.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
      },
    });
  } catch (networkErr) {
    // Node's fetch (undici) wraps the *real* network error inside `.cause` and
    // gives every failure the same useless top-level message "fetch failed" --
    // so we have to dig into .cause to see the actual reason (ECONNREFUSED,
    // ENOTFOUND, ETIMEDOUT, a TLS/certificate error, an abort, etc).
    const cause = networkErr && networkErr.cause;
    const detail = ac.signal.aborted
      ? 'timeout (no response within 12s)'
      : (cause && (cause.code || cause.message)) || (networkErr && networkErr.message) || 'unknown';
    const e = new Error('fetch failed: ' + detail);
    e.code = 'fetch_failed';
    throw e;
  } finally {
    clearTimeout(killer);
  }
  if (r.status === 429) { const e = new Error('rate_limited'); e.code = 'rate_limited'; throw e; }
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.code = 'http_' + r.status; throw e; }
  return r.json();
}

async function fetchWithRetry(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetchJson(url);
    } catch (e) {
      lastErr = e;
      const wait = e.code === 'rate_limited' ? 900 * (i + 1) : 400 * (i + 1);
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

function toISO(d) {
  const [dd, mm, yyyy] = (d || '').split('/');
  return dd && mm && yyyy ? `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` : '';
}

function parseRecords(data) {
  const records = Array.isArray(data.records) ? data.records : [];
  return records
    .map((r) => ({
      date: r.arrival_date, min: parseFloat(r.min_price), max: parseFloat(r.max_price),
      modal: parseFloat(r.modal_price), variety: r.variety || '', district: r.district || '', market: r.market || '',
    }))
    .filter((r) => !isNaN(r.modal));
}

function pickLatest(parsed) {
  if (parsed.length === 0) return null;
  const sorted = [...parsed].sort((a, b) => toISO(b.date).localeCompare(toISO(a.date)));
  return sorted[0];
}

function toResult(latest) {
  return {
    ok: true, date: toISO(latest.date), variety: latest.variety, market: latest.market,
    minPerKg: Math.round((latest.min / 100) * 100) / 100,
    maxPerKg: Math.round((latest.max / 100) * 100) / 100,
    modalPerKg: Math.round((latest.modal / 100) * 100) / 100,
  };
}

// One query against the API for a commodity, optionally scoped to a specific market.
// Returns { parsed, rawCount } -- rawCount is the number of raw records returned,
// before any client-side filtering, so the debug panel can show what the API sent back.
async function queryOnce(apiKey, commodity, market) {
  let url = `https://api.data.gov.in/resource/${RESOURCE_ID}` +
    `?api-key=${encodeURIComponent(apiKey)}&format=json&limit=50` +
    `&filters[state.keyword]=${encodeURIComponent(STATE)}` +
    `&filters[commodity]=${encodeURIComponent(commodity)}`;
  if (market) url += `&filters[market]=${encodeURIComponent(market)}`;
  const data = await fetchWithRetry(url);
  const parsed = parseRecords(data);
  return { parsed, rawCount: Array.isArray(data.records) ? data.records.length : 0 };
}

export default async function handler(req, res) {
  try {
    const apiKey = process.env.DATA_GOV_IN_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: 'DATA_GOV_IN_API_KEY is not configured on the server.' });
    }
    const commodities = (req.query.commodities || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (commodities.length === 0) {
      return res.status(400).json({ ok: false, error: 'Pass ?commodities=Onion,Potato,Tomato' });
    }

    const results = {};
    const debug = {};

    await runThrottled(commodities, async (commodity) => {
      const dbg = { tries: [] };
      try {
        // 1. Karaikudi market specifically.
        let r = await queryOnce(apiKey, commodity, PRIORITY_MARKET);
        dbg.tries.push({ scope: PRIORITY_MARKET, rawCount: r.rawCount });
        let latest = pickLatest(r.parsed);
        if (latest) { results[commodity] = { ...toResult(latest), scope: 'karaikudi' }; debug[commodity] = dbg; return; }

        // 2. Nearby districts (client-side filter, since the API has no district param).
        r = await queryOnce(apiKey, commodity, null);
        dbg.tries.push({ scope: 'Tamil Nadu (all)', rawCount: r.rawCount });
        const nearRecords = r.parsed.filter((rec) => NEAR_DISTRICTS.some((d) => rec.district && rec.district.toLowerCase().includes(d.toLowerCase())));
        latest = pickLatest(nearRecords);
        if (latest) { results[commodity] = { ...toResult(latest), scope: 'near' }; debug[commodity] = dbg; return; }

        // 3. Any market in Tamil Nadu.
        latest = pickLatest(r.parsed);
        if (latest) { results[commodity] = { ...toResult(latest), scope: 'tamil_nadu' }; debug[commodity] = dbg; return; }

        results[commodity] = { ok: false, reason: 'no_data' };
        debug[commodity] = dbg;
      } catch (e) {
        results[commodity] = { ok: false, reason: e.code === 'rate_limited' ? 'rate_limited' : 'fetch_failed' };
        dbg.error = e.message;
        debug[commodity] = dbg;
      }
      return null;
    }, CONCURRENCY);

    const values = Object.values(results);
    const anyOk = values.some((r) => r.ok);
    const allRateLimited = values.length > 0 && values.every((r) => !r.ok && r.reason === 'rate_limited');
    const allFetchFailed = values.length > 0 && values.every((r) => !r.ok && r.reason === 'fetch_failed');

    res.setHeader('Cache-Control', anyOk ? 's-maxage=21600, stale-while-revalidate=43200' : 'no-store');
    return res.status(200).json({
      ok: true,
      market: PRIORITY_MARKET,
      results,
      debug,
      note: allRateLimited
        ? 'The government price API is rate-limiting this key right now -- try again in a few minutes.'
        : allFetchFailed
          ? 'Could not connect to the government price API from the server -- this is usually temporary; try again shortly.'
          : undefined,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Unknown error' });
  }
}
