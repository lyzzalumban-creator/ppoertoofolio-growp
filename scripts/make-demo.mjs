#!/usr/bin/env node
// Bikin data/demo-history.json: riwayat PALSU (random walk) agar halaman bisa dilihat
// sebelum data asli terkumpul. Web otomatis memakainya hanya bila history.json masih kosong,
// dan menampilkan spanduk "data contoh".
//
//   node scripts/make-demo.mjs [YYYY-MM-DD terakhir] [jumlah hari]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildSnapshot, keyOf, pruneOld, upsertSnapshot, validateHoldings } from './lib/portfolio.mjs';
import { writeHistory } from './lib/history.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const holdings = validateHoldings(JSON.parse(readFileSync(path.join(ROOT, 'data', 'holdings.json'), 'utf8')));

const end = process.argv[2] || new Date().toISOString().slice(0, 10);
const days = Number(process.argv[3] || 150);

// PRNG tetap (mulberry32) supaya hasilnya sama setiap dijalankan.
let seed = 20261123;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

const START = { BBCA: 9300, TLKM: 3150, AAPL: 175, NVDA: 115, BTC: 960_000_000, ETH: 38_000_000, XAU: 1_130_000, RDPU: 4_900_000, KAS: 1 };
const VOL = { idx: 0.012, us: 0.016, crypto: 0.03, gold: 0.007, manual: 0.00015 };
const DRIFT = { idx: 0.0003, us: 0.0007, crypto: 0.0009, gold: 0.0003, manual: 0.00012 };
const TRADING = new Set(['idx', 'us']); // tidak bergerak di akhir pekan

const px = Object.fromEntries(holdings.assets.map((a) => [keyOf(a), START[a.symbol] ?? a.avgCost]));
let fx = 15_900;
let snaps = [];
let prev = null;
const endMs = Date.parse(`${end}T00:00:00Z`);

for (let i = days - 1; i >= 0; i--) {
  const d = new Date(endMs - i * 86_400_000);
  const date = d.toISOString().slice(0, 10);
  const weekend = [0, 6].includes(d.getUTCDay());
  fx *= 1 + 0.0002 * gauss();
  for (const a of holdings.assets) {
    if (a.type === 'manual' && a.symbol === 'KAS') continue;
    if (TRADING.has(a.type) && weekend) continue;
    px[keyOf(a)] *= 1 + DRIFT[a.type] + VOL[a.type] * gauss();
  }
  const quotes = new Map(holdings.assets.map((a) => [keyOf(a), { price: Math.round(px[keyOf(a)] * 1e4) / 1e4, asOf: date }]));
  const snap = buildSnapshot({ date, assets: holdings.assets, quotes, fx, prev });
  snaps = upsertSnapshot(snaps, snap);
  prev = snap;
}

writeHistory(path.join(ROOT, 'data', 'demo-history.json'), {
  title: 'Portofolio Contoh',
  mode: 'full',
  demo: true,
  updatedAt: null,
  snapshots: pruneOld(snaps, 30),
});
console.log(`data/demo-history.json: ${snaps.length} hari, sampai ${end}`);
