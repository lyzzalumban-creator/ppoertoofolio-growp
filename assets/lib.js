// Bagian bersama semua tampilan: konstanta, pemformat, dan keadaan.
// Tanpa framework: tiap tampilan menggambar dirinya dari `state`; perubahan (simpan, jual, sembunyikan nominal)
// diumumkan lewat notify() dan app.js menggambar ulang semuanya.

export const TYPE = {
  idx: { label: 'Saham IDX', unit: 'lembar' },
  us: { label: 'Saham AS', unit: 'saham' },
  crypto: { label: 'Kripto', unit: '' },
  gold: { label: 'Emas', unit: 'gram' },
  cash: { label: 'Kas', unit: '' },
  manual: { label: 'Lainnya', unit: 'unit' },
};
export const ORDER = Object.keys(TYPE);
// Jenis yang belum dikenal versi ini (mis. HP masih memegang web lama dari cache, sementara robot sudah menulis jenis baru)
// tetap tampil dengan label apa adanya dan warna netral, bukan membuat seluruh dasbor berhenti.
export const typeOf = (t) => TYPE[t] || { label: String(t || 'Lainnya'), unit: '' };
export const colorOf = (t) => `var(--c-${TYPE[t] ? t : 'manual'})`;
/** Urutan tampil jenis-jenis yang ada di data: yang dikenal menurut ORDER, sisanya di belakang. */
export const typesIn = (keys) => [...ORDER.filter((t) => keys.includes(t)), ...keys.filter((t) => !TYPE[t])];

export const MASK = '••••••';
export const DAY = 86_400_000;

export const ICON = {
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17.4v.1"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
};

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const fIdr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
export const fUsd = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'USD' });
export const fNum = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 8 });
export const fCompact = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });
const fDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fDay = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const fMonth = new Intl.DateTimeFormat('id-ID', { month: 'short', year: '2-digit', timeZone: 'UTC' });
export const fMonthLong = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const fAtDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' });
export const fAtTime = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' });

export const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
// Tanggal tak sah (mis. format aneh dari Sheet) tampil apa adanya, bukan melempar galat yang menghentikan halaman.
export const longDate = (iso) => (Number.isFinite(toMs(iso)) ? fDate.format(toMs(iso)) : String(iso ?? ''));
export const monthName = (m) => fMonthLong.format(toMs(`${m}-01`));
export const todayWib = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// "2 jam lalu": penanda kesegaran; bila terlalu lama, jadwal otomatis mungkin berhenti (mis. dimatikan GitHub).
export function agoText(ms) {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} jam lalu` : `${Math.floor(h / 24)} hari lalu`;
}

export const state = {
  assets: [], snapshots: [], txs: [], meta: {},
  series: [], pending: [], perf: null, // series = riwayat robot dengan hari terakhir diganti tampilan langsung
  hidden: true, goal: null,
  route: { view: 'beranda', sub: '' },
  range: 'Semua', arange: 'Semua', sort: 'value', q: '', filter: '', histN: 30,
};

// Privasi dulu: pada kunjungan pertama nominal tersembunyi; pilihanmu diingat di browser ini.
try { const v = localStorage.getItem('pf-hidden'); state.hidden = v === null ? true : v === '1'; } catch { state.hidden = true; }
// Target nilai: preferensi per perangkat (seperti pf-hidden), tidak dikirim ke Sheet.
try { const g = Number(localStorage.getItem('pf-goal')); state.goal = g > 0 ? g : null; } catch { state.goal = null; }

export const latest = () => state.series[state.series.length - 1];
export const canTrade = () => state.meta.version >= 3; // Code.gs versi 3: tab Transaksi

const subs = [];
export const subscribe = (fn) => subs.push(fn);
export const notify = () => subs.forEach((fn) => fn());

export function setHidden(v) {
  state.hidden = v;
  try { localStorage.setItem('pf-hidden', v ? '1' : '0'); } catch { /* abaikan */ }
  notify();
}

// ---------- pemformat ----------

export function money(v, { sign = false } = {}) {
  if (v == null || !Number.isFinite(v)) return '–';
  if (state.hidden) return MASK;
  const s = fIdr.format(Math.abs(v));
  if (v < 0) return `−${s}`;
  return sign && v > 0 ? `+${s}` : s;
}

export function pct(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '–';
  const n = Math.abs(v * 100).toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${n}%`;
}

export const tone = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'flat');
export const arrow = (v) => (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '');
// Arah ditulis dengan panah dan tanda +/−, bukan hanya warna.
export const delta = (v, digits) => (v == null || !Number.isFinite(v) ? '<span class="flat">–</span>' : `<span class="${tone(v)}">${arrow(v)}${pct(v, digits)}</span>`);
export const weightText = (w) => `${(w * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;

// Kode aset pasar selalu huruf besar di tampilan (mis. "panw" -> PANW); label aset manual dan kas dibiarkan.
export const symDisp = (p) => (p.type === 'manual' || p.type === 'cash' ? p.symbol : String(p.symbol).toUpperCase());
export const assetName = (p) => (p.name && p.name !== p.symbol ? p.name : symDisp(p));
export const keyOf = (a) => `${a.type}:${a.symbol}`;
export const assetHref = (a) => `#/aset/${encodeURIComponent(keyOf(a))}`;

// Lama dimiliki sampai tanggal data terakhir, dalam satuan yang enak dibaca.
export function heldText(buyDate) {
  const end = latest() ? latest().date : todayWib();
  const d = Math.floor((toMs(end) - toMs(buyDate)) / DAY);
  if (!Number.isFinite(d) || d < 0) return '';
  if (d === 0) return 'hari ini';
  return d < 60 ? `${d} hari` : d < 730 ? `${Math.floor(d / 30.44)} bln` : `${(d / 365.25).toLocaleString('id-ID', { maximumFractionDigits: 1 })} thn`;
}

export const tile = (label, value, note) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="note">${note}</div></div>`;

// Pesan singkat di bawah layar (mis. "Tersimpan"). role=status: dibacakan pembaca layar.
let toastT = 0;
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 4000);
}
