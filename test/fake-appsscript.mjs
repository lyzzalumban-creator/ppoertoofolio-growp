// Menjalankan apps-script/Code.gs APA ADANYA di atas tiruan SpreadsheetApp/PropertiesService/ContentService.
// Tiruan ini hanya memodelkan metode yang dipakai Code.gs; BUKAN bukti perilaku Google yang asli.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CODE = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

class FakeSheet {
  constructor() { this.rows = []; }
  appendRow(r) { this.rows.push([...r]); }
  getLastRow() { return this.rows.length; }
  getDataRange() { return { getValues: () => this.rows.map((r) => [...r]) }; }
  getRange(r, c, nr, nc) {
    const self = this;
    return {
      setValues(vals) {
        if (vals.length !== nr || vals.some((row) => row.length !== nc)) throw new Error('ukuran setValues tidak cocok');
        vals.forEach((row, i) => {
          self.rows[r - 1 + i] = self.rows[r - 1 + i] || [];
          row.forEach((v, j) => {
            // Seperti input pengguna di Sheets: awalan = + - @ dibaca sebagai RUMUS (nilainya bukan teks asli),
            // kecuali diberi apostrof di depan, yang membuatnya teks biasa (apostrofnya tidak tersimpan).
            // Teks mirip tanggal (YYYY-MM-DD) tanpa apostrof juga diubah Sheets menjadi tanggal, pada tengah malam
            // di zona waktu Sheet (di sini Asia/Jakarta, UTC+7); apostrof membuatnya tetap teks.
            let stored = v;
            if (typeof v === 'string') {
              if (v.startsWith("'")) stored = v.slice(1);
              else if (/^[=+\-@]/.test(v)) stored = '#FORMULA!';
              else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) stored = new Date(`${v}T00:00:00+07:00`);
            }
            self.rows[r - 1 + i][c - 1 + j] = stored;
          });
        });
      },
      clearContent() {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (self.rows[r - 1 + i]) self.rows[r - 1 + i][c - 1 + j] = '';
      },
    };
  }
}

/** Buat satu "spreadsheet" baru lengkap dengan kode Apps Script-nya. */
export function createFake({ token = 'rahasia-panjang' } = {}) {
  const sheets = new Map();
  const ctx = {
    SpreadsheetApp: { getActive: () => ({
      getSheetByName: (n) => sheets.get(n) || null,
      insertSheet: (n) => { const s = new FakeSheet(); sheets.set(n, s); return s; },
      getSpreadsheetTimeZone: () => 'Asia/Jakarta',
    }) },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        if (fmt !== 'yyyy-MM-dd') throw new Error(`format ${fmt} tidak ditiru`);
        return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'TOKEN' ? token : null) }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }),
    },
  };
  vm.createContext(ctx);
  // const/function pada skrip tingkat atas tidak jadi properti global di vm; ekspor lewat satu ekspresi.
  vm.runInContext(`${CODE}\nthis.__doPost = doPost;`, ctx);

  return {
    sheets,
    /** Panggil seperti web app: kirim JSON, terima objek hasil. */
    call(payload) {
      const out = ctx.__doPost({ postData: { contents: typeof payload === 'string' ? payload : JSON.stringify(payload) } });
      return JSON.parse(out.text);
    },
    token,
  };
}
