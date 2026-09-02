/* Vercel serverless function: hourly day-ahead spot prices for a Norwegian
   bidding zone from hvakosterstrommen.no, one JSON file per day, fetched in
   parallel and merged so the page makes one request instead of fifty.
   GET /api/no2?start=YYYY-MM-DD&end=YYYY-MM-DD&area=NO2
   Returns { price: [[ms, EUR/MWh], ...], source }. Timestamps are UTC ms. */

const AREAS = ['NO1', 'NO2', 'NO3', 'NO4', 'NO5'];

function isoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '');
}

function dayList(start, end) {
  const out = [];
  const d = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  while (d <= e && out.length < 120) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function fetchDay(day, area) {
  const url = 'https://www.hvakosterstrommen.no/api/v1/prices/' +
    day.slice(0, 4) + '/' + day.slice(5, 7) + '-' + day.slice(8, 10) + '_' + area + '.json';
  const r = await fetch(url, { headers: { 'User-Agent': 'highcharts-orbit-demo/1.0' } });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error('hvakosterstrommen ' + day + ' HTTP ' + r.status);
  const rows = await r.json();
  return rows.map(function (x) {
    return [Date.parse(x.time_start), Math.round(x.EUR_per_kWh * 1000 * 100) / 100];
  }).filter(function (p) { return !isNaN(p[0]); });
}

module.exports = async function handler(req, res) {
  const { start, end } = req.query;
  const area = AREAS.indexOf(req.query.area) >= 0 ? req.query.area : 'NO2';
  if (!isoDate(start) || !isoDate(end)) {
    res.status(400).json({ error: 'start and end must be YYYY-MM-DD' });
    return;
  }
  try {
    const days = dayList(start, end);
    const parts = await Promise.all(days.map(function (d) { return fetchDay(d, area); }));
    const price = [].concat.apply([], parts).sort(function (a, b) { return a[0] - b[0]; });
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({
      area,
      price,
      source: 'hvakosterstrommen.no (day-ahead prices, attribution required)',
      fetchedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
