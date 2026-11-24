import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveView, byTypePnl, cashSplit, concentration, currentDrawdown, goalProgress, insights, maxDrawdown, monthlyReturns, returnIndex, riskStats, sortPositions } from '../assets/stats.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} != ${b}`);
const snap = (date, dayPct) => ({ date, dayPct });

test('returnIndex mengabaikan dayPct snapshot pertama dan melewati yang kosong', () => {
  const idx = returnIndex([snap('2026-01-30', 0.5), snap('2026-01-31', 0.1), snap('2026-02-01', null), snap('2026-02-02', -0.1)]);
  assert.deepEqual(idx.map((p) => p.date), ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
  near(idx[0].idx, 1);
  near(idx[1].idx, 1.1);
  near(idx[2].idx, 1.1, 'dayPct null = tidak berubah');
  near(idx[3].idx, 0.99);
});

test('monthlyReturns: bulan baru diukur dari akhir bulan sebelumnya', () => {
  const m = monthlyReturns([
    snap('2026-01-30', null), snap('2026-01-31', 0.1), // Jan: +10%
    snap('2026-02-01', 0.1), snap('2026-02-02', -0.5), // Feb: 1,1 * 0,5 = -45%
    snap('2026-03-05', 0.2), // Mar: +20% (selisih hari tidak masalah)
  ]);
  assert.deepEqual(m.map((x) => x.month), ['2026-01', '2026-02', '2026-03']);
  near(m[0].ret, 0.1);
  near(m[1].ret, -0.45);
  near(m[2].ret, 0.2);
  assert.deepEqual([m[0].from, m[0].to, m[2].from, m[2].to], ['2026-01-30', '2026-01-31', '2026-03-05', '2026-03-05']);
});

test('monthlyReturns: pnl rupiah = jumlah dayPnl bulan itu; snapshot tanpa dayPnl dihitung 0', () => {
  const withPnl = (date, dayPct, dayPnl) => ({ ...snap(date, dayPct), dayPnl });
  const m = monthlyReturns([
    withPnl('2026-01-30', null, null), withPnl('2026-01-31', 0.1, 1_000), // Jan: 1.000
    withPnl('2026-02-01', 0.1, 2_500), withPnl('2026-02-02', -0.5, -4_000), // Feb: -1.500
    snap('2026-03-05', 0.2), // tanpa dayPnl: 0, bukan NaN
  ]);
  assert.deepEqual(m.map((x) => x.pnl), [1_000, -1_500, 0]);
  assert.ok(m.every((x) => Number.isFinite(x.pnl)));
});

test('monthlyReturns: hasil bulanan berantai sama dengan return total', () => {
  const s = [];
  for (let i = 0; i < 90; i++) s.push(snap(new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), ((i * 37) % 11 - 5) / 400));
  const chained = monthlyReturns(s).reduce((a, x) => a * (1 + x.ret), 1);
  near(chained, returnIndex(s).at(-1).idx);
});

test('monthlyReturns: satu snapshot = 0%, kosong = []', () => {
  assert.deepEqual(monthlyReturns([]), []);
  near(monthlyReturns([snap('2026-05-10', 0.3)])[0].ret, 0);
});

test('maxDrawdown mencari puncak ke lembah terdalam, bukan sekadar nilai terendah', () => {
  const idx = [
    { date: 'a', idx: 1 }, { date: 'b', idx: 1.2 }, { date: 'c', idx: 0.9 }, // 1,2 -> 0,9 = -25%
    { date: 'd', idx: 1.5 }, { date: 'e', idx: 1.3 }, // -13%
  ];
  const dd = maxDrawdown(idx);
  near(dd.pct, -0.25);
  assert.equal(dd.from, 'b');
  assert.equal(dd.to, 'c');
});

test('maxDrawdown: selalu naik = 0 tanpa tanggal', () => {
  assert.deepEqual(maxDrawdown([{ date: 'a', idx: 1 }, { date: 'b', idx: 1.1 }]), { pct: 0, from: null, to: null });
});

test('sortPositions: persen kosong selalu di bawah, nama memakai urutan Indonesia', () => {
  const rows = [
    { symbol: 'B', name: 'bank', value: 10, pnlPct: null, dayPct: 0.01 },
    { symbol: 'A', name: 'Apel', value: 30, pnlPct: -0.2, dayPct: null },
    { symbol: 'C', name: 'cokelat', value: 20, pnlPct: 0.5, dayPct: -0.02 },
  ];
  const sym = (k) => sortPositions(rows, k).map((r) => r.symbol).join('');
  assert.equal(sym('value'), 'ACB');
  assert.equal(sym('pnlPct'), 'CAB');
  assert.equal(sym('dayPct'), 'BCA');
  assert.equal(sym('name'), 'ABC');
  assert.equal(sym('ngawur'), 'ACB', 'kunci tak dikenal = urut nilai');
  assert.equal(rows[0].symbol, 'B', 'array asli tidak diubah');
});

const P = (symbol, o = {}) => ({ type: 'idx', symbol, name: symbol, value: 100, weight: 0.1, dayPct: null, ...o });

const pt = (w) => `${Math.round(w * 100)}%`;
const LB = { crypto: 'Kripto', idx: 'Saham IDX' };

test('insights: aset dan jenis yang terlalu besar diperingatkan, dengan ambang batas', () => {
  const snap = { positions: [P('ETH', { type: 'crypto', name: 'Ethereum', weight: 0.4 }), P('BBCA', { weight: 0.2 })], byType: { crypto: { weight: 0.65 }, idx: { weight: 0.35 } } };
  const r = insights(snap, LB, pt);
  assert.deepEqual(r.map((x) => x.id), ['asset:crypto:ETH', 'type:crypto']);
  assert.match(r[0].text, /Ethereum menguasai 40%/);
  assert.match(r[1].text, /Kripto \(65%\)/);
  const ok = { positions: [P('ETH', { type: 'crypto', weight: 0.29 })], byType: { crypto: { weight: 0.59 } } };
  assert.deepEqual(insights(ok, LB, pt), [], 'tepat di bawah ambang = aman');
  assert.equal(insights({ positions: [P('ETH', { type: 'crypto', weight: 0.3 })], byType: {} }, LB, pt).length, 1, 'tepat di ambang = peringatan');
});

test('insights: kas/deposito (manual) tidak dianggap konsentrasi, harga lama dihitung semua jenis', () => {
  const snap = { positions: [P('KAS', { type: 'manual', weight: 0.9 }), P('BBCA', { weight: 0.1, stale: true }), P('DEPO', { type: 'manual', weight: 0, stale: true })], byType: { manual: { weight: 0.9 }, idx: { weight: 0.1 } } };
  const r = insights(snap, { manual: 'Lainnya' }, pt);
  assert.deepEqual(r.map((x) => x.id), ['stale']);
  assert.match(r[0].text, /^2 aset memakai harga lama/);
});

test('insights: tanpa posisi = tanpa peringatan, dan tidak pernah memuat nominal', () => {
  assert.deepEqual(insights({}, LB, pt), []);
  const r = insights({ positions: [P('ETH', { type: 'crypto', name: 'Ethereum', weight: 0.5, value: 123456789 })], byType: { crypto: { weight: 0.7 } } }, LB, pt);
  assert.ok(r.every((x) => !/\d{4,}|Rp/.test(x.text)));
});

test('goalProgress: dibatasi 0..1, null bila target tidak valid', () => {
  near(goalProgress(49, 100), 0.49);
  assert.equal(goalProgress(150, 100), 1);
  assert.equal(goalProgress(-5, 100), 0);
  for (const g of [0, -1, NaN, null, undefined]) assert.equal(goalProgress(10, g), null);
});

const days = (rs) => rs.map((r, i) => snap(new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), r));

test('riskStats: butuh minimal 14 hari return, kurang dari itu = null', () => {
  assert.equal(riskStats(days(Array(13).fill(0.01))), null);
  assert.equal(riskStats([snap('2026-01-01', null), ...days(Array(13).fill(0.01))]), null, 'dayPct kosong tidak dihitung');
  assert.notEqual(riskStats(days(Array(14).fill(0.01))), null);
});

test('riskStats: volatilitas tahunan, hari terbaik/terburuk, dan hitung naik/turun/datar', () => {
  const rs = [0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0, 0.03, -0.02, 0];
  const r = riskStats(days(rs));
  const n = rs.length, mean = rs.reduce((a, b) => a + b) / n;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  near(r.vol, sd * Math.sqrt(365));
  assert.deepEqual([r.up, r.down, r.flat, r.days], [7, 7, 2, 16]); // 6+1 naik, 6+1 turun, 2 datar
  assert.equal(r.best.date, '2026-01-14');
  near(r.best.pct, 0.03);
  assert.equal(r.worst.date, '2026-01-15');
  near(r.worst.pct, -0.02);
});

test('riskStats: harga tidak pernah bergerak = volatilitas 0, bukan error', () => {
  const r = riskStats(days(Array(20).fill(0)));
  assert.equal(r.vol, 0);
  assert.equal(r.flat, 20);
});

test('currentDrawdown: jarak dari puncak, 0 bila sedang di puncak', () => {
  const dd = currentDrawdown([{ date: 'a', idx: 1 }, { date: 'b', idx: 1.5 }, { date: 'c', idx: 1.2 }]);
  near(dd.pct, -0.2);
  assert.equal(dd.peak, 'b');
  near(currentDrawdown([{ date: 'a', idx: 1 }, { date: 'b', idx: 1.1 }]).pct, 0);
});

test('concentration: top 3 dan setara N aset (4 aset sama rata = 4, satu mendominasi = mendekati 1)', () => {
  const eq = concentration([0.25, 0.25, 0.25, 0.25].map((weight) => ({ weight })));
  near(eq.top3, 0.75);
  near(eq.effective, 4);
  const one = concentration([{ weight: 0.97 }, { weight: 0.01 }, { weight: 0.01 }, { weight: 0.01 }]);
  assert.ok(one.effective < 1.1 && one.top3 > 0.98);
  near(concentration([{ weight: 0.2 }, { weight: 0.2 }]).effective, 2, 'bobot dinormalkan, tidak harus berjumlah 1');
  assert.equal(concentration([]), null);
  assert.equal(concentration([{ weight: 0 }]), null);
});

test('byTypePnl: dijumlah per jenis; modal 0 = persen kosong', () => {
  const r = byTypePnl([
    { type: 'idx', value: 120, cost: 100 }, { type: 'idx', value: 80, cost: 100 },
    { type: 'manual', value: 50, cost: 0 }, { type: 'us', value: 90, cost: 100 },
  ]);
  assert.deepEqual([r.idx.value, r.idx.cost, r.idx.count, r.idx.pnl], [200, 200, 2, 0]);
  near(r.idx.pnlPct, 0);
  near(r.us.pnlPct, -0.1);
  assert.equal(r.manual.pnlPct, null);
  assert.equal(Object.keys(r).length, 3);
});

test('insights: kas tidak dianggap konsentrasi walau mendominasi', () => {
  const snap = { positions: [P('BCA', { type: 'cash', weight: 0.9 }), P('BBCA', { weight: 0.1 })], byType: { cash: { weight: 0.9 }, idx: { weight: 0.1 } } };
  assert.deepEqual(insights(snap, { cash: 'Kas', idx: 'Saham IDX' }, pt), []);
});

test('cashSplit: kas, yang diinvestasikan, dan porsi kas; tanpa kas = 0', () => {
  const r = cashSplit({ total: 1000, byType: { cash: { value: 250 }, idx: { value: 750 } } });
  assert.deepEqual([r.cash, r.invested, r.weight], [250, 750, 0.25]);
  assert.deepEqual(cashSplit({ total: 500, byType: { idx: { value: 500 } } }), { cash: 0, invested: 500, weight: 0 });
  assert.deepEqual(cashSplit({ total: 0, byType: {} }), { cash: 0, invested: 0, weight: 0 });
});

// ---------- tampilan langsung ----------
import { buildSnapshot as bs } from '../scripts/lib/portfolio.mjs';

const A1 = { type: 'idx', symbol: 'BBCA', qty: 100, avgCost: 9000 };
const A2 = { type: 'us', symbol: 'AAPL', qty: 2, avgCost: 150 };
const q = (p1, p2, d) => new Map([['idx:BBCA', { price: p1, asOf: d }], ['us:AAPL', { price: p2, asOf: d }]]);
const s1 = bs({ date: '2026-11-22', assets: [A1, A2], quotes: q(10_000, 200, '2026-11-22'), fx: 16_000 });
const s2 = { ...bs({ date: '2026-11-23', assets: [A1, A2], quotes: q(10_500, 210, '2026-11-23'), fx: 16_000, prev: s1 }), at: '2026-11-23T06:00:00Z' };

test('liveView tanpa perubahan = snapshot terakhir robot (angka identik)', () => {
  const { snap, pending } = liveView([A1, A2], [s1, s2]);
  assert.deepEqual(pending, []);
  for (const k of ['total', 'cost', 'pnl', 'pnlPct', 'dayPnl', 'dayPct', 'at']) assert.equal(snap[k], s2[k], k);
});

test('liveView: jumlah diubah (jual/beli) langsung dihitung dengan harga terakhir', () => {
  const { snap } = liveView([{ ...A1, qty: 40 }, A2], [s1, s2]);
  assert.equal(snap.positions.find((p) => p.symbol === 'BBCA').value, 420_000);
  assert.equal(snap.total, 420_000 + 2 * 210 * 16_000);
});

test('liveView: aset baru tanpa harga -> pending; kas dan manual langsung dihitung', () => {
  const baru = { type: 'crypto', symbol: 'SOL', coingeckoId: 'solana', qty: 3, avgCost: 1 };
  const kas = { type: 'cash', symbol: 'BCA', qty: 5_000_000 };
  const depo = { type: 'manual', symbol: 'DEPO', qty: 1, price: 2_000_000, avgCost: 2_000_000 };
  const { snap, pending } = liveView([A1, baru, kas, depo], [s1, s2]);
  assert.deepEqual(pending.map((a) => a.symbol), ['SOL']);
  assert.deepEqual(snap.positions.map((p) => p.symbol).sort(), ['BBCA', 'BCA', 'DEPO']);
});

test('liveView tanpa riwayat: kas/manual tetap terhitung (tanggal hari ini), aset pasar menunggu harga', () => {
  const { snap, pending } = liveView([A1, { type: 'cash', symbol: 'BCA', qty: 1000 }], [], '2026-11-24');
  assert.equal(snap.total, 1000);
  assert.equal(snap.date, '2026-11-24');
  assert.deepEqual(pending.map((a) => a.symbol), ['BBCA']);
  assert.deepEqual(liveView([], []), { snap: null, pending: [] });
});

test('liveView: aset dolar tanpa kurs di snapshot -> menunggu, bukan angka salah', () => {
  const sNoFx = { ...s2, fx: null };
  const { pending } = liveView([A2, { type: 'cash', symbol: 'USD', qty: 10, currency: 'USD' }], [s1, sNoFx]);
  assert.deepEqual(pending.map((a) => a.symbol), ['AAPL', 'USD']);
});

import { treemap } from '../assets/stats.js';
test('treemap: luas petak sebanding nilai, semua di dalam kotak, tanpa tumpang tindih', () => {
  const items = [50, 25, 12, 8, 4, 1].map((value, i) => ({ id: i, value }));
  const r = treemap(items, 100, 90);
  assert.equal(r.length, 6);
  const total = 100;
  for (const t of r) {
    assert.ok(t.x >= -1e-9 && t.y >= -1e-9 && t.x + t.w <= 100 + 1e-9 && t.y + t.h <= 90 + 1e-9);
    assert.ok(Math.abs((t.w * t.h) / (100 * 90) - t.item.value / total) < 1e-9);
  }
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
    const a = r[i], b = r[j];
    assert.ok(a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9 || a.y + a.h <= b.y + 1e-9 || b.y + b.h <= a.y + 1e-9, `petak ${i} dan ${j} bertumpuk`);
  }
  assert.equal(treemap([{ value: 0 }, { value: -3 }]).length, 0); // nilai nol/negatif diabaikan
  assert.equal(treemap([{ value: 5 }], 100, 50)[0].w, 100);
});

import { heatItems } from '../assets/stats.js';
test('heatItems: kas tidak ikut, aset kecil digabung jadi "Lainnya", metrik hari ini vs untung total', () => {
  const P = (symbol, value, dayPct, pnlPct, type = 'idx') => ({ type, symbol, value, dayPct, pnlPct });
  const pos = [P('A', 600, 0.01, 0.2), P('B', 300, -0.02, 0.1), P('C', 30, 0.04, 0.5), P('D', 20, 0.02, 0.1), P('KAS', 9999, null, 0, 'cash')];
  const day = heatItems(pos, 'day');
  assert.equal(day.length, 3); // A, B, dan satu petak gabungan C+D
  assert.ok(!day.some((i) => i.p && i.p.type === 'cash') && !day.some((i) => i.group && i.group.some((g) => g.type === 'cash')));
  const g = day.find((i) => i.group);
  assert.equal(g.group.length, 2);
  assert.equal(g.value, 50);
  assert.ok(Math.abs(g.d - (30 * 0.04 + 20 * 0.02) / 50) < 1e-12);
  assert.equal(heatItems(pos, 'pnl').find((i) => i.p && i.p.symbol === 'A').d, 0.2);
  // hanya satu aset kecil: tidak digabung
  assert.equal(heatItems([P('A', 900, 0, 0), P('B', 40, 0, 0)], 'day').length, 2);
  assert.equal(heatItems([P('A', 900, 0, 0), P('B', 40, 0, 0)], 'day').some((i) => i.group), false);
  assert.equal(heatItems([P('X', 10, null, null)], 'day')[0].d, null);
});
