// Aktivitas: dua bagian. Jual-beli (keuntungan terealisasi, tukar mata uang) dan Trading emas (profit per bulan).
// Ketuk satu baris untuk rinciannya (dan menghapus catatan).
import { $, MASK, arrow, esc, fMonth, fNum, fUsd, longDate, monthName, money, state, symDisp, toMs, todayWib, tone } from '../lib.js';
import { fxStats, realized } from '../../scripts/lib/trade.mjs';
import { barChart, sparkline, watch } from './chart.js';
import { openTx } from './sheets.js';

const usd = (v, { sign = false } = {}) => {
  if (state.hidden) return MASK;
  const s = fUsd.format(Math.abs(v));
  return v < 0 ? `−${s}` : sign && v > 0 ? `+${s}` : s;
};

/** Satu baris transaksi (dipakai juga di halaman aset). */
export function txRow(t) {
  const k = t.kind === 'sell' ? ['sell', 'Jual'] : t.kind === 'convert' ? ['conv', 'Tukar'] : t.kind === 'fx' ? ['conv', t.side === 'sell' ? 'Sell' : 'Buy'] : ['buy', 'Beli'];
  const qty = state.hidden ? MASK : fNum.format(t.qty);
  const main = t.kind === 'convert' ? `${esc(t.symbol)} → ${esc(t.toSymbol || '')}` : esc(symDisp(t));
  const sub = t.kind === 'fx' ? `${qty} lot` : t.kind === 'convert' ? `kurs ${fNum.format(t.price)}` : qty;
  const val = t.kind === 'sell' ? `<b class="${tone(t.pnlIdr)}">${arrow(t.pnlIdr)}${money(t.pnlIdr, { sign: true })}</b><small>terealisasi</small>`
    : t.kind === 'fx' ? `<b class="${tone(t.pnl)}">${arrow(t.pnl)}${usd(t.pnl, { sign: true })}</b>`
    : t.kind === 'convert' ? `<b>${state.hidden ? MASK : esc(new Intl.NumberFormat('id-ID', { style: 'currency', currency: t.currency === 'IDR' ? 'USD' : 'IDR', maximumFractionDigits: t.currency === 'IDR' ? 2 : 0 }).format(t.toQty))}</b>`
    : '<small>dibeli</small>';
  return `<li><button type="button" class="tx" data-tx="${esc(t.id)}">
    <span class="tx-kind ${k[0]}">${k[1]}</span>
    <span class="tx-main"><b>${main}</b><small>${sub} · ${esc(longDate(t.date))}</small></span>
    <span class="tx-val">${val}</span>
  </button></li>`;
}

const byNewest = (a, b) => (a.date === b.date ? String(b.at).localeCompare(String(a.at)) : a.date < b.date ? 1 : -1);

function groupByMonth(list) {
  const groups = new Map();
  for (const t of [...list].sort(byNewest)) {
    const m = String(t.date).slice(0, 7);
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(t);
  }
  return [...groups].map(([m, ts]) => `<h3 class="tx-month">${esc(/^\d{4}-\d{2}$/.test(m) ? monthName(m) : m)}</h3><ul class="tx-list">${ts.map(txRow).join('')}</ul>`).join('');
}

/** Jumlah berjalan per transaksi (urut tanggal): bentuk kurva untuk mini-grafik kartu statistik. */
const cumulative = (list, val) => {
  let sum = 0;
  return [...list].sort((a, b) => (a.date === b.date ? String(a.at).localeCompare(String(b.at)) : a.date < b.date ? -1 : 1)).map((t) => (sum += Number(val(t)) || 0));
};

function renderJualBeli() {
  const list = state.txs.filter((t) => t.kind !== 'fx');
  const sells = list.filter((t) => t.kind === 'sell');
  const year = Number(todayWib().slice(0, 4)); // tahun menurut WIB, sama dengan tanggal transaksi
  const all = realized(list);
  const thisYear = realized(list, year);
  $('realized').innerHTML = `
    <div class="wg"><div class="wg-left">
      <div class="wg-top"><span class="label">Keuntungan terealisasi</span>${sells.length ? `<span class="pill ${tone(all)}">${arrow(all)}${sells.length} penjualan</span>` : ''}</div>
      <div class="sum-value ${sells.length ? tone(all) : ''}">${sells.length ? money(all, { sign: true }) : '–'}</div>
    </div>${sparkline(cumulative(sells, (t) => t.pnlIdr), 'wg-spark', 'g-real')}</div>
    <dl class="stats">
      <div><dt>Tahun ${year}</dt><dd class="${tone(thisYear)}">${sells.length ? money(thisYear, { sign: true }) : '–'}</dd></div>
      <div><dt>Transaksi</dt><dd>${list.length}</dd></div>
    </dl>`;
  $('txs').innerHTML = list.length ? groupByMonth(list) : '<p class="muted">Belum ada transaksi.</p>';
}

// ---------- trading emas ----------

const short = (m) => fMonth.format(toMs(`${m}-01`)).split(' ')[0];

function drawFx() {
  const months = fxStats(state.txs).months.slice(-12);
  const show = !state.hidden; // nominal: saat tersembunyi hanya bentuk batang, tanpa angka
  barChart($('fxchart'), months.map((m) => ({ label: short(m.month), v: m.pnl, tip: `<b>${esc(monthName(m.month))}</b><span>${esc(usd(m.pnl, { sign: true }))}</span><span>${m.trades} trade</span>` })), {
    fmtY: (v) => (show ? `${v.toLocaleString('id-ID', { maximumFractionDigits: 0 })}` : ''),
    fmtV: (v) => (show ? v.toLocaleString('id-ID', { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1 }) : ''),
    aria: months.length ? `Profit trading emas per bulan, ${months.length} bulan` : '',
    empty: 'Grafik muncul setelah ada trade yang dicatat.',
  });
  chartDrawn();
}
const chartDrawn = watch($('fxchart'), () => { if (state.route.view === 'aktivitas') drawFx(); });

function renderTrading() {
  const st = fxStats(state.txs);
  const thisMonth = st.months.find((m) => m.month === todayWib().slice(0, 7));
  $('fxsum').innerHTML = `
    <div class="wg"><div class="wg-left">
      <div class="wg-top"><span class="label">Profit trading emas</span>${st.trades ? `<span class="pill ${tone(st.total)}">${arrow(st.total)}${st.trades} trade</span>` : ''}</div>
      <div class="sum-value ${st.trades ? tone(st.total) : ''}">${st.trades ? usd(st.total, { sign: true }) : '–'}</div>
    </div>${sparkline(cumulative(state.txs.filter((t) => t.kind === 'fx'), (t) => t.pnl), 'wg-spark', 'g-fx')}</div>
    <dl class="stats c3">
      <div><dt>Bulan ini</dt><dd class="${tone(thisMonth && thisMonth.pnl)}">${thisMonth ? usd(thisMonth.pnl, { sign: true }) : '–'}</dd></div>
      <div><dt>Win rate</dt><dd>${st.winRate == null ? '–' : `${Math.round(st.winRate * 100)}%`}</dd></div>
      <div><dt>Menang / kalah</dt><dd>${st.trades ? `${st.wins} / ${st.losses}` : '–'}</dd></div>
    </dl>`;
  $('fxmonths').innerHTML = [...st.months].reverse().map((m) => `<li class="mrow"><span class="mr-m">${esc(short(m.month))} ${esc(m.month.slice(0, 4))}</span><span class="mr-v ${tone(m.pnl)}">${arrow(m.pnl)}${usd(m.pnl, { sign: true })}</span></li>`).join('');
  const list = state.txs.filter((t) => t.kind === 'fx');
  $('fxlist').innerHTML = list.length ? groupByMonth(list) : '<p class="muted">Belum ada trade. Ketuk + lalu pilih Trade emas.</p>';
  drawFx();
}

export function render() {
  renderJualBeli();
  renderTrading();
}

const SUBS = ['jual-beli', 'trading'];
/** Tampilkan satu bagian; bagian tak dikenal = Jual-beli. */
export function show(sub) {
  const s = SUBS.includes(sub) ? sub : 'jual-beli';
  $('ak-jb').hidden = s !== 'jual-beli';
  $('ak-fx').hidden = s !== 'trading';
  for (const a of $('aktnav').querySelectorAll('a')) {
    if (a.getAttribute('href') === `#/aktivitas/${s}`) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (s === 'trading') drawFx();
}

for (const id of ['txs', 'fxlist']) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tx]');
    if (b) openTx(b.dataset.tx);
  });
}
