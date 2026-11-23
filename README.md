# Portofolio

Dashboard yang menggabungkan semua portofolio investasi (saham IDX, saham AS, kripto, emas, reksa dana, kas) jadi satu halaman. Data **diperbarui sekali sehari** saat penutupan pasar, tanpa server.

```
GitHub Actions (tiap hari 07.30 WIB)
   └─ scripts/update.mjs  → ambil harga penutupan, hitung snapshot
        └─ data/history.json  (satu baris per hari)
             └─ index.html + assets/  → dibaca & digambar di browser (GitHub Pages)
```

Tanpa framework, tanpa library eksternal, tanpa API key wajib.

## Mulai (3 langkah)

1. **Isi asetmu** di [`data/holdings.json`](data/holdings.json) (contoh sudah ada, lihat tabel field di bawah).
2. **Aktifkan GitHub Pages:** Settings → Pages → *Deploy from branch* → branch `main`, folder `/ (root)`.
   Workflow terjadwal GitHub hanya berjalan dari branch default, jadi pastikan semua file ini sudah ada di `main`.
3. **Jalankan sekali manual:** tab Actions → *Update harga harian* → *Run workflow*. Setelah hijau, buka situs Pages-mu. Sesudah itu jalan sendiri tiap hari.

Selama `history.json` masih kosong, halaman menampilkan **data contoh** dengan spanduk kuning.

## Format `data/holdings.json`

```json
{
  "settings": { "title": "Portofolio Saya", "publish": "full" },
  "assets": [
    { "type": "idx", "symbol": "BBCA", "name": "Bank Central Asia", "qty": 1000, "avgCost": 9500 }
  ]
}
```

| Field | Keterangan |
|---|---|
| `type` | `idx` saham Indonesia · `us` saham AS · `crypto` kripto · `gold` emas · `manual` yang lain (reksa dana, deposito, kas) |
| `symbol` | `idx`: kode tanpa `.JK` (mis. `BBCA`). `us`: ticker (mis. `AAPL`). Lainnya: label bebas |
| `name` | Nama yang tampil (opsional) |
| `qty` | Jumlah. **`idx` dalam LEMBAR, bukan lot** (1 lot = 100 lembar). `gold` dalam gram. `manual` dalam unit |
| `avgCost` | Harga beli rata-rata **per unit**, dalam mata uang aset: rupiah untuk `idx`/`crypto`/`gold`/`manual`, dolar untuk `us` |
| `coingeckoId` | Wajib untuk `crypto`. Lihat "API ID" di halaman koin di coingecko.com (mis. `bitcoin`) |
| `price` | Wajib untuk `manual`: harga per unit saat ini. Kamu perbarui sendiri |
| `currency` | Hanya `manual`: `IDR` (default) atau `USD` |
| `costIdr` | Opsional: total modal dalam rupiah. Isi untuk aset dolar bila ingin untung/rugi ikut memperhitungkan kurs saat beli |
| `yahoo` | Opsional: paksa simbol Yahoo Finance untuk ticker yang tidak biasa (mis. `BRK-B`) |
| `settings.publish` | `full` (default) atau `percent`, lihat bagian privasi |

Aset `manual` dengan `qty: 1` dan `price` = saldo (mis. deposito) adalah cara termudah mencatat sesuatu yang tidak punya harga pasar.

## Privasi: baca ini sebelum repo/situsnya publik

Apa pun yang dibaca situs ada di repo, dan **repo publik bisa dibaca siapa saja**. Ada dua pengaman:

- **`"publish": "percent"`**: snapshot yang diterbitkan **tidak berisi nominal rupiah, modal, maupun jumlah unit**. Yang tersisa hanya harga pasar, bobot alokasi, dan persentase untung/rugi. Harga aset `manual` juga dibuang karena itu angka ketikanmu sendiri.
- **Secret `HOLDINGS_JSON`**: karena `data/holdings.json` sendiri ada di repo, di repo publik isi file itu (jumlah dan harga belinya) tetap terlihat. Solusinya: Settings → Secrets and variables → Actions → *New repository secret* bernama `HOLDINGS_JSON`, isi dengan seluruh isi `holdings.json` (termasuk `"publish": "percent"`). Bila secret ada, file di repo diabaikan; ganti isi file di repo dengan contoh/kosong.

Yang **tetap** terlihat di mode persentase: perbandingan bobot antar aset dan persentase untung/rugi. Absolutnya tidak.
Log Actions tidak pernah mencetak nominal rupiah, hanya persentase.

Bila repo **privat**, GitHub Pages dari repo privat butuh paket GitHub berbayar. Tombol "Sembunyikan nominal" di halaman hanya kosmetik (data tetap ada di file), bukan pengaman.

## Sumber data dan batasannya

| Aset | Sumber | Catatan |
|---|---|---|
| Saham IDX, saham AS, kurs USD/IDR | Yahoo Finance (cadangan: Stooq untuk saham AS & kurs) | Endpoint tidak resmi tanpa kontrak; bisa berubah atau menolak IP cloud |
| Kripto | CoinGecko | Dalam rupiah langsung. Boleh pasang secret `COINGECKO_API_KEY` (demo key gratis) bila kena batas request |
| Emas | Harga emas dunia (futures `GC=F`, cadangan XAUUSD) × kurs ÷ 31,1035 | Harga **internasional per gram**, bukan harga Antam/toko emas. Untuk harga Antam pakai `manual` |

- Satu "foto" per hari pada 07.30 WIB: IDX dan bursa AS sudah tutup, kripto diambil saat itu.
- Bila satu harga gagal diambil, dipakai harga terakhir dan baris ditandai **harga lama**. Bila belum pernah ada harga sama sekali (mis. salah ketik simbol), proses **dibatalkan** dan tidak menulis apa pun, supaya total tidak diam-diam salah. Workflow gagal sehingga kamu dapat notifikasi dari GitHub.
- "Hari ini" dihitung dari **pergerakan harga**, bukan selisih total, jadi setoran atau penarikan dana tidak terbaca sebagai untung/rugi.
- Untung/rugi aset dolar memakai kurs hari ini untuk modal, kecuali kamu mengisi `costIdr`.
- Rincian per aset disimpan 90 hari terakhir saja; total dan alokasi harian disimpan selamanya.

## Perintah lokal

```bash
npm test             # tes logika hitung & parser (tanpa jaringan)
npm run update:dry   # ambil harga & tampilkan ringkasan, tanpa menulis file
npm run update       # ambil harga & tulis data/history.json
npm run demo         # buat ulang data/demo-history.json (data karangan)
npm run serve        # lihat situs di http://localhost:8080
```

Halaman tidak bisa dibuka dengan klik dua kali `index.html` (browser memblokir pemuatan data dari `file://`); pakai `npm run serve`.
Untuk memakai secret secara lokal: `HOLDINGS_JSON="$(cat holdings-pribadi.json)" npm run update`.

## Struktur

```
index.html, assets/        situs statis (HTML, CSS, JS murni)
data/holdings.json         daftar asetmu (atau secret HOLDINGS_JSON)
data/history.json          snapshot harian, dibuat otomatis
data/demo-history.json     data karangan untuk pratinjau
scripts/update.mjs         pengambil harga + pembuat snapshot
scripts/lib/               logika hitung, sumber data, baca/tulis riwayat
test/                      tes (node --test)
.github/workflows/         jadwal harian
```

Hanya untuk pencatatan pribadi, bukan saran investasi.
