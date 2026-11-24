// Jual-beli aset (logika murni, tanpa jaringan). Dipakai web; diuji di test/trade.test.mjs.
// Dasar modal memakai harga beli RATA-RATA per unit, satu-satunya yang disimpan per aset (bukan FIFO).
// Semua angka hasil dalam rupiah kecuali `pnl` (mata uang aset).
import { currencyOf, isIsoDate } from './portfolio.mjs';

const round = (n, d) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const rateOf = (a, fx) => (currencyOf(a) === 'USD' ? fx : 1);

/** Daftar masalah isian transaksi (kosong = sah). `today` = YYYY-MM-DD menurut WIB. */
export function checkTrade(asset, t, today) {
  if (!asset) return ['Aset tidak ditemukan'];
  const errs = [];
  if (asset.type === 'cash') errs.push('Kas tidak dijual-beli: ubah saldonya saja');
  if (t.kind !== 'buy' && t.kind !== 'sell') errs.push('Pilih Beli atau Jual');
  if (!(Number.isFinite(t.qty) && t.qty > 0)) errs.push('Jumlah harus lebih dari 0');
  else if (t.kind === 'sell' && t.qty > asset.qty * (1 + 1e-9)) errs.push(`Jumlah melebihi yang dimiliki (${asset.qty})`);
  if (!(Number.isFinite(t.price) && t.price >= 0)) errs.push('Harga per unit harus angka 0 atau lebih');
  if (!isIsoDate(t.date)) errs.push('Tanggal tidak valid');
  else if (today && t.date > today) errs.push('Tanggal tidak boleh di masa depan');
  if (currencyOf(asset) === 'USD' && !(Number.isFinite(t.fx) && t.fx > 0)) errs.push('Kurs USD/IDR harus diisi');
  return errs;
}

/** Jual sebagian/semua: aset sesudahnya (null bila habis) dan untung/rugi terealisasi. */
export function sell(asset, { qty, price, fx }) {
  const rate = rateOf(asset, fx);
  const share = Math.min(1, qty / asset.qty);
  // Modal porsi yang dijual: dari costIdr bila ada (kurs saat beli), selain itu harga rata-rata x kurs sekarang.
  const costIdr = asset.costIdr != null ? asset.costIdr * share : qty * asset.avgCost * rate;
  const proceedsIdr = qty * price * rate;
  const left = asset.qty - qty;
  const next = left <= asset.qty * 1e-9 ? null : {
    ...asset,
    qty: round(left, 10),
    ...(asset.costIdr != null ? { costIdr: round(asset.costIdr - costIdr, 2) } : {}),
  };
  return {
    asset: next,
    costIdr: round(costIdr, 2),
    proceedsIdr: round(proceedsIdr, 2),
    pnl: round(qty * (price - asset.avgCost), 6),
    pnlIdr: round(proceedsIdr - costIdr, 2),
  };
}

/** Beli lagi: jumlah bertambah, harga beli rata-rata ditimbang ulang. */
export function buy(asset, { qty, price, fx }) {
  const total = asset.qty + qty;
  return {
    asset: {
      ...asset,
      qty: round(total, 10),
      avgCost: round((asset.qty * asset.avgCost + qty * price) / total, 8),
      ...(asset.costIdr != null ? { costIdr: round(asset.costIdr + qty * price * rateOf(asset, fx), 2) } : {}),
    },
  };
}

/** Satu baris tab Transaksi. */
export function txRecord(asset, t, result, id, at) {
  const usd = currencyOf(asset) === 'USD';
  return {
    id, date: t.date, kind: t.kind, type: asset.type, symbol: asset.symbol, name: asset.name || asset.symbol,
    qty: t.qty, price: t.price, currency: currencyOf(asset), ...(usd ? { fx: t.fx } : {}),
    ...(t.kind === 'sell' ? { costIdr: result.costIdr, pnl: result.pnl, pnlIdr: result.pnlIdr } : {}),
    at,
  };
}

/** Total keuntungan terealisasi (rupiah) dari daftar transaksi; `year` (opsional) membatasi ke satu tahun. */
export function realized(txs, year) {
  return txs.filter((t) => t.kind === 'sell' && Number.isFinite(t.pnlIdr) && (!year || String(t.date).startsWith(String(year))))
    .reduce((s, t) => s + t.pnlIdr, 0);
}
