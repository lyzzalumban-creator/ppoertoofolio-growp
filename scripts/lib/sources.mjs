// Pengambil harga penutupan dari sumber gratis tanpa API key.
//  - Yahoo Finance : saham IDX (.JK), saham AS, kurs USD/IDR, emas (GC=F)
//  - Stooq         : cadangan untuk saham AS, kurs, dan emas bila Yahoo menolak
//  - CoinGecko     : kripto, langsung dalam rupiah
// Semua fungsi menerima `get` supaya bisa dites tanpa jaringan.

import { dateInTz } from './portfolio.mjs';

const UA = 'Mozilla/5.0 (compatible; portfolio-updater/1.0)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET dengan timeout dan retry (hanya untuk 429/5xx/gangguan jaringan).
 * Pada 429 (kena batas request) jedanya mengikuti header Retry-After, maksimal 30 detik;
 * jeda 1-4 detik terbukti terlalu pendek untuk CoinGecko.
 */
export async function getUrl(url, { headers = {}, json = true, tries = 3, wait = sleep } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    let delay = 1000 * 2 ** i;
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: json ? 'application/json' : 'text/csv,*/*', ...headers },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return json ? await res.json() : await res.text();
      lastErr = new Error(`HTTP ${res.status} dari ${new URL(url).host}`);
      if (res.status < 500 && res.status !== 429) break; // salah di sisi kita, retry percuma
      if (res.status === 429) {
        const raw = res.headers.get('retry-after');
        const ra = raw == null || raw.trim() === '' ? NaN : Number(raw); // Number(null) = 0, jadi cek dulu ada-tidaknya
        delay = Math.min(30_000, (Number.isFinite(ra) && ra >= 0 ? ra : 5 * (i + 1)) * 1000);
      }
    } catch (e) {
      lastErr = e;
    }
    if (i < tries - 1) await wait(delay); // jangan menunggu setelah percobaan terakhir
  }
  throw lastErr;
}

// ---------- Yahoo Finance ----------

export function parseYahoo(data, symbol) {
  const r = data && data.chart && data.chart.result && data.chart.result[0];
  if (!r) {
    const why = data && data.chart && data.chart.error && data.chart.error.description;
    throw new Error(`Yahoo: tidak ada data untuk ${symbol}${why ? ` (${why})` : ' (simbol salah?)'}`);
  }
  const closes = (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || [];
  const ts = r.timestamp || [];
  for (let i = closes.length - 1; i >= 0; i--) {
    if (typeof closes[i] === 'number' && Number.isFinite(closes[i])) {
      const tz = (r.meta && r.meta.exchangeTimezoneName) || 'UTC';
      return { price: closes[i], asOf: dateInTz(ts[i] * 1000, tz), currency: r.meta && r.meta.currency };
    }
  }
  throw new Error(`Yahoo: tidak ada harga penutupan untuk ${symbol}`);
}

export async function fetchYahooClose(symbol, { get = getUrl } = {}) {
  let lastErr;
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10d&interval=1d`;
      return parseYahoo(await get(url), symbol);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** Semua penutupan harian dalam respons Yahoo (yang null dilewati), tanggalnya menurut zona waktu bursa. */
export function parseYahooSeries(data, symbol) {
  const r = data && data.chart && data.chart.result && data.chart.result[0];
  if (!r) {
    const why = data && data.chart && data.chart.error && data.chart.error.description;
    throw new Error(`Yahoo: tidak ada data untuk ${symbol}${why ? ` (${why})` : ' (simbol salah?)'}`);
  }
  const tz = (r.meta && r.meta.exchangeTimezoneName) || 'UTC';
  const closes = (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || [];
  const ts = r.timestamp || [];
  const byDate = new Map(); // satu titik per tanggal; bila dobel, yang terakhir menang
  closes.forEach((c, i) => {
    if (typeof c === 'number' && Number.isFinite(c)) byDate.set(dateInTz(ts[i] * 1000, tz), c);
  });
  if (!byDate.size) throw new Error(`Yahoo: tidak ada riwayat harga untuk ${symbol}`);
  const points = [...byDate].map(([date, close]) => ({ date, close })).sort((a, b) => (a.date < b.date ? -1 : 1));
  return { points, currency: r.meta && r.meta.currency };
}

/** Penutupan harian dari tanggal `from` sampai `to` (YYYY-MM-DD, keduanya termasuk). */
export async function fetchYahooSeries(symbol, from, to, { get = getUrl } = {}) {
  const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const p2 = Math.floor(Date.parse(`${to}T00:00:00Z`) / 1000) + 86_400;
  let lastErr;
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
      return parseYahooSeries(await get(url), symbol);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ---------- Stooq (cadangan) ----------

export function parseStooq(csv, symbol) {
  const lines = String(csv).trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 1; i--) {
    const [date, , , , close] = lines[i].split(',');
    const price = Number(close);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(price) && price > 0) return { price, asOf: date };
  }
  throw new Error(`Stooq: tidak ada data untuk ${symbol}`);
}

export async function fetchStooqClose(symbol, { get = getUrl } = {}) {
  const csv = await get(`https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`, { json: false });
  return parseStooq(csv, symbol);
}

// ---------- CoinGecko ----------

export async function fetchCoinGeckoIdr(ids, { get = getUrl, apiKey } = {}) {
  const url =
    'https://api.coingecko.com/api/v3/simple/price' +
    `?ids=${ids.map(encodeURIComponent).join(',')}&vs_currencies=idr&include_last_updated_at=true`;
  const data = await get(url, { headers: apiKey ? { 'x-cg-demo-api-key': apiKey } : {} });
  const out = new Map();
  for (const id of ids) {
    const d = data && data[id];
    if (d && typeof d.idr === 'number' && d.idr > 0) {
      const ms = (d.last_updated_at ? d.last_updated_at * 1000 : Date.now());
      out.set(id, { price: d.idr, asOf: dateInTz(ms, 'Asia/Jakarta') });
    }
  }
  return out;
}
