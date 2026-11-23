#!/usr/bin/env node
// Robot harian: baca daftar aset dari Apps Script, ambil harga penutupan, hitung snapshot,
// lalu kirim snapshot itu kembali ke Sheet. Tidak ada data yang ditulis ke repo.
//
//   node scripts/update.mjs             jalankan sungguhan
//   node scripts/update.mjs --dry-run   hitung & tampilkan ringkasan, tanpa menyimpan
//
// Env wajib:  APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN
// Env opsional: COINGECKO_API_KEY (demo key CoinGecko), SNAPSHOT_DATE (YYYY-MM-DD, untuk pengujian)

import { buildSnapshot, dateInTz, keyOf, validateHoldings } from './lib/portfolio.mjs';
import { collectQuotes } from './lib/quotes.mjs';
import { fetchCoinGeckoIdr, fetchStooqClose, fetchYahooClose } from './lib/sources.mjs';
import { call } from './lib/api.mjs';

const DRY = process.argv.includes('--dry-run');
const warn = (m) => console.warn(process.env.GITHUB_ACTIONS ? `::warning::${m}` : `! ${m}`);

async function main() {
  const { APPS_SCRIPT_URL: url, APPS_SCRIPT_TOKEN: token } = process.env;
  if (!url || !token) throw new Error('Isi env APPS_SCRIPT_URL dan APPS_SCRIPT_TOKEN (di GitHub: Settings > Secrets and variables > Actions)');

  // shortcut: satu kali coba; bila Google sedang error, jalankan ulang workflow-nya.
  const { assets, history } = await call(url, token, 'list');
  validateHoldings({ assets });

  const date = process.env.SNAPSHOT_DATE || dateInTz(Date.now(), 'Asia/Jakarta');
  const prev = history.filter((s) => s.date < date).at(-1) || null; // pembanding perubahan harian
  const lastKnown = history.filter((s) => s.date <= date).at(-1) || null; // cadangan bila harga gagal diambil

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

  const snap = buildSnapshot({ date, assets, quotes, fx, prev });

  // Log Actions bisa terbaca orang lain bila repo publik: tampilkan persentase saja, tanpa nominal rupiah.
  const pct = (v) => (v == null ? '   –  ' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`.padStart(8));
  console.log(`Snapshot ${date} — ${snap.positions.length} aset`);
  for (const p of snap.positions) {
    console.log(`  ${keyOf(p).padEnd(16)} bobot ${(p.weight * 100).toFixed(1).padStart(5)}%  P/L ${pct(p.pnlPct)}  hari ini ${pct(p.dayPct)}  per ${p.asOf}${p.stale ? '  (harga lama)' : ''}`);
  }
  console.log(`  TOTAL P/L ${pct(snap.pnlPct).trim()}, hari ini ${pct(snap.dayPct).trim()}`);

  if (DRY) return console.log('(dry-run: tidak disimpan)');
  const { days } = await call(url, token, 'appendSnapshot', { snapshot: snap });
  console.log(`Tersimpan di Sheet (${days} hari riwayat)`);
}

main().catch((e) => {
  console.error(`\nGAGAL: ${e.message}`);
  process.exit(1);
});
