// Aset: cari, filter jenis (lewat rute #/aset/<jenis>), urutan, dan rincian tiap aset.
import { $, ICON, assetName, colorOf, delta, esc, fIdr, fNum, fUsd, heldText, latest, longDate, MASK, money, state, symDisp, typeOf, typesIn, weightText } from '../lib.js';
import { sortPositions } from '../stats.js';

// Harga aset manual adalah angka ketikanmu sendiri (sering = saldo), jadi diperlakukan sebagai nominal.
function priceText(p, fmt) {
  if (p.type === 'manual' && state.hidden) return MASK;
  return fmt.format(p.price);
}

// Jenis dari rute dipakai hanya bila memang ada asetnya (rute ngawur = Semua).
const typeFilter = () => (state.route.view === 'aset' && (latest().positions || []).some((p) => p.type === state.route.sub) ? state.route.sub : '');

function renderChips() {
  const pos = latest().positions || [];
  const cur = typeFilter();
  const present = typesIn([...new Set(pos.map((p) => p.type))]);
  const chip = (href, label, on, dot) => `<a href="${href}"${on ? ' aria-current="page"' : ''}>${dot ? `<i class="dot" style="background:${colorOf(dot)}"></i>` : ''}${label}</a>`;
  $('chips').innerHTML = chip('#/aset', `Semua (${pos.length})`, !cur) + present.map((t) => chip(`#/aset/${t}`, `${esc(typeOf(t).label)} (${pos.filter((p) => p.type === t).length})`, cur === t, t)).join('');
}

function renderList() {
  const all = latest().positions || [];
  const cur = typeFilter();
  const q = state.q.trim().toLowerCase();
  let rows = sortPositions(all, state.sort);
  if (cur) rows = rows.filter((p) => p.type === cur);
  if (q) rows = rows.filter((p) => `${p.name || ''} ${p.symbol}`.toLowerCase().includes(q));
  $('sort').value = state.sort;
  $('filter-note').textContent = cur || q ? `${rows.length} dari ${all.length} aset` : 'Nilai dan perubahan hari ini · ketuk untuk rincian';

  const maxW = Math.max(0.0001, ...all.map((p) => p.weight || 0));
  $('holdings').innerHTML = rows.map((p) => {
    const priceFmt = p.currency === 'USD' ? fUsd : fIdr;
    const t = typeOf(p.type);
    const sym = symDisp(p);
    const name = assetName(p);
    const qty = state.hidden ? MASK : `${fNum.format(p.qty)}${t.unit ? ` ${t.unit}` : ''}`;
    const buy = p.buyDate ? `dibeli ${longDate(p.buyDate)}${heldText(p.buyDate)}` : null;
    const sub = [name !== sym ? sym : null, t.label, buy].filter(Boolean).join(' · ');
    const stale = p.stale ? `<span class="chip" title="Gagal diambil; memakai harga per ${esc(p.asOf)}">harga lama</span>` : '';
    const key = `${p.type}:${p.symbol}`;
    // Kas: hanya saldo (dalam mata uangnya); harga, modal, dan untung/rugi tidak bermakna.
    const det = p.type === 'cash'
      ? `<div><dt>Saldo</dt><dd data-label="Saldo">${state.hidden ? MASK : priceFmt.format(p.qty)}</dd></div>
        ${p.currency === 'USD' ? `<div><dt>Setara rupiah</dt><dd>${money(p.value)}<small>kurs ${esc(fIdr.format(latest().fx))}</small></dd></div>` : ''}`
      : `<div><dt>Harga</dt><dd data-label="Harga" title="Harga per ${p.asOf ? longDate(p.asOf) : ''}">${priceText(p, priceFmt)}${stale}</dd></div>
        <div><dt>Jumlah</dt><dd>${esc(qty)}</dd></div>
        <div><dt>Untung/rugi</dt><dd>${delta(p.pnlPct)}<small>${esc(money(p.pnl, { sign: true }))}</small></dd></div>
        <div><dt>Modal</dt><dd>${money(p.cost)}</dd></div>
        ${p.buyDate ? `<div><dt>Dibeli</dt><dd>${esc(longDate(p.buyDate))}<small>${esc(heldText(p.buyDate).replace(/^ \(|\)$/g, ''))}</small></dd></div>` : ''}`;
    return `<li><details class="asset-row" data-key="${esc(key)}"${state.open.has(key) ? ' open' : ''}>
      <summary>
        <i class="dot" style="background:${colorOf(p.type)}"></i>
        <span class="a-main"><strong>${esc(name)}</strong><small>${esc(sub)}</small></span>
        <span class="a-val"><b>${money(p.value)}</b>${delta(p.dayPct)}</span>
        ${ICON.chev}
        <span class="a-bar"><span class="bar"><i style="width:${Math.max(2, (p.weight / maxW) * 100).toFixed(1)}%"></i></span>${weightText(p.weight)} dari total</span>
      </summary>
      <dl class="a-det">
        ${det}
      </dl></details></li>`;
  }).join('') || '<li class="muted">Tidak ada aset yang cocok.</li>';
}

export function render() {
  renderChips();
  renderList();
}

export const show = render; // jenis yang dipilih ada di rute, jadi gambar ulang tiap halaman dibuka

$('q').addEventListener('input', (e) => {
  state.q = e.target.value;
  renderList();
});
$('sort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  renderList();
});

// 'toggle' tidak menggelembung, jadi didengarkan di fase tangkap.
$('holdings').addEventListener('toggle', (e) => {
  const d = e.target;
  if (!d.matches || !d.matches('details[data-key]')) return;
  if (d.open) state.open.add(d.dataset.key);
  else state.open.delete(d.dataset.key);
}, true);
