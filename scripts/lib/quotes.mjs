// Kumpulkan harga semua aset dengan urutan sumber + cadangan + harga lama.
// Sumber disuntik lewat `src` supaya seluruh jalur gagalnya bisa dites tanpa jaringan.

import { currencyOf, keyOf } from './portfolio.mjs';

export const OZ_GRAM = 31.1034768; // gram per troy ons

/** Simbol Yahoo Finance sebuah aset: idx -> BBCA.JK, kripto -> BTC-USD, emas -> GC=F; field `yahoo` menimpa. */
export function yahooSymbol(a) {
  if (a.yahoo) return a.yahoo;
  if (a.type === 'idx') return a.symbol.endsWith('.JK') ? a.symbol : `${a.symbol}.JK`;
  if (a.type === 'crypto') return `${a.symbol}-USD`;
  if (a.type === 'gold') return 'GC=F';
  return a.symbol;
}

/**
 * @param {object}   p
 * @param {Array}    p.assets
 * @param {string}   p.date        tanggal snapshot (untuk aset manual)
 * @param {object}   p.lastKnown   snapshot terakhir (cadangan harga & kurs), opsional
 * @param {object}   p.src         { yahoo(sym), stooq(sym), coingecko(ids) }
 * @param {Function} p.warn
 * @returns {{ quotes: Map, fx: number|null, problems: string[] }}
 */
export async function collectQuotes({ assets, date, lastKnown, src, warn = () => {} }) {
  const lastPos = new Map(((lastKnown && lastKnown.positions) || []).map((p) => [`${p.type}:${p.symbol}`, p]));
  const quotes = new Map();
  const problems = [];
  // Pesan memakai nomor aset (urutan di Sheet), bukan kode saham: log Actions di repo publik bisa dibaca orang lain.
  const who = (a) => `#${assets.indexOf(a) + 1} ${a.type}`;

  const firstOk = async (label, attempts) => {
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
  };

  // --- kurs USD/IDR: dibutuhkan aset dolar, emas, dan cadangan kripto ---
  const needFx = assets.some((a) => currencyOf(a) === 'USD' || a.type === 'gold' || a.type === 'crypto');
  let fx = null;
  let fxErr = null;
  if (needFx) {
    try {
      fx = (await firstOk('USD/IDR', [['Yahoo', () => src.yahoo('USDIDR=X')], ['Stooq', () => src.stooq('usdidr')]])).price;
    } catch (e) {
      if (lastKnown && lastKnown.fx > 0) {
        fx = lastKnown.fx;
        warn(`Kurs USD/IDR memakai nilai terakhir (${fx}) karena gagal diambil`);
      } else {
        fxErr = e.message;
      }
    }
  }
  // Baru dianggap masalah bila ada aset yang benar-benar butuh kurs (portofolio tanpa aset dolar tetap jalan).
  const requireFx = () => {
    if (!(fx > 0)) throw new Error(`butuh kurs USD/IDR${fxErr ? ` (${fxErr})` : ''}`);
    return fx;
  };

  // --- kripto: satu request CoinGecko untuk semua koin ---
  let cg = new Map();
  const cryptos = assets.filter((a) => a.type === 'crypto');
  if (cryptos.length) {
    try {
      cg = await src.coingecko([...new Set(cryptos.map((a) => a.coingeckoId))]);
    } catch (e) {
      warn(`CoinGecko gagal (${e.message})`);
    }
  }

  for (const a of assets) {
    const key = keyOf(a);
    const cur = currencyOf(a);
    try {
      let q;
      if (a.type === 'manual' || a.type === 'cash') {
        if (cur === 'USD') requireFx();
        q = { price: a.type === 'cash' ? 1 : a.price, asOf: date }; // kas: 1 unit = 1 satuan mata uangnya
      } else if (a.type === 'crypto') {
        q = cg.get(a.coingeckoId);
        if (!q) {
          // Cadangan: harga USD dari Yahoo (mis. BTC-USD) dikali kurs.
          const ySym = yahooSymbol(a);
          warn(`${who(a)}: tidak ada harga dari CoinGecko, mencoba Yahoo`);
          const y = await src.yahoo(ySym);
          if (y.currency && y.currency !== 'USD') throw new Error(`Yahoo bermata uang ${y.currency}, bukan USD`);
          q = { price: y.price * requireFx(), asOf: y.asOf };
        }
      } else if (a.type === 'gold') {
        const oz = await firstOk(who(a), [['Yahoo GC=F', () => src.yahoo(yahooSymbol(a))], ['Stooq xauusd', () => src.stooq('xauusd')]]);
        q = { price: (oz.price * requireFx()) / OZ_GRAM, asOf: oz.asOf }; // USD/ons -> IDR/gram
      } else {
        const ySym = yahooSymbol(a);
        const attempts = [['Yahoo', () => src.yahoo(ySym)]];
        if (a.type === 'us') attempts.push(['Stooq', () => src.stooq(`${a.symbol.toLowerCase().replace('.', '-')}.us`)]);
        q = await firstOk(who(a), attempts);
        if (q.currency && q.currency !== cur) {
          throw new Error(`mata uang ${q.currency} dari sumber data tidak sama dengan ${cur} yang diharapkan untuk type "${a.type}"`);
        }
        if (cur === 'USD') requireFx();
      }
      quotes.set(key, { price: q.price, asOf: q.asOf });
    } catch (e) {
      const old = lastPos.get(key);
      if (old && old.price > 0) {
        warn(`${who(a)}: gagal diambil (${e.message}); memakai harga terakhir per ${old.asOf}`);
        quotes.set(key, { price: old.price, asOf: old.asOf, stale: true });
      } else {
        problems.push(`${who(a)}: ${e.message}`);
      }
    }
  }

  // Harga lama beraset dolar tetap butuh kurs untuk dikonversi.
  if (!(fx > 0)) {
    for (const a of assets) {
      if (currencyOf(a) === 'USD' && quotes.has(keyOf(a))) {
        quotes.delete(keyOf(a));
        problems.push(`${who(a)}: butuh kurs USD/IDR${fxErr ? ` (${fxErr})` : ''}`);
      }
    }
  }

  return { quotes, fx, problems };
}
