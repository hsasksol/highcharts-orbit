/* Vercel serverless function: ERCOT hourly demand and day-ahead demand
   forecast from the EIA API v2, keyed server-side.
   GET /api/ercot?start=YYYY-MM-DD&end=YYYY-MM-DD
   Returns { demand: [[ms, MW], ...], forecast: [[ms, MW], ...], source }.
   Periods from EIA are UTC hours ("2026-07-22T23"); we emit UTC ms. */

const BASE = 'https://api.eia.gov/v2/electricity/rto/region-data/data/';

function isoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '');
}

async function fetchType(key, type, start, end) {
  const q = new URLSearchParams();
  q.set('api_key', key);
  q.set('frequency', 'hourly');
  q.append('data[]', 'value');
  q.append('facets[respondent][]', 'ERCO');
  q.append('facets[type][]', type);
  q.set('start', start + 'T00');
  q.set('end', end + 'T23');
  q.set('sort[0][column]', 'period');
  q.set('sort[0][direction]', 'asc');
  q.set('length', '5000');
  const r = await fetch(BASE + '?' + q.toString());
  if (!r.ok) throw new Error('EIA ' + type + ' HTTP ' + r.status);
  const j = await r.json();
  const rows = (j.response && j.response.data) || [];
  const out = [];
  for (const row of rows) {
    if (row.value === null || row.value === undefined) continue;
    const ms = Date.parse(row.period + ':00:00Z');
    if (!isNaN(ms)) out.push([ms, Number(row.value)]);
  }
  return out;
}

module.exports = async function handler(req, res) {
  const key = process.env.EIA_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'EIA_API_KEY is not configured' });
    return;
  }
  const { start, end } = req.query;
  if (!isoDate(start) || !isoDate(end)) {
    res.status(400).json({ error: 'start and end must be YYYY-MM-DD' });
    return;
  }
  try {
    /* EIA is slow on long ranges; fetch in 20-day chunks in parallel. */
    const chunks = [];
    const d = new Date(start + 'T00:00:00Z'), e = new Date(end + 'T00:00:00Z');
    while (d <= e && chunks.length < 12) {
      const c0 = d.toISOString().slice(0, 10);
      d.setUTCDate(d.getUTCDate() + 19);
      const c1 = (d <= e ? d : e).toISOString().slice(0, 10);
      chunks.push([c0, c1]);
      d.setUTCDate(d.getUTCDate() + 1);
    }
    const parts = await Promise.all(chunks.map(function (c) {
      return Promise.all([fetchType(key, 'D', c[0], c[1]), fetchType(key, 'DF', c[0], c[1])]);
    }));
    const demand = [].concat.apply([], parts.map(function (p) { return p[0]; }));
    const forecast = [].concat.apply([], parts.map(function (p) { return p[1]; }));
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({
      demand,
      forecast,
      source: 'U.S. Energy Information Administration, Hourly Electric Grid Monitor (public domain)',
      fetchedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
