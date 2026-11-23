// Profil: pengaturan tampilan, target, status data, tentang, dan keluar.
// Tombol "Muat ulang data" dan "Keluar" ditangani app.js (yang memegang pemuatan data dan kredensial).
import { $, latest, money, setHidden, state } from '../lib.js';

function theme() {
  try { const t = localStorage.getItem('pf-theme'); return t === 'light' || t === 'dark' ? t : 'auto'; } catch { return 'auto'; }
}

function applyTheme(v) {
  const root = document.documentElement;
  if (v === 'light' || v === 'dark') root.dataset.theme = v;
  else delete root.dataset.theme;
  try { if (v === 'auto') localStorage.removeItem('pf-theme'); else localStorage.setItem('pf-theme', v); } catch { /* abaikan */ }
}

/** Boleh dipanggil kapan saja, termasuk saat data belum ada. */
export function render() {
  $('set-hide').setAttribute('aria-checked', String(state.hidden));
  $('set-theme').value = theme();
  $('set-goal').textContent = state.goal ? `Target ${money(state.goal)}` : 'Belum diatur.';
  const L = state.snapshots.length ? latest() : null;
  const v = state.meta.version;
  $('set-data').textContent = L
    ? `${(L.positions || []).length} aset, riwayat ${state.snapshots.length} hari. Skrip Apps Script ${v >= 2 ? `versi ${v}` : 'versi lama (tempel Code.gs terbaru agar tanggal beli tersimpan)'}.`
    : 'Belum ada data.';
}

$('set-hide').addEventListener('click', () => setHidden(!state.hidden));
$('set-theme').addEventListener('change', (e) => applyTheme(e.target.value));
