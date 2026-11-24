// Hitungan kinerja dari riwayat snapshot. Murni (tanpa DOM), jadi bisa dites di Node.
import { buildSnapshot, currencyOf, keyOf } from '../scripts/lib/portfolio.mjs';
// dayPct tiap snapshot = perubahan HARGA aset yang dipegang sejak snapshot sebelumnya, jadi
// menambah atau menjual aset tidak terbaca sebagai untung/rugi (return tertimbang waktu).

/** Indeks return berantai, bernilai 1 pada snapshot pertama. */
export function returnIndex(snaps) {
  let idx = 1;
  return snaps.map((s, i) => {
    if (i > 0 && Number.isFinite(s.dayPct)) idx *= 1 + s.dayPct;
    return { date: s.date, idx };
  });
}

/**
 * Return tiap bulan kalender: [{ month: 'YYYY-MM', from, to, ret, pnl }], urut lama -> baru.
 * pnl = jumlah perubahan harian dalam rupiah (dayPnl) bulan itu: hanya gerak harga, tanpa setoran/jual-beli.
 */
export function monthlyReturns(snaps) {
  const months = [];
  returnIndex(snaps).forEach((p, i) => {
    const m = p.date.slice(0, 7);
    const last = months[months.length - 1];
    const d = Number.isFinite(snaps[i].dayPnl) ? snaps[i].dayPnl : 0;
    if (last && last.month === m) {
      last.to = p.date;
      last.end = p.idx;
      last.pnl += d;
    } else {
      // Bulan baru diukur dari akhir bulan sebelumnya; bulan pertama dari snapshot pertama.
      months.push({ month: m, from: p.date, to: p.date, base: last ? last.end : p.idx, end: p.idx, pnl: d });
    }
  });
  return months.map(({ month, from, to, base, end, pnl }) => ({ month, from, to, ret: end / base - 1, pnl }));
}

/** Penurunan terdalam dari puncak ke lembah: { pct (<= 0), from (puncak), to (lembah) }. */
export function maxDrawdown(index) {
  const out = { pct: 0, from: null, to: null };
  let peak = index[0];
  for (const p of index) {
    if (p.idx > peak.idx) peak = p;
    const dd = p.idx / peak.idx - 1;
    if (dd < out.pct) Object.assign(out, { pct: dd, from: peak.date, to: p.date });
  }
  return out;
}

const label = (p) => String(p.name || p.symbol);
// Persentase kosong (mis. modal 0) selalu di bawah; seri diurutkan menurut nilai.
const byPct = (k) => (a, b) => (a[k] == null) - (b[k] == null) || (b[k] ?? 0) - (a[k] ?? 0) || b.value - a.value;
const SORTS = {
  value: (a, b) => b.value - a.value,
  pnlPct: byPct('pnlPct'),
  dayPct: byPct('dayPct'),
  name: (a, b) => label(a).localeCompare(label(b), 'id', { sensitivity: 'base' }),
};

/** Salinan terurut; kunci tak dikenal = urut nilai. */
export function sortPositions(rows, key) {
  return [...rows].sort(SORTS[key] || SORTS.value);
}

// ---------- halaman depan ----------

// Ambang konsentrasi. Kas dan aset "manual" (deposito, reksa dana pasar uang) tidak dihitung: dominannya bukan risiko pasar.
const SAFE = ['cash', 'manual'];
export const LIMIT = { asset: 0.3, type: 0.6 };

/** Peringatan dari snapshot terbaru: [{ id, text }], paling penting dulu. Hanya persen, tanpa nominal. */
export function insights(snap, labels, pctText) {
  const out = [];
  const pos = (snap.positions || []).filter((p) => !SAFE.includes(p.type));
  const top = [...pos].sort((a, b) => b.weight - a.weight)[0];
  if (top && top.weight >= LIMIT.asset) out.push({ id: `asset:${top.type}:${top.symbol}`, text: `${top.name || top.symbol} menguasai ${pctText(top.weight)} dari total. Satu aset terlalu besar membuat portofolio mudah goyah.` });
  const bt = Object.entries(snap.byType || {}).filter(([t]) => !SAFE.includes(t)).sort((a, b) => b[1].weight - a[1].weight)[0];
  if (bt && bt[1].weight >= LIMIT.type) out.push({ id: `type:${bt[0]}`, text: `Alokasi condong ke ${labels[bt[0]] || bt[0]} (${pctText(bt[1].weight)}). Pertimbangkan jenis lain agar lebih seimbang.` });
  const stale = (snap.positions || []).filter((p) => p.stale).length; // semua jenis, termasuk manual
  if (stale) out.push({ id: 'stale', text: `${stale} aset memakai harga lama karena gagal diambil. Nilai total bisa meleset.` });
  return out;
}

/** Kemajuan menuju target: pecahan 0..1 (dibatasi), atau null bila target belum valid. */
export function goalProgress(total, goal) {
  if (!(goal > 0) || !Number.isFinite(total)) return null;
  return Math.min(1, Math.max(0, total / goal));
}

// ---------- analisis: risiko, konsentrasi, per jenis ----------

export const MIN_RISK_DAYS = 14;

/** Statistik risiko dari return harian (dayPct); null bila datanya belum cukup untuk dipercaya. */
export function riskStats(snaps) {
  const d = snaps.filter((s) => Number.isFinite(s.dayPct)).map((s) => ({ date: s.date, r: s.dayPct }));
  if (d.length < MIN_RISK_DAYS) return null;
  const mean = d.reduce((a, x) => a + x.r, 0) / d.length;
  const sd = Math.sqrt(d.reduce((a, x) => a + (x.r - mean) ** 2, 0) / (d.length - 1));
  const pick = (better) => d.reduce((a, x) => (better(x.r, a.r) ? x : a));
  const best = pick((x, y) => x > y);
  const worst = pick((x, y) => x < y);
  return {
    days: d.length,
    vol: sd * Math.sqrt(365), // snapshot ada tiap hari kalender, jadi 365, bukan 252
    best: { date: best.date, pct: best.r },
    worst: { date: worst.date, pct: worst.r },
    up: d.filter((x) => x.r > 0).length,
    down: d.filter((x) => x.r < 0).length,
    flat: d.filter((x) => x.r === 0).length,
  };
}

/** Jarak nilai terakhir dari puncaknya: { pct (<= 0), peak (tanggal puncak) }. Butuh indeks tak kosong. */
export function currentDrawdown(index) {
  let peak = index[0];
  for (const p of index) if (p.idx > peak.idx) peak = p;
  return { pct: index[index.length - 1].idx / peak.idx - 1, peak: peak.date };
}

/** Seberapa menumpuk: porsi 3 aset terbesar, dan "setara N aset berbobot sama" (1 / jumlah bobot kuadrat). */
export function concentration(rows) {
  const w = rows.map((p) => p.weight).filter((x) => x > 0);
  const sum = w.reduce((a, b) => a + b, 0);
  if (!sum) return null;
  const n = w.map((x) => x / sum).sort((a, b) => b - a);
  return { top3: n.slice(0, 3).reduce((a, b) => a + b, 0), effective: 1 / n.reduce((a, x) => a + x * x, 0) };
}

/** Nilai, modal, dan untung/rugi per jenis aset: { jenis: { value, cost, count, pnl, pnlPct } }. */
export function byTypePnl(rows) {
  const out = {};
  for (const p of rows) {
    const t = (out[p.type] ||= { value: 0, cost: 0, count: 0 });
    t.value += p.value;
    t.cost += p.cost;
    t.count += 1;
  }
  for (const t of Object.values(out)) {
    t.pnl = t.value - t.cost;
    t.pnlPct = t.cost > 0 ? t.pnl / t.cost : null;
  }
  return out;
}

/** Kas dan yang diinvestasikan (total di luar kas): { cash, invested, weight (porsi kas, 0..1) }. */
export function cashSplit(snap) {
  const cash = (snap.byType && snap.byType.cash && snap.byType.cash.value) || 0;
  return { cash, invested: snap.total - cash, weight: snap.total > 0 ? cash / snap.total : 0 };
}

// ---------- tampilan langsung ----------

/**
 * Snapshot "sekarang" dari daftar aset di Sheet + harga terakhir yang diketahui, memakai fungsi yang sama dengan robot.
 * Dengan ini aset yang baru ditambah, dibeli, atau dijual langsung tampil tanpa menunggu robot berikutnya.
 * Aset tanpa harga (baru ditambah, robot belum jalan) dikembalikan di `pending`.
 * @returns {{ snap: object|null, pending: object[] }}
 */
export function liveView(assets, snaps, today) {
  const L = snaps[snaps.length - 1];
  const P = snaps[snaps.length - 2];
  const known = new Map(((L && L.positions) || []).map((p) => [keyOf(p), p]));
  const fx = L ? L.fx : null;
  const priced = [];
  const pending = [];
  for (const a of assets) {
    const cur = currencyOf(a);
    const p = known.get(keyOf(a));
    let q = null;
    if (a.type === 'cash') q = { price: 1 };
    else if (a.type === 'manual' && Number.isFinite(a.price)) q = { price: a.price };
    else if (p && Number.isFinite(p.price) && (p.currency || cur) === cur) q = { price: p.price, asOf: p.asOf, ...(p.stale ? { stale: true } : {}) };
    if (q && cur === 'USD' && !(fx > 0)) q = null; // aset dolar butuh kurs
    if (q) priced.push([a, { asOf: L ? L.date : today, ...q }]);
    else pending.push(a);
  }
  if (!priced.length) return { snap: null, pending };
  const snap = buildSnapshot({ date: L ? L.date : today, assets: priced.map((x) => x[0]), quotes: new Map(priced.map(([a, q]) => [keyOf(a), q])), fx, prev: P });
  if (L && L.at) snap.at = L.at;
  return { snap, pending };
}
