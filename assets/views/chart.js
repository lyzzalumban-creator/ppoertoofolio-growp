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
 * Gambar grafik area ke `box`: isi berwarna penuh selebar kotak, garis putus-putus vertikal di titik terpilih,
 * gelembung nilai di titik itu, dan tanggalnya di bawah. Bawaan menunjuk titik terakhir; sentuh/geser untuk memilih.
 * pts = [{ t, date, y, c? }] (c = garis modal, opsional). opts: { fmtTip(p) -> html nilai, label, empty, height }.
 */
export function lineChart(box, pts, { fmtTip, label, empty, height } = {}) {
  if (pts.length < 2) {
    box.innerHTML = `<div class="empty">${empty || 'Belum ada data untuk rentang ini.'}</div>`;
    return;
  }
  // Halaman tersembunyi: kosongkan (jangan sisakan angka lama), digambar lagi saat halamannya dibuka.
  if (!box.clientWidth) { box.innerHTML = ''; return; }

  const W = Math.max(260, Math.floor(box.clientWidth));
  const H = height || (W < 520 ? 250 : 290);
  const mt = 16, mb = 34; // mb: ruang baris tanggal di bawah
  const ih = H - mt - mb;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const ys = pts.flatMap((p) => (p.c != null ? [p.y, p.c] : [p.y]));
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (lo === hi) { lo -= Math.abs(lo) * 0.01 || 1; hi += Math.abs(hi) * 0.01 || 1; }
  const pad = (hi - lo) * 0.1;
  lo -= pad; hi += pad;
  const X = (t) => ((t - t0) / (t1 - t0)) * W;
  const Y = (v) => mt + (1 - (v - lo) / (hi - lo)) * ih;

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = `${line}L${W},${(mt + ih).toFixed(1)}L0,${(mt + ih).toFixed(1)}Z`;
  const costLine = pts.some((p) => p.c != null) ? pts.filter((p) => p.c != null).map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.c).toFixed(1)}`).join('') : '';
  const dir = tone(pts[pts.length - 1].y - pts[0].y);
  const longSpan = t1 - t0 > 330 * DAY;
  const xLabels = [0, 1, 2].map((k) => {
    const t = t0 + ((t1 - t0) * k) / 2;
    return `<text x="${(X(t) + [4, 0, -4][k]).toFixed(1)}" y="${H - 6}" text-anchor="${['start', 'middle', 'end'][k]}">${(longSpan ? fMonth : fDay).format(t)}</text>`;
  }).join('');
  const vgrid = [1, 2, 3, 4, 5].map((k) => `<line class="grid-line" x1="${((W * k) / 6).toFixed(1)}" x2="${((W * k) / 6).toFixed(1)}" y1="${mt}" y2="${mt + ih}"/>`).join('');
  const gid = `g-${box.id}`;

  box.innerHTML = `
    <svg class="chart ${dir}" viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(label(pts[0], pts[pts.length - 1]))}">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".42"/><stop offset="1" stop-color="currentColor" stop-opacity=".03"/></linearGradient></defs>
      ${vgrid}
      <path d="${area}" fill="url(#${gid})"/>
      ${costLine ? `<path class="cost" d="${costLine}"/>` : ''}
      <path class="line" d="${line}"/>
      <g class="axis">${xLabels}</g>
      <g class="cursor"><line y1="${mt}" y2="${mt + ih}"/><circle r="5"/></g>
      <rect class="hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
    </svg>
    <div class="tip"></div><div class="dpill"></div>`;

  const svg = box.querySelector('svg'), cur = svg.querySelector('.cursor'), tip = box.querySelector('.tip'), pill = box.querySelector('.dpill');
  const place = (p) => {
    const cx = X(p.t), cy = Y(p.y);
    const ln = cur.querySelector('line'), dot = cur.querySelector('circle');
    ln.setAttribute('x1', cx); ln.setAttribute('x2', cx);
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
    tip.style.left = '0px'; // ukur dari posisi netral: lebar tidak boleh dipengaruhi posisi sebelumnya
    tip.innerHTML = fmtTip(p);
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    // di kiri titik; bila tak muat pindah ke kanannya; selalu tetap di dalam kotak
    tip.style.left = `${Math.min(Math.max(2, cx - tw - 10 >= 2 ? cx - tw - 10 : cx + 12), W - tw - 2)}px`;
    tip.style.top = `${Math.min(Math.max(2, cy - th / 2), mt + ih - th)}px`;
    pill.textContent = longDate(p.date);
    pill.style.left = `${Math.min(Math.max(2, cx - pill.offsetWidth / 2), W - pill.offsetWidth - 2)}px`;
    pill.style.top = `${mt + ih + 6}px`;
  };
  const last = pts[pts.length - 1];
  place(last);
  const show = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let best = pts[0];
    for (const p of pts) if (Math.abs(X(p.t) - px) < Math.abs(X(best.t) - px)) best = p;
    place(best);
  };
  const hit = svg.querySelector('.hit');
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  // Mouse: kembali ke titik terakhir saat kursor pergi. Sentuh: pilihan bertahan setelah jari diangkat (ketuk titik lain untuk pindah).
  hit.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') place(last); });
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

/**
 * Grafik batang per periode (return bulanan, profit trading): hijau di atas nol, merah di bawah, nilai di ujung batang.
 * items = [{ label, v, tip? }] (tip = html gelembung saat diketuk/diarahkan); opts: { fmtY, fmtV, aria, empty }.
 */
export function barChart(box, items, { fmtY, fmtV, aria, empty } = {}) {
  if (!items.length) { box.innerHTML = `<div class="empty">${empty || 'Belum ada data.'}</div>`; return; }
  if (!box.clientWidth) { box.innerHTML = ''; return; }
  const W = Math.max(260, Math.floor(box.clientWidth));
  const H = 230, ml = 40, mr = 4, mt = 22, mb = 26;
  const iw = W - ml - mr, ih = H - mt - mb;
  const vals = items.map((i) => i.v);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const Y = (v) => mt + (1 - (v - y0) / (y1 - y0 || 1)) * ih;
  const slot = iw / items.length;
  const bw = Math.min(28, slot * 0.62);
  const grid = ticks.map((v) => `<line class="${v === 0 ? 'zero-line' : 'grid-line'}" x1="${ml}" x2="${W - mr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${ml - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${esc(fmtY(v))}</text>`).join('');
  const bars = items.map((it, i) => {
    const cx = ml + slot * (i + 0.5);
    const top = Math.min(Y(it.v), Y(0)), h = Math.max(1.5, Math.abs(Y(it.v) - Y(0)));
    const dir = it.v > 0 ? 'pos' : it.v < 0 ? 'neg' : 'flat';
    const ty = it.v >= 0 ? top - 4 : top + h + 11;
    return `<rect class="bar ${dir}" x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3"/>
      <text class="bv ${dir}" x="${cx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle">${esc(fmtV(it.v))}</text>
      <text class="bl" x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(it.label)}</text>`;
  }).join('');
  box.innerHTML = `<svg class="chart bars" viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(aria || '')}"><g class="axis">${grid}</g>${bars}</svg><div class="tip" hidden></div>`;
  // Ketuk (atau arahkan) satu batang: gelembung berisi bulan dan nilainya; pilihan bertahan sampai batang lain dipilih.
  const svg = box.querySelector('svg'), tip = box.querySelector('.tip'), rects = svg.querySelectorAll('rect.bar');
  const pick = (ev) => {
    const r = svg.getBoundingClientRect();
    const i = Math.min(items.length - 1, Math.max(0, Math.floor((((ev.clientX - r.left) / r.width) * W - ml) / slot)));
    rects.forEach((b, k) => b.classList.toggle('sel', k === i));
    if (!items[i].tip) return;
    tip.hidden = false;
    tip.innerHTML = items[i].tip;
    const cx = ml + slot * (i + 0.5), top = Math.min(Y(items[i].v), Y(0));
    tip.style.left = `${Math.min(Math.max(2, cx - tip.offsetWidth / 2), W - tip.offsetWidth - 2)}px`;
    tip.style.top = `${Math.max(2, top - tip.offsetHeight - 22)}px`;
  };
  svg.addEventListener('pointerdown', pick);
  svg.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse') pick(ev); });
}
