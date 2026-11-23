// Menjaga log GitHub Actions bebas dari data pribadi. Di repo publik, log run bisa dibaca siapa pun
// yang punya akun GitHub, termasuk kode saham yang kamu pegang.
// Dua lapis: (1) robot tidak mencetak rincian per aset, (2) sisa teks yang masih memuat kode/nama
// disamarkan menjadi *** — oleh GitHub (::add-mask::) dan oleh scrub() di bawah.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Teks yang tidak boleh tampil di log: kode, nama, ID CoinGecko, dan simbol Yahoo tiap aset. */
export function sensitiveStrings(assets) {
  const seen = new Map(); // dedup tanpa peduli besar-kecil huruf
  for (const a of assets) {
    for (const v of [a.symbol, a.name, a.coingeckoId, a.yahoo]) {
      if (typeof v !== 'string') continue;
      const t = v.trim();
      if (t) seen.set(t.toLowerCase(), t);
    }
  }
  return [...seen.values()];
}

/**
 * Perintah `::add-mask::` yang membuat GitHub mengganti nilai itu menjadi *** di seluruh log berikutnya,
 * termasuk keluaran yang tidak kita kendalikan. Nilai pendek (< 3 huruf) dilewati: menyamarkan "F" atau "T"
 * akan ikut mengaburkan huruf yang sama di mana-mana. Untuk yang pendek, perlindungan datang dari scrub().
 */
export function maskLines(strings) {
  const out = [];
  for (const s of strings) {
    if (s.length < 3 || /[\r\n]/.test(s)) continue;
    // Besar, kecil, dan bentuk aslinya: pencocokan GitHub peka huruf besar-kecil.
    for (const v of new Set([s, s.toUpperCase(), s.toLowerCase()])) out.push(`::add-mask::${v.replace(/%/g, '%25')}`);
  }
  return out;
}

/**
 * Ganti kemunculan teks sensitif dengan ***. Teks >= 3 huruf diganti di mana pun muncul (juga di dalam
 * "CUAN.JK"); teks pendek hanya bila berdiri sendiri, supaya "F" tidak menghapus huruf f dari kata lain.
 */
export function scrub(text, strings) {
  let out = String(text);
  for (const s of [...strings].sort((a, b) => b.length - a.length)) { // terpanjang dulu
    const re = s.length >= 3
      ? new RegExp(escapeRe(s), 'gi')
      : new RegExp(`(?<![A-Za-z0-9])${escapeRe(s)}(?![A-Za-z0-9])`, 'gi');
    out = out.replace(re, '***');
  }
  return out;
}
