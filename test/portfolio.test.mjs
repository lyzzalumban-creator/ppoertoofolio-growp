import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, dateInTz, isIsoDate, keyOf, validateHoldings } from '../scripts/lib/portfolio.mjs';

const assets = [
  { type: 'idx', symbol: 'BBCA', qty: 1000, avgCost: 9000 },
  { type: 'us', symbol: 'AAPL', qty: 10, avgCost: 150 },
  { type: 'crypto', symbol: 'BTC', coingeckoId: 'bitcoin', qty: 0.5, avgCost: 800_000_000 },
];
const quotes = new Map([
  ['idx:BBCA', { price: 10_000, asOf: '2026-11-23' }],
  ['us:AAPL', { price: 200, asOf: '2026-11-21' }],
  ['crypto:BTC', { price: 1_000_000_000, asOf: '2026-11-24' }],
]);

test('aset yang benar lolos validasi', () => {
  assert.doesNotThrow(() => validateHoldings({ assets }));
});

test('validateHoldings melaporkan semua masalah sekaligus', () => {
  const bad = { assets: [
    { type: 'foo', symbol: 'X', qty: 1, avgCost: 1 },
    { type: 'idx', symbol: 'BBCA', qty: 0, avgCost: 1 },
    { type: 'crypto', symbol: 'BTC', qty: 1, avgCost: 1 },
    { type: 'manual', symbol: 'M', qty: 1, avgCost: 1 },
    { type: 'idx', symbol: 'BBCA', qty: 1, avgCost: 1 },
  ] };
  assert.throws(() => validateHoldings(bad), (e) => {
    for (const s of ['type harus', 'qty harus', 'coingeckoId', 'price', 'duplikat']) assert.match(e.message, new RegExp(s));
    return true;
  });
  assert.throws(() => validateHoldings({ assets: [] }), /minimal satu aset/);
});

test('buildSnapshot: nilai, modal, untung/rugi, kurs USD', () => {
  const s = buildSnapshot({ date: '2026-11-24', assets, quotes, fx: 16_000 });
  // 1000*10.000 + 10*200*16.000 + 0.5*1.000.000.000
  assert.equal(s.total, 10_000_000 + 32_000_000 + 500_000_000);
  // 1000*9.000 + 10*150*16.000 + 0.5*800.000.000
  assert.equal(s.cost, 9_000_000 + 24_000_000 + 400_000_000);
  assert.equal(s.pnl, s.total - s.cost);
  assert.ok(Math.abs(s.pnlPct - (s.total - s.cost) / s.cost) < 1e-6);
  assert.equal(s.dayPct, null); // belum ada pembanding
});

test('bobot semua aset berjumlah 1 dan terurut dari nilai terbesar', () => {
  const s = buildSnapshot({ date: '2026-11-24', assets, quotes, fx: 16_000 });
  const sum = s.positions.reduce((a, p) => a + p.weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-4);
  assert.deepEqual(s.positions.map((p) => p.symbol), ['BTC', 'AAPL', 'BBCA']);
  const t = Object.values(s.byType).reduce((a, v) => a + v.weight, 0);
  assert.ok(Math.abs(t - 1) < 1e-4);
});

test('costIdr menggantikan modal dari avgCost (memperhitungkan kurs saat beli)', () => {
  const a = [{ type: 'us', symbol: 'AAPL', qty: 10, avgCost: 150, costIdr: 20_000_000 }];
  const s = buildSnapshot({ date: 'd', assets: a, quotes: new Map([['us:AAPL', { price: 200 }]]), fx: 16_000 });
  assert.equal(s.cost, 20_000_000);
});

test('perubahan harian dihitung dari harga, bukan dari selisih total (setoran tidak dianggap untung)', () => {
  const day1 = buildSnapshot({ date: '2026-11-23', assets, quotes, fx: 16_000 });
  // Hari berikutnya: BBCA naik 10%, qty BBCA digandakan (seolah top-up), harga lain tetap.
  const assets2 = assets.map((a) => (a.symbol === 'BBCA' ? { ...a, qty: 2000 } : a));
  const q2 = new Map(quotes);
  q2.set('idx:BBCA', { price: 11_000, asOf: '2026-11-24' });
  const day2 = buildSnapshot({ date: '2026-11-24', assets: assets2, quotes: q2, fx: 16_000, prev: day1 });
  const bbca = day2.positions.find((p) => p.symbol === 'BBCA');
  assert.ok(Math.abs(bbca.dayPct - 0.1) < 1e-6);
  assert.equal(day2.dayPnl, 2000 * 1000); // 2000 lembar * Rp1.000 kenaikan
  // dasar = nilai kemarin dari posisi hari ini (qty baru x harga lama) -> persentase tetap masuk akal
  assert.ok(day2.dayPct > 0 && day2.dayPct < 0.1);
});

test('harga hilang atau kurs hilang -> error jelas', () => {
  assert.throws(() => buildSnapshot({ date: 'd', assets, quotes: new Map(), fx: 1 }), /tidak tersedia/);
  assert.throws(() => buildSnapshot({ date: 'd', assets, quotes, fx: null }), /Kurs USD\/IDR/);
});

test('harga lama (stale) ditandai di posisi', () => {
  const q = new Map(quotes);
  q.set('idx:BBCA', { price: 9_500, asOf: '2026-11-20', stale: true });
  const s = buildSnapshot({ date: 'd', assets, quotes: q, fx: 16_000 });
  assert.equal(s.positions.find((p) => p.symbol === 'BBCA').stale, true);
  assert.equal(s.positions.find((p) => p.symbol === 'AAPL').stale, undefined);
});

test('dateInTz memakai zona waktu yang diminta', () => {
  const ms = Date.parse('2026-11-23T20:00:00Z'); // 03:00 WIB tanggal berikutnya
  assert.equal(dateInTz(ms, 'Asia/Jakarta'), '2026-11-24');
  assert.equal(dateInTz(ms, 'UTC'), '2026-11-23');
  assert.equal(keyOf({ type: 'idx', symbol: 'BBCA' }), 'idx:BBCA');
});

test('isIsoDate: hanya tanggal kalender nyata berformat YYYY-MM-DD', () => {
  for (const ok of ['2025-03-03', '2024-02-29', '2000-12-31']) assert.equal(isIsoDate(ok), true, ok);
  for (const bad of ['2025-02-30', '2025-02-29', '2025-13-01', '2025-00-10', '03/03/2025', '2025-3-3', '20250303', '2025-03-03T00:00', '', null, undefined, 20250303]) {
    assert.equal(isIsoDate(bad), false, String(bad));
  }
});

test('validateHoldings memeriksa buyDate bila ada, dan menamai asetnya', () => {
  assert.doesNotThrow(() => validateHoldings({ assets: [{ ...assets[0], buyDate: '2025-03-03' }] }));
  assert.throws(() => validateHoldings({ assets: [{ ...assets[0], buyDate: '2025-02-30' }] }), /BBCA.*buyDate/);
  assert.throws(() => validateHoldings({ assets: [{ ...assets[0], buyDate: '03/03/2025' }] }), /buyDate/);
});

test('buildSnapshot membawa buyDate ke posisi, dan tidak menambahkannya bila kosong', () => {
  const a = assets.map((x) => (x.symbol === 'BBCA' ? { ...x, buyDate: '2025-03-03' } : x));
  const s = buildSnapshot({ date: '2026-11-24', assets: a, quotes, fx: 16_000 });
  assert.equal(s.positions.find((p) => p.symbol === 'BBCA').buyDate, '2025-03-03');
  assert.ok(!('buyDate' in s.positions.find((p) => p.symbol === 'AAPL')));
});

// ---------- kas ----------

test('kas: cukup label, saldo, dan (opsional) mata uang; tanpa avgCost atau price', () => {
  assert.doesNotThrow(() => validateHoldings({ assets: [{ type: 'cash', symbol: 'BCA', qty: 5_000_000 }] }));
  assert.doesNotThrow(() => validateHoldings({ assets: [{ type: 'cash', symbol: 'USD', qty: 1500, currency: 'USD' }] }));
});

test('kas: saldo boleh 0 tapi tidak negatif, mata uang hanya IDR/USD, label tidak boleh kembar', () => {
  assert.doesNotThrow(() => validateHoldings({ assets: [{ type: 'cash', symbol: 'BCA', qty: 0 }] }));
  assert.throws(() => validateHoldings({ assets: [{ type: 'cash', symbol: 'BCA', qty: -1 }] }), /qty harus angka 0 atau lebih/);
  assert.throws(() => validateHoldings({ assets: [{ type: 'idx', symbol: 'BBCA', qty: 0, avgCost: 1 }] }), /qty harus angka lebih dari 0/);
  assert.throws(() => validateHoldings({ assets: [{ type: 'cash', symbol: 'BCA', qty: 1, currency: 'EUR' }] }), /currency harus IDR atau USD/);
  assert.throws(() => validateHoldings({ assets: [{ type: 'cash', symbol: 'BCA', qty: 1 }, { type: 'cash', symbol: 'BCA', qty: 2 }] }), /duplikat/);
});

test('jenis lain tetap wajib avgCost (kelonggaran hanya untuk kas)', () => {
  assert.throws(() => validateHoldings({ assets: [{ type: 'idx', symbol: 'BBCA', qty: 1 }] }), /avgCost/);
});

test('buildSnapshot: kas rupiah = nilai sebesar saldo, untung/rugi nol, masuk byType.cash', () => {
  const assets = [{ type: 'cash', symbol: 'BCA', qty: 5_000_000 }, { type: 'idx', symbol: 'BBCA', qty: 100, avgCost: 9000 }];
  const q = new Map([['cash:BCA', { price: 1, asOf: '2026-11-23' }], ['idx:BBCA', { price: 10_000, asOf: '2026-11-23' }]]);
  const s = buildSnapshot({ date: '2026-11-23', assets, quotes: q, fx: null });
  const c = s.positions.find((p) => p.type === 'cash');
  assert.deepEqual([c.value, c.cost, c.pnl, c.pnlPct, c.currency], [5_000_000, 5_000_000, 0, 0, 'IDR']);
  assert.equal(s.total, 6_000_000);
  assert.equal(s.cost, 5_900_000, 'modal total = modal kas (= saldonya) + modal saham');
  assert.equal(s.byType.cash.value, 5_000_000);
  assert.ok(Math.abs(s.byType.cash.weight - 5 / 6) < 1e-5);
});

test('buildSnapshot: kas dolar ikut kurs di nilai, tetap tanpa untung/rugi, dan butuh kurs', () => {
  const assets = [{ type: 'cash', symbol: 'USD', qty: 1000, currency: 'USD' }];
  const q = new Map([['cash:USD', { price: 1, asOf: '2026-11-24' }]]);
  const d1 = buildSnapshot({ date: '2026-11-23', assets, quotes: q, fx: 16_000 });
  const d2 = buildSnapshot({ date: '2026-11-24', assets, quotes: q, fx: 16_160, prev: d1 });
  assert.equal(d2.total, 16_160_000);
  assert.equal(d2.pnl, 0, 'kurs naik tidak dihitung sebagai untung/rugi aset kas');
  assert.ok(Math.abs(d2.dayPct - 0.01) < 1e-9, 'perubahan harian mengikuti kurs');
  assert.throws(() => buildSnapshot({ date: '2026-11-24', assets, quotes: q, fx: null }), /Kurs USD\/IDR dibutuhkan/);
});
