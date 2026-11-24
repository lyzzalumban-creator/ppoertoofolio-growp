// Klien untuk Apps Script web app. Dipakai browser (dasbor, Kelola) dan Node (robot harian).

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Galat sementara dari Google (menggantung, 5xx, jaringan): layak dicoba lagi. Kata sandi salah dan galat data tidak.
const transient = (e) => e.name === 'TimeoutError' || e.name === 'TypeError' || /^HTTP 5\d\d$/.test(e.message);

/**
 * Satu panggilan ke Apps Script. Bawaan: satu kali coba tanpa batas waktu (dipakai dasbor, yang menunggu pengguna).
 * Robot memakai { timeoutMs, retries }: Apps Script sesekali menggantung ±2 menit lalu membalas 500, jadi lebih baik
 * menyerah cepat dan mencoba lagi. Aman diulang: semua aksi tulis idempoten (daftar aset sama, snapshot per tanggal, id transaksi).
 */
export async function call(url, token, action, body = {}, { timeoutMs = 0, retries = 0, delayMs = 5000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        // text/plain = "simple request": browser tidak mengirim preflight, yang tidak dilayani Apps Script.
        headers: { 'content-type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...body, token, action }),
        ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let data;
      try {
        data = JSON.parse(await res.text());
      } catch {
        // Biasanya halaman login/error Google: URL salah, atau deploy belum "Who has access: Anyone".
        throw new Error('Respons bukan JSON. Periksa URL, dan pastikan deploy memakai "Who has access: Anyone".');
      }
      if (data.error) throw new Error(data.error);
      return data;
    } catch (e) {
      if (attempt >= retries || !transient(e)) throw e;
      await wait(delayMs);
    }
  }
}
