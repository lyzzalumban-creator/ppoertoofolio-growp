import { test } from 'node:test';
import assert from 'node:assert/strict';

// data.js membaca localStorage dan memakai fetch; tiruan sederhana cukup.
globalThis.localStorage = { getItem: () => JSON.stringify({ url: 'https://script.google.com/x', token: 't' }), setItem() {}, removeItem() {} };
const { saveAssets, saveStamp, whenSaved, setData } = await import('../assets/data.js');
const { state } = await import('../assets/lib.js');

test('simpan yang sedang berjalan dilacak: whenSaved menunggu sampai selesai, saveStamp naik tiap simpan', async () => {
  let release;
  globalThis.fetch = () => new Promise((r) => { release = () => r({ ok: true, text: async () => '{}' }); });
  setData({ assets: [], history: [], transactions: [] });
  const s0 = saveStamp();
  const p = saveAssets([{ type: 'cash', symbol: 'K', qty: 5, currency: 'IDR' }]);
  assert.equal(saveStamp(), s0 + 1);
  let waited = false;
  const w = whenSaved().then(() => { waited = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(waited, false); // masih menunggu balasan Sheet
  assert.equal(state.assets.length, 0); // state baru berubah setelah Sheet membalas
  release();
  await p; await w;
  assert.equal(waited, true);
  assert.equal(state.assets[0].qty, 5);
});

test('simpan gagal: whenSaved tetap selesai dan state tidak berubah', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => '' });
  setData({ assets: [], history: [], transactions: [] });
  await assert.rejects(saveAssets([{ type: 'cash', symbol: 'K', qty: 9, currency: 'IDR' }]));
  await whenSaved();
  assert.equal(state.assets.length, 0);
});

test('tarik kas tidak terbaca sebagai rugi: harga datar = return harian 0 dengan atau tanpa penarikan; total turun', async () => {
  const { liveView } = await import('../assets/stats.js');
  const pos = (price) => [
    { type: 'idx', symbol: 'A', name: 'A', qty: 100, price, currency: 'IDR', priceIdr: price, value: 100 * price, cost: 100_000, pnl: 0, pnlPct: 0, weight: 0.05, asOf: '2026-11-22' },
    { type: 'cash', symbol: 'K', name: 'K', qty: 1_900_000, price: 1, currency: 'IDR', priceIdr: 1, value: 1_900_000, cost: 1_900_000, pnl: 0, pnlPct: 0, weight: 0.95 }];
  const snaps = [
    { date: '2026-11-21', fx: 16000, total: 2_000_000, positions: pos(1000), byType: {}, px: { 'idx:A': 1000 } },
    { date: '2026-11-22', fx: 16000, total: 2_000_000, positions: pos(1000), byType: {}, px: { 'idx:A': 1000 } }];
  const mk = (cash) => [{ type: 'idx', symbol: 'A', qty: 100, avgCost: 1000, price: 1000 }, { type: 'cash', symbol: 'K', qty: cash, currency: 'IDR' }];
  const a = liveView(mk(1_900_000), snaps, '2026-11-23').snap;
  const b = liveView(mk(900_000), snaps, '2026-11-23').snap; // tarik 1.000.000
  assert.equal(a.dayPct, 0);
  assert.equal(b.dayPct, 0); // penarikan bukan kerugian
  assert.equal(b.dayPnl, 0);
  assert.equal(a.total - b.total, 1_000_000);
});
