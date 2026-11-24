// Data DEMO: portofolio fiktif 1 tahun ke belakang dengan banyak transaksi (beli, jual, tukar mata uang, trade emas).
// Dibangun dengan logika yang sama dengan aplikasi (beli memotong kas, jual menambah kas), jadi saldo, riwayat, dan
// catatan saling cocok. Deterministik (benih tetap), tanpa jaringan, dan TIDAK menyentuh Sheet atau penyimpanan pengguna.
import { buildSnapshot, keyOf } from '../scripts/lib/portfolio.mjs';
import { buy, convert, convertRecord, fxRecord, sell, txRecord, withCash } from '../scripts/lib/trade.mjs';

const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Semesta aset fiktif: harga awal dalam mata uang aset (idx/kripto/manual rupiah, saham AS dolar).
const U = [
  { type: 'idx', symbol: 'BBCA', name: 'Bank Central Asia', p0: 9000, vol: 0.012, drift: 0.0004, lot: 100 },
  { type: 'idx', symbol: 'TLKM', name: 'Telkom Indonesia', p0: 3300, vol: 0.013, drift: -0.0001, lot: 100 },
  { type: 'idx', symbol: 'ASII', name: 'Astra International', p0: 5100, vol: 0.014, drift: 0.0002, lot: 100 },
  { type: 'us', symbol: 'AAPL', name: 'Apple', p0: 178, vol: 0.015, drift: 0.0006, lot: 1 },
  { type: 'us', symbol: 'NVDA', name: 'NVIDIA', p0: 118, vol: 0.025, drift: 0.0012, lot: 1 },
  { type: 'us', symbol: 'MSFT', name: 'Microsoft', p0: 410, vol: 0.013, drift: 0.0005, lot: 1 },
  { type: 'crypto', symbol: 'BTC', coingeckoId: 'bitcoin', name: 'Bitcoin', p0: 1_000_000_000, vol: 0.03, drift: 0.0009, lot: 0.0001 },
  { type: 'crypto', symbol: 'ETH', coingeckoId: 'ethereum', name: 'Ethereum', p0: 40_000_000, vol: 0.035, drift: 0.0007, lot: 0.001 },
  { type: 'manual', symbol: 'RDPU', name: 'Reksa Dana Pasar Uang', p0: 1450, vol: 0.0001, drift: 0.00014, lot: 1 },
];

/** @param {string} today YYYY-MM-DD (hari terakhir riwayat) @param {number} days jumlah hari ke belakang */
export function demoData(today, days = 365) {
  const r = rng(20261124);
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
  const end = Date.parse(`${today}T00:00:00Z`);
  const dates = Array.from({ length: days + 1 }, (_, i) => iso(end - (days - i) * DAY));

  // jalur harga: saham dan kurs tidak bergerak di akhir pekan
  const px = Object.fromEntries(U.map((u) => [u.symbol, [u.p0]]));
  const fxs = [15_700];
  dates.forEach((d, i) => {
    if (!i) return;
    const wk = [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
    for (const u of U) {
      const prev = px[u.symbol][i - 1];
      px[u.symbol].push(wk && (u.type === 'idx' || u.type === 'us') ? prev : Math.max(u.p0 * 0.05, prev * (1 + u.drift + u.vol * gauss())));
    }
    fxs.push(wk ? fxs[i - 1] : Math.min(16_600, Math.max(15_200, fxs[i - 1] * (1 + 0.0025 * gauss()))));
  });
  const price = (sym, i) => Math.round(px[sym][i] * 1e4) / 1e4;

  let assets = [{ type: 'cash', symbol: 'BCA', name: 'Rekening BCA', qty: 150_000_000 }, { type: 'cash', symbol: 'USD', name: 'Dolar', qty: 0, currency: 'USD' }];
  const txs = [];
  const history = [];
  let prev = null;
  let n = 0;
  const id = () => `tx-demo-${(++n).toString(36)}`;
  const cur = (u) => (u.type === 'us' ? 'USD' : 'IDR');
  const held = (sym) => assets.find((a) => a.symbol === sym && a.type !== 'cash');

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const fx = fxs[i];
    const wk = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
    const at = `${date}T0${3 + (n % 6)}:00:00Z`;
    const tryOp = (fn) => { try { fn(); } catch { /* saldo tidak cukup: lewati */ } };

    const doBuy = (u, qty) => tryOp(() => {
      const p = price(u.symbol, i);
      if (!(qty > 0)) return;
      const ex = held(u.symbol);
      const base = ex || { type: u.type, symbol: u.symbol, name: u.name, ...(u.coingeckoId ? { coingeckoId: u.coingeckoId } : {}), qty: 0, avgCost: p, ...(u.type === 'manual' ? { price: p } : {}), buyDate: date };
      const t = { kind: 'buy', qty, price: p, fx, date };
      const next0 = ex ? buy(ex, t).asset : { ...base, qty, avgCost: p };
      let list = ex ? assets.map((a) => (a === ex ? next0 : a)) : [...assets, next0];
      list = withCash(list, cur(u), null, -(qty * p));
      assets = list;
      txs.push(txRecord(next0, t, {}, id(), at));
    });
    const doSell = (u, frac) => tryOp(() => {
      const ex = held(u.symbol);
      if (!ex || ex.type === 'manual') return;
      const qty = Math.max(u.lot, Math.round((ex.qty * frac) / u.lot) * u.lot);
      if (qty > ex.qty) return;
      const p = price(u.symbol, i);
      const t = { kind: 'sell', qty, price: p, fx, date };
      const res = sell(ex, t);
      let list = assets.flatMap((a) => (a === ex ? (res.asset ? [res.asset] : []) : [a]));
      list = withCash(list, cur(u), null, res.proceeds);
      assets = list;
      txs.push(txRecord(ex, t, res, id(), at));
    });
    const doConvert = (fromCur, amount) => tryOp(() => {
      const from = assets.find((a) => a.type === 'cash' && (a.currency || 'IDR') === fromCur);
      if (!from) return;
      const c = { from: keyOf(from), to: '', amount, rate: Math.round(fx * (1 + 0.002 * gauss())), date };
      const res = convert(assets, c);
      txs.push(convertRecord(assets, c, res, id(), at));
      assets = res.assets;
    });

    if (i === 0) {
      doConvert('IDR', 40_000_000);
      doBuy(U[0], 3500); doBuy(U[1], 7000); doBuy(U[3], 8); doBuy(U[4], 8); doBuy(U[6], 0.025); doBuy(U[8], 15_000);
    } else {
      const x = r();
      if (!wk && x < 0.3) { // trade emas
        const pnl = Math.round((gauss() * 32 + 7) * 100) / 100;
        if (pnl !== 0) tryOp(() => {
          const t = { side: r() < 0.5 ? 'buy' : 'sell', lot: [0.01, 0.02, 0.05, 0.1][Math.floor(r() * 4)], pnl, date };
          assets = withCash(assets, 'USD', null, pnl);
          txs.push(fxRecord(t, id(), at));
        });
      } else if (!wk && x < 0.38) { // beli
        const u = U[Math.floor(r() * U.length)];
        const budget = u.type === 'us' ? 300 + r() * 1200 : 4_000_000 + r() * 16_000_000;
        doBuy(u, Math.max(u.lot, Math.floor(budget / price(u.symbol, i) / u.lot) * u.lot));
      } else if (!wk && x < 0.45) doSell(U[Math.floor(r() * (U.length - 1))], 0.3 + r() * 0.5); // jual
      else if (!wk && x < 0.49) { if (r() < 0.6) doConvert('IDR', Math.round((8 + r() * 25) * 1e6 / 1e5) * 1e5); else doConvert('USD', Math.round(400 + r() * 1200)); } // tukar
      else if (x >= 0.49 && x < 0.53) assets = withCash(assets, 'IDR', null, Math.round((5 + r() * 15) * 1e6)); // setoran (tidak dicatat)
    }

    // harga tiap aset hari ini; aset manual membawa harganya sendiri
    assets = assets.map((a) => (a.type === 'manual' ? { ...a, price: price(a.symbol, i) } : a));
    const quotes = new Map(assets.map((a) => [keyOf(a), { price: a.type === 'cash' ? 1 : price(a.symbol, i), asOf: date }]));
    const snap = buildSnapshot({ date, assets, quotes, fx, prev });
    prev = snap;
    history.push(snap);
  }
  history.forEach((s, k) => { if (k < history.length - 2) delete s.positions; }); // seperti Code.gs: rincian hanya 2 hari terakhir
  history[history.length - 1].at = new Date().toISOString();
  return { version: 4, assets, history, transactions: txs };
}
