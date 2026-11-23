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
            let stored = v;
            if (typeof v === 'string') stored = v.startsWith("'") ? v.slice(1) : /^[=+\-@]/.test(v) ? '#FORMULA!' : v;
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
    }) },
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
