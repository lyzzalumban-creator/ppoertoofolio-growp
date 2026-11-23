import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildSnapshot, dateInTz, keyOf, pruneOld, redact, upsertSnapshot, validateHoldings,
} from '../scripts/lib/portfolio.mjs';

const sample = JSON.parse(readFileSync(new URL('../data/holdings.json', import.meta.url), 'utf8'));

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

test('holdings contoh di repo lolos validasi', () => {
  assert.doesNotThrow(() => validateHoldings(sample));
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
  assert.throws(() => validateHoldings({ settings: { publish: 'x' }, assets: [assets[0]] }), /publish/);
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

test('redact membuang SEMUA nominal rupiah dan jumlah unit', () => {
  const full = buildSnapshot({ date: '2026-11-24', assets, quotes, fx: 16_000 });
  const pub = redact(full);
  const json = JSON.stringify(pub);
  for (const secret of [full.total, full.cost, full.pnl]) assert.ok(!json.includes(String(secret)), `bocor: ${secret}`);
  for (const p of pub.positions) {
    for (const k of ['qty', 'value', 'cost', 'pnl']) assert.ok(!(k in p), `field ${k} masih ada`);
  }
  assert.ok(!('total' in pub) && !('cost' in pub) && !('dayPnl' in pub));
  assert.ok(!Object.values(pub.byType).some((t) => 'value' in t));
  assert.equal(pub.pnlPct, full.pnlPct);
  assert.ok(pub.positions.every((p) => typeof p.weight === 'number'));
});

test('redact tidak menerbitkan "harga" aset manual (sering sama dengan saldo)', () => {
  const a = [
    ...assets,
    { type: 'manual', symbol: 'DEPO', qty: 1, price: 123_456_789, avgCost: 100_000_000 },
  ];
  const q = new Map(quotes);
  q.set('manual:DEPO', { price: 123_456_789, asOf: '2026-11-24' });
  const full = buildSnapshot({ date: 'd', assets: a, quotes: q, fx: 16_000 });
  assert.equal(full.positions.find((p) => p.symbol === 'DEPO').value, 123_456_789); // kontrol: di versi penuh memang ada
  const json = JSON.stringify(redact(full));
  assert.ok(!json.includes('123456789'), 'saldo manual bocor lewat price/priceIdr');
  const depo = redact(full).positions.find((p) => p.symbol === 'DEPO');
  assert.ok(!('price' in depo) && !('priceIdr' in depo));
  // harga pasar (bukan manual) tetap ada
  assert.equal(redact(full).positions.find((p) => p.symbol === 'AAPL').price, 200);
});

test('redact tetap menyisakan data yang cukup untuk fallback harga lama', () => {
  const pub = redact(buildSnapshot({ date: 'd', assets, quotes, fx: 16_000 }));
  const p = pub.positions.find((x) => x.symbol === 'AAPL');
  assert.equal(p.price, 200);
  assert.equal(p.priceIdr, 3_200_000);
  assert.equal(p.asOf, '2026-11-21');
});

test('upsertSnapshot: ganti tanggal yang sama, urut menurut tanggal', () => {
  let h = [{ date: '2026-11-22', total: 1 }, { date: '2026-11-24', total: 3 }];
  h = upsertSnapshot(h, { date: '2026-11-23', total: 2 });
  h = upsertSnapshot(h, { date: '2026-11-24', total: 99 });
  assert.deepEqual(h.map((s) => s.date), ['2026-11-22', '2026-11-23', '2026-11-24']);
  assert.equal(h.at(-1).total, 99);
});

test('pruneOld hanya membuang rincian aset dari snapshot lama', () => {
  const snaps = Array.from({ length: 5 }, (_, i) => ({ date: `d${i}`, total: i, positions: [{}] }));
  const out = pruneOld(snaps, 2);
  assert.deepEqual(out.map((s) => 'positions' in s), [false, false, false, true, true]);
  assert.deepEqual(out.map((s) => s.total), [0, 1, 2, 3, 4]);
});

test('dateInTz memakai zona waktu yang diminta', () => {
  const ms = Date.parse('2026-11-23T20:00:00Z'); // 03:00 WIB tanggal berikutnya
  assert.equal(dateInTz(ms, 'Asia/Jakarta'), '2026-11-24');
  assert.equal(dateInTz(ms, 'UTC'), '2026-11-23');
  assert.equal(keyOf({ type: 'idx', symbol: 'BBCA' }), 'idx:BBCA');
});
