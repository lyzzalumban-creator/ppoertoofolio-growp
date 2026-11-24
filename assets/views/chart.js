// Grafik garis SVG tanpa library, dipakai grafik portofolio (Beranda) dan grafik harga aset (halaman aset).
// Warna garis mengikuti arah dalam rentang yang dipilih (naik hijau, turun merah), dengan area berbayang di bawahnya.
import { DAY, esc, fDay, fMonth, longDate, toMs, tone } from '../lib.js';

export const RANGES = [['1 bln', 31], ['3 bln', 92], ['6 bln', 183], ['1 thn', 366], ['Semua', Infinity]];

export function inRange(snaps, range) {
  const days = (RANGES.find((r) => r[0] === range) || [])[1] ?? Infinity;
  if (!Number.isFinite(days) || !snaps.length) return snaps;
  const end = toMs(snaps[snaps.length - 1].date);
  return snaps.filter((s) => end - toMs(s.date) <= days * DAY);
}

export const rangesHtml = (cur) => RANGES.map(([l]) => `<button type="button" data-range="${l}" aria-pressed="${l === cur}">${l}</button>`).join('');

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

/**
 * Gambar grafik ke `box`. pts = [{ t, date, y, c? }] (c = garis modal, opsional).
 * opts: { fmtY, fmtTip, label, empty, height }
 */
export function lineChart(box, pts, { fmtY, fmtTip, label, empty, height } = {}) {
  if (pts.length < 2) {
    box.innerHTML = `<div class="empty">${empty || 'Belum ada data untuk rentang ini.'}</div>`;
    return;
  }
  // Halaman tersembunyi: kosongkan (jangan sisakan angka lama), digambar lagi saat halamannya dibuka.
  if (!box.clientWidth) { box.innerHTML = ''; return; }

  const W = Math.max(260, Math.floor(box.clientWidth));
  const H = height || (W < 520 ? 210 : 260);
  const withCost = pts.some((p) => p.c != null);
  const ml = 8, mr = 52, mt = 10, mb = 24; // sumbu nilai di kanan, seperti aplikasi saham pada umumnya
  const iw = W - ml - mr, ih = H - mt - mb;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const ys = withCost ? pts.flatMap((p) => (p.c != null ? [p.y, p.c] : [p.y])) : pts.map((p) => p.y);
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (lo === hi) { lo -= Math.abs(lo) * 0.01 || 1; hi += Math.abs(hi) * 0.01 || 1; }
  const pad = (hi - lo) * 0.08;
  const floor = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
  const ticks = niceTicks(floor, hi + pad);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const X = (t) => ml + ((t - t0) / (t1 - t0)) * iw;
  const Y = (v) => mt + (1 - (v - y0) / (y1 - y0)) * ih;

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = `${line}L${X(t1).toFixed(1)},${(mt + ih).toFixed(1)}L${X(t0).toFixed(1)},${(mt + ih).toFixed(1)}Z`;
  const costLine = withCost ? pts.filter((p) => p.c != null).map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.c).toFixed(1)}`).join('') : '';
  const dir = tone(pts[pts.length - 1].y - pts[0].y);
  const longSpan = t1 - t0 > 330 * DAY;
  const xLabels = [0, 1, 2].map((k) => {
    const t = t0 + ((t1 - t0) * k) / 2;
    return `<text x="${X(t).toFixed(1)}" y="${H - 6}" text-anchor="${['start', 'middle', 'end'][k]}">${(longSpan ? fMonth : fDay).format(t)}</text>`;
  }).join('');
  const grid = ticks.map((v) => `<line class="grid-line" x1="${ml}" x2="${W - mr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${W - mr + 6}" y="${(Y(v) + 4).toFixed(1)}">${esc(fmtY(v))}</text>`).join('');
  const zero = y0 < 0 && y1 > 0 ? `<line class="zero-line" x1="${ml}" x2="${W - mr}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>` : '';
  const last = pts[pts.length - 1];
  const gid = `g-${box.id}`;

  box.innerHTML = `
    <svg class="chart ${dir}" viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(label(pts[0], last))}">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".22"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
      <g class="axis">${grid}${xLabels}</g>
      ${zero}
      <path d="${area}" fill="url(#${gid})"/>
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
    tip.innerHTML = fmtTip(best);
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(4, (cx / W) * r.width - w / 2), r.width - w - 4)}px`;
  };
  const hide = () => { cur.hidden = true; tip.hidden = true; };
  const hit = svg.querySelector('.hit');
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}

/** Gambar ulang saat lebar kotak berubah (termasuk saat halamannya baru dibuka). */
export function watch(box, draw) {
  let w = -1, raf = 0;
  new ResizeObserver(() => {
    const nw = Math.floor(box.clientWidth);
    if (nw === w) return;
    w = nw;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  }).observe(box);
  return () => { w = Math.floor(box.clientWidth); }; // panggil sesudah menggambar langsung: RO tidak menggambar dobel
}

/** Mini-grafik bentuk saja (tanpa angka): aman walau nominal disembunyikan. */
export function sparkline(values, cls = '') {
  const pts = values.filter(Number.isFinite);
  if (pts.length < 2) return '';
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = hi - lo || 1;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * 100).toFixed(2)},${(29 - ((v - lo) / span) * 27).toFixed(2)}`).join('');
  return `<svg class="spark ${tone(pts[pts.length - 1] - pts[0])} ${cls}" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="area" d="${d}L100,32L0,32Z"/><path class="line" d="${d}"/></svg>`;
}
