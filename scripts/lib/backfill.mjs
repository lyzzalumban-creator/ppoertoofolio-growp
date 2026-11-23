// Riwayat mundur: membangun snapshot harian sejak tanggal beli dari harga penutupan historis.
// Logika murni (tanpa jaringan); pengambilan harga ada di sources.mjs, penyimpanan di update.mjs.
//
// Asumsi (sengaja sederhana): jumlah (qty) tiap aset TETAP sejak tanggal belinya. Aset tanpa buyDate tidak
// ikut, karena kapan ia mulai dimiliki tidak diketahui; ia baru muncul di snapshot nyata dari robot harian.

import { buildSnapshot, currencyOf, keyOf } from './portfolio.mjs';
import { OZ_GRAM } from './quotes.mjs';

export const MAX_BACKFILL_DAYS = 366;

const DAY = 86_400_000;
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * Tanggal yang perlu diisi: dari tanggal beli paling awal (paling jauh `max` hari ke belakang) sampai
 * SEBELUM snapshot pertama yang sudah ada (atau sebelum hari ini bila riwayat masih kosong).
 * Hanya celah di depan yang diisi; snapshot nyata yang sudah ada tidak pernah ditimpa.
 */
export function backfillDates({ assets, firstDate, today, max = MAX_BACKFILL_DAYS }) {
  const buys = assets.map((a) => a.buyDate).filter(Boolean);
  if (!buys.length) return [];
  const earliest = buys.reduce((m, d) => (d < m ? d : m));
  const limit = addDays(today, -max);
  const start = earliest < limit ? limit : earliest;
  const end = firstDate || today; // eksklusif
  const out = [];
  for (let d = start; d < end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Penutupan terakhir pada atau sebelum tanggal `d` (libur/akhir pekan memakai penutupan sebelumnya), atau null. */
export function closeOn(points, d) {
  if (!points || !points.length || points[0].date > d) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].date <= d) lo = mid;
    else hi = mid - 1;
  }
  return points[lo].close;
}

// Harga satu aset pada satu tanggal, dalam mata uang aset itu; null bila belum bisa dihitung.
function priceOn(a, date, series, fx) {
  if (a.type === 'manual') return a.price;
  const c = closeOn(series.get(keyOf(a)), date);
  if (c == null) return null;
  if (a.type === 'idx' || a.type === 'us') return c;
  if (!(fx > 0)) return null;
  return a.type === 'crypto' ? c * fx : (c * fx) / OZ_GRAM; // kripto: USD -> IDR; emas: USD/ons -> IDR/gram
}

/**
 * @param {Array}  assets    aset (dengan buyDate bila diketahui)
 * @param {Array}  dates     hasil backfillDates, urut naik
 * @param {Map}    series    keyOf(aset) -> [{date, close}] urut naik (harga dalam mata uang sumbernya)
 * @param {Array}  fxSeries  [{date, close}] USD/IDR, atau null bila tak ada aset yang membutuhkan
 * @returns {Array} snapshot urut naik; tanggal yang tak bisa dihitung dilewati
 */
export function buildBackfill({ assets, dates, series, fxSeries }) {
  const out = [];
  let prev = null;
  for (const date of dates) {
    const held = assets.filter((a) => a.buyDate && a.buyDate <= date);
    if (!held.length) continue;
    const fx = fxSeries ? closeOn(fxSeries, date) : null;
    if (held.some((a) => currencyOf(a) === 'USD') && !(fx > 0)) continue;

    const quotes = new Map();
    for (const a of held) {
      const price = priceOn(a, date, series, fx);
      if (price == null) break;
      quotes.set(keyOf(a), { price, asOf: date });
    }
    if (quotes.size !== held.length) continue; // ada aset tanpa harga pada tanggal ini

    const snap = buildSnapshot({ date, assets: held, quotes, fx, prev });
    out.push(snap);
    prev = snap;
  }
  return out;
}
