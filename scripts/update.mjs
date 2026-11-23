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
  buildSnapshot, currencyOf, dateInTz, keyOf, pruneOld, redact, upsertSnapshot, validateHoldings,
} from './lib/portfolio.mjs';
import { fetchCoinGeckoIdr, fetchStooqClose, fetchYahooClose } from './lib/sources.mjs';
import { readHistory, writeHistory } from './lib/history.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOLDINGS_PATH = path.join(ROOT, 'data', 'holdings.json');
const HISTORY_PATH = path.join(ROOT, 'data', 'history.json');
const OZ_GRAM = 31.1034768;
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

async function firstOk(label, ...attempts) {
  let lastErr;
  for (const [name, fn] of attempts) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      warn(`${label}: ${name} gagal (${e.message})`);
    }
  }
  throw lastErr;
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
  const lastPos = new Map(((lastKnown && lastKnown.positions) || []).map((p) => [`${p.type}:${p.symbol}`, p]));

  const problems = [];
  const quotes = new Map();

  // --- kurs USD/IDR (juga dibutuhkan untuk emas) ---
  const needFx = assets.some((a) => currencyOf(a) === 'USD' || a.type === 'gold');
  let fx = null;
  if (needFx) {
    try {
      fx = (await firstOk('USD/IDR', ['Yahoo', () => fetchYahooClose('USDIDR=X')], ['Stooq', () => fetchStooqClose('usdidr')])).price;
    } catch (e) {
      if (lastKnown && lastKnown.fx > 0) {
        fx = lastKnown.fx;
        warn(`Kurs USD/IDR memakai nilai terakhir (${fx}) karena gagal diambil`);
      } else {
        problems.push(`Kurs USD/IDR: ${e.message}`);
      }
    }
  }

  // --- kripto: satu request untuk semua koin ---
  const cryptos = assets.filter((a) => a.type === 'crypto');
  let cgMap = new Map();
  if (cryptos.length) {
    try {
      cgMap = await fetchCoinGeckoIdr([...new Set(cryptos.map((a) => a.coingeckoId))], { apiKey: process.env.COINGECKO_API_KEY });
    } catch (e) {
      warn(`CoinGecko gagal (${e.message})`);
    }
  }

  // --- aset lainnya, satu per satu ---
  for (const a of assets) {
    const key = keyOf(a);
    const cur = currencyOf(a);
    try {
      let q;
      if (a.type === 'manual') {
        q = { price: a.price, asOf: date };
      } else if (a.type === 'crypto') {
        q = cgMap.get(a.coingeckoId);
        if (!q) throw new Error(`CoinGecko tidak mengembalikan harga untuk "${a.coingeckoId}"`);
      } else if (a.type === 'gold') {
        if (!fx) throw new Error('butuh kurs USD/IDR');
        const oz = await firstOk(key, ['Yahoo GC=F', () => fetchYahooClose(a.yahoo || 'GC=F')], ['Stooq xauusd', () => fetchStooqClose('xauusd')]);
        q = { price: (oz.price * fx) / OZ_GRAM, asOf: oz.asOf }; // USD per troy ons -> IDR per gram
      } else {
        const ySym = a.yahoo || (a.type === 'idx' ? (a.symbol.endsWith('.JK') ? a.symbol : `${a.symbol}.JK`) : a.symbol);
        const attempts = [['Yahoo', () => fetchYahooClose(ySym)]];
        if (a.type === 'us') attempts.push(['Stooq', () => fetchStooqClose(`${a.symbol.toLowerCase().replace('.', '-')}.us`)]);
        q = await firstOk(key, ...attempts);
        if (q.currency && q.currency !== cur) {
          throw new Error(`mata uang ${q.currency} dari sumber data tidak sama dengan ${cur} yang diharapkan untuk type "${a.type}"`);
        }
      }
      quotes.set(key, { price: q.price, asOf: q.asOf });
    } catch (e) {
      const old = lastPos.get(key);
      if (old && old.price > 0) {
        warn(`${key}: gagal diambil (${e.message}); memakai harga terakhir per ${old.asOf}`);
        quotes.set(key, { price: old.price, asOf: old.asOf, stale: true });
      } else {
        problems.push(`${key}: ${e.message}`);
      }
    }
  }

  if (problems.length) {
    throw new Error(`Snapshot dibatalkan, ${problems.length} aset tanpa harga dan tanpa data lama:\n- ${problems.join('\n- ')}`);
  }

  const full = buildSnapshot({ date, assets, quotes, fx, prev });
  const snap = mode === 'percent' ? redact(full) : full;

  // Ringkasan di log: sengaja TANPA nominal rupiah (log Actions bisa publik).
  console.log(`Snapshot ${date} (mode: ${mode}) — ${full.positions.length} aset`);
  for (const p of full.positions) {
    const pct = (v) => (v == null ? '   –  ' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`.padStart(8));
    console.log(`  ${keyOf(p).padEnd(16)} bobot ${(p.weight * 100).toFixed(1).padStart(5)}%  P/L ${pct(p.pnlPct)}  hari ini ${pct(p.dayPct)}${p.stale ? '  (harga lama)' : ''}`);
  }
  console.log(`  TOTAL P/L ${(full.pnlPct == null ? '–' : (full.pnlPct * 100).toFixed(2) + '%')}, hari ini ${(full.dayPct == null ? '–' : (full.dayPct * 100).toFixed(2) + '%')}`);

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
