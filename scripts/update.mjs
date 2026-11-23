#!/usr/bin/env node
// Ambil harga penutupan, hitung snapshot hari ini, tambahkan ke data/history.json.
//
//   node scripts/update.mjs             jalankan sungguhan
//   node scripts/update.mjs --dry-run   hitung & tampilkan ringkasan, tanpa menulis file
//
// Env opsional:
//   HOLDINGS_JSON      isi holdings.json (dari GitHub Secret). Bila ada, file di repo diabaikan.
//   COINGECKO_API_KEY  demo key CoinGecko (opsional, menaikkan batas request)
//   SNAPSHOT_DATE      paksa tanggal YYYY-MM-DD (untuk pengujian)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildSnapshot, dateInTz, keyOf, pruneOld, redact, upsertSnapshot, validateHoldings,
} from './lib/portfolio.mjs';
import { collectQuotes } from './lib/quotes.mjs';
import { fetchCoinGeckoIdr, fetchStooqClose, fetchYahooClose } from './lib/sources.mjs';
import { readHistory, writeHistory } from './lib/history.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOLDINGS_PATH = path.join(ROOT, 'data', 'holdings.json');
const HISTORY_PATH = path.join(ROOT, 'data', 'history.json');
const DRY = process.argv.includes('--dry-run');

const warn = (m) => console.warn(process.env.GITHUB_ACTIONS ? `::warning::${m}` : `! ${m}`);

function loadHoldings() {
  const fromEnv = (process.env.HOLDINGS_JSON || '').trim();
  const raw = fromEnv || readFileSync(HOLDINGS_PATH, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    // Jangan cetak isi/pesan parser: untuk secret, potongan isinya bisa bocor ke log publik.
    throw new Error(fromEnv ? 'Secret HOLDINGS_JSON bukan JSON yang valid (isinya tidak dicetak demi keamanan)' : `data/holdings.json bukan JSON yang valid: ${e.message}`);
  }
}

async function main() {
  const holdings = validateHoldings(loadHoldings());
  const settings = holdings.settings || {};
  const mode = settings.publish === 'percent' ? 'percent' : 'full';
  const assets = holdings.assets;

  const date = process.env.SNAPSHOT_DATE || dateInTz(Date.now(), 'Asia/Jakarta');
  const history = readHistory(HISTORY_PATH);
  const before = history.snapshots.filter((s) => s.date < date);
  const prev = before[before.length - 1] || null; // pembanding perubahan harian
  const lastKnown = history.snapshots.filter((s) => s.date <= date).at(-1) || null; // cadangan bila fetch gagal

  const { quotes, fx, problems } = await collectQuotes({
    assets,
    date,
    lastKnown,
    warn,
    src: {
      yahoo: (sym) => fetchYahooClose(sym),
      stooq: (sym) => fetchStooqClose(sym),
      coingecko: (ids) => fetchCoinGeckoIdr(ids, { apiKey: process.env.COINGECKO_API_KEY }),
    },
  });

  if (problems.length) {
    throw new Error(`Snapshot dibatalkan, ${problems.length} aset tanpa harga dan tanpa data lama:\n- ${problems.join('\n- ')}`);
  }

  const full = buildSnapshot({ date, assets, quotes, fx, prev });
  const snap = mode === 'percent' ? redact(full) : full;

  // Ringkasan di log: sengaja TANPA nominal rupiah (log Actions bisa publik).
  console.log(`Snapshot ${date} (mode: ${mode}) — ${full.positions.length} aset`);
  const pct = (v) => (v == null ? '   –  ' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`.padStart(8));
  for (const p of full.positions) {
    console.log(`  ${keyOf(p).padEnd(16)} bobot ${(p.weight * 100).toFixed(1).padStart(5)}%  P/L ${pct(p.pnlPct)}  hari ini ${pct(p.dayPct)}  per ${p.asOf}${p.stale ? '  (harga lama)' : ''}`);
  }
  console.log(`  TOTAL P/L ${pct(full.pnlPct).trim()}, hari ini ${pct(full.dayPct).trim()}`);

  if (DRY) return console.log('(dry-run: tidak ada file yang ditulis)');

  let snapshots = history.snapshots;
  if (mode === 'percent') snapshots = snapshots.map((s) => (s.total != null ? redact(s) : s)); // bersihkan sisa nominal lama
  snapshots = pruneOld(upsertSnapshot(snapshots, snap), 90);

  writeHistory(HISTORY_PATH, {
    title: settings.title || 'Portofolio',
    mode,
    updatedAt: new Date().toISOString(),
    snapshots,
  });
  console.log(`Tersimpan: data/history.json (${snapshots.length} hari)`);
}

main().catch((e) => {
  console.error(`\nGAGAL: ${e.message}`);
  process.exit(1);
});
