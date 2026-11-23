// Hitungan kinerja dari riwayat snapshot. Murni (tanpa DOM), jadi bisa dites di Node.
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

/** Return tiap bulan kalender: [{ month: 'YYYY-MM', from, to, ret }], urut lama -> baru. */
export function monthlyReturns(snaps) {
  const months = [];
  for (const p of returnIndex(snaps)) {
    const m = p.date.slice(0, 7);
    const last = months[months.length - 1];
    if (last && last.month === m) {
      last.to = p.date;
      last.end = p.idx;
    } else {
      // Bulan baru diukur dari akhir bulan sebelumnya; bulan pertama dari snapshot pertama.
      months.push({ month: m, from: p.date, to: p.date, base: last ? last.end : p.idx, end: p.idx });
    }
  }
  return months.map(({ month, from, to, base, end }) => ({ month, from, to, ret: end / base - 1 }));
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
export const SORT_KEYS = Object.keys(SORTS);

/** Salinan terurut; kunci tak dikenal = urut nilai. */
export function sortPositions(rows, key) {
  return [...rows].sort(SORTS[key] || SORTS.value);
}

// ---------- halaman depan ----------

/** Perubahan hari ini per aset (rupiah, dari dayPct); naik/turun terbanyak, maks. n per sisi. */
export function dayMovers(rows, n = 3) {
  const moved = rows
    .filter((p) => Number.isFinite(p.dayPct) && p.dayPct !== 0)
    .map((p) => ({ ...p, dayAmt: p.value - p.value / (1 + p.dayPct) }));
  return {
    gainers: moved.filter((p) => p.dayPct > 0).sort((a, b) => b.dayPct - a.dayPct).slice(0, n),
    losers: moved.filter((p) => p.dayPct < 0).sort((a, b) => a.dayPct - b.dayPct).slice(0, n),
  };
}

// Ambang konsentrasi. Aset "manual" (kas, deposito, reksa dana pasar uang) tidak dihitung: dominannya bukan risiko pasar.
export const LIMIT = { asset: 0.3, type: 0.6 };

/** Peringatan dari snapshot terbaru: [{ id, text }], paling penting dulu. Hanya persen, tanpa nominal. */
export function insights(snap, labels, pctText) {
  const out = [];
  const pos = (snap.positions || []).filter((p) => p.type !== 'manual');
  const top = [...pos].sort((a, b) => b.weight - a.weight)[0];
  if (top && top.weight >= LIMIT.asset) out.push({ id: `asset:${top.type}:${top.symbol}`, text: `${top.name || top.symbol} menguasai ${pctText(top.weight)} dari total. Satu aset terlalu besar membuat portofolio mudah goyah.` });
  const bt = Object.entries(snap.byType || {}).filter(([t]) => t !== 'manual').sort((a, b) => b[1].weight - a[1].weight)[0];
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
