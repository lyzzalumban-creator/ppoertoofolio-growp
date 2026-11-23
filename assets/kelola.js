// Halaman Kelola aset: tambah / ubah / hapus. Daftar disimpan ke Google Sheet lewat Apps Script.
// Validasi memakai modul yang sama dengan robot harian, jadi salah isi ketahuan sekarang, bukan besok pagi.

import { call } from '../scripts/lib/api.mjs';
import { dateInTz, validateHoldings } from '../scripts/lib/portfolio.mjs';
import { readCreds } from './creds.js';

const TYPE = {
  idx: { label: 'Saham IDX', unit: 'lembar', symbol: 'Kode saham (mis. BBCA)', qty: 'Jumlah (lembar, BUKAN lot; 1 lot = 100 lembar)', cost: 'Harga beli rata-rata per lembar (Rp)' },
  us: { label: 'Saham AS', unit: 'saham', symbol: 'Ticker (mis. AAPL)', qty: 'Jumlah saham (boleh pecahan)', cost: 'Harga beli rata-rata per saham (US$)' },
  crypto: { label: 'Kripto', unit: '', symbol: 'Simbol (mis. BTC)', qty: 'Jumlah koin', cost: 'Harga beli rata-rata per koin (Rp)' },
  gold: { label: 'Emas', unit: 'gram', symbol: 'Label (mis. XAU)', qty: 'Jumlah (gram)', cost: 'Harga beli rata-rata per gram (Rp)' },
  manual: { label: 'Lainnya', unit: 'unit', symbol: 'Label (mis. RDPU, DEPO, KAS)', qty: 'Jumlah unit (mis. 1 untuk deposito)', cost: 'Modal per unit' },
};
const NUM = ['qty', 'avgCost', 'price', 'costIdr'];
const TXT = ['symbol', 'name', 'coingeckoId', 'currency', 'yahoo', 'buyDate'];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fNum = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 8 });
const fDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const today = () => dateInTz(Date.now(), 'Asia/Jakarta');

let creds = readCreds();
let assets = [];
let editing = null; // indeks yang diubah, atau null = tambah
let oldScript = false; // kode Apps Script di Sheet belum mengenal kolom baru (mis. tanggal beli)

const status = (m) => { $('status').textContent = m; };

function banner(html, error = true) {
  const b = $('banner');
  b.hidden = false;
  b.className = error ? 'banner error' : 'banner';
  b.innerHTML = html;
}

// ---------- daftar ----------

function renderList() {
  $('assets').innerHTML = assets.map((a, i) => {
    const t = TYPE[a.type] || { label: a.type, unit: '' };
    const qty = `${fNum.format(a.qty)}${t.unit ? ` ${t.unit}` : ''}`;
    return `<li><div class="asset-info"><strong>${esc(a.name || a.symbol)}</strong>
        <small>${esc(t.label)} · ${esc(a.symbol)} · ${esc(qty)} · beli rata-rata ${fNum.format(a.avgCost)}${a.type === 'us' ? ' US$' : ''}${a.buyDate ? ` · dibeli ${fDate.format(Date.parse(`${a.buyDate}T00:00:00Z`))}` : ''}</small></div>
      <div class="row"><button class="btn" type="button" data-edit="${i}">Ubah</button><button class="btn" type="button" data-del="${i}">Hapus</button></div></li>`;
  }).join('') || '<li class="muted">Belum ada aset. Tekan “Tambah aset”.</li>';
  status(`${assets.length} aset tersimpan di Sheet`);
}

async function save(next) {
  if (next.length) validateHoldings({ assets: next }); // melempar error berisi semua masalah; daftar kosong boleh (hapus terakhir)
  await call(creds.url, creds.token, 'saveAssets', { assets: next });
  assets = next;
  renderList();
  status(`Tersimpan (${assets.length} aset). Muncul di dasbor setelah update harga berikutnya.`);
}

$('assets').addEventListener('click', async (e) => {
  const ed = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-del]');
  if (ed) return openForm(Number(ed.dataset.edit));
  if (!del) return;
  const i = Number(del.dataset.del);
  if (!confirm(`Hapus ${assets[i].name || assets[i].symbol}?`)) return;
  del.disabled = true;
  try {
    await save(assets.filter((_, k) => k !== i));
  } catch (err) {
    del.disabled = false;
    status(`Gagal menghapus: ${err.message}`);
  }
});

// ---------- form ----------

function syncType() {
  const t = TYPE[$('f-type').value];
  $('l-symbol').textContent = t.symbol;
  $('l-qty').textContent = t.qty;
  $('l-cost').textContent = t.cost;
  for (const el of document.querySelectorAll('#form [data-for]')) el.hidden = el.dataset.for !== $('f-type').value;
}

function openForm(i) {
  editing = i;
  const a = i == null ? { type: 'idx', currency: 'IDR' } : assets[i];
  $('dlg-h').textContent = i == null ? 'Tambah aset' : 'Ubah aset';
  $('f-type').value = a.type;
  for (const k of [...TXT, ...NUM]) $(`f-${k}`).value = a[k] ?? '';
  if (!$('f-currency').value) $('f-currency').value = 'IDR';
  $('f-err').hidden = true;
  $('save').disabled = false;
  $('f-buyDate').max = today(); // pemilih tanggal tidak menawarkan masa depan
  $('form').querySelector('.adv').open = a.costIdr != null || !!a.yahoo;
  syncType();
  $('dlg').showModal();
  $('f-symbol').focus();
}

function readForm() {
  const a = { type: $('f-type').value };
  for (const k of TXT) { const v = $(`f-${k}`).value.trim(); if (v) a[k] = v; }
  for (const k of NUM) { const v = $(`f-${k}`).valueAsNumber; if (Number.isFinite(v)) a[k] = v; }
  // Kolom yang tidak relevan untuk jenis ini tidak ikut disimpan.
  if (a.type !== 'crypto') delete a.coingeckoId;
  if (a.type !== 'manual') { delete a.price; delete a.currency; }
  if (a.type === 'gold' && !a.symbol) a.symbol = 'XAU';
  if (oldScript) delete a.buyDate; // skrip lama membuang kolom ini diam-diam; jangan berpura-pura menyimpannya
  return a;
}

$('f-type').addEventListener('change', syncType);
$('add').addEventListener('click', () => openForm(null));
$('cancel').addEventListener('click', () => $('dlg').close());

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const item = readForm();
  const err = (m) => { $('f-err').hidden = false; $('f-err').textContent = m; };
  if (item.buyDate && item.buyDate > today()) return err('Tanggal beli tidak boleh di masa depan.');
  const next = editing == null ? [...assets, item] : assets.map((a, i) => (i === editing ? item : a));
  $('save').disabled = true; // cegah kirim dobel
  try {
    await save(next);
    $('dlg').close();
  } catch (ex) {
    $('save').disabled = false;
    err(ex.message === 'unauthorized' ? 'Kata sandi tidak cocok lagi. Sambungkan ulang dari dasbor.' : ex.message.replace(/^holdings tidak valid:\n/, ''));
  }
});

// ---------- mulai ----------

async function start() {
  if (!creds) {
    status('Belum tersambung');
    return banner('Belum tersambung ke Sheet. <a href="index.html">Buka dasbor</a> dan sambungkan dulu.');
  }
  try {
    const d = await call(creds.url, creds.token, 'list');
    assets = d.assets;
    oldScript = !(d.version >= 2);
  } catch (e) {
    status('Gagal memuat');
    return banner(e.message === 'unauthorized'
      ? 'Kata sandi tidak cocok lagi. <a href="index.html">Sambungkan ulang dari dasbor</a>.'
      : `Data tidak bisa dibaca (${esc(e.message)}). Periksa koneksi, lalu muat ulang.`);
  }
  $('list-card').hidden = false;
  if (oldScript) {
    $('buy-field').hidden = true;
    banner('Kode Apps Script di Sheet-mu masih versi lama, jadi <strong>tanggal beli belum bisa disimpan</strong>. Tempel <code>Code.gs</code> terbaru, lalu <em>Deploy → Manage deployments → Edit → New version → Deploy</em> (langkahnya ada di README).', false);
  }
  renderList();
}

await start();
