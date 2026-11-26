// Profil: pengaturan tampilan, target, status data, tentang, dan keluar.
// Tombol "Muat ulang data" dan "Keluar" ditangani app.js (yang memegang pemuatan data dan kredensial).
import { $, esc, latest, money, monthName, pct, setHidden, state } from '../lib.js';
import { dateAfterYears, goalProgress, yearsToGoal, yearReturn } from '../stats.js';

function theme() {
  try { const t = localStorage.getItem('pf-theme'); return t === 'light' || t === 'dark' ? t : 'auto'; } catch { return 'auto'; }
}

function applyTheme(v) {
  const root = document.documentElement;
  if (v === 'light' || v === 'dark') root.dataset.theme = v;
  else delete root.dataset.theme;
  try { if (v === 'auto') localStorage.removeItem('pf-theme'); else localStorage.setItem('pf-theme', v); } catch { /* abaikan */ }
}

// Perkiraan tercapai (di Profil): bunga majemuk dari nilai sekarang, tanpa setoran baru; asumsi pengguna dan return 12 bulan terakhir.
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


/** Boleh dipanggil kapan saja, termasuk saat data belum ada. */
export function render() {
  $('set-hide').setAttribute('aria-checked', String(state.hidden));
  $('set-theme').value = theme();
  $('logout').textContent = state.demo ? 'Keluar dari demo' : 'Keluar dari perangkat ini';
  $('set-goal').textContent = state.goal ? `Target ${money(state.goal)}` : 'Belum diatur.';
  const L = latest();
  $('set-proj').innerHTML = L && state.goal && goalProgress(L.total, state.goal) < 1 ? projHtml(L) : '';
  const v = state.meta.version;
  const script = v >= 4 ? `versi ${v}` : v >= 3 ? `versi ${v}: tukar mata uang dan trade emas belum bisa, tempel Code.gs terbaru` : v >= 2 ? `versi ${v}: jual-beli belum bisa dicatat, tempel Code.gs terbaru` : 'versi lama: tempel Code.gs terbaru agar tanggal beli dan jual-beli tersimpan';
  $('set-data').textContent = state.assets.length || state.snapshots.length
    ? `${state.assets.length} aset, riwayat ${state.snapshots.length} hari, ${state.txs.length} transaksi. Skrip Apps Script ${script}.`
    : `Belum ada data. Skrip Apps Script ${v ? script : 'belum terbaca'}.`;
}

$('set-hide').addEventListener('click', () => setHidden(!state.hidden));
$('set-theme').addEventListener('change', (e) => applyTheme(e.target.value));
