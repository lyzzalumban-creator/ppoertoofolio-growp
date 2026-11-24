import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buy, cashAccounts, checkConvert, checkFx, checkTrade, convert, convertRecord, fxRecord, fxStats, realized, sell, txRecord, withCash } from '../scripts/lib/trade.mjs';
import { buildSnapshot } from '../scripts/lib/portfolio.mjs';

const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m ?? ''} ${a} != ${b}`);
const bbca = { type: 'idx', symbol: 'BBCA', name: 'Bank Central Asia', qty: 1000, avgCost: 9000 };
const aapl = { type: 'us', symbol: 'AAPL', qty: 10, avgCost: 150 };

test('jual sebagian saham rupiah: untung = (harga jual - rata-rata) x jumlah; sisa jumlah, rata-rata tetap', () => {
  const r = sell(bbca, { qty: 400, price: 10_000 });
  assert.deepEqual(r.asset, { ...bbca, qty: 600 });
  assert.equal(r.pnlIdr, 400_000);
  assert.equal(r.pnl, 400_000);
  assert.equal(r.costIdr, 3_600_000);
  assert.equal(r.proceedsIdr, 4_000_000);
});

test('jual semua: aset hilang (null); rugi bernilai negatif', () => {
  const r = sell(bbca, { qty: 1000, price: 8_500 });
  assert.equal(r.asset, null);
  assert.equal(r.pnlIdr, -500_000);
});

test('saham dolar tanpa costIdr: modal = rata-rata x kurs saat jual; pnl dalam dolar juga tercatat', () => {
  const r = sell(aapl, { qty: 4, price: 200, fx: 16_000 });
  assert.equal(r.pnl, 200); // 4 x (200 - 150) dolar
  assert.equal(r.pnlIdr, 3_200_000);
  assert.equal(r.asset.qty, 6);
});

test('saham dolar dengan costIdr: modal porsi terjual dari costIdr (kurs saat beli), costIdr sisa ikut berkurang', () => {
  const a = { ...aapl, costIdr: 22_500_000 }; // dibeli saat kurs 15.000
  const r = sell(a, { qty: 4, price: 200, fx: 16_000 });
  assert.equal(r.costIdr, 9_000_000); // 40% dari 22,5 juta
  assert.equal(r.pnlIdr, 12_800_000 - 9_000_000); // termasuk untung kurs
  assert.equal(r.asset.costIdr, 13_500_000);
});

test('beli lagi: harga rata-rata ditimbang ulang; costIdr bertambah sebesar pembelian x kurs', () => {
  assert.deepEqual(buy(bbca, { qty: 1000, price: 10_000 }).asset, { ...bbca, qty: 2000, avgCost: 9500 });
  const a = buy({ ...aapl, costIdr: 22_500_000 }, { qty: 10, price: 250, fx: 16_000 }).asset;
  assert.equal(a.avgCost, 200);
  assert.equal(a.costIdr, 22_500_000 + 40_000_000);
});

test('pecahan (kripto): tidak tersisa debu akibat pembulatan saat jual semua', () => {
  const btc = { type: 'crypto', symbol: 'BTC', coingeckoId: 'bitcoin', qty: 0.3, avgCost: 1e9 };
  const half = sell(btc, { qty: 0.1, price: 1.2e9 });
  assert.equal(half.asset.qty, 0.2);
  assert.equal(sell(half.asset, { qty: 0.2, price: 1.2e9 }).asset, null);
});

test('checkTrade: menolak jumlah 0/negatif, jual melebihi milik, tanggal masa depan, kurs kosong untuk dolar, kas', () => {
  const ok = { kind: 'sell', qty: 10, price: 100, date: '2026-11-23' };
  assert.deepEqual(checkTrade(bbca, ok, '2026-11-24'), []);
  assert.match(checkTrade(bbca, { ...ok, qty: 0 }).join(), /lebih dari 0/);
  assert.match(checkTrade(bbca, { ...ok, qty: 1001 }).join(), /melebihi/);
  assert.deepEqual(checkTrade(bbca, { ...ok, kind: 'buy', qty: 5000 }), [], 'beli boleh berapa pun');
  assert.match(checkTrade(bbca, { ...ok, date: '2026-11-30' }, '2026-11-24').join(), /masa depan/);
  assert.match(checkTrade(bbca, { ...ok, date: '23/11/2026' }).join(), /Tanggal tidak valid/);
  assert.match(checkTrade(aapl, { ...ok, qty: 1 }).join(), /Kurs/);
  assert.deepEqual(checkTrade(aapl, { ...ok, qty: 1, fx: 16_000 }), []);
  assert.match(checkTrade({ type: 'cash', symbol: 'BCA', qty: 1 }, ok).join(), /Kas/);
  assert.match(checkTrade(bbca, { ...ok, kind: 'tukar' }).join(), /Beli atau Jual/);
  assert.match(checkTrade(null, ok).join(), /tidak ditemukan/);
});

test('txRecord: catatan jual memuat untung terealisasi; beli tidak; kurs hanya untuk dolar', () => {
  const t = { kind: 'sell', qty: 4, price: 200, fx: 16_000, date: '2026-11-23' };
  const rec = txRecord(aapl, t, sell(aapl, t), 'abc12345', '2026-11-23T05:00:00Z');
  assert.equal(rec.pnlIdr, 3_200_000);
  assert.equal(rec.fx, 16_000);
  assert.equal(rec.currency, 'USD');
  const b = txRecord(bbca, { kind: 'buy', qty: 1, price: 1, date: '2026-11-23' }, buy(bbca, { qty: 1, price: 1 }), 'id-2', 'x');
  assert.ok(!('pnlIdr' in b) && !('fx' in b));
});

test('realized: jumlah untung/rugi jual saja, bisa per tahun', () => {
  const txs = [
    { kind: 'sell', date: '2025-05-01', pnlIdr: 100 }, { kind: 'sell', date: '2026-01-02', pnlIdr: -30 },
    { kind: 'buy', date: '2026-02-01' }, { kind: 'sell', date: '2026-03-01', pnlIdr: 50 },
  ];
  assert.equal(realized(txs), 120);
  assert.equal(realized(txs, 2026), 20);
  assert.equal(realized([]), 0);
});

test('snapshot menyimpan harga rupiah tiap aset (px) untuk grafik per aset', () => {
  const s = buildSnapshot({ date: '2026-11-23', assets: [bbca, aapl], quotes: new Map([['idx:BBCA', { price: 10_000, asOf: '2026-11-23' }], ['us:AAPL', { price: 200, asOf: '2026-11-21' }]]), fx: 16_000 });
  assert.deepEqual(s.px, { 'idx:BBCA': 10_000, 'us:AAPL': 3_200_000 });
});

// ---------- kas ----------
const kas = { type: 'cash', symbol: 'BCA', qty: 10_000_000 };
const usd = { type: 'cash', symbol: 'USD', qty: 500, currency: 'USD' };

test('sell: hasil jual dalam mata uang aset (itu yang masuk kas)', () => {
  assert.equal(sell(bbca, { qty: 400, price: 10_000 }).proceeds, 4_000_000);
  assert.equal(sell(aapl, { qty: 4, price: 200, fx: 16_000 }).proceeds, 800); // dolar, bukan rupiah
});

test('withCash: kurangi saldo, tambah saldo, tidak boleh negatif, tidak ada kas = galat jelas', () => {
  const a = [kas, usd, bbca];
  assert.equal(withCash(a, 'IDR', null, -4_000_000).find((x) => x.symbol === 'BCA').qty, 6_000_000);
  assert.equal(withCash(a, 'USD', 'cash:USD', 150.5).find((x) => x.symbol === 'USD').qty, 650.5);
  assert.equal(withCash(a, 'IDR', null, -10_000_000).find((x) => x.symbol === 'BCA').qty, 0, 'tepat habis = 0, sah');
  assert.throws(() => withCash(a, 'IDR', null, -10_000_001), /Saldo kas BCA kurang Rp1/);
  assert.throws(() => withCash([bbca], 'IDR', null, -1), /Belum ada kas rupiah/);
  assert.throws(() => withCash(a, 'IDR', 'cash:USD', 1), /bukan kas rupiah/);
});

test('withCash: menambah ke mata uang tanpa kas membuat kas baru (jual saham AS tanpa kas dolar)', () => {
  const r = withCash([kas, aapl], 'USD', null, 800);
  assert.deepEqual(r.find((x) => x.symbol === 'USD'), { type: 'cash', symbol: 'USD', qty: 800, currency: 'USD' });
  assert.equal(r.length, 3);
  assert.deepEqual(cashAccounts(r, 'USD').map((x) => x.symbol), ['USD']);
  // label tidak bentrok dengan kas lain yang sudah memakai nama itu
  const r2 = withCash([{ type: 'cash', symbol: 'KAS', qty: 1, currency: 'USD' }, aapl], 'IDR', null, 5);
  assert.equal(r2.find((x) => x.symbol === 'KAS2').qty, 5);
});

test('float: beberapa kali tambah-kurang kecil tidak meninggalkan sisa 0,1+0,2', () => {
  let a = [{ type: 'cash', symbol: 'USD', qty: 0, currency: 'USD' }];
  a = withCash(a, 'USD', null, 0.1);
  a = withCash(a, 'USD', null, 0.2);
  assert.equal(a[0].qty, 0.3);
  a = withCash(a, 'USD', null, -0.3);
  assert.equal(a[0].qty, 0);
});

// ---------- tukar mata uang ----------
test('convert IDR -> USD: dibagi kurs; saldo asal berkurang, kas dolar bertambah', () => {
  const c = { from: 'cash:BCA', to: 'cash:USD', amount: 1_600_000, rate: 16_000 };
  const r = convert([kas, usd], c);
  assert.equal(r.recv, 100);
  assert.equal(r.fromCur, 'IDR');
  assert.equal(r.toCur, 'USD');
  assert.equal(r.assets.find((x) => x.symbol === 'BCA').qty, 8_400_000);
  assert.equal(r.assets.find((x) => x.symbol === 'USD').qty, 600);
});

test('convert USD -> IDR: dikali kurs; tujuan kosong = kas rupiah pertama (dibuat bila belum ada)', () => {
  const r = convert([usd], { from: 'cash:USD', to: '', amount: 200, rate: 16_250 });
  assert.equal(r.recv, 3_250_000);
  assert.equal(r.assets.find((x) => x.symbol === 'KAS').qty, 3_250_000);
  assert.equal(r.assets.find((x) => x.symbol === 'USD').qty, 300);
});

test('checkConvert: saldo kurang, kurs kosong, tanggal masa depan ditolak; isian wajar lolos', () => {
  const ok = { from: 'cash:BCA', amount: 1_000_000, rate: 16_000, date: '2026-11-24' };
  assert.deepEqual(checkConvert([kas], ok, '2026-11-24'), []);
  assert.match(checkConvert([kas], { ...ok, amount: 20_000_000 }, '2026-11-24').join(), /Saldo BCA kurang Rp10\.000\.000/);
  assert.match(checkConvert([kas], { ...ok, rate: 0 }, '2026-11-24').join(), /Kurs/);
  assert.match(checkConvert([kas], { ...ok, date: '2099-01-01' }, '2026-11-24').join(), /masa depan/);
  assert.match(checkConvert([kas], { ...ok, from: 'cash:XX' }, '2026-11-24').join(), /kas asal/);
});

test('convertRecord: satu baris Transaksi berisi asal, tujuan, jumlah, kurs', () => {
  const c = { from: 'cash:BCA', to: 'cash:USD', amount: 1_600_000, rate: 16_000, date: '2026-11-24' };
  const r = convert([kas, usd], c);
  assert.deepEqual(convertRecord([kas, usd], c, r, 'tx-abcdefgh', '2026-11-24T00:00:00Z'), {
    id: 'tx-abcdefgh', date: '2026-11-24', kind: 'convert', type: 'cash', symbol: 'BCA', name: 'BCA', qty: 1_600_000, price: 16_000,
    currency: 'IDR', toSymbol: 'USD', toQty: 100, at: '2026-11-24T00:00:00Z',
  });
});

// ---------- trading emas ----------
test('checkFx: sisi, lot, profit tidak boleh nol, tanggal', () => {
  const ok = { side: 'buy', lot: 0.05, pnl: 12.5, date: '2026-11-24' };
  assert.deepEqual(checkFx(ok, '2026-11-24'), []);
  assert.deepEqual(checkFx({ ...ok, pnl: -30 }, '2026-11-24'), [], 'rugi (negatif) sah');
  assert.match(checkFx({ ...ok, side: '' }, '2026-11-24').join(), /Buy atau Sell/);
  assert.match(checkFx({ ...ok, lot: 0 }, '2026-11-24').join(), /Lot/);
  assert.match(checkFx({ ...ok, pnl: 0 }, '2026-11-24').join(), /profit atau rugi/);
  assert.match(checkFx({ ...ok, pnl: NaN }, '2026-11-24').join(), /profit atau rugi/);
  assert.match(checkFx({ ...ok, date: '2099-01-01' }, '2026-11-24').join(), /masa depan/);
});

test('fxRecord dan profit ke kas USD: profit menambah, rugi mengurangi, rugi melebihi saldo ditolak', () => {
  const t = { side: 'sell', lot: 0.1, pnl: -40.256, date: '2026-11-24' };
  assert.deepEqual(fxRecord(t, 'tx-abcdefgh', 'x'), { id: 'tx-abcdefgh', date: '2026-11-24', kind: 'fx', type: 'forex', symbol: 'XAUUSD', name: 'Emas (XAU/USD)', qty: 0.1, side: 'sell', currency: 'USD', pnl: -40.26, at: 'x' });
  assert.equal(withCash([usd], 'USD', null, 75.5).find((x) => x.symbol === 'USD').qty, 575.5);
  assert.equal(withCash([usd], 'USD', null, -40.26).find((x) => x.symbol === 'USD').qty, 459.74);
  assert.throws(() => withCash([usd], 'USD', null, -600), /Saldo kas USD kurang US\$100/);
});

test('fxStats: total, win rate, dan per bulan urut lama -> baru; kind lain tidak ikut', () => {
  const fx = (date, pnl) => ({ kind: 'fx', date, pnl });
  const txs = [fx('2026-10-05', 10), fx('2026-10-20', -4.5), fx('2026-11-02', 20), { kind: 'sell', date: '2026-11-03', pnl: 999 }, fx('2026-09-30', -1)];
  const st = fxStats(txs);
  assert.equal(st.total, 24.5);
  assert.equal(st.trades, 4);
  assert.equal(st.wins, 2);
  assert.equal(st.losses, 2);
  assert.equal(st.winRate, 0.5);
  assert.deepEqual(st.months, [{ month: '2026-09', pnl: -1, trades: 1 }, { month: '2026-10', pnl: 5.5, trades: 2 }, { month: '2026-11', pnl: 20, trades: 1 }]);
  assert.deepEqual(fxStats([]), { total: 0, trades: 0, wins: 0, losses: 0, winRate: null, months: [] });
});

test('realized tidak ikut menghitung trading emas dan tukar mata uang', () => {
  assert.equal(realized([{ kind: 'fx', pnl: 50, pnlIdr: 800_000 }, { kind: 'convert' }, { kind: 'sell', pnlIdr: 100 }]), 100);
});

test('presisi desimal: 0,1 + 0,2 = 0,3 persis; jual semua tidak menyisakan debu; kas tidak jadi minus karena selisih floating-point', () => {
  const a = buy({ type: 'crypto', symbol: 'BTC', qty: 0.1, avgCost: 100 }, { qty: 0.2, price: 100, fx: 1, date: '2026-01-01' }).asset;
  assert.equal(a.qty, 0.3);
  const r = sell(a, { qty: a.qty, price: 120, fx: 1, date: '2026-01-02' });
  assert.equal(r.asset, null); // habis, bukan 5e-17
  let kas = [{ type: 'cash', symbol: 'K', qty: 0.3, currency: 'IDR' }];
  kas = withCash(kas, 'IDR', null, -0.1);
  kas = withCash(kas, 'IDR', null, -0.2);
  assert.equal(kas[0].qty, 0);
  assert.doesNotThrow(() => withCash([{ type: 'cash', symbol: 'K', qty: 0.3, currency: 'IDR' }], 'IDR', null, -0.30000000000000004));
});
