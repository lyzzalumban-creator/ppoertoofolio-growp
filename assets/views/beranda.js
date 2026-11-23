// Beranda: angka utama, sorotan, grafik, pergerakan hari ini, alokasi ringkas, target.
import { $, ICON, ORDER, TYPE, arrow, delta, esc, fMonthLong, latest, money, notify, pct, state, symDisp, toMs, tone, weightText } from '../lib.js';
import { dayMovers, goalProgress, insights } from '../stats.js';
import { drawChart, initChart, renderChart, renderRanges } from './chart.js';

// Mini-grafik 30 hari terakhir: hanya bentuknya (tanpa angka), jadi aman walau nominal disembunyikan.
function sparkline() {
  const pts = state.snapshots.slice(-30).filter((s) => s.total != null).map((s) => s.total);
  if (pts.length < 2) return '';
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = hi - lo || 1;
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * 100).toFixed(2)},${(29 - ((v - lo) / span) * 27).toFixed(2)}`).join('');
  const dir = pts[pts.length - 1] > pts[0] ? 'pos' : pts[pts.length - 1] < pts[0] ? 'neg' : 'flat';
  return `<svg class="spark ${dir}" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="area" d="${line}L100,32L0,32Z"/><path class="line" d="${line}"/></svg>`;
}

// Baris di kartu utama: persen selalu tampil, nominal hanya bila tidak disembunyikan.
function heroRow(cls, label, p, amt) {
  const body = p == null
    ? '<span class="flat">belum ada pembanding</span>'
    : `<span class="${tone(p)}">${arrow(p)}${pct(p)}${state.hidden ? '' : ` · ${money(amt, { sign: true })}`}</span>`;
  return `<div class="hrow ${cls}"><span class="hl">${label}</span>${body}</div>`;
}

function renderKpis() {
  const L = latest();
  const types = Object.keys(L.byType || {}).length;
  const mtd = state.snapshots.length > 1 ? state.perf.months.at(-1) : null;
  const spark = sparkline();
  $('kpis').innerHTML = `
    <div class="kpi hero"><div class="label">Total nilai</div><div class="value">${money(L.total)}</div>
      <div class="hrows">${heroRow('today', 'Hari ini', L.dayPct, L.dayPnl)}${heroRow('all', 'Sejak beli', L.pnlPct, L.pnl)}</div>
      ${spark ? `<div class="spark-wrap">${spark}<span class="spark-label">30 hari</span></div>` : ''}</div>
    <div class="kpi"><div class="label">Modal</div><div class="value">${money(L.cost)}</div><div class="note">${(L.positions || []).length} aset · ${types} jenis</div></div>
    <div class="kpi"><div class="label">Bulan ini</div><div class="value">${delta(mtd && mtd.ret)}</div><div class="note">${mtd ? `${esc(fMonthLong.format(toMs(mtd.to)))}, dari harga saja` : 'belum ada pembanding'}</div></div>`;
}

function renderInsights() {
  const list = insights(latest(), Object.fromEntries(ORDER.map((t) => [t, TYPE[t].label])), weightText);
  $('insights').hidden = !list.length;
  $('insight-list').innerHTML = list.map((i) => `<li class="insight">${ICON.warn}<div><b>Perhatian</b><p>${esc(i.text)}</p></div></li>`).join('');
}

function moverList(title, rows) {
  if (!rows.length) return '';
  return `<div class="mv-group"><h3>${title}</h3><ul class="mv">${rows.map((p) => `<li><i class="dot" style="background:var(--c-${p.type})"></i>
    <span class="n">${esc(symDisp(p))}<small>${esc(p.name && p.name !== p.symbol ? p.name : TYPE[p.type].label)}</small></span>
    <span class="v">${delta(p.dayPct)}<small class="flat">${esc(money(p.dayAmt, { sign: true }))}</small></span></li>`).join('')}</ul></div>`;
}

function renderMovers() {
  const { gainers, losers } = dayMovers(latest().positions || []);
  $('movers').innerHTML = gainers.length || losers.length
    ? moverList('Naik terbanyak', gainers) + moverList('Turun terbanyak', losers)
    : '<p class="muted">Belum ada pergerakan hari ini, atau belum ada hari pembanding.</p>';
}

// Alokasi ringkas: tiap jenis adalah tautan ke daftar Aset yang sudah terfilter.
function renderAlloc() {
  const L = latest();
  const types = ORDER.filter((t) => L.byType && L.byType[t]);
  let acc = 0;
  const stops = types.map((t, i) => {
    const from = acc;
    acc += L.byType[t].weight * 100;
    const to = i === types.length - 1 ? 100 : acc;
    return `var(--c-${t}) ${from.toFixed(3)}% ${to.toFixed(3)}%`;
  });
  const donut = $('donut');
  donut.style.background = stops.length ? `conic-gradient(${stops.join(',')})` : '';
  donut.innerHTML = `<div class="hole"><strong>${(L.positions || []).length}</strong><span>aset</span></div>`;
  $('legend').innerHTML = types.map((t) => {
    const b = L.byType[t];
    return `<li><a class="lg" href="#/aset/${t}" data-type="${t}">
      <i class="sw" style="background:var(--c-${t})"></i><span class="nm">${TYPE[t].label}</span><span class="pc">${weightText(b.weight)}</span>
      <span class="am">${money(b.value)}</span></a></li>`;
  }).join('');
}

function renderGoal() {
  const L = latest();
  const f = goalProgress(L.total, state.goal);
  if (f == null) {
    $('goal').innerHTML = '<div class="goal-empty"><p>Tetapkan target nilai portofolio untuk melihat kemajuanmu.</p><button type="button" class="btn" data-goal="open">Atur target</button></div>';
    return;
  }
  const p = Math.floor(f * 100); // 99,8% tampil 99%, bukan 100% sebelum benar-benar tercapai
  $('goal').innerHTML = `<div class="goal">
    <div class="ring" role="img" aria-label="${p} persen menuju target" style="background:conic-gradient(var(--accent) ${(f * 100).toFixed(2)}%, var(--surface-2) 0)"><div class="hole">${p}%</div></div>
    <div><p class="g-line"><b>${money(L.total)}</b> dari ${money(state.goal)}</p>
      <p class="g-sub">${f >= 1 ? 'Target tercapai' : `Sisa ${money(state.goal - L.total)}`}</p>
      <button type="button" class="btn" data-goal="open">Ubah target</button></div></div>`;
}

function setGoal(v) {
  state.goal = v > 0 ? v : null;
  try { if (state.goal) localStorage.setItem('pf-goal', String(state.goal)); else localStorage.removeItem('pf-goal'); } catch { /* abaikan */ }
  $('goal-dlg').close();
  notify(); // Beranda dan Profil sama-sama menampilkan target
}

export function render() {
  renderKpis();
  renderInsights();
  renderMovers();
  renderAlloc();
  renderGoal();
  renderRanges();
  renderChart();
}

export const show = drawChart;

// Tombol "Atur/Ubah target" ada di Beranda dan di Profil, jadi didengarkan di level dokumen.
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-goal="open"]')) return;
  $('goal-input').value = state.goal ?? '';
  $('goal-err').hidden = true;
  $('goal-del').hidden = state.goal == null;
  $('goal-dlg').showModal();
  $('goal-input').focus();
});
$('goal-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('goal-input').valueAsNumber;
  if (!(v > 0) || !Number.isFinite(v)) { $('goal-err').hidden = false; $('goal-err').textContent = 'Isi angka lebih dari 0.'; return; }
  setGoal(v);
});
$('goal-del').addEventListener('click', () => setGoal(null));
$('goal-cancel').addEventListener('click', () => $('goal-dlg').close());

initChart();
