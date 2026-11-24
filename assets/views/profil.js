// Profil: pengaturan tampilan, target, status data, tentang, dan keluar.
// Tombol "Muat ulang data" dan "Keluar" ditangani app.js (yang memegang pemuatan data dan kredensial).
import { $, money, setHidden, state } from '../lib.js';

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
  const v = state.meta.version;
  const script = v >= 3 ? `versi ${v}` : v >= 2 ? `versi ${v}: jual-beli belum bisa dicatat, tempel Code.gs terbaru` : 'versi lama: tempel Code.gs terbaru agar tanggal beli dan jual-beli tersimpan';
  $('set-data').textContent = state.assets.length || state.snapshots.length
    ? `${state.assets.length} aset, riwayat ${state.snapshots.length} hari, ${state.txs.length} transaksi. Skrip Apps Script ${script}.`
    : `Belum ada data. Skrip Apps Script ${v ? script : 'belum terbaca'}.`;
}

$('set-hide').addEventListener('click', () => setHidden(!state.hidden));
$('set-theme').addEventListener('change', (e) => applyTheme(e.target.value));
