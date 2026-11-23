// Logika murni (tanpa jaringan, tanpa file): validasi aset, hitung snapshot harian,
// dan versi "persentase saja" untuk situs publik. Dipisah supaya mudah dites.

export const TYPES = ['idx', 'us', 'crypto', 'gold', 'manual'];

const DEFAULT_CURRENCY = { idx: 'IDR', us: 'USD', crypto: 'IDR', gold: 'IDR', manual: 'IDR' };

export const currencyOf = (a) => (a.type === 'manual' ? a.currency || 'IDR' : DEFAULT_CURRENCY[a.type]);
export const keyOf = (a) => `${a.type}:${a.symbol}`;

const round = (n, d) => {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** Tanggal YYYY-MM-DD di zona waktu tertentu. */
export function dateInTz(ms, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** Lempar error berisi SEMUA masalah sekaligus, supaya mudah diperbaiki sekali jalan. */
export function validateHoldings(h) {
  const errs = [];
  if (!h || !Array.isArray(h.assets) || h.assets.length === 0) {
    throw new Error('holdings tidak valid: "assets" harus berisi minimal satu aset');
  }
  const seen = new Set();
  h.assets.forEach((a, i) => {
    const where = `assets[${i}]${a && a.symbol ? ` (${a.symbol})` : ''}`;
    if (!a || typeof a !== 'object') return errs.push(`${where}: harus berupa objek`);
    if (!TYPES.includes(a.type)) errs.push(`${where}: type harus salah satu dari ${TYPES.join(', ')}`);
    if (!a.symbol || typeof a.symbol !== 'string') errs.push(`${where}: symbol wajib diisi`);
    if (!(typeof a.qty === 'number' && a.qty > 0)) errs.push(`${where}: qty harus angka lebih dari 0`);
    if (!(typeof a.avgCost === 'number' && a.avgCost >= 0)) errs.push(`${where}: avgCost harus angka 0 atau lebih`);
    if (a.costIdr != null && !(typeof a.costIdr === 'number' && a.costIdr >= 0)) errs.push(`${where}: costIdr harus angka 0 atau lebih`);
    if (a.type === 'crypto' && !a.coingeckoId) errs.push(`${where}: aset kripto butuh coingeckoId (mis. "bitcoin")`);
    if (a.type === 'manual' && !(typeof a.price === 'number' && a.price >= 0)) errs.push(`${where}: aset manual butuh price (harga per unit)`);
    if (a.type === 'manual' && a.currency && !['IDR', 'USD'].includes(a.currency)) errs.push(`${where}: currency harus IDR atau USD`);
    const k = keyOf(a);
    if (seen.has(k)) errs.push(`${where}: duplikat (${k}), gabungkan jadi satu baris`);
    seen.add(k);
  });
  const publish = (h.settings && h.settings.publish) || 'full';
  if (!['full', 'percent'].includes(publish)) errs.push('settings.publish harus "full" atau "percent"');
  if (errs.length) throw new Error(`holdings tidak valid:\n- ${errs.join('\n- ')}`);
  return h;
}

/**
 * Hitung snapshot satu hari.
 * @param {object}  p
 * @param {string}  p.date    YYYY-MM-DD
 * @param {Array}   p.assets  daftar aset (sudah tervalidasi)
 * @param {Map}     p.quotes  keyOf(aset) -> { price (mata uang asli), asOf, stale? }
 * @param {number}  p.fx      kurs USD->IDR (boleh null bila tidak ada aset USD)
 * @param {object}  p.prev    snapshot hari sebelumnya (untuk perubahan harian), opsional
 */
export function buildSnapshot({ date, assets, quotes, fx, prev }) {
  const prevPos = new Map(((prev && prev.positions) || []).map((p) => [`${p.type}:${p.symbol}`, p]));
  const toIdr = (v, cur) => (cur === 'USD' ? v * fx : v);

  let total = 0;
  let cost = 0;
  let dayPnl = 0;
  let dayBase = 0;

  const rows = assets.map((a) => {
    const cur = currencyOf(a);
    const q = quotes.get(keyOf(a));
    if (!q) throw new Error(`Harga untuk ${keyOf(a)} tidak tersedia`);
    if (cur === 'USD' && !(fx > 0)) throw new Error(`Kurs USD/IDR dibutuhkan untuk ${keyOf(a)}`);

    const priceIdr = toIdr(q.price, cur);
    const value = a.qty * priceIdr;
    // costIdr (opsional) = total modal dalam rupiah, memperhitungkan kurs saat beli.
    const c = a.costIdr != null ? a.costIdr : a.qty * toIdr(a.avgCost, cur);

    // Perubahan harian dihitung dari pergerakan HARGA saja (bukan selisih total),
    // supaya setoran/penarikan dana tidak terbaca sebagai untung/rugi.
    const pp = prevPos.get(keyOf(a));
    let dayPct = null;
    if (pp && pp.priceIdr > 0) {
      dayPct = priceIdr / pp.priceIdr - 1;
      dayPnl += a.qty * (priceIdr - pp.priceIdr);
      dayBase += a.qty * pp.priceIdr;
    }

    total += value;
    cost += c;
    return {
      type: a.type,
      symbol: a.symbol,
      name: a.name || a.symbol,
      qty: a.qty,
      price: q.price,
      currency: cur,
      priceIdr,
      value,
      cost: c,
      pnl: value - c,
      pnlPct: c > 0 ? (value - c) / c : null,
      dayPct,
      asOf: q.asOf,
      ...(q.stale ? { stale: true } : {}),
    };
  });

  rows.sort((x, y) => y.value - x.value);
  rows.forEach((p) => {
    p.weight = total > 0 ? p.value / total : 0;
  });

  const byType = {};
  for (const t of TYPES) {
    const sel = rows.filter((p) => p.type === t);
    if (!sel.length) continue;
    const v = sel.reduce((s, p) => s + p.value, 0);
    byType[t] = { value: round(v, 2), weight: round(total > 0 ? v / total : 0, 6) };
  }

  return {
    date,
    fx: fx == null ? null : round(fx, 4),
    total: round(total, 2),
    cost: round(cost, 2),
    pnl: round(total - cost, 2),
    pnlPct: round(cost > 0 ? (total - cost) / cost : null, 6),
    dayPnl: round(dayBase > 0 ? dayPnl : null, 2),
    dayPct: round(dayBase > 0 ? dayPnl / dayBase : null, 6),
    byType,
    positions: rows.map((p) => ({
      ...p,
      price: round(p.price, 6),
      priceIdr: round(p.priceIdr, 4),
      value: round(p.value, 2),
      cost: round(p.cost, 2),
      pnl: round(p.pnl, 2),
      pnlPct: round(p.pnlPct, 6),
      dayPct: round(p.dayPct, 6),
      weight: round(p.weight, 6),
    })),
  };
}

/**
 * Versi publik tanpa nominal rupiah: tidak ada total, modal, jumlah unit, atau nilai.
 * Yang tersisa hanya harga pasar (memang publik), bobot, dan persentase.
 */
export function redact(s) {
  const out = {
    date: s.date,
    fx: s.fx,
    pnlPct: s.pnlPct,
    dayPct: s.dayPct,
    byType: Object.fromEntries(Object.entries(s.byType || {}).map(([k, v]) => [k, { weight: v.weight }])),
  };
  if (s.positions) {
    out.positions = s.positions.map((p) => ({
      type: p.type,
      symbol: p.symbol,
      name: p.name,
      // Harga pasar itu publik, tapi "harga" aset manual adalah angka yang kamu ketik sendiri
      // (saldo deposito, nilai reksa dana, dst) dan sering sama persis dengan nilai kepemilikan.
      ...(p.type === 'manual' ? {} : { price: p.price, priceIdr: p.priceIdr }),
      currency: p.currency,
      weight: p.weight,
      pnlPct: p.pnlPct,
      dayPct: p.dayPct,
      asOf: p.asOf,
      ...(p.stale ? { stale: true } : {}),
    }));
  }
  return out;
}

/** Tambah/ganti snapshot per tanggal (aman dijalankan ulang di hari yang sama). */
export function upsertSnapshot(snapshots, snap) {
  const rest = snapshots.filter((s) => s.date !== snap.date);
  rest.push(snap);
  rest.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rest;
}

/** Buang rincian per aset dari snapshot lama supaya file tidak membengkak. */
export function pruneOld(snapshots, keep = 90) {
  const cut = snapshots.length - keep;
  return snapshots.map((s, i) => {
    if (i >= cut || !s.positions) return s;
    const { positions, ...rest } = s;
    return rest;
  });
}
