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
