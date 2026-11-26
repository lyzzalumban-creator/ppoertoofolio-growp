// Beranda: kartu nilai, grafik portofolio, Rincian (+ target), peta aset, dan kapsul trading emas.
// Ketuk petak aset untuk halaman detailnya.
import { $, ICON, MASK, ORDER, TYPE, arrow, assetHref, delta, esc, fIdr, fUsd, latest, longDate, money, monthName, notify, pct, state, symDisp, todayWib, toMs, tone, weightText } from '../lib.js';
import { dateAfterYears, goalProgress, heatItems, insights, treemap, yearsToGoal, yearReturn } from '../stats.js';
import { fxStats, realized } from '../../scripts/lib/trade.mjs';
import { inRange, lineChart, rangesHtml, watch } from './chart.js';
import { openAssetForm } from './sheets.js';

const keyOf = (p) => `${p.type}:${p.symbol}`;

// ---------- ringkasan ----------

/** Angka Total nilai: --n (jumlah karakter) dipakai CSS agar angkanya memenuhi lebar kartu, sepanjang apa pun. */
const numHtml = (t) => `<b class="sum-value" style="--n:${t.length}">${esc(t)}</b>`;

function renderSummary() {
  const L = latest();
  const box = $('summary');
  const stats = $('sumstats');
  $('chart-rows').innerHTML = ''; // diisi lagi di bawah bila sudah ada data
  const solo = !L; // belum ada data: kartu ringkasan tampil sendiri tanpa kartu doa dan rincian
  $('sum-row').classList.toggle('solo', solo);
  $('motto').hidden = solo;
  stats.hidden = solo;
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
  const n = (L.positions || []).length + state.pending.length;
  box.innerHTML = `
    <div class="sum-top"><span class="label">Total nilai</span></div>
    <div id="sum-num">${numHtml(money(L.total))}</div>`;
  $('chart-rows').innerHTML = `<dl class="sum-rows">
      <div><dt>Total profit</dt><dd class="${tone(L.pnl)}">${state.hidden ? '' : `${esc(money(L.pnl, { sign: true }))} `}${arrow(L.pnl)}${pct(L.pnlPct)}</dd></div>
      <div class="today"><dt>Harian</dt>${L.dayPct == null
        ? '<dd class="flat">belum ada pembanding</dd>'
        : `<dd class="${tone(L.dayPnl)}">${state.hidden ? '' : `${esc(money(L.dayPnl, { sign: true }))} `}${arrow(L.dayPct)}${pct(L.dayPct)}</dd>`}</div>
    </dl>`;
  stats.innerHTML = `
    <div class="sum-top"><span class="label">Rincian</span><span class="muted">${n} aset</span></div>
    <dl class="stats rows">
      <div><dt>Modal</dt><dd>${money(L.cost)}</dd></div>
      <div><dt>Terealisasi</dt><dd class="${tone(real)}">${state.txs.some((t) => t.kind === 'sell') ? money(real, { sign: true }) : '–'}</dd></div>
      <div><dt>Bulan ini</dt><dd>${delta(mtd && mtd.ret)}</dd></div>
    </dl>
    ${state.pending.length ? `<p class="muted pend">${state.pending.length} aset menunggu harga pertama dan belum masuk total.</p>` : ''}
    <div id="goal">${goalHtml(L)}</div>`;
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
  lineChart($('chart'), pts, {
    // angka total di kartu atas ikut titik yang disentuh (nominal tersembunyi: tetap disamarkan)
    head: pts.length > 1 && $('chart').clientWidth ? $('sum-num') : null,
    headHtml: (p) => numHtml(amt ? fIdr.format(p.y) : MASK),
    fmtTip: (p) => `<b>${esc(amt ? fIdr.format(p.y) : pct(p.y / 100))}</b>${p.c != null ? `<span>Modal ${esc(fIdr.format(p.c))}</span>` : ''}`,
    label: (a, b) => `${amt ? 'Nilai portofolio' : 'Untung rugi dari modal'} dari ${amt ? fIdr.format(a.y) : pct(a.y / 100)} pada ${longDate(a.date)} menjadi ${amt ? fIdr.format(b.y) : pct(b.y / 100)} pada ${longDate(b.date)}`,
    empty: state.series.length < 2 ? 'Grafik muncul setelah ada data minimal 2 hari. Isi <em>Tanggal beli</em> saat menambah aset, lalu robot mengisi riwayat sejak tanggal itu.' : '',
  });
  chartDrawn();
}
const chartDrawn = watch($('chart'), () => { if (state.series.length) drawChart(); });

// ---------- trading emas: kapsul ringkasan (detail di Aktivitas) ----------

function renderFx() {
  const L = latest();
  $('fx-sec').hidden = !L;
  if (!L) return;
  const st = fxStats(state.txs);
  const m = st.months.find((x) => x.month === todayWib().slice(0, 7));
  const usd = (v) => (state.hidden ? MASK : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fUsd.format(Math.abs(v))}`);
  const item = (label, value, cls = '') => `<div class="cap-i ${cls}"><span>${label}</span><b>${value}</b></div>`;
  const win = st.trades ? Math.round(st.winRate * 100) : 0;
  $('fx-caps').innerHTML = `<li class="cap">${st.trades
    ? `<div class="cap-top">${item('Total profit', `${arrow(st.total)}${esc(usd(st.total))}`, `${tone(st.total)} big`)}${item('Bulan ini', m ? `${arrow(m.pnl)}${esc(usd(m.pnl))}` : '–', `${m ? tone(m.pnl) : ''} end`)}</div>
      <div class="cap-bar" role="img" aria-label="Win rate ${win} persen"><i style="width:${win}%"></i></div>
      <div class="cap-wl"><span>Win rate <b>${win}%</b></span><span>${st.wins} menang · ${st.losses} kalah · ${st.trades} trade</span></div>`
    : item('Trading emas', 'Belum ada trade')}</li>`;
}

// ---------- peta aset: ukuran petak = bobot, warna = perubahan hari ini atau untung total (hanya persen, tanpa nominal) ----------

const RADII = ['24px', '24px 24px 24px 12px', '12px 24px 24px 24px', '24px 12px 24px 12px']; // sudut bergantian, tetap serumpun
const HEAT_FULL = { day: 0.025, pnl: 0.3 }; // persen yang sudah dianggap warna pekat penuh
function renderHeat() {
  const all = ((latest() && latest().positions) || []);
  const items = heatItems(all, state.heat);
  $('heat-card').hidden = all.filter((p) => p.value > 0).length < 2;
  if ($('heat-card').hidden) return;
  for (const b of $('heat-mode').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.heat === state.heat));
  const H = 92; // kotak 100 × 92 satuan; ditampilkan dengan aspect-ratio yang sama
  $('heat').innerHTML = treemap(items, 100, H).map(({ item: { p, d }, x, y, w, h }, i) => {
    const heat = d == null ? 0 : Math.min(1, Math.abs(d) / HEAT_FULL[state.heat]).toFixed(2);
    const name = state.hidden ? MASK : symDisp(p); // nominal tersembunyi: nama aset ikut disamarkan
    const geo = `left:${x.toFixed(2)}%;top:${((y / H) * 100).toFixed(2)}%;width:${w.toFixed(2)}%;height:${((h / H) * 100).toFixed(2)}%;--h:${heat};--r:${RADII[i % RADII.length]}`;
    const label = `${name}, bobot ${weightText(p.weight)}${d == null ? '' : `, ${state.heat === 'pnl' ? 'untung' : 'hari ini'} ${pct(d)}`}`;
    return `<a class="hm-tile ${d == null || d === 0 ? 'flat' : tone(d)}" href="${assetHref(p)}" style="${geo}" aria-label="${esc(label)}"><b class="hm-sym">${esc(name)}</b><span class="hm-pct">${weightText(p.weight)}</span>${d == null ? '' : `<span class="hm-d">${arrow(d)}${pct(d)}</span>`}</a>`;
  }).join('');
}

// ---------- target (di kartu Rincian) ----------

// Perkiraan tercapai (di kartu Rincian): bunga majemuk dari nilai sekarang, tanpa setoran baru; asumsi pengguna dan return 12 bulan terakhir.
const durText = (y) => (y > 100 ? '>100 thn' : y < 1 ? `${Math.max(1, Math.ceil(y * 12))} bln` : `${y.toLocaleString('id-ID', { maximumFractionDigits: 1 })} thn`);
function projLine(label, rate, L) {
  const y = yearsToGoal(L.total, state.goal, rate);
  return `<li><span>${esc(label)}</span>${y == null
    ? '<b class="neg">tidak tercapai</b>'
    : `<b>${esc(monthName(dateAfterYears(L.date, y).slice(0, 7)))}</b><small>${esc(durText(y))}</small>`}</li>`;
}
function projHtml(L) {
  const yr = state.perf ? yearReturn(state.perf.index) : null;
  const lines = [];
  if (state.goalRate) lines.push(projLine(`Return ${state.goalRate.toLocaleString('id-ID')}%/thn`, state.goalRate / 100, L));
  if (yr) lines.push(projLine(yr.est ? `Disetahunkan ${pct(yr.ret)}` : `12 bln ${pct(yr.ret)}`, yr.ret, L));
  return lines.length ? `<ul class="g-proj" aria-label="Perkiraan target tercapai">${lines.join('')}</ul>` : '';
}

/** Bagian target di kartu Rincian: belum diatur = ajakan; sudah = bar kemajuan, sisa, dan perkiraan tercapai. */
function goalHtml(L) {
  const f = goalProgress(L.total, state.goal);
  if (f == null) return '<div class="goal-empty"><span class="muted">Target belum diatur</span><button type="button" class="btn" data-goal="open">Atur target</button></div>';
  const p = Math.floor(f * 100); // 99,8% tampil 99%, bukan 100% sebelum benar-benar tercapai
  return `<div class="goal-line" role="img" aria-label="${p} persen menuju target"><span class="bar" aria-hidden="true"><i style="width:${(f * 100).toFixed(1)}%"></i></span><span class="muted">${p}% dari target</span><button type="button" class="btn sm" data-goal="open">Ubah</button></div>
    ${f >= 1 ? '<p class="g-sub"><span class="pill pos">✓ Target tercapai</span></p>' : `<p class="g-sub">Sisa ${money(state.goal - L.total)} dari ${money(state.goal)}</p>${projHtml(L)}`}`;
}

function setGoal(v, rate) {
  state.goal = v > 0 ? v : null;
  state.goalRate = rate > 0 ? rate : null;
  try { if (state.goalRate) localStorage.setItem('pf-goal-rate', String(state.goalRate)); else localStorage.removeItem('pf-goal-rate'); } catch { /* abaikan */ }
  try { if (state.goal) localStorage.setItem('pf-goal', String(state.goal)); else localStorage.removeItem('pf-goal'); } catch { /* abaikan */ }
  $('goal-dlg').close();
  notify();
}

export function render() {
  renderSummary();
  renderInsights();
  renderHeat();
  renderFx();
  $('ranges').innerHTML = rangesHtml(state.range);
  $('chart-card').hidden = !state.series.length;
  if (state.series.length) drawChart();
}

export function show() {
  if (state.series.length) drawChart();
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


document.addEventListener('click', (e) => {
  if (e.target.closest('[data-add]')) openAssetForm(null);
});

// Tombol "Atur/Ubah target" ada di Beranda dan di Profil, jadi didengarkan di level dokumen.
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-goal="open"]')) return;
  $('goal-input').value = state.goal ?? '';
  $('goal-rate').value = state.goalRate ?? '';
  $('goal-err').hidden = true;
  $('goal-del').hidden = state.goal == null;
  $('goal-dlg').showModal();
  $('goal-input').focus();
});
$('goal-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('goal-input').valueAsNumber;
  if (!(v > 0) || !Number.isFinite(v)) { $('goal-err').hidden = false; $('goal-err').textContent = 'Isi angka lebih dari 0.'; return; }
  const r = $('goal-rate').value === '' ? null : $('goal-rate').valueAsNumber;
  if (r != null && !(r > 0 && r <= 500)) { $('goal-err').hidden = false; $('goal-err').textContent = 'Return per tahun: isi angka 0–500, atau kosongkan.'; return; }
  setGoal(v, r);
});
$('goal-del').addEventListener('click', () => setGoal(null, null));
$('goal-form').addEventListener('input', () => { $('goal-err').hidden = true; });
$('goal-cancel').addEventListener('click', () => $('goal-dlg').close());
