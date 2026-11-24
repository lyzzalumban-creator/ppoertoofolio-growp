// Lumbung: dasbor portofolio. Tanpa framework dan tanpa library eksternal.
// Data diambil SEKALI dari Google Sheet lewat Apps Script (butuh URL + kata sandi), lalu semua halaman
// (Beranda, Analisis, Aset, Profil) digambar dari data itu di browser. Pindah halaman = ganti #/rute, tanpa memuat ulang.
// Halaman ini sendiri tidak berisi data.

import { call } from '../scripts/lib/api.mjs';
import { clearCreds, readCreds, saveCreds, scriptUrlOk } from './creds.js';
import { mountNav, setActive } from './nav.js';
import { $, ICON, agoText, esc, fAtDate, fAtTime, latest, longDate, setHidden, state, subscribe } from './lib.js';
import { maxDrawdown, monthlyReturns, returnIndex } from './stats.js';
import * as beranda from './views/beranda.js';
import * as analisis from './views/analisis.js';
import * as aset from './views/aset.js';
import * as profil from './views/profil.js';

const VIEWS = { beranda, analisis, aset, profil };
const NAMES = { beranda: 'Beranda', analisis: 'Analisis', aset: 'Aset', profil: 'Profil' };
const NEEDS_DATA = ['beranda', 'analisis', 'aset'];

mountNav('beranda', true).hidden = true; // tampil setelah tahu sudah tersambung
$('reload').innerHTML = ICON.refresh;

let mode = 'loading'; // loading | connect | dash | empty | error

// ---------- header ----------

function renderHeader() {
  const at = latest().at ? Date.parse(latest().at) : NaN;
  const age = Date.now() - at;
  $('subtitle').textContent = Number.isFinite(at)
    ? `Diperbarui ${fAtDate.format(at)}, ${fAtTime.format(at)} WIB (${agoText(age).replace(/ /g, ' ')})`
    : `Data per ${longDate(latest().date)}`;
  $('subtitle').classList.toggle('stale', Number.isFinite(at) && age > 12 * 3_600_000); // jadwal 6 jam: lewat 12 jam = ada yang macet
  const btn = $('privacy');
  const label = state.hidden ? 'Tampilkan nominal' : 'Sembunyikan nominal';
  btn.setAttribute('aria-pressed', String(state.hidden));
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = state.hidden ? ICON.eye : ICON.eyeOff; // ikon = aksi yang akan terjadi bila diketuk
}

// ---------- gambar semua halaman ----------

// Galat di satu bagian tidak boleh membekukan yang lain. Dulu satu jenis aset yang tak dikenal (web lama di cache,
// data dari robot baru) membuat kerangka pemuatan tidak pernah hilang. Sekarang bagian yang gagal dilaporkan, sisanya jalan.
const failed = new Map(); // bagian -> pesan galat
function safely(name, fn) {
  try {
    fn();
    failed.delete(name);
  } catch (e) {
    failed.set(name, (e && e.message) || String(e));
    console.error(e);
  }
}
function reportFailures() {
  const b = $('render-err');
  b.hidden = !failed.size;
  if (failed.size) b.innerHTML = `<strong>Sebagian tampilan gagal digambar (${esc([...failed.keys()].join(', '))}).</strong><br>Muat ulang halaman. Bila pesan ini tetap muncul, kirim teks ini: <code>${esc([...failed.values()][0])}</code>`;
}

function render() {
  if (state.snapshots.length) {
    safely('Hitungan', () => {
      const index = returnIndex(state.snapshots);
      state.perf = { index, months: monthlyReturns(state.snapshots), dd: maxDrawdown(index) };
    });
    safely('Header', renderHeader);
    safely('Beranda', beranda.render);
    safely('Analisis', analisis.render);
    safely('Aset', aset.render);
  }
  safely('Profil', profil.render); // Profil tetap hidup walau data belum ada
  reportFailures();
}
subscribe(render);

// ---------- rute: #/beranda, #/analisis/<bagian>, #/aset/<jenis>, #/profil ----------

function route(byUser) {
  const [v = '', sub = ''] = location.hash.replace(/^#\/?/, '').split('/');
  const view = VIEWS[v] ? v : 'beranda';
  state.route = { view, sub };
  document.body.dataset.route = location.hash.replace(/^#\/?/, ''); // penanda rute selesai diproses (juga dipakai tes)
  const data = mode === 'dash';
  $('dash').hidden = !(data && NEEDS_DATA.includes(view));
  for (const k of NEEDS_DATA) $(`v-${k}`).hidden = !(data && view === k);
  $('v-profil').hidden = !(view === 'profil' && (mode === 'dash' || mode === 'empty' || mode === 'error'));
  setActive(view);
  document.title = mode === 'connect' ? 'Lumbung' : `${NAMES[view]} · Lumbung`;
  if (data || view === 'profil') {
    // nama terpisah: berhasil membuka halaman tidak boleh menghapus laporan gagal menggambar halaman itu
    safely(`${NAMES[view]} (buka)`, () => VIEWS[view].show?.(sub));
    reportFailures();
  }
  if (byUser) {
    window.scrollTo(0, 0);
    $(`vt-${view}`).focus({ preventScroll: true }); // pembaca layar tahu halaman berganti
  }
}
window.addEventListener('hashchange', () => route(true));

// ---------- keadaan layar ----------

function show(m) { // 'connect' | 'dash' | 'empty' | 'error'
  mode = m;
  $('skeleton').hidden = true;
  $('connect').hidden = m !== 'connect';
  $('nav').hidden = m === 'connect';
  $('actions').hidden = m === 'connect';
  $('privacy').hidden = m !== 'dash';
  if (m !== 'error' && m !== 'empty') $('banner').hidden = true;
  if (m !== 'dash') { failed.clear(); $('render-err').hidden = true; }
  route(false);
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

// Tersambung dengan benar, hanya belum ada snapshot: bukan kegagalan.
function empty() {
  show('empty');
  $('subtitle').textContent = 'Belum ada data';
  const b = $('banner');
  b.hidden = false;
  b.className = 'banner';
  b.innerHTML = '<strong>Belum ada data portofolio.</strong><br>Tambah aset di <a href="kelola.html">Kelola aset</a>, lalu jalankan workflow <em>Update harga harian</em> di tab Actions GitHub.';
  render();
}

function fail(msg, hint) {
  show('error');
  $('subtitle').textContent = 'Gagal memuat data';
  const b = $('banner');
  b.hidden = false;
  b.className = 'banner error';
  b.innerHTML = `<strong>${esc(msg)}</strong>${hint ? `<br>${hint}` : ''}`;
  render();
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
  state.meta = { version: d.version };
  if (!state.snapshots.length) return empty();
  render();
  show('dash'); // menggambar halaman yang diminta lewat rute, sekarang data sudah ada
}

// ---------- interaksi ----------

$('privacy').addEventListener('click', () => setHidden(!state.hidden));

async function reload() {
  const c = readCreds();
  if (!c) return showConnect();
  const label = $('set-reload').textContent;
  for (const b of [$('reload'), $('set-reload')]) { b.disabled = true; b.setAttribute('aria-busy', 'true'); }
  $('set-reload').textContent = 'Memuat…';
  await start(c);
  for (const b of [$('reload'), $('set-reload')]) { b.disabled = false; b.removeAttribute('aria-busy'); }
  $('set-reload').textContent = label;
}
$('reload').addEventListener('click', reload);
$('set-reload').addEventListener('click', reload);

$('logout').addEventListener('click', () => {
  clearCreds();
  state.snapshots = [];
  state.meta = {};
  showConnect();
});

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
