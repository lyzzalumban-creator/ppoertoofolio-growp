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
