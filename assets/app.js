// Dasbor portofolio. Tanpa framework dan tanpa library eksternal.
// Data diambil dari Google Sheet lewat Apps Script (butuh URL + kata sandi); halaman ini sendiri tidak berisi data.

import { call } from '../scripts/lib/api.mjs';
import { clearCreds, readCreds, saveCreds, scriptUrlOk } from './creds.js';

const TYPE = {
  idx: { label: 'Saham IDX', unit: 'lembar' },
  us: { label: 'Saham AS', unit: 'saham' },
  crypto: { label: 'Kripto', unit: '' },
  gold: { label: 'Emas', unit: 'gram' },
  manual: { label: 'Lainnya', unit: 'unit' },
};
const ORDER = Object.keys(TYPE);
const RANGES = [['1 bln', 31], ['3 bln', 92], ['1 thn', 366], ['Semua', Infinity]];
const MASK = '••••••';
const DAY = 86_400_000;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fIdr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const fUsd = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'USD' });
const fNum = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 8 });
const fCompact = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });
const fDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fDay = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fMonth = new Intl.DateTimeFormat('id-ID', { month: 'short', year: '2-digit', timeZone: 'UTC' });

const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const longDate = (iso) => fDate.format(toMs(iso));

const state = { snapshots: [], hidden: false, range: 'Semua', filter: null };

try { state.hidden = localStorage.getItem('pf-hidden') === '1'; } catch { /* penyimpanan diblokir: abaikan */ }

const latest = () => state.snapshots[state.snapshots.length - 1];

// ---------- pemformat ----------

function money(v, { sign = false } = {}) {
  if (v == null) return '–';
  if (state.hidden) return MASK;
  const s = fIdr.format(Math.abs(v));
  if (v < 0) return `−${s}`;
  return sign && v > 0 ? `+${s}` : s;
}

function pct(v, digits = 2) {
  if (v == null) return '–';
  const n = Math.abs(v * 100).toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${n}%`;
}

const tone = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'flat');
const arrow = (v) => (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '');
// Arah ditulis dengan panah dan tanda +/−, bukan hanya warna.
const delta = (v, digits) => (v == null ? '<span class="flat">–</span>' : `<span class="${tone(v)}">${arrow(v)}${pct(v, digits)}</span>`);
const weightText = (w) => `${(w * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;

// ---------- render ----------

function renderHeader() {
  $('subtitle').textContent = `Harga penutupan · data per ${longDate(latest().date)}`;
  const btn = $('privacy');
  btn.setAttribute('aria-pressed', String(state.hidden));
  btn.textContent = state.hidden ? 'Tampilkan nominal' : 'Sembunyikan nominal';
}

function renderKpis() {
  const L = latest();
  const types = Object.keys(L.byType || {}).length;
  const cards = [
    { label: 'Total nilai', value: money(L.total), note: `Modal ${money(L.cost)}` },
    { label: 'Untung/rugi total', value: delta(L.pnlPct), note: money(L.pnl, { sign: true }) },
    { label: 'Hari ini', value: delta(L.dayPct), note: L.dayPct == null ? 'Butuh data hari sebelumnya' : money(L.dayPnl, { sign: true }) },
    { label: 'Jumlah aset', value: String((L.positions || []).length), note: `${types} jenis aset` },
  ];
  $('kpis').innerHTML = cards.map((c) => `<div class="kpi"><div class="label">${esc(c.label)}</div><div class="value">${c.value}</div><div class="note">${esc(c.note)}</div></div>`).join('');
}

// -- grafik --

function niceTicks(min, max, n = 4) {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let i = 0; i < 50; i++) {
    const v = Number((start + i * step).toPrecision(12));
    ticks.push(v);
    if (v >= max) break;
  }
  return ticks;
}

function inRange(snaps) {
  const days = (RANGES.find((r) => r[0] === state.range) || [])[1] ?? Infinity;
  if (!Number.isFinite(days)) return snaps;
  const end = toMs(snaps[snaps.length - 1].date);
  return snaps.filter((s) => end - toMs(s.date) <= days * DAY);
}

// Saat nominal disembunyikan, grafik beralih dari nilai rupiah ke untung/rugi dalam persen.
function series() {
  const amt = !state.hidden;
  const pts = inRange(state.snapshots)
    .filter((s) => (amt ? s.total != null : s.pnlPct != null))
    .map((s) => ({ t: toMs(s.date), date: s.date, y: amt ? s.total : s.pnlPct * 100 }));
  return { pts, amt };
}

function renderRanges() {
  $('ranges').innerHTML = RANGES.map(([l]) => `<button type="button" data-range="${l}" aria-pressed="${l === state.range}">${l}</button>`).join('');
}

function renderChart() {
  const { pts, amt } = series();
  $('chart-h').textContent = amt ? 'Nilai portofolio' : 'Untung/rugi dari modal (%)';
  const box = $('chart');
  box.innerHTML = '';

  if (pts.length < 2) {
    box.innerHTML = `<div class="empty">${pts.length ? 'Grafik muncul setelah ada data minimal 2 hari.' : 'Belum ada data untuk rentang ini.'}</div>`;
    return;
  }

  const W = Math.max(280, Math.floor(box.clientWidth));
  // Di layar lebar grafik berdampingan dengan kartu Alokasi yang tinggi; samakan agar tidak ada ruang kosong.
  const sideBySide = window.matchMedia('(min-width: 900px)').matches;
  const H = sideBySide ? 430 : W < 520 ? 220 : 280;
  const ml = amt ? 62 : 50, mr = 12, mt = 12, mb = 26;
  const iw = W - ml - mr, ih = H - mt - mb;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;

  let lo = Math.min(...pts.map((p) => p.y));
  let hi = Math.max(...pts.map((p) => p.y));
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  const ticks = niceTicks(lo - pad, hi + pad);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];

  const X = (t) => ml + ((t - t0) / (t1 - t0)) * iw;
  const Y = (v) => mt + (1 - (v - y0) / (y1 - y0)) * ih;
  const fmtY = (v) => (amt ? fCompact.format(v) : `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);
  const fmtTip = (v) => (amt ? fIdr.format(v) : pct(v / 100));

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = `${line}L${X(t1).toFixed(1)},${(mt + ih).toFixed(1)}L${X(t0).toFixed(1)},${(mt + ih).toFixed(1)}Z`;

  const longSpan = t1 - t0 > 330 * DAY;
  const xLabels = [0, 1, 2, 3].map((k) => {
    const t = t0 + ((t1 - t0) * k) / 3;
    const txt = longSpan ? fMonth.format(t) : fDay.format(t);
    const anchor = k === 0 ? 'start' : k === 3 ? 'end' : 'middle';
    return `<text x="${X(t).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${txt}</text>`;
  }).join('');

  const grid = ticks.map((v) => `<line class="grid-line" x1="${ml}" x2="${W - mr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${ml - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${fmtY(v)}</text>`).join('');
  const zero = y0 < 0 && y1 > 0 ? `<line class="zero-line" x1="${ml}" x2="${W - mr}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>` : '';
  const last = pts[pts.length - 1];
  const label = `${amt ? 'Nilai portofolio' : 'Untung rugi dari modal'} dari ${fmtTip(pts[0].y)} pada ${longDate(pts[0].date)} menjadi ${fmtTip(last.y)} pada ${longDate(last.date)}`;

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(label)}">
      <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.25"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs>
      <g class="axis">${grid}${xLabels}</g>
      ${zero}
      <path d="${area}" fill="url(#fill)"/>
      <path class="line" d="${line}"/>
      <circle class="dot" cx="${X(last.t).toFixed(1)}" cy="${Y(last.y).toFixed(1)}" r="4"/>
      <g class="cursor" hidden><line y1="${mt}" y2="${mt + ih}"/><circle class="dot" r="5"/></g>
      <rect class="hit" x="${ml}" y="0" width="${iw}" height="${H}" fill="transparent"/>
    </svg>
    <div class="tip" hidden></div>`;

  const svg = box.querySelector('svg'), cur = svg.querySelector('.cursor'), tip = box.querySelector('.tip');
  const show = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let best = pts[0];
    for (const p of pts) if (Math.abs(X(p.t) - px) < Math.abs(X(best.t) - px)) best = p;
    const cx = X(best.t), cy = Y(best.y);
    cur.hidden = false;
    cur.querySelector('line').setAttribute('x1', cx); cur.querySelector('line').setAttribute('x2', cx);
    cur.querySelector('circle').setAttribute('cx', cx); cur.querySelector('circle').setAttribute('cy', cy);
    tip.hidden = false;
    tip.innerHTML = `<b>${esc(fmtTip(best.y))}</b>${longDate(best.date)}`;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(4, (cx / W) * r.width - w / 2), r.width - w - 4)}px`;
  };
  const hide = () => { cur.hidden = true; tip.hidden = true; };
  const hit = svg.querySelector('.hit');
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}

// -- alokasi --

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
    return `<li><button type="button" class="lg" data-type="${t}" aria-pressed="${state.filter === t}">
      <i class="sw" style="background:var(--c-${t})"></i><span class="nm">${TYPE[t].label}</span><span class="pc">${weightText(b.weight)}</span>
      <span class="am">${money(b.value)}</span></button></li>`;
  }).join('');
}

// -- tabel --

// Harga aset manual adalah angka ketikanmu sendiri (sering = saldo), jadi diperlakukan sebagai nominal.
function priceText(p, fmt) {
  if (p.type === 'manual' && state.hidden) return MASK;
  return fmt.format(p.price);
}

function renderTable() {
  const L = latest();
  let rows = L.positions || [];
  if (state.filter) rows = rows.filter((p) => p.type === state.filter);
  $('filter-note').textContent = state.filter ? `Hanya ${TYPE[state.filter].label} · klik lagi untuk semua` : '';

  const maxW = Math.max(0.0001, ...(L.positions || []).map((p) => p.weight || 0));
  const head = '<thead><tr><th>Aset</th><th>Harga</th><th>Nilai</th><th>Bobot</th><th>Untung/rugi</th><th>Hari ini</th></tr></thead>';

  const body = rows.map((p) => {
    const priceFmt = p.currency === 'USD' ? fUsd : fIdr;
    const qty = state.hidden ? null : `${fNum.format(p.qty)}${TYPE[p.type].unit ? ` ${TYPE[p.type].unit}` : ''}`;
    const sub = [p.symbol, qty].filter(Boolean).join(' · ');
    const stale = p.stale ? `<span class="chip" title="Gagal diambil hari ini; memakai harga per ${esc(p.asOf)}">harga lama</span>` : '';
    return `<tr>
      <td class="asset"><i class="dot" style="background:var(--c-${p.type})"></i><div><strong>${esc(p.name)}</strong><small>${esc(sub)}</small></div></td>
      <td class="num" data-label="Harga" title="Penutupan ${p.asOf ? longDate(p.asOf) : ''}">${priceText(p, priceFmt)}${stale}</td>
      <td class="num" data-label="Nilai">${money(p.value)}</td>
      <td class="num" data-label="Bobot"><span class="wt">${weightText(p.weight)}<span class="bar"><i style="width:${Math.max(2, (p.weight / maxW) * 100).toFixed(1)}%"></i></span></span></td>
      <td class="num" data-label="Untung/rugi">${delta(p.pnlPct)}<small>${money(p.pnl, { sign: true })}</small></td>
      <td class="num" data-label="Hari ini">${delta(p.dayPct)}</td>
    </tr>`;
  }).join('');

  $('holdings').innerHTML = `${head}<tbody>${body || '<tr><td colspan="6" class="muted">Tidak ada aset.</td></tr>'}</tbody>`;
}

function render() {
  renderHeader();
  renderKpis();
  renderRanges();
  renderChart();
  renderAlloc();
  renderTable();
}

// ---------- interaksi ----------

$('privacy').addEventListener('click', () => {
  state.hidden = !state.hidden;
  try { localStorage.setItem('pf-hidden', state.hidden ? '1' : '0'); } catch { /* abaikan */ }
  render();
});

$('ranges').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-range]');
  if (!b) return;
  state.range = b.dataset.range;
  renderRanges();
  renderChart();
});

$('legend').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-type]');
  if (!b) return;
  state.filter = state.filter === b.dataset.type ? null : b.dataset.type;
  renderAlloc();
  renderTable();
});

$('logout').addEventListener('click', () => {
  clearCreds();
  state.snapshots = [];
  showConnect();
});

let raf = 0, lastW = 0;
new ResizeObserver(() => {
  const w = Math.floor($('chart').clientWidth);
  if (!state.snapshots.length || w === lastW) return;
  lastW = w;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(renderChart);
}).observe($('chart'));

// ---------- sambung & mulai ----------

function show(view) { // 'connect' | 'dash' | 'error'
  $('connect').hidden = view !== 'connect';
  $('dash').hidden = view !== 'dash';
  $('actions').hidden = view !== 'dash';
  if (view !== 'error') $('banner').hidden = true;
}

function showConnect(err, url) {
  show('connect');
  $('subtitle').textContent = 'Belum tersambung';
  if (url) $('c-url').value = url;
  $('c-token').value = '';
  $('c-err').hidden = !err;
  $('c-err').textContent = err || '';
  ($('c-url').value ? $('c-token') : $('c-url')).focus();
}

function fail(msg, hint) {
  show('error');
  $('subtitle').textContent = 'Gagal memuat data';
  const b = $('banner');
  b.hidden = false;
  b.className = 'banner error';
  b.innerHTML = `<strong>${esc(msg)}</strong>${hint ? `<br>${hint}` : ''}`;
}

async function start(creds, prefetched) {
  let d = prefetched;
  try {
    if (!d) d = await call(creds.url, creds.token, 'list');
  } catch (e) {
    if (e.message === 'unauthorized') return showConnect('Kata sandi tidak cocok.', creds.url);
    return fail(`Data tidak bisa dibaca (${e.message}).`, 'Periksa koneksi internet, lalu muat ulang. <a href="#" id="relink">Sambungkan ulang</a>');
  }
  state.snapshots = d.history;
  if (!state.snapshots.length) {
    return fail('Belum ada data portofolio.', 'Tambah aset di <a href="kelola.html">Kelola aset</a>, lalu jalankan workflow <em>Update harga harian</em> di tab Actions GitHub.');
  }
  show('dash');
  render();
}

$('connect').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('c-url').value.trim();
  const token = $('c-token').value;
  const err = (m) => { $('c-err').hidden = false; $('c-err').textContent = m; };
  if (!scriptUrlOk(url)) return err('URL harus berawalan https://script.google.com/… (alamat Web app dari Apps Script).');
  let d;
  try {
    d = await call(url, token, 'list'); // uji dulu sebelum disimpan
  } catch (ex) {
    return err(ex.message === 'unauthorized' ? 'Kata sandi salah.' : `Gagal tersambung: ${ex.message}`);
  }
  saveCreds({ url, token });
  start({ url, token }, d);
});

document.addEventListener('click', (e) => {
  if (e.target.id !== 'relink') return;
  e.preventDefault();
  clearCreds();
  showConnect();
});

const creds = readCreds();
if (creds) await start(creds);
else showConnect();
