import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoData } from '../assets/demo.js';
import { validateHoldings } from '../scripts/lib/portfolio.mjs';
import { fxStats, realized } from '../scripts/lib/trade.mjs';

const D = demoData('2026-11-24');

test('demo: deterministik (benih tetap) dan cepat', () => {
  const t = Date.now();
  const again = demoData('2026-11-24');
  assert.ok(Date.now() - t < 2000);
  assert.deepEqual(again.assets, D.assets);
  assert.deepEqual(again.transactions, D.transactions);
  assert.deepEqual(again.history.map((s) => s.total), D.history.map((s) => s.total));
});

test('demo: riwayat 1 tahun (366 hari) berakhir hari ini; rincian posisi hanya 2 hari terakhir; px di semua hari', () => {
  assert.equal(D.history.length, 366);
  assert.equal(D.history[0].date, '2025-11-24');
  assert.equal(D.history.at(-1).date, '2026-11-24');
  assert.ok(D.history.every((s, i) => i >= 364 === Array.isArray(s.positions) && Object.keys(s.px).length > 0));
  assert.ok(D.history.every((s) => Number.isFinite(s.total) && s.total > 0));
  assert.equal(D.version, 4);
});

test('demo: aset lolos validasi yang sama dengan robot; tidak ada saldo kas negatif; ada kas rupiah dan dolar', () => {
  assert.doesNotThrow(() => validateHoldings({ assets: D.assets }));
  const cash = D.assets.filter((a) => a.type === 'cash');
  assert.ok(cash.every((c) => c.qty >= 0));
  assert.deepEqual(cash.map((c) => c.currency || 'IDR').sort(), ['IDR', 'USD']);
});

test('demo: banyak transaksi dari semua jenis, id unik, kolom wajib terisi', () => {
  const k = {};
  for (const t of D.transactions) k[t.kind] = (k[t.kind] || 0) + 1;
  assert.ok(D.transactions.length >= 80);
  for (const kind of ['buy', 'sell', 'convert', 'fx']) assert.ok(k[kind] >= 5, `${kind}: ${k[kind]}`);
  assert.equal(new Set(D.transactions.map((t) => t.id)).size, D.transactions.length);
  for (const t of D.transactions) {
    assert.match(t.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(t.date >= '2025-11-24' && t.date <= '2026-11-24');
    assert.ok(t.qty > 0);
    if (t.kind === 'sell') assert.ok(Number.isFinite(t.pnlIdr) && Number.isFinite(t.costIdr));
    if (t.kind === 'convert') assert.ok(t.toQty > 0 && t.price > 0 && t.toSymbol);
    if (t.kind === 'fx') assert.ok(Number.isFinite(t.pnl) && t.pnl !== 0 && ['buy', 'sell'].includes(t.side));
  }
});

test('demo: ada trade untung DAN rugi dan transaksi tersebar di sedikitnya 10 bulan (grafik bulanan terisi)', () => {
  const st = fxStats(D.transactions);
  assert.ok(st.wins >= 10 && st.losses >= 10);
  assert.ok(st.months.length >= 10);
  assert.ok(Number.isFinite(realized(D.transactions)));
});

test('demo: nilai terakhir = jumlah posisi; bobot per jenis berjumlah 1', () => {
  const L = D.history.at(-1);
  const sum = L.positions.reduce((s, p) => s + p.value, 0);
  assert.ok(Math.abs(sum - L.total) < 1);
  assert.ok(Math.abs(Object.values(L.byType).reduce((s, t) => s + t.weight, 0) - 1) < 1e-4);
});

test('rentang YTD: hanya titik tahun terakhir; kurang dari 2 titik = semua', async () => {
  const { inRange } = await import('../assets/views/chart.js');
  const s = ['2025-12-30', '2025-12-31', '2026-01-02', '2026-06-01', '2026-11-23'].map((date) => ({ date }));
  assert.deepEqual(inRange(s, 'YTD').map((x) => x.date), ['2026-01-02', '2026-06-01', '2026-11-23']);
  assert.equal(inRange([{ date: '2025-12-31' }, { date: '2026-01-01' }], 'YTD').length, 2);
  assert.equal(inRange([{ date: '2025-12-30' }, { date: '2026-01-05' }], 'YTD').length, 2); // hanya 1 titik tahun ini: tampilkan semua
});
