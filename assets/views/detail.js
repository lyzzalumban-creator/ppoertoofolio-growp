// Halaman satu aset (#/aset/<jenis:kode>): nilai, grafik harga, statistik, tombol Beli/Jual/Ubah/Hapus, aktivitasnya.
import { currencyOf } from '../../scripts/lib/portfolio.mjs';
import { $, ICON, MASK, toast, assetName, canTrade, colorOf, delta, esc, fCompact, fIdr, fNum, fUsd, heldText, keyOf, latest, longDate, money, pct, state, symDisp, toMs, tone, arrow, typeOf, weightText } from '../lib.js';
import { inRange, lineChart, rangesHtml, watch } from './chart.js';
import { openAssetForm, openTrade, openTx, removeAsset } from './sheets.js';
import { txRow } from './aktivitas.js';

const current = () => {
  const key = decodeURIComponent(state.route.sub || '');
  return { key, asset: state.assets.find((a) => keyOf(a) === key), pos: ((latest() && latest().positions) || []).find((p) => keyOf(p) === key) };
};

const stat = (label, value, note = '') => `<div><dt>${label}</dt><dd>${value}${note ? `<small>${note}</small>` : ''}</dd></div>`;

function drawChart() {
  const { key, asset, pos } = current();
  const box = $('achart');
  if (!box || !asset || asset.type === 'cash') return;
  const usd = currencyOf(asset) === 'USD';
  const secret = asset.type === 'manual' && state.hidden; // harga manual = angka ketikanmu sendiri, ikut disamarkan
  const raw = inRange(state.series, state.arange)
    .filter((s) => s.px && Number.isFinite(s.px[key]) && (!usd || s.fx > 0))
    .map((s) => ({ t: toMs(s.date), date: s.date, y: usd ? s.px[key] / s.fx : s.px[key] }));
  const base = raw.length ? raw[0].y : 1;
  const pts = secret ? raw.map((p) => ({ ...p, y: (p.y / base - 1) * 100 })) : raw;
  const fmt = usd ? fUsd : fIdr;
  lineChart(box, pts, {
    fmtY: (v) => (secret ? `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : usd ? v.toLocaleString('id-ID', { maximumFractionDigits: 2 }) : fCompact.format(v)),
    fmtTip: (p) => `<b>${esc(secret ? pct(p.y / 100) : fmt.format(p.y))}</b>${longDate(p.date)}`,
    label: (a, b) => `Harga ${symDisp(pos || asset)} dari ${secret ? pct(a.y / 100) : fmt.format(a.y)} pada ${longDate(a.date)} menjadi ${secret ? pct(b.y / 100) : fmt.format(b.y)} pada ${longDate(b.date)}`,
    empty: 'Grafik harga muncul setelah robot mencatat harga aset ini beberapa hari.',
    height: 200,
  });
  chartDrawn();
}
const chartDrawn = watch($('detail'), () => { if (state.route.view === 'aset') drawChart(); });

export function render() {
  const { asset, pos } = current();
  if (!asset) {
    $('detail').innerHTML = `<a class="back" href="#/beranda">${ICON.back}Beranda</a>
      <div class="card empty-card"><p>Aset ini tidak ada lagi (mungkin sudah terjual atau dihapus).</p><a class="btn" href="#/aktivitas">Lihat aktivitas</a></div>`;
    return;
  }
  const t = typeOf(asset.type);
  const cash = asset.type === 'cash';
  const usd = currencyOf(asset) === 'USD';
  const fmt = usd ? fUsd : fIdr;
  const unit = t.unit ? ` ${t.unit}` : '';
  const qty = state.hidden ? MASK : `${fNum.format(asset.qty)}${unit}`;
  const L = latest();
  const stats = cash
    ? [stat('Saldo', state.hidden ? MASK : fmt.format(asset.qty)), usd ? stat('Setara rupiah', money(pos && pos.value), L && L.fx ? `kurs ${esc(fIdr.format(L.fx))}` : '') : '', stat('Bobot', pos ? weightText(pos.weight) : '–', 'dari total')]
    : [
      stat('Hari ini', delta(pos && pos.dayPct), pos && Number.isFinite(pos.dayPct) && !state.hidden ? money(pos.value - pos.value / (1 + pos.dayPct), { sign: true }) : ''),
      stat('Untung', delta(pos && pos.pnlPct), pos ? money(pos.pnl, { sign: true }) : ''),
      stat('Nilai', money(pos && pos.value)),
      stat('Jumlah', esc(qty)),
      stat('Modal', money(pos ? pos.cost : null)),
      stat('Harga rata-rata', asset.type === 'manual' && state.hidden ? MASK : esc(fmt.format(asset.avgCost))),
      stat('Harga terakhir', pos ? (asset.type === 'manual' && state.hidden ? MASK : esc(fmt.format(pos.price))) : 'menunggu robot', pos && pos.asOf ? `per ${esc(longDate(pos.asOf))}${pos.stale ? ' (harga lama)' : ''}` : ''),
      stat('Bobot', pos ? weightText(pos.weight) : '–', 'dari total'),
      asset.buyDate ? stat('Dibeli', esc(longDate(asset.buyDate)), esc(heldText(asset.buyDate))) : '',
    ];
  const trades = state.txs.filter((x) => x.type === asset.type && x.symbol === asset.symbol).sort((a, b) => (a.date < b.date ? 1 : -1));
  const tradeBtn = (kind, label, icon) => `<button type="button" class="act" data-act="${kind}"${canTrade() ? '' : ' aria-disabled="true"'}>${icon}<span>${label}</span></button>`;
  $('detail').innerHTML = `
    <a class="back" href="#/beranda">${ICON.back}Beranda</a>
    <header class="d-head">
      <span class="d-badge" style="background:${colorOf(asset.type)}" aria-hidden="true">${esc(symDisp(asset).slice(0, 1).toUpperCase())}</span>
      <div><h2 class="d-name">${esc(assetName(asset))}</h2><p class="muted">${esc(symDisp(asset))} · ${esc(t.label)}</p></div>
    </header>
    <section class="card d-main">
      <div class="d-value">${pos ? money(pos.value) : '–'}</div>
      <div class="d-day">${pos ? (Number.isFinite(pos.dayPct) ? `<span class="pill ${tone(pos.dayPct)}">${arrow(pos.dayPct)}${pct(pos.dayPct)}</span><span class="muted">hari ini</span>` : '<span class="muted">Hari ini: belum ada pembanding</span>') : '<span class="chip-wait">Menunggu harga</span><span class="muted">Robot mengambil harga 4 kali sehari.</span>'}</div>
      ${cash ? '' : `<div id="achart" class="chart-box"></div><div class="seg seg-ranges" id="aranges" role="group" aria-label="Rentang waktu grafik harga">${rangesHtml(state.arange)}</div>`}
    </section>
    <div class="acts" role="group" aria-label="Tindakan">
      ${cash ? '' : tradeBtn('buy', 'Beli', ICON.plus) + tradeBtn('sell', 'Jual', ICON.minus)}
      <button type="button" class="act" data-act="edit">${ICON.edit}<span>${cash ? 'Ubah saldo' : 'Ubah'}</span></button>
      <button type="button" class="act danger" data-act="del">${ICON.trash}<span>Hapus</span></button>
    </div>
    ${!cash && !canTrade() ? '<p class="note">Beli/Jual butuh kode Apps Script versi 3 (tab Transaksi). Tempel <code>Code.gs</code> terbaru lalu buat versi deploy baru; langkahnya ada di README.</p>' : ''}
    <dl class="stats card">${stats.join('')}</dl>
    <section class="card" aria-labelledby="d-act-h"><h2 id="d-act-h">Aktivitas</h2>
      ${trades.length ? `<ul class="tx-list">${trades.map(txRow).join('')}</ul>` : '<p class="muted">Belum ada jual-beli untuk aset ini.</p>'}
    </section>`;
  if (!cash) drawChart();
}

export const show = render;

$('detail').addEventListener('click', (e) => {
  const r = e.target.closest('#aranges button[data-range]');
  if (r) { state.arange = r.dataset.range; $('aranges').innerHTML = rangesHtml(state.arange); drawChart(); return; }
  const b = e.target.closest('[data-act]');
  if (b) {
    const { asset } = current();
    if (!asset) return;
    const act = b.dataset.act;
    if (act === 'buy' || act === 'sell') openTrade(asset, act);
    else if (act === 'edit') openAssetForm(asset);
    else if (act === 'del') removeAsset(asset).catch((ex) => toast(ex.message));
    return;
  }
  const tx = e.target.closest('[data-tx]');
  if (tx) openTx(tx.dataset.tx);
});
