/* Vercel serverless function: French electricity load and day-ahead price
   from the Energy-Charts API (Fraunhofer ISE; load from ENTSO-E, price from
   Bundesnetzagentur | SMARD.de; CC BY 4.0). No key, but the API restricts
   CORS, so the page goes through this route. Quarter-hour values are averaged
   to hourly means.
   GET /api/france?start=YYYY-MM-DD&end=YYYY-MM-DD
   Returns { load: [[ms, MW], ...], price: [[ms, EUR/MWh], ...] }. UTC ms. */

const HOUR = 3600 * 1000;

function isoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '');
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'highcharts-orbit-demo/1.0' } });
  if (!r.ok) throw new Error('energy-charts HTTP ' + r.status + ' for ' + url.split('?')[0]);
  return r.json();
}

function hourlyMeans(seconds, values, decimals) {
  const sums = {}, counts = {};
  for (let i = 0; i < seconds.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) continue;
    const h = Math.floor(seconds[i] * 1000 / HOUR) * HOUR;
    sums[h] = (sums[h] || 0) + v;
    counts[h] = (counts[h] || 0) + 1;
  }
  const f = Math.pow(10, decimals);
  return Object.keys(sums).map(function (h) {
    return [Number(h), Math.round(sums[h] / counts[h] * f) / f];
  }).sort(function (a, b) { return a[0] - b[0]; });
}

module.exports = async function handler(req, res) {
  const { start, end } = req.query;
  if (!isoDate(start) || !isoDate(end)) {
    res.status(400).json({ error: 'start and end must be YYYY-MM-DD' });
    return;
  }
  try {
    const range = '&start=' + start + '&end=' + end;
    const [pp, pr] = await Promise.all([
      getJSON('https://api.energy-charts.info/public_power?country=fr' + range),
      getJSON('https://api.energy-charts.info/price?bzn=FR' + range)
    ]);
    const loadType = (pp.production_types || []).find(function (t) { return t.name === 'Load'; });
    if (!loadType) throw new Error('energy-charts public_power has no Load series');
    const load = hourlyMeans(pp.unix_seconds, loadType.data, 0);
    const price = hourlyMeans(pr.unix_seconds, pr.price, 2);
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({
      load,
      price,
      source: 'Energy-Charts (Fraunhofer ISE): load from ENTSO-E, day-ahead price from Bundesnetzagentur | SMARD.de, CC BY 4.0',
      fetchedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
