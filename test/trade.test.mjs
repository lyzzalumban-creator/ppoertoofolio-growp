import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buy, checkTrade, realized, sell, txRecord } from '../scripts/lib/trade.mjs';
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
