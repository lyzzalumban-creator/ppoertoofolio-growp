// Analisis: Kinerja, Alokasi, Risiko, Riwayat. Semua dihitung dari riwayat snapshot di browser.
import { $, arrow, colorOf, delta, esc, fDay, fMonth, latest, longDate, money, monthName, pct, state, symDisp, tile, toMs, tone, typeOf, typesIn, weightText } from '../lib.js';
import { byTypePnl, cashSplit, concentration, currentDrawdown, riskStats } from '../stats.js';
import { barChart, watch } from './chart.js';

const SUBS = ['kinerja', 'bulanan', 'alokasi', 'risiko', 'riwayat'];
const PAGE = 30;
const num1 = (v) => v.toLocaleString('id-ID', { maximumFractionDigits: 1 });
const none = (msg) => `<div class="empty">${msg}</div>`;

// -- Kinerja (semua dalam persen, jadi aman saat nominal disembunyikan) --

function renderKinerja() {
  const { index, months, dd } = state.perf;
  if (state.series.length < 2) {
    $('metrics').innerHTML = none('Butuh data minimal 2 hari.');
  } else {
    const ranked = [...months].sort((a, b) => b.ret - a.ret);
    $('metrics').innerHTML = [
      tile('Return tertimbang waktu', delta(index.at(-1).idx - 1), `sejak ${esc(longDate(index[0].date))}`),
      tile('Penurunan terdalam', delta(dd.pct), dd.to ? `${esc(fDay.format(toMs(dd.from)))} → ${esc(longDate(dd.to))}` : 'belum pernah turun'),
      tile('Bulan terbaik', delta(ranked[0].ret), esc(monthName(ranked[0].month))),
      tile('Bulan terburuk', delta(ranked.at(-1).ret), esc(monthName(ranked.at(-1).month))),
    ].join('');

  }

  // Batang untung/rugi per aset, berpusat di nol bila ada yang rugi.
  // Kas tidak ikut: untung/ruginya selalu nol, hanya mengotori batang.
  const rows = ((latest() && latest().positions) || []).filter((p) => p.pnlPct != null && p.type !== 'cash').sort((a, b) => b.pnlPct - a.pnlPct);
  const lo = Math.min(0, ...rows.map((p) => p.pnlPct));
  const hi = Math.max(0, ...rows.map((p) => p.pnlPct));
  const span = hi - lo || 1;
  const z = (-lo / span) * 100;
  $('perf').innerHTML = rows.map((p) => {
    const w = (Math.abs(p.pnlPct) / span) * 100;
    const left = p.pnlPct < 0 ? z - w : z;
    return `<li class="pr"><span class="pr-n" title="${esc(p.name)}"><i class="dot" style="background:${colorOf(p.type)}"></i>${esc(symDisp(p))}</span>
      <span class="pr-t" aria-hidden="true"><i class="pr-b ${tone(p.pnlPct)}" style="left:${left.toFixed(2)}%;width:${Math.max(0.5, w).toFixed(2)}%"></i>${lo < 0 ? `<i class="pr-z" style="left:${z.toFixed(2)}%"></i>` : ''}</span>
      <span class="pr-v ${tone(p.pnlPct)}">${arrow(p.pnlPct)}${pct(p.pnlPct, 1)}</span></li>`;
  }).join('') || '<li class="muted">Belum ada aset dengan modal.</li>';
}

// -- Bulanan: batang return per bulan + daftar dengan rupiah dan persen --

let mAll = false; // false = 12 bulan terakhir
const short = (m) => fMonth.format(toMs(`${m}-01`)).split(' ')[0];

function drawMonths() {
  const months = state.perf ? (mAll ? state.perf.months : state.perf.months.slice(-12)) : [];
  const ok = state.series.length >= 2 && months.length;
  barChart($('mchart'), ok ? months.map((m) => ({ label: short(m.month), v: m.ret * 100, tip: `<b>${esc(monthName(m.month))}</b>${state.hidden ? '' : `<span>${esc(money(m.pnl, { sign: true }))}</span>`}<span>${esc(pct(m.ret))}</span>`, head: `<b>${esc(pct(m.ret))}</b>${state.hidden ? '' : `<span class="pill ${tone(m.pnl)}">${arrow(m.pnl)}${esc(money(m.pnl, { sign: true }))}</span>`}<small class="muted">${esc(monthName(m.month))}</small>` })) : [], {
    head: $('mhead'),
    restHead: ok ? `<b>${esc(pct(months.reduce((a, m) => a * (1 + m.ret), 1) - 1))}</b><small class="muted">${months.length} bulan</small>` : '',
    fmtY: (v) => `${v.toLocaleString('id-ID', { maximumFractionDigits: 0 })}%`,
    fmtV: (v) => `${v.toLocaleString('id-ID', { maximumFractionDigits: Math.abs(v) >= 10 ? 0 : 1 })}%`,
    aria: ok ? `Return bulanan, ${months.length} bulan` : '',
    empty: 'Butuh data minimal 2 hari.',
  });
  chartDrawn();
}
const chartDrawn = watch($('mchart'), () => { if (state.route.view === 'analisis') drawMonths(); });

function renderBulanan() {
  const months = state.perf ? (mAll ? state.perf.months : state.perf.months.slice(-12)) : [];
  $('mlist').innerHTML = state.series.length < 2 ? '' : [...months].reverse().map((m) => `<li class="mrow">
      <span class="mr-m">${esc(short(m.month))} ${esc(m.month.slice(0, 4))}</span>
      <span class="mr-v ${tone(m.ret)}">${state.hidden ? '' : `${money(m.pnl, { sign: true })} `}${arrow(m.ret)}${pct(m.ret).replace(/^[+−]/, '')}</span></li>`).join('');
  for (const b of $('mrange').querySelectorAll('button')) b.setAttribute('aria-pressed', String((b.dataset.m === 'all') === mAll));
  drawMonths();
}

$('mrange').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-m]');
  if (!b) return;
  mAll = b.dataset.m === 'all';
  renderBulanan();
});

// -- Alokasi: seberapa menumpuk, dan untung/rugi per jenis --

function renderAlokasi() {
  const L = latest();
  if (!L) { $('conc').innerHTML = none('Belum ada aset yang berharga.'); $('types').innerHTML = ''; return; }
  const pos = L.positions || [];
  const split = cashSplit(L);
  const invested = pos.filter((p) => p.type !== 'cash'); // konsentrasi dihitung di antara yang diinvestasikan, tanpa kas
  const c = concentration(invested);
  const stats = byTypePnl(pos);
  const types = typesIn(Object.keys(stats)).sort((a, b) => stats[b].value - stats[a].value);
  const total = types.reduce((s, t) => s + stats[t].value, 0) || 1;
  $('conc').innerHTML = [
    tile('Kas', money(split.cash), split.cash ? `${weightText(split.weight)} dari total` : 'belum ada aset kas'),
    tile('Diinvestasikan', money(split.invested), `${weightText(1 - split.weight)} dari total`),
    ...(c ? [
      tile('3 aset terbesar', weightText(c.top3), 'dari yang diinvestasikan, di luar kas'),
      tile('Setara', `${num1(c.effective)} aset`, `bila bobotnya sama rata (punya ${invested.length})`),
    ] : []),
  ].join('');

  $('types').innerHTML = types.map((t) => {
    const s = stats[t];
    const w = s.value / total;
    return `<li><div class="ty" data-type="${esc(t)}">
      <i class="dot" style="background:${colorOf(t)}"></i>
      <span class="nm">${esc(typeOf(t).label)}<small>${s.count} aset · ${weightText(w)} dari total</small></span>
      <span class="v"><b>${money(s.value)}</b>${t === 'cash' ? '' : delta(s.pnlPct)}</span>
      <span class="bar" aria-hidden="true"><i style="width:${(w * 100).toFixed(1)}%;background:${colorOf(t)}"></i></span></div></li>`;
  }).join('');
}

// -- Risiko --

function renderRisiko() {
  const r = riskStats(state.series);
  if (!r) { $('risk').innerHTML = none('Butuh minimal 14 hari data agar angka risiko layak dipercaya.'); return; }
  const dd = currentDrawdown(state.perf.index);
  $('risk').innerHTML = [
    tile('Volatilitas (setahun)', `${num1(r.vol * 100)}%`, `dari ${r.days} hari: ${r.up} naik, ${r.down} turun, ${r.flat} datar`),
    tile('Penurunan saat ini', delta(dd.pct), dd.pct === 0 ? 'sedang di puncak' : `dari puncak ${esc(longDate(dd.peak))}`),
    tile('Hari terbaik', delta(r.best.pct), esc(longDate(r.best.date))),
    tile('Hari terburuk', delta(r.worst.pct), esc(longDate(r.worst.date))),
  ].join('');
}

// -- Riwayat --

function renderRiwayat() {
  const all = [...state.series].reverse();
  const shown = all.slice(0, state.histN);
  $('hist').tBodies[0].innerHTML = shown.map((s) => `<tr><td>${esc(longDate(s.date))}</td><td>${money(s.total)}</td><td>${delta(s.dayPct)}</td><td>${delta(s.pnlPct)}</td></tr>`).join('');
  $('hist-more').hidden = shown.length >= all.length;
}

export function render() {
  renderKinerja();
  renderBulanan();
  renderAlokasi();
  renderRisiko();
  renderRiwayat();
}

/** Tampilkan satu bagian; bagian tak dikenal = Kinerja. */
export function show(sub) {
  const s = SUBS.includes(sub) ? sub : 'kinerja';
  for (const k of SUBS) $(`an-${k}`).hidden = k !== s;
  if (s === 'bulanan') drawMonths();
  for (const a of $('subnav').querySelectorAll('a')) {
    if (a.getAttribute('href') === `#/analisis/${s}`) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

$('hist-more').addEventListener('click', () => {
  state.histN += PAGE;
  renderRiwayat();
});
