// Beranda: ringkasan, sorotan, grafik portofolio, dan daftar aset (kartu dengan grafik harga masing-masing),
// ditambah alokasi ringkas dan target di samping. Ketuk aset untuk halaman detailnya.
import { $, ICON, MASK, ORDER, reveal, replay, ticker, TYPE, arrow, assetHref, assetName, colorOf, delta, esc, fIdr, latest, longDate, money, notify, pct, state, symDisp, toMs, tone, typeOf, typesIn, weightText } from '../lib.js';
import { goalProgress, heatItems, insights, sortPositions, treemap } from '../stats.js';
import { realized } from '../../scripts/lib/trade.mjs';
import { inRange, lineChart, rangesHtml, sparkline, watch } from './chart.js';
import { openAssetForm } from './sheets.js';

const keyOf = (p) => `${p.type}:${p.symbol}`;

// ---------- ringkasan ----------

function renderSummary() {
  const L = latest();
  const box = $('summary');
  if (!state.assets.length && !L) {
    box.innerHTML = `<div class="onboard"><h2>Mulai dari kas</h2>
      <p class="muted">Tambah kas dulu, lalu beli aset darinya.</p>
      <button type="button" class="btn primary" data-add>Tambah kas</button></div>`;
    return;
  }
  if (!L) {
    box.innerHTML = `<div class="sum-top"><span class="label">Total nilai</span></div><div class="sum-value">–</div>
      <p class="muted">Menunggu harga pertama dari robot.</p>`;
    return;
  }
  const mtd = state.series.length > 1 && state.perf ? state.perf.months.at(-1) : null;
  const real = realized(state.txs);
  const f = goalProgress(L.total, state.goal);
  const n = (L.positions || []).length + state.pending.length;
  box.innerHTML = `
    <div class="sum-top"><span class="label">Total nilai</span><span class="muted">${n} aset</span></div>
    <div class="sum-value">${money(L.total)}</div>
    <div class="sum-day today">${L.dayPct == null
      ? '<span class="flat">Hari ini: belum ada pembanding</span>'
      : `<span class="pill ${tone(L.dayPct)}">${arrow(L.dayPct)}${pct(L.dayPct)}</span><span class="${tone(L.dayPnl)}">${state.hidden ? '' : `${money(L.dayPnl, { sign: true })} `}</span><span class="muted">hari ini</span>`}</div>
    <dl class="stats">
      <div><dt>Modal</dt><dd>${money(L.cost)}</dd></div>
      <div><dt>Untung</dt><dd>${delta(L.pnlPct)}<small>${money(L.pnl, { sign: true })}</small></dd></div>
      <div><dt>Terealisasi</dt><dd class="${tone(real)}">${state.txs.some((t) => t.kind === 'sell') ? money(real, { sign: true }) : '–'}</dd></div>
      <div><dt>Bulan ini</dt><dd>${delta(mtd && mtd.ret)}</dd></div>
    </dl>
    ${state.pending.length ? `<p class="muted pend">${state.pending.length} aset menunggu harga pertama dan belum masuk total.</p>` : ''}
    ${f == null ? '' : `<div class="goal-line"><span class="bar" aria-hidden="true"><i style="width:${(f * 100).toFixed(1)}%"></i></span><span class="muted">${Math.floor(f * 100)}% dari target</span></div>`}`;
}

function renderInsights() {
  const L = latest();
  const list = L ? insights(L, Object.fromEntries(ORDER.map((t) => [t, TYPE[t].label])), weightText) : [];
  $('insights').hidden = !list.length;
  $('insight-list').innerHTML = list.map((i) => `<li class="insight">${ICON.warn}<div><b>Perhatian</b><p>${esc(i.text)}</p></div></li>`).join('');
}

// ---------- grafik portofolio ----------

function drawChart() {
  const amt = !state.hidden;
  const pts = inRange(state.series, state.range)
    .filter((s) => (amt ? Number.isFinite(s.total) : Number.isFinite(s.pnlPct)))
    .map((s) => ({ t: toMs(s.date), date: s.date, y: amt ? s.total : s.pnlPct * 100, c: amt && Number.isFinite(s.cost) ? s.cost : null }));
  $('chart-h').textContent = amt ? 'Nilai portofolio' : 'Untung/rugi dari modal (%)';
  $('chart-key').innerHTML = amt && pts.length > 1 ? '<span>Nilai</span><span class="k-cost">Modal</span>' : '';
  const first = pts[0];
  lineChart($('chart'), pts, {
    head: $('chart-head'),
    headHtml: (p, rest) => {
      const d = p.y - first.y;
      const shown = amt ? `${esc(money(d, { sign: true }))}${first.y ? ` (${esc(pct(p.y / first.y - 1))})` : ''}` : esc(pct(d / 100));
      return `<b>${esc(amt ? fIdr.format(p.y) : pct(p.y / 100))}</b><span class="pill ${tone(d)}">${arrow(d)}${shown}</span><small class="muted">${rest ? `sejak ${esc(longDate(first.date))}` : esc(longDate(p.date))}</small>`;
    },
    fmtTip: (p) => `<b>${esc(amt ? fIdr.format(p.y) : pct(p.y / 100))}</b>${p.c != null ? `<span>Modal ${esc(fIdr.format(p.c))}</span>` : ''}`,
    label: (a, b) => `${amt ? 'Nilai portofolio' : 'Untung rugi dari modal'} dari ${amt ? fIdr.format(a.y) : pct(a.y / 100)} pada ${longDate(a.date)} menjadi ${amt ? fIdr.format(b.y) : pct(b.y / 100)} pada ${longDate(b.date)}`,
    empty: state.series.length < 2 ? 'Grafik muncul setelah ada data minimal 2 hari. Isi <em>Tanggal beli</em> saat menambah aset, lalu robot mengisi riwayat sejak tanggal itu.' : '',
  });
  chartDrawn();
}
const chartDrawn = watch($('chart'), () => { if (state.series.length) drawChart(); });

// ---------- daftar aset ----------

// Riwayat harga satu aset (rupiah) dari snapshot; untuk mini-grafik dan grafik di halaman aset.
export const priceSeries = (key, n) => state.series.slice(-n).map((s) => (s.px ? s.px[key] : undefined)).filter(Number.isFinite);

function holdingRow(p, maxW) {
  const name = assetName(p);
  const sym = symDisp(p);
  const spark = p.type === 'cash' ? '' : sparkline(priceSeries(keyOf(p), 30));
  return `<li><a class="hold" href="${assetHref(p)}">
    <i class="h-dot" style="background:${colorOf(p.type)}"></i>
    <span class="h-id"><b>${esc(sym)}</b><small>${esc(name !== sym ? name : typeOf(p.type).label)}</small></span>
    <span class="h-spark">${spark}</span>
    <span class="h-val"><b>${money(p.value)}</b>${p.type === 'cash' && !Number.isFinite(p.dayPct) ? `<span class="muted">${weightText(p.weight)}</span>` : delta(p.dayPct)}</span>
    <span class="h-bar" aria-hidden="true"><i style="width:${Math.max(2, (p.weight / maxW) * 100).toFixed(1)}%;background:${colorOf(p.type)}"></i></span>
  </a></li>`;
}

function pendingRow(a) {
  return `<li><a class="hold wait" href="${assetHref(a)}">
    <i class="h-dot" style="background:${colorOf(a.type)}"></i>
    <span class="h-id"><b>${esc(symDisp(a))}</b><small>${esc(a.name && a.name !== a.symbol ? a.name : typeOf(a.type).label)}</small></span>
    <span class="h-spark"></span>
    <span class="h-val"><b>–</b><span class="chip-wait">Menunggu harga</span></span>
  </a></li>`;
}

function renderHoldings() {
  const L = latest();
  const all = (L && L.positions) || [];
  const types = typesIn([...new Set([...all.map((p) => p.type), ...state.pending.map((a) => a.type)])]);
  if (state.filter && !types.includes(state.filter)) state.filter = '';
  const chip = (t, label, on) => `<button type="button" data-filter="${esc(t)}" aria-pressed="${on}">${t ? `<i class="dot" style="background:${colorOf(t)}"></i>` : ''}${esc(label)}</button>`;
  $('chips').innerHTML = types.length > 1 ? chip('', 'Semua', !state.filter) + types.map((t) => chip(t, typeOf(t).label, state.filter === t)).join('') : '';

  const q = state.q.trim().toLowerCase();
  const match = (a) => (!state.filter || a.type === state.filter) && (!q || `${a.name || ''} ${a.symbol}`.toLowerCase().includes(q));
  const rows = sortPositions(all, state.sort).filter(match);
  const wait = state.pending.filter(match);
  const total = all.length + state.pending.length;
  $('hold-count').textContent = total ? `${total} aset` : '';
  $('sort').value = state.sort;
  $('filter-note').textContent = state.filter || q ? `${rows.length + wait.length} dari ${total} aset` : '';
  const maxW = Math.max(0.0001, ...all.map((p) => p.weight || 0));
  $('holdings').innerHTML = rows.map((p) => holdingRow(p, maxW)).join('') + wait.map(pendingRow).join('')
    || `<li class="empty-row">${total ? 'Tidak ada aset yang cocok.' : 'Belum ada aset.'}</li>`;
  $('hold-tools').hidden = total < 2;
}

// ---------- peta aset: ukuran petak = bobot, warna = perubahan hari ini atau untung total (hanya persen, tanpa nominal) ----------

const RADII = ['28px', '28px 28px 28px 6px', '6px 28px 28px 28px', '44px 10px 28px 10px', '28px 6px 28px 6px']; // bentuk sudut bergantian
const HEAT_FULL = { day: 0.025, pnl: 0.3 }; // persen yang sudah dianggap warna pekat penuh
function renderHeat() {
  const all = ((latest() && latest().positions) || []);
  const items = heatItems(all, state.heat);
  $('heat-card').hidden = all.filter((p) => p.value > 0).length < 2;
  if ($('heat-card').hidden) return;
  for (const b of $('heat-mode').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.heat === state.heat));
  const H = 92; // kotak 100 × 92 satuan; ditampilkan dengan aspect-ratio yang sama
  $('heat').innerHTML = treemap(items, 100, H).map(({ item, x, y, w, h }, i) => {
    const d = item.d;
    const heat = d == null ? 0 : Math.min(1, Math.abs(d) / HEAT_FULL[state.heat]).toFixed(2);
    const wt = item.p ? item.p.weight : item.group.reduce((s, p) => s + (p.weight || 0), 0);
    const name = state.hidden ? MASK : item.p ? symDisp(item.p) : `Lainnya (${item.group.length})`; // nominal tersembunyi: nama aset ikut disamarkan
    const geo = `left:${x.toFixed(2)}%;top:${((y / H) * 100).toFixed(2)}%;width:${w.toFixed(2)}%;height:${((h / H) * 100).toFixed(2)}%;--h:${heat};--r:${RADII[i % RADII.length]}`;
    const label = `${name}, bobot ${weightText(wt)}${d == null ? '' : `, ${state.heat === 'pnl' ? 'untung' : 'hari ini'} ${pct(d)}`}${item.group && !state.hidden ? `: ${item.group.map(symDisp).join(', ')}` : ''}`;
    const inner = `<b class="hm-sym">${esc(state.hidden ? MASK : item.p ? name : `${item.group.length} lain`)}</b><span class="hm-pct">${weightText(wt)}</span>${d == null ? '' : `<span class="hm-d">${arrow(d)}${pct(d)}</span>`}`;
    const cls = `hm-tile ${d == null || d === 0 ? 'flat' : tone(d)}`;
    return item.p
      ? `<a class="${cls}" href="${assetHref(item.p)}" style="${geo}" aria-label="${esc(label)}">${inner}</a>`
      : `<div class="${cls}" style="${geo}" role="img" aria-label="${esc(label)}">${inner}</div>`;
  }).join('');
}

// ---------- samping: alokasi ringkas dan target ----------

function renderAlloc() {
  const L = latest();
  const types = L ? typesIn(Object.keys(L.byType || {})) : [];
  $('alloc-card').hidden = !types.length;
  let acc = 0;
  const stops = types.map((t, i) => {
    const from = acc;
    acc += L.byType[t].weight * 100;
    return `${colorOf(t)} ${from.toFixed(3)}% ${(i === types.length - 1 ? 100 : acc).toFixed(3)}%`;
  });
  $('donut').style.background = stops.length ? `conic-gradient(${stops.join(',')})` : '';
  $('donut').innerHTML = `<div class="hole"><strong>${L ? (L.positions || []).length : 0}</strong><span>aset</span></div>`;
  $('legend').innerHTML = types.map((t) => `<li><button type="button" class="lg" data-filter="${esc(t)}" aria-pressed="${state.filter === t}">
      <i class="sw" style="background:${colorOf(t)}"></i><span class="nm">${esc(typeOf(t).label)}</span><span class="pc">${weightText(L.byType[t].weight)}</span>
      <span class="am">${money(L.byType[t].value)}</span></button></li>`).join('');
}

function renderGoal() {
  const L = latest();
  const f = L ? goalProgress(L.total, state.goal) : null;
  if (f == null) {
    $('goal').innerHTML = '<div class="goal-empty"><p>Tetapkan target nilai portofolio untuk melihat kemajuanmu.</p><button type="button" class="btn" data-goal="open">Atur target</button></div>';
    return;
  }
  const p = Math.floor(f * 100); // 99,8% tampil 99%, bukan 100% sebelum benar-benar tercapai
  $('goal').innerHTML = `<div class="goal">
    <div class="ring" role="img" aria-label="${p} persen menuju target" style="--p:${(f * 100).toFixed(2)}%"><div class="hole">${p}%</div></div>
    <div><p class="g-line"><b>${money(L.total)}</b> dari ${money(state.goal)}</p>
      <p class="g-sub">${f >= 1 ? 'Target tercapai' : `Sisa ${money(state.goal - L.total)}`}</p>
      <button type="button" class="btn" data-goal="open">Ubah target</button></div></div>`;
}

function setGoal(v) {
  state.goal = v > 0 ? v : null;
  try { if (state.goal) localStorage.setItem('pf-goal', String(state.goal)); else localStorage.removeItem('pf-goal'); } catch { /* abaikan */ }
  $('goal-dlg').close();
  notify();
}

export function render() {
  renderSummary();
  ticker($('summary').querySelector('.sum-value'));
  renderInsights();
  renderHeat();
  renderHoldings();
  renderAlloc();
  renderGoal();
  $('ranges').innerHTML = rangesHtml(state.range);
  $('chart-card').hidden = !state.series.length;
  if (state.series.length) drawChart();
}

export function show() {
  if (state.series.length) drawChart();
  reveal($('holdings'));
  replay($('donut'));
  replay($('goal').querySelector('.ring'));
}

// ---------- interaksi ----------

$('heat-mode').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-heat]');
  if (!b || b.dataset.heat === state.heat) return;
  state.heat = b.dataset.heat;
  renderHeat();
});
$('ranges').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-range]');
  if (!b) return;
  state.range = b.dataset.range;
  $('ranges').innerHTML = rangesHtml(state.range);
  drawChart();
});

// Saring jenis: chip di atas daftar dan baris alokasi; ketuk lagi untuk melepas.
document.addEventListener('click', (e) => {
  const b = e.target.closest('#chips [data-filter], #legend [data-filter], #types [data-filter]');
  if (!b) return;
  const t = b.dataset.filter;
  const fromTypes = !!b.closest('#types'); // dari Analisis: selalu pasang (tautannya juga pindah ke Beranda)
  state.filter = fromTypes ? t : state.filter === t || !t ? '' : t;
  renderHoldings();
  renderAlloc();
  if (b.closest('#legend')) $('holdings-sec').scrollIntoView({ block: 'start' });
});

$('q').addEventListener('input', (e) => { state.q = e.target.value; renderHoldings(); });
$('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderHoldings(); });

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-add]')) openAssetForm(null);
});

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
$('goal-input').addEventListener('input', () => { $('goal-err').hidden = true; });
$('goal-cancel').addEventListener('click', () => $('goal-dlg').close());
