// Lumbung: dasbor portofolio. Tanpa framework dan tanpa library eksternal.
// Data diambil SEKALI dari Google Sheet lewat Apps Script (butuh URL + kata sandi), lalu semua halaman digambar
// di browser. Pindah halaman = ganti #/rute. Tambah/ubah/jual/beli disimpan lewat data.js dan langsung tampil.
// Halaman ini sendiri tidak berisi data.

import { call } from '../scripts/lib/api.mjs';
import { clearCreds, readCreds, saveCreds, scriptUrlOk } from './creds.js';
import { mountNav, setActive } from './nav.js';
import { $, ICON, agoText, esc, fAtDate, fAtTime, latest, longDate, setHidden, state, subscribe, todayWib } from './lib.js';
import { saveStamp, setData, whenSaved } from './data.js';
import { demoData } from './demo.js';
import * as beranda from './views/beranda.js';
import * as detail from './views/detail.js';
import * as analisis from './views/analisis.js';
import * as aktivitas from './views/aktivitas.js';
import * as profil from './views/profil.js';

const VIEWS = { beranda, aset: detail, analisis, aktivitas, profil };
const NAMES = { beranda: 'Beranda', aset: 'Aset', analisis: 'Analisis', aktivitas: 'Aktivitas', profil: 'Profil' };
const DATA_VIEWS = ['beranda', 'aset', 'analisis', 'aktivitas'];

mountNav().hidden = true; // tampil setelah tahu sudah tersambung
$('reload').innerHTML = ICON.refresh;

let mode = 'loading'; // loading | connect | dash | error

// ---------- header ----------

function renderHeader() {
  const L = latest();
  const at = L && L.at ? Date.parse(L.at) : NaN;
  const age = Date.now() - at;
  $('subtitle').textContent = Number.isFinite(at)
    ? `Diperbarui ${fAtDate.format(at)}, ${fAtTime.format(at)} WIB (${agoText(age).replace(/ /g, ' ')})`
    : L ? `Data per ${longDate(L.date)}` : state.assets.length ? 'Menunggu harga pertama' : 'Belum ada aset';
  if (state.demo) $('subtitle').textContent = 'Demo · data contoh 1 tahun';
  $('subtitle').classList.toggle('stale', !state.demo && Number.isFinite(at) && age > 12 * 3_600_000); // jadwal 6 jam: lewat 12 jam = ada yang macet
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
  if (mode === 'dash') {
    safely('Header', renderHeader);
    safely('Beranda', beranda.render);
    if (state.route.view === 'aset') safely('Aset', detail.render);
    safely('Analisis', analisis.render);
    safely('Aktivitas', aktivitas.render);
  }
  safely('Profil', profil.render); // Profil tetap hidup walau data gagal dimuat
  reportFailures();
}
subscribe(render);

// ---------- rute: #/beranda, #/aset/<jenis:kode>, #/analisis/<bagian>, #/aktivitas, #/profil ----------

function route(byUser) {
  const [v = '', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const view = VIEWS[v] ? v : 'beranda';
  state.route = { view, sub: rest.join('/') };
  document.body.dataset.route = location.hash.replace(/^#\/?/, ''); // penanda rute selesai diproses (juga dipakai tes)
  const data = mode === 'dash';
  $('dash').hidden = !(data && DATA_VIEWS.includes(view));
  for (const k of DATA_VIEWS) $(`v-${k}`).hidden = !(data && view === k);
  $('v-profil').hidden = !(view === 'profil' && (mode === 'dash' || mode === 'error'));
  setActive(view);
  document.title = mode === 'connect' ? 'Lumbung' : `${NAMES[view]} · Lumbung`;
  if (data || view === 'profil') {
    // nama terpisah: berhasil membuka halaman tidak boleh menghapus laporan gagal menggambar halaman itu
    safely(`${NAMES[view]} (buka)`, () => VIEWS[view].show?.(state.route.sub));
    reportFailures();
  }
  if (byUser) {
    window.scrollTo(0, 0);
    $(`vt-${view}`).focus({ preventScroll: true }); // pembaca layar tahu halaman berganti
  }
}
window.addEventListener('hashchange', () => route(true));

// ---------- keadaan layar ----------

function show(m) { // 'connect' | 'dash' | 'error'
  mode = m;
  $('skeleton').hidden = true;
  $('connect').hidden = m !== 'connect';
  $('nav').hidden = m === 'connect';
  $('actions').hidden = m === 'connect';
  $('privacy').hidden = m !== 'dash';
  if (m !== 'error') $('banner').hidden = true;
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
    if (!d) {
      await whenSaved(); // simpan yang sedang berjalan selesai dulu, supaya hasilnya tidak tertimpa data lama
      const stamp = saveStamp();
      d = await call(creds.url, creds.token, 'list');
      if (saveStamp() !== stamp) { await whenSaved(); d = await call(creds.url, creds.token, 'list'); } // ada simpan baru selama memuat
    }
  } catch (e) {
    if (e.message === 'unauthorized') return showConnect('Kata sandi tidak cocok.', creds.url);
    return fail(`Data tidak bisa dibaca (${e.message}).`, 'Periksa koneksi internet, lalu muat ulang. <a href="#" id="relink">Sambungkan ulang</a>');
  }
  try {
    setData(d); // menghitung tampilan langsung; data berbentuk aneh tidak boleh membuat kerangka pemuatan abadi
  } catch (e) {
    console.error(e);
    return fail(`Data dari Sheet tidak terbaca (${e.message}).`, 'Muat ulang halaman. Bila pesan ini tetap muncul, periksa tab Riwayat di Sheet.');
  }
  mode = 'dash';
  render();
  show('dash'); // menggambar halaman yang diminta lewat rute, sekarang data sudah ada
}

// ---------- interaksi ----------

$('privacy').addEventListener('click', () => setHidden(!state.hidden));

async function reload() {
  if (state.demo) return startDemo(); // demo: buat ulang dari awal
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

// ---------- demo ----------

function startDemo() {
  state.demo = true;
  state.hidden = false; // contoh: tampilkan angkanya (tidak disimpan, pilihanmu di browser ini tidak berubah)
  setData(demoData(todayWib()));
  mode = 'dash';
  render();
  show('dash');
  const b = $('banner');
  b.hidden = false;
  b.className = 'banner';
  b.innerHTML = '<strong>Mode demo.</strong> Semua data contoh dan tidak disimpan. Coba beli, jual, tukar, atau trade emas.';
  renderHeader();
}

async function exitDemo() {
  state.demo = false;
  try { const v = localStorage.getItem('pf-hidden'); state.hidden = v === null ? true : v === '1'; } catch { state.hidden = true; }
  $('banner').hidden = true;
  setData({});
  const c = readCreds();
  if (c) await start(c);
  else showConnect();
}
$('demo-btn').addEventListener('click', startDemo);

$('logout').addEventListener('click', () => {
  if (state.demo) { exitDemo(); return; } // keluar dari demo tidak menghapus kredensial apa pun
  clearCreds();
  setData({});
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
if (new URLSearchParams(location.search).has('demo')) startDemo();
else if (creds) await start(creds);
else showConnect();
