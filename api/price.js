/* Vercel serverless function: European day-ahead electricity prices from the
   Energy-Charts API (Fraunhofer ISE, data from SMARD / Bundesnetzagentur,
   CC BY 4.0). The API has no key but restricts CORS, so the page goes
   through this route. Quarter-hour values are averaged to hourly means.
   GET /api/price?bzn=FR&start=YYYY-MM-DD&end=YYYY-MM-DD
   Returns { bzn, price: [[ms, EUR/MWh], ...], source }. Timestamps UTC ms. */

const BZN = ['FR', 'DE-LU', 'ES', 'IT-North', 'NL', 'BE', 'AT', 'PL', 'NO2', 'SE3', 'DK1', 'DK2', 'FI', 'CH', 'GB'];
const HOUR = 3600 * 1000;

function isoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '');
}

module.exports = async function handler(req, res) {
  const { start, end } = req.query;
  const bzn = BZN.indexOf(req.query.bzn) >= 0 ? req.query.bzn : 'FR';
  if (!isoDate(start) || !isoDate(end)) {
    res.status(400).json({ error: 'start and end must be YYYY-MM-DD' });
    return;
  }
  try {
    const url = 'https://api.energy-charts.info/price?bzn=' + encodeURIComponent(bzn) +
      '&start=' + start + '&end=' + end;
    const r = await fetch(url, { headers: { 'User-Agent': 'highcharts-orbit-demo/1.0' } });
    if (!r.ok) throw new Error('energy-charts HTTP ' + r.status);
    const j = await r.json();
    const sums = {}, counts = {};
    for (let i = 0; i < j.unix_seconds.length; i++) {
      const v = j.price[i];
      if (v === null || v === undefined) continue;
      const h = Math.floor(j.unix_seconds[i] * 1000 / HOUR) * HOUR;
      sums[h] = (sums[h] || 0) + v;
      counts[h] = (counts[h] || 0) + 1;
    }
    const price = Object.keys(sums).map(function (h) {
      return [Number(h), Math.round(sums[h] / counts[h] * 100) / 100];
    }).sort(function (a, b) { return a[0] - b[0]; });
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({
      bzn,
      price,
      unit: j.unit,
      source: 'Energy-Charts (Fraunhofer ISE), data from Bundesnetzagentur | SMARD.de, CC BY 4.0',
      fetchedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
