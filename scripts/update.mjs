#!/usr/bin/env node
// Robot harian: baca daftar aset dari Apps Script, ambil harga penutupan, hitung snapshot,
// lalu kirim snapshot itu kembali ke Sheet. Tidak ada data yang ditulis ke repo.
//
//   node scripts/update.mjs             jalankan sungguhan
//   node scripts/update.mjs --dry-run   hitung & tampilkan ringkasan, tanpa menyimpan
//
// Env wajib:  APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN
// Env opsional: COINGECKO_API_KEY (demo key CoinGecko), SNAPSHOT_DATE (YYYY-MM-DD, untuk pengujian)

import { buildSnapshot, currencyOf, dateInTz, keyOf, validateHoldings } from './lib/portfolio.mjs';
import { collectQuotes, yahooSymbol } from './lib/quotes.mjs';
import { addDays, backfillDates, buildBackfill } from './lib/backfill.mjs';
import { fetchCoinGeckoIdr, fetchStooqClose, fetchYahooClose, fetchYahooSeries } from './lib/sources.mjs';
import { call } from './lib/api.mjs';
import { maskLines, scrub, sensitiveStrings } from './lib/privacy.mjs';

const DRY = process.argv.includes('--dry-run');

// Di GitHub Actions log run bisa dibaca orang lain bila repo publik. Karena itu robot di sana tidak mencetak
// rincian per aset (kode, bobot, untung/rugi, tanggal beli), dan teks yang masih memuat kode/nama aset
// disamarkan. Di komputermu sendiri semuanya tampil lengkap.
const QUIET = process.env.GITHUB_ACTIONS === 'true';
let secrets = []; // diisi begitu daftar aset terbaca
const clean = (m) => (QUIET ? scrub(m, secrets) : m);
const log = (m) => console.log(clean(m));
const warn = (m) => console.warn(QUIET ? `::warning::${clean(m)}` : `! ${m}`);

// Penutupan harian historis semua aset yang punya tanggal beli, plus kurs USD/IDR bila dibutuhkan.
async function loadSeries(assets, from, to) {
  const start = addDays(from, -10); // cadangan: akhir pekan/libur tepat sebelum tanggal pertama
  const series = new Map();
  for (const a of assets) {
    if (!a.buyDate || a.type === 'manual') continue;
    const { points, currency } = await fetchYahooSeries(yahooSymbol(a), start, to);
    const want = a.type === 'idx' ? 'IDR' : 'USD'; // us, kripto (X-USD), dan emas (GC=F) semuanya dalam dolar
    if (currency && currency !== want) throw new Error(`#${assets.indexOf(a) + 1} ${a.type}: mata uang ${currency} dari sumber tidak sama dengan ${want} yang diharapkan`);
    series.set(keyOf(a), points);
  }
  const needFx = assets.some((a) => a.buyDate && (currencyOf(a) === 'USD' || a.type === 'gold' || a.type === 'crypto'));
  const fxSeries = needFx ? (await fetchYahooSeries('USDIDR=X', start, to)).points : null;
  return { series, fxSeries };
}

async function main() {
  const { APPS_SCRIPT_URL: url, APPS_SCRIPT_TOKEN: token } = process.env;
  if (!url || !token) throw new Error('Isi env APPS_SCRIPT_URL dan APPS_SCRIPT_TOKEN (di GitHub: Settings > Secrets and variables > Actions)');

  // shortcut: satu kali coba; bila Google sedang error, jalankan ulang workflow-nya.
  const { assets, history } = await call(url, token, 'list');
  secrets = sensitiveStrings(assets);
  if (QUIET) for (const l of maskLines(secrets)) console.log(l); // sebelum apa pun yang bisa memuat kode aset
  validateHoldings({ assets });

  const date = process.env.SNAPSHOT_DATE || dateInTz(Date.now(), 'Asia/Jakarta');

  // --- riwayat mundur: isi celah di DEPAN (sejak tanggal beli paling awal, maks 366 hari) dari harga historis.
  // Kegagalan di sini hanya diberi peringatan; snapshot hari ini tetap dibuat.
  let hist = history;
  try {
    const dates = backfillDates({ assets, firstDate: history[0] && history[0].date, today: date });
    if (dates.length) {
      const { series, fxSeries } = await loadSeries(assets, dates[0], dates[dates.length - 1]);
      const snaps = buildBackfill({ assets, dates, series, fxSeries });
      const skipped = dates.length - snaps.length;
      // Jumlah hari riwayat = hari ini dikurangi tanggal beli paling awal, jadi di Actions angkanya tidak dicetak.
      log(QUIET ? 'Riwayat mundur: diisi' : `Riwayat mundur: ${snaps.length} hari (${dates[0]} → ${dates[dates.length - 1]})${skipped ? `, ${skipped} hari dilewati (tak ada harga)` : ''}${DRY ? ' [dry-run: tidak disimpan]' : ''}`);
      hist = [...snaps, ...history]; // dipakai untuk "Hari ini" walau penyimpanan di bawah gagal
      if (!DRY) {
        // Terbaru dulu: bila terputus di tengah, yang tersimpan tetap menyambung ke riwayat yang ada,
        // dan run berikutnya melanjutkan ke belakang tanpa meninggalkan lubang.
        for (const s of [...snaps].reverse()) await call(url, token, 'appendSnapshot', { snapshot: s });
      }
    }
  } catch (e) {
    warn(`Riwayat mundur dilewati: ${e.message}`);
  }

  const prev = hist.filter((s) => s.date < date).at(-1) || null; // pembanding perubahan harian
  const lastKnown = hist.filter((s) => s.date <= date).at(-1) || null; // cadangan bila harga gagal diambil

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
  snap.at = new Date().toISOString(); // kapan harga diambil; dasbor menampilkannya sebagai "diperbarui ..."

  log(`Snapshot ${date} — ${snap.positions.length} aset`);
  if (!QUIET) {
    const pct = (v) => (v == null ? '   –  ' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`.padStart(8));
    for (const p of snap.positions) {
      console.log(`  ${keyOf(p).padEnd(16)} bobot ${(p.weight * 100).toFixed(1).padStart(5)}%  P/L ${pct(p.pnlPct)}  hari ini ${pct(p.dayPct)}  per ${p.asOf}${p.stale ? '  (harga lama)' : ''}`);
    }
    console.log(`  TOTAL P/L ${pct(snap.pnlPct).trim()}, hari ini ${pct(snap.dayPct).trim()}`);
  }

  if (DRY) return log('(dry-run: tidak disimpan)');
  const { days } = await call(url, token, 'appendSnapshot', { snapshot: snap });
  log(QUIET ? 'Tersimpan di Sheet' : `Tersimpan di Sheet (${days} hari riwayat)`);
}

main().catch((e) => {
  console.error(`\nGAGAL: ${clean(e.message)}`);
  process.exit(1);
});
