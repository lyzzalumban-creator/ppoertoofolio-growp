import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxDrawdown, monthlyReturns, returnIndex, sortPositions } from '../assets/stats.js';

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
