/* Vercel serverless function: ERCOT hourly generation by fuel type from the
   EIA API v2, keyed server-side. Used for a single day, so no chunking.
   GET /api/fuelmix?start=YYYY-MM-DD&end=YYYY-MM-DD
   Returns { series: { SUN: [[ms, MW], ...], WND: ..., NG: ..., ... }, names }.
   Battery values are net: negative while charging, positive while discharging.
   Periods from EIA are UTC hours; we emit UTC ms. */

const BASE = 'https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/';
const NAMES = {
  SUN: 'Solar', WND: 'Wind', NG: 'Natural gas', COL: 'Coal',
  NUC: 'Nuclear', BAT: 'Batteries', WAT: 'Hydro', OTH: 'Other'
};

function isoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '');
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
    const q = new URLSearchParams();
    q.set('api_key', key);
    q.set('frequency', 'hourly');
    q.append('data[]', 'value');
    q.append('facets[respondent][]', 'ERCO');
    q.set('start', start + 'T00');
    q.set('end', end + 'T23');
    q.set('sort[0][column]', 'period');
    q.set('sort[0][direction]', 'asc');
    q.set('length', '5000');
    const r = await fetch(BASE + '?' + q.toString());
    if (!r.ok) throw new Error('EIA fuel-type HTTP ' + r.status);
    const j = await r.json();
    const series = {};
    for (const row of (j.response && j.response.data) || []) {
      if (row.value === null || row.value === undefined) continue;
      const ms = Date.parse(row.period + ':00:00Z');
      if (isNaN(ms)) continue;
      const f = row.fueltype;
      if (!NAMES[f]) continue;
      (series[f] = series[f] || []).push([ms, Number(row.value)]);
    }
    Object.keys(series).forEach(function (f) {
      series[f].sort(function (a, b) { return a[0] - b[0]; });
    });
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({
      series,
      names: NAMES,
      source: 'U.S. Energy Information Administration, Hourly Electric Grid Monitor (public domain)',
      fetchedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
