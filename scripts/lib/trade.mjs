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
    proceeds: round(qty * price, 6), // hasil jual dalam mata uang aset (itulah yang masuk ke kas)
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

// ---------- kas ----------
// Semua uang bergerak lewat kas: beli memotong kas, jual dan profit trading menambah kas, tukar memindahkan antar mata uang.

const CUR_NAME = { IDR: 'rupiah', USD: 'dolar' };
const fmt = (n) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 });

/** Daftar kas bermata uang tertentu. */
export const cashAccounts = (assets, cur) => assets.filter((a) => a.type === 'cash' && currencyOf(a) === cur);

function newCash(assets, cur) {
  const taken = new Set(assets.map((a) => a.type === 'cash' && a.symbol));
  let symbol = cur === 'USD' ? 'USD' : 'KAS';
  for (let i = 2; taken.has(symbol); i++) symbol = `${cur === 'USD' ? 'USD' : 'KAS'}${i}`;
  return { type: 'cash', symbol, qty: 0, ...(cur === 'USD' ? { currency: 'USD' } : {}) };
}

/**
 * Tambah (delta > 0) atau kurangi (delta < 0) saldo satu kas, mengembalikan daftar aset baru.
 * key = kunci kas yang dipakai; kosong = kas pertama bermata uang itu. Menambah ke mata uang yang belum punya kas membuatnya;
 * mengurangi tanpa kas atau melebihi saldo melempar galat (tidak ada saldo negatif).
 */
export function withCash(assets, cur, key, delta) {
  let list = assets;
  let target = key ? assets.find((a) => a.type === 'cash' && `${a.type}:${a.symbol}` === key) : cashAccounts(assets, cur)[0];
  if (key && !target) throw new Error('Kas tidak ditemukan');
  if (target && currencyOf(target) !== cur) throw new Error(`Kas ini bukan kas ${CUR_NAME[cur]}`);
  if (!target) {
    if (delta < 0) throw new Error(`Belum ada kas ${CUR_NAME[cur]}. Tambah kas dulu.`);
    target = newCash(assets, cur);
    list = [...assets, target];
  }
  const bal = round(target.qty + delta, 6);
  if (bal < 0) throw new Error(`Saldo kas ${target.symbol} kurang ${cur === 'USD' ? 'US$' : 'Rp'}${fmt(-bal)}`);
  return list.map((a) => (a === target ? { ...a, qty: bal } : a));
}

/** Tukar kas antar mata uang (IDR <-> USD) dengan kurs yang kamu isi sendiri (rupiah per dolar). */
export function checkConvert(assets, c, today) {
  const errs = [];
  const from = assets.find((a) => a.type === 'cash' && `${a.type}:${a.symbol}` === c.from);
  if (!from) errs.push('Pilih kas asal');
  if (!(Number.isFinite(c.amount) && c.amount > 0)) errs.push('Jumlah harus lebih dari 0');
  else if (from && c.amount > from.qty * (1 + 1e-9)) errs.push(`Saldo ${from.symbol} kurang ${currencyOf(from) === 'USD' ? 'US$' : 'Rp'}${fmt(c.amount - from.qty)}`);
  if (!(Number.isFinite(c.rate) && c.rate > 0)) errs.push('Kurs harus lebih dari 0');
  if (!isIsoDate(c.date)) errs.push('Tanggal tidak valid');
  else if (today && c.date > today) errs.push('Tanggal tidak boleh di masa depan');
  return errs;
}

/** Hasil tukar: { assets (baru), toCur, recv }. `to` (kunci kas tujuan) boleh kosong = kas pertama mata uang tujuan. */
export function convert(assets, { from, to, amount, rate }) {
  const src = assets.find((a) => `${a.type}:${a.symbol}` === from);
  const fromCur = currencyOf(src);
  const toCur = fromCur === 'IDR' ? 'USD' : 'IDR';
  const recv = round(fromCur === 'IDR' ? amount / rate : amount * rate, 6);
  let next = withCash(assets, fromCur, from, -amount);
  next = withCash(next, toCur, to || null, recv);
  return { assets: next, fromCur, toCur, recv };
}

/** Satu baris tab Transaksi untuk tukar mata uang. */
export function convertRecord(assets, c, r, id, at) {
  const src = assets.find((a) => `${a.type}:${a.symbol}` === c.from);
  const dst = (r.assets.find((a) => `${a.type}:${a.symbol}` === c.to) || cashAccounts(r.assets, r.toCur)[0]);
  return { id, date: c.date, kind: 'convert', type: 'cash', symbol: src.symbol, name: src.name || src.symbol, qty: c.amount, price: c.rate, currency: r.fromCur, toSymbol: dst.symbol, toQty: r.recv, at };
}

// ---------- trading emas (forex XAU/USD) ----------

export const FX_SYMBOL = 'XAUUSD';

/** Daftar masalah isian satu trade emas: sisi, lot, profit (dolar, boleh negatif), tanggal. */
export function checkFx(t, today) {
  const errs = [];
  if (t.side !== 'buy' && t.side !== 'sell') errs.push('Pilih Buy atau Sell');
  if (!(Number.isFinite(t.lot) && t.lot > 0)) errs.push('Lot harus lebih dari 0');
  if (!Number.isFinite(t.pnl) || t.pnl === 0) errs.push('Isi profit atau rugi (dolar)');
  if (!isIsoDate(t.date)) errs.push('Tanggal tidak valid');
  else if (today && t.date > today) errs.push('Tanggal tidak boleh di masa depan');
  return errs;
}

export function fxRecord(t, id, at) {
  return { id, date: t.date, kind: 'fx', type: 'forex', symbol: FX_SYMBOL, name: 'Emas (XAU/USD)', qty: t.lot, side: t.side, currency: 'USD', pnl: round(t.pnl, 2), at };
}

/** Ringkasan trading dari daftar transaksi: total, jumlah, menang, kalah, dan per bulan (urut lama -> baru). */
export function fxStats(txs) {
  const list = txs.filter((t) => t.kind === 'fx' && Number.isFinite(t.pnl));
  const months = new Map();
  for (const t of list) {
    const m = String(t.date).slice(0, 7);
    const o = months.get(m) || { month: m, pnl: 0, trades: 0 };
    o.pnl = round(o.pnl + t.pnl, 2);
    o.trades += 1;
    months.set(m, o);
  }
  const wins = list.filter((t) => t.pnl > 0).length;
  return {
    total: round(list.reduce((s, t) => s + t.pnl, 0), 2),
    trades: list.length,
    wins,
    losses: list.filter((t) => t.pnl < 0).length,
    winRate: list.length ? wins / list.length : null,
    months: [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
  };
}
