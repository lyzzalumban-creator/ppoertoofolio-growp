// Grafik nilai portofolio (SVG tanpa library): rentang waktu, garis modal, tooltip.
import { $, DAY, esc, fCompact, fDay, fIdr, fMonth, longDate, pct, state, toMs } from '../lib.js';

const RANGES = [['1 bln', 31], ['3 bln', 92], ['6 bln', 183], ['1 thn', 366], ['Semua', Infinity]];

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
    .map((s) => ({ t: toMs(s.date), date: s.date, y: amt ? s.total : s.pnlPct * 100, c: amt ? s.cost : null }));
  return { pts, amt };
}

export function renderRanges() {
  $('ranges').innerHTML = RANGES.map(([l]) => `<button type="button" data-range="${l}" aria-pressed="${l === state.range}">${l}</button>`).join('');
}

export function renderChart() {
  const { pts, amt } = series();
  $('chart-h').textContent = amt ? 'Nilai portofolio' : 'Untung/rugi dari modal (%)';
  const box = $('chart');
  // Garis modal (putus-putus) hanya saat nominal tampil; saat tersembunyi grafiknya persen.
  const withCost = amt && pts.some((p) => p.c != null);
  $('chart-key').innerHTML = withCost && pts.length > 1 ? '<span>Nilai</span><span class="k-cost">Modal</span>' : '';

  if (pts.length < 2) {
    box.innerHTML = `<div class="empty">${pts.length ? 'Grafik muncul setelah ada data minimal 2 hari. Isi <em>Tanggal beli</em> di <a href="kelola.html">Kelola aset</a>, lalu jalankan workflow: riwayat langsung terisi sejak tanggal beli.' : 'Belum ada data untuk rentang ini.'}</div>`;
    return;
  }
  // Halaman tersembunyi: kosongkan (jangan sisakan grafik rupiah lama), digambar lagi saat halamannya dibuka.
  if (!box.clientWidth) { box.innerHTML = ''; return; }

  const W = Math.max(280, Math.floor(box.clientWidth));
  // Di layar lebar grafik berdampingan dengan kartu Alokasi dan Target; samakan tingginya agar tidak ada ruang kosong.
  const sideBySide = window.matchMedia('(min-width: 900px)').matches;
  const H = sideBySide ? 300 : W < 520 ? 220 : 280;
  const ml = amt ? 62 : 50, mr = 12, mt = 12, mb = 26;
  const iw = W - ml - mr, ih = H - mt - mb;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;

  const ys = withCost ? pts.flatMap((p) => (p.c != null ? [p.y, p.c] : [p.y])) : pts.map((p) => p.y);
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  // Bila semua nilai >= 0 (mis. nilai portofolio), bantalan tidak boleh memunculkan sumbu di bawah nol.
  const floor = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
  const ticks = niceTicks(floor, hi + pad);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];

  const X = (t) => ml + ((t - t0) / (t1 - t0)) * iw;
  const Y = (v) => mt + (1 - (v - y0) / (y1 - y0)) * ih;
  const fmtY = (v) => (amt ? fCompact.format(v) : `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);
  const fmtTip = (v) => (amt ? fIdr.format(v) : pct(v / 100));

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = `${line}L${X(t1).toFixed(1)},${(mt + ih).toFixed(1)}L${X(t0).toFixed(1)},${(mt + ih).toFixed(1)}Z`;
  const costPts = withCost ? pts.filter((p) => p.c != null) : [];
  const costLine = costPts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.c).toFixed(1)}`).join('');

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
      ${costLine ? `<path class="cost" d="${costLine}"/>` : ''}
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
    tip.innerHTML = `<b>${esc(fmtTip(best.y))}</b>${withCost && best.c != null ? `Modal ${esc(fIdr.format(best.c))}<br>` : ''}${longDate(best.date)}`;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(4, (cx / W) * r.width - w / 2), r.width - w - 4)}px`;
  };
  const hide = () => { cur.hidden = true; tip.hidden = true; };
  const hit = svg.querySelector('.hit');
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}

let raf = 0, lastW = 0;

/** Gambar sekarang (dipanggil saat Beranda dibuka); ResizeObserver tidak perlu menggambar ulang lagi. */
export function drawChart() {
  renderChart();
  lastW = Math.floor($('chart').clientWidth);
}

export function initChart() {
  $('ranges').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-range]');
    if (!b) return;
    state.range = b.dataset.range;
    renderRanges();
    renderChart();
  });
  new ResizeObserver(() => {
    const w = Math.floor($('chart').clientWidth);
    if (!state.snapshots.length || w === lastW) return;
    lastW = w;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(renderChart);
  }).observe($('chart'));
}
