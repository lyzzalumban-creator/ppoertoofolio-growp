// Mengisi tiruan Apps Script dengan aset contoh + riwayat 150 hari (random walk tetap) lewat aksi aslinya.
import { buildSnapshot, keyOf } from '../../scripts/lib/portfolio.mjs';

// Aset CONTOH (bukan data pengguna). BBCA diberi tanggal beli untuk menguji tampilannya.
export const sampleAssets = [
  {
    "type": "idx",
    "symbol": "BBCA",
    "name": "Bank Central Asia",
    "qty": 1000,
    "avgCost": 9500
  },
  {
    "type": "idx",
    "symbol": "TLKM",
    "name": "Telkom Indonesia",
    "qty": 2000,
    "avgCost": 3200
  },
  {
    "type": "us",
    "symbol": "AAPL",
    "name": "Apple",
    "qty": 5,
    "avgCost": 180
  },
  {
    "type": "us",
    "symbol": "NVDA",
    "name": "NVIDIA",
    "qty": 3,
    "avgCost": 120
  },
  {
    "type": "crypto",
    "symbol": "BTC",
    "name": "Bitcoin",
    "coingeckoId": "bitcoin",
    "qty": 0.02,
    "avgCost": 1000000000
  },
  {
    "type": "crypto",
    "symbol": "ETH",
    "name": "Ethereum",
    "coingeckoId": "ethereum",
    "qty": 0.5,
    "avgCost": 40000000
  },
  {
    "type": "gold",
    "symbol": "XAU",
    "name": "Emas (gram)",
    "qty": 10,
    "avgCost": 1100000
  },
  {
    "type": "manual",
    "symbol": "RDPU",
    "name": "Reksa Dana Pasar Uang",
    "qty": 1,
    "price": 5000000,
    "avgCost": 4800000
  },
  {
    "type": "manual",
    "symbol": "KAS",
    "name": "Kas",
    "qty": 3000000,
    "price": 1,
    "avgCost": 1
  }
].map((a) => (a.symbol === 'BBCA' ? { ...a, buyDate: '2025-03-03' } : a));

export function seedFake(fake, { days = 150, end = '2026-11-23', withHistory = true, at = '2026-11-23T06:30:00Z' } = {}) {
  const t = fake.token;
  fake.call({ token: t, action: 'saveAssets', assets: sampleAssets });
  if (!withHistory) return;

  let seed = 20261123;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const START = { BBCA: 9300, TLKM: 3150, AAPL: 175, NVDA: 115, BTC: 960_000_000, ETH: 38_000_000, XAU: 1_130_000, RDPU: 4_900_000, KAS: 1 };
  const VOL = { idx: 0.012, us: 0.016, crypto: 0.03, gold: 0.007, manual: 0.00015 };
  const DRIFT = { idx: 0.0003, us: 0.0007, crypto: 0.0009, gold: 0.0003, manual: 0.00012 };
  const px = Object.fromEntries(sampleAssets.map((a) => [keyOf(a), START[a.symbol] ?? a.avgCost]));
  let fx = 15_900, prev = null;
  const endMs = Date.parse(`${end}T00:00:00Z`);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endMs - i * 86_400_000);
    const date = d.toISOString().slice(0, 10);
    const weekend = [0, 6].includes(d.getUTCDay());
    fx *= 1 + 0.0002 * gauss();
    for (const a of sampleAssets) {
      if (a.symbol === 'KAS') continue;
      if (['idx', 'us'].includes(a.type) && weekend) continue;
      px[keyOf(a)] *= 1 + DRIFT[a.type] + VOL[a.type] * gauss();
    }
    const quotes = new Map(sampleAssets.map((a) => [keyOf(a), { price: Math.round(px[keyOf(a)] * 1e4) / 1e4, asOf: date }]));
    const snap = buildSnapshot({ date, assets: sampleAssets, quotes, fx, prev });
    prev = snap;
    if (i === 0 && at) snap.at = at;
    const r = fake.call({ token: t, action: 'appendSnapshot', snapshot: snap });
    if (!r.ok) throw new Error(`seed gagal: ${r.error}`);
  }
}
