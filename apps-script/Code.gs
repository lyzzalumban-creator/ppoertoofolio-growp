// Pintu data portofolio. Web dan robot harian memanggil ini; Google Sheet hanya tempat penyimpanan.
//
// Pasang: di Google Sheet buka Extensions > Apps Script, tempel seluruh file ini,
// lalu Project Settings > Script properties > tambah TOKEN (kata sandi panjang).
// Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone.
// Tab "Aset" dan "Riwayat" dibuat otomatis.

const COLS = ['type', 'symbol', 'name', 'qty', 'avgCost', 'coingeckoId', 'price', 'currency', 'costIdr', 'yahoo', 'buyDate'];
const TEXT = ['type', 'symbol', 'name', 'coingeckoId', 'currency', 'yahoo', 'buyDate'];
// Naikkan bila format data berubah; web memeriksanya agar tidak mengirim kolom yang belum dikenal skrip lama.
const VERSION = 2;

// shortcut: kata sandi dibandingkan biasa (bukan constant-time) dan tanpa batas percobaan, cukup untuk
// satu pemilik dengan kata sandi panjang; tambahkan penundaan/penguncian bila URL ini bocor.
function doPost(e) {
  let body;
  try {
    const req = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || req.token !== token) body = { error: 'unauthorized' };
    else if (!Object.prototype.hasOwnProperty.call(ACTIONS, req.action)) body = { error: 'aksi tidak dikenal' };
    else body = Object.assign({ ok: true }, ACTIONS[req.action](req));
  } catch (err) {
    body = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

const ACTIONS = {
  // Dasbor dan robot membaca semuanya sekaligus.
  list: () => ({ version: VERSION, assets: readAssets(), history: readHistory() }),

  // Halaman Kelola mengirim seluruh daftar aset. shortcut: yang terakhir menyimpan menang (satu pengguna).
  saveAssets: (req) => {
    if (!Array.isArray(req.assets) || req.assets.length > 500) throw new Error('assets harus berupa daftar (maks 500)');
    const rows = req.assets.map((a) => COLS.map((c) => safe(a[c], c)));
    put(tab('Aset', COLS), [COLS].concat(rows), COLS.length);
    return { saved: rows.length };
  },

  // Robot harian menambah/mengganti snapshot satu tanggal.
  appendSnapshot: (req) => {
    const s = req.snapshot;
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) throw new Error('snapshot.date harus YYYY-MM-DD');
    const sh = tab('Riwayat', ['json']);
    const all = readHistory();
    const i = all.findIndex((x) => x.date === s.date);
    if (i >= 0) all[i] = s;
    else all.push(s);
    all.sort((a, b) => (a.date < b.date ? -1 : 1));
    // shortcut: rincian per aset hanya 2 hari terakhir (cukup untuk perubahan harian & harga cadangan);
    // satu sel Sheet maksimal 50.000 karakter, sekitar 150 aset per snapshot.
    all.forEach((x, k) => { if (k < all.length - 2) delete x.positions; });
    put(sh, [['json']].concat(all.map((x) => [JSON.stringify(x)])), 1);
    return { days: all.length };
  },
};

function readAssets() {
  return tab('Aset', COLS).getDataRange().getValues().slice(1)
    .filter((r) => r[0] !== '')
    .map((r) => {
      const a = {};
      COLS.forEach((c, i) => {
        const v = r[i];
        if (v === '' || v == null) return; // kosong, atau kolom yang belum ada di baris lama (undefined)
        a[c] = c === 'buyDate' ? dateText(v) : TEXT.indexOf(c) >= 0 ? String(v) : v;
      });
      return a;
    });
}

function readHistory() {
  return tab('Riwayat', ['json']).getDataRange().getValues().slice(1)
    .filter((r) => r[0] !== '')
    .map((r) => JSON.parse(r[0]));
}

function tab(name, header) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
  }
  return sh;
}

// Tulis dulu, baru hapus sisa baris lama: bila terhenti di tengah, data lama tidak hilang.
function put(sh, values, width) {
  const old = sh.getLastRow();
  sh.getRange(1, 1, values.length, width).setValues(values);
  if (old > values.length) sh.getRange(values.length + 1, 1, old - values.length, width).clearContent();
}

// Tanggal yang diketik langsung di Sheet menjadi objek Date; kembalikan ke teks YYYY-MM-DD (zona waktu Sheet).
function dateText(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  return String(v);
}

// Teks berawalan = + - @ dibaca Sheets sebagai rumus, dan teks mirip tanggal diubah jadi tanggal;
// apostrof di depan menjaganya tetap teks (apostrofnya sendiri tidak tersimpan).
function safe(v, col) {
  if (v === undefined || v === null || v === '') return '';
  if (col === 'buyDate') return "'" + v;
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}
