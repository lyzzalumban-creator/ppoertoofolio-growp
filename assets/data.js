// Lapisan data web: muat sekali dari Apps Script, hitung tampilan langsung, dan simpan perubahan.
// Setiap simpan langsung memperbarui `state` (tanpa memuat ulang), jadi tambah/beli/jual terlihat seketika.
import { call } from '../scripts/lib/api.mjs';
import { readCreds } from './creds.js';
import { notify, state, todayWib } from './lib.js';
import { liveView, maxDrawdown, monthlyReturns, returnIndex } from './stats.js';

/** Hitung ulang tampilan langsung dan hitungan kinerja dari state.assets + state.snapshots. */
export function recompute() {
  const { snap, pending } = liveView(state.assets, state.snapshots, todayWib());
  const past = state.snapshots;
  // Hari terakhir riwayat diganti tampilan langsung (tanggal sama); tanpa riwayat, cukup tampilan langsung.
  state.series = snap ? (past.length && past[past.length - 1].date === snap.date ? [...past.slice(0, -1), snap] : [...past, snap]) : past.slice();
  state.pending = pending;
  const index = returnIndex(state.series);
  state.perf = { index, months: monthlyReturns(state.series), dd: index.length ? maxDrawdown(index) : null };
}

export function setData(d) {
  state.assets = d.assets || [];
  state.snapshots = d.history || [];
  state.txs = d.transactions || [];
  state.meta = { version: d.version };
  recompute();
}

const creds = () => {
  const c = readCreds();
  if (!c) throw new Error('Belum tersambung. Buka Profil > Keluar, lalu sambungkan lagi.');
  return c;
};

async function send(action, payload) {
  const c = creds();
  return call(c.url, c.token, action, payload);
}

/** Simpan seluruh daftar aset (tambah/ubah/hapus). */
export async function saveAssets(next) {
  await send('saveAssets', { assets: next });
  state.assets = next;
  recompute();
  notify();
}

/** Beli lagi / jual: daftar aset baru + catatan transaksi dalam satu panggilan (aman diulang, id sama). */
export async function trade(next, tx) {
  await send('trade', { assets: next, tx });
  state.assets = next;
  state.txs = [...state.txs, tx]; // gagal kirim = melempar sebelum baris ini, jadi tidak pernah dobel
  recompute();
  notify();
}

export async function deleteTx(id) {
  await send('deleteTx', { id });
  state.txs = state.txs.filter((t) => t.id !== id);
  notify();
}

/** id transaksi: acak, cukup unik untuk satu pemilik; dipakai agar kiriman ulang tidak tercatat dua kali. */
export const newId = () => `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
