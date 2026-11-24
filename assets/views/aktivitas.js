// Aktivitas: keuntungan terealisasi dan riwayat jual-beli. Ketuk satu baris untuk rinciannya (dan menghapus catatan).
import { $, MASK, arrow, esc, fNum, longDate, monthName, money, state, symDisp, todayWib, tone, typeOf } from '../lib.js';
import { realized } from '../../scripts/lib/trade.mjs';
import { openTx } from './sheets.js';

/** Satu baris transaksi (dipakai juga di halaman aset). */
export function txRow(t) {
  const sellTx = t.kind === 'sell';
  return `<li><button type="button" class="tx" data-tx="${esc(t.id)}">
    <span class="tx-kind ${sellTx ? 'sell' : 'buy'}">${sellTx ? 'Jual' : 'Beli'}</span>
    <span class="tx-main"><b>${esc(symDisp(t))}</b><small>${state.hidden ? MASK : fNum.format(t.qty)} · ${esc(longDate(t.date))}</small></span>
    <span class="tx-val">${sellTx ? `<b class="${tone(t.pnlIdr)}">${arrow(t.pnlIdr)}${money(t.pnlIdr, { sign: true })}</b><small>terealisasi</small>` : `<small>${esc(typeOf(t.type).label)}</small>`}</span>
  </button></li>`;
}

export function render() {
  const sells = state.txs.filter((t) => t.kind === 'sell');
  const year = Number(todayWib().slice(0, 4)); // tahun menurut WIB, sama dengan tanggal transaksi
  const all = realized(state.txs);
  const thisYear = realized(state.txs, year);
  $('realized').innerHTML = `
    <div class="sum-top"><span class="label">Keuntungan terealisasi</span><span class="muted">${sells.length} penjualan</span></div>
    <div class="sum-value ${sells.length ? tone(all) : ''}">${sells.length ? money(all, { sign: true }) : '–'}</div>
    <dl class="stats">
      <div><dt>Tahun ${year}</dt><dd class="${tone(thisYear)}">${sells.length ? money(thisYear, { sign: true }) : '–'}</dd></div>
      <div><dt>Transaksi</dt><dd>${state.txs.length}</dd></div>
    </dl>
    <p class="muted">Dihitung dari harga jual dikurangi harga beli rata-rata saat dijual.</p>`;

  if (!state.txs.length) {
    $('txs').innerHTML = '<p class="muted">Belum ada transaksi. Buka salah satu aset di Beranda, lalu pilih <b>Jual</b> atau <b>Beli</b>.</p>';
    return;
  }
  // Terbaru di atas, dikelompokkan per bulan.
  const list = [...state.txs].sort((a, b) => (a.date === b.date ? String(b.at).localeCompare(String(a.at)) : a.date < b.date ? 1 : -1));
  const groups = new Map();
  for (const t of list) {
    const m = String(t.date).slice(0, 7);
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(t);
  }
  $('txs').innerHTML = [...groups].map(([m, ts]) => `<h3 class="tx-month">${esc(/^\d{4}-\d{2}$/.test(m) ? monthName(m) : m)}</h3><ul class="tx-list">${ts.map(txRow).join('')}</ul>`).join('');
}

$('txs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tx]');
  if (b) openTx(b.dataset.tx);
});
