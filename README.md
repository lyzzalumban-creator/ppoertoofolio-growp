# Portofolio

Dasbor pribadi yang menggabungkan semua portofolio investasimu (saham IDX, saham AS, kripto, emas, reksa dana, kas) di satu halaman. Aset diisi **lewat web**, data disimpan di **Google Sheet-mu sendiri**, dan harga diperbarui **sekali sehari** saat penutupan pasar.

```
Web: dasbor + "Kelola aset" ──┐
                              ├──► Apps Script ──► Google Sheet (tab "Aset" dan "Riwayat")
Robot harian (GitHub Actions) ┘
```

**Repo dan situs ini tidak berisi data sama sekali.** Tanpa URL dan kata sandimu, halamannya kosong. Alasannya ada di bagian [Privasi](#privasi).

## Pasang (sekali, ±15 menit)

1. **Buat Google Sheet kosong.** Namanya bebas. Tab `Aset` dan `Riwayat` dibuat otomatis.
2. **Pasang kode:** di Sheet buka *Extensions → Apps Script*, hapus isi bawaan, tempel seluruh isi [`apps-script/Code.gs`](apps-script/Code.gs), simpan.
3. **Pasang kata sandi:** *Project Settings* (ikon roda gigi) → *Script properties* → *Add script property*: nama `TOKEN`, nilai kata sandi **panjang (20 karakter atau lebih)**. Simpan di pengelola kata sandi, karena tidak bisa dipulihkan, hanya diganti.
4. **Deploy:** *Deploy → New deployment →* jenis *Web app*, isi **Execute as: Me** dan **Who has access: Anyone**, lalu *Deploy*. Izinkan aksesnya saat diminta; peringatan *"Google hasn't verified this app"* wajar karena kamu pembuatnya sendiri (*Advanced → Go to … (unsafe) → Allow*). Salin **Web app URL** (berakhiran `/exec`).
5. **Isi secret di GitHub:** repo → *Settings → Secrets and variables → Actions → New repository secret*:
   - `APPS_SCRIPT_URL`: URL tadi
   - `APPS_SCRIPT_TOKEN`: kata sandi yang sama dengan `TOKEN`
   - (opsional) `COINGECKO_API_KEY`: demo key CoinGecko gratis, untuk batas request lebih longgar
6. **Aktifkan GitHub Pages:** *Settings → Pages → Deploy from branch →* `main`, folder `/ (root)`. Workflow terjadwal GitHub hanya berjalan dari branch default, jadi pastikan semua file ini sudah ada di `main`.
7. **Pakai:** buka situsmu, tempel URL dan kata sandi (sekali per perangkat), buka **Kelola aset** dan tambah asetmu. Lalu tab *Actions → Update harga harian → Run workflow*. Sesudah itu jalan sendiri tiap hari pukul 07.30 WIB.

Aset yang kamu tambah muncul di dasbor setelah update harga berikutnya (maksimal 1 hari, atau langsung bila kamu menekan *Run workflow*).

> **Mengubah kode Apps Script nanti?** Perubahan baru aktif setelah *Deploy → Manage deployments → Edit (ikon pensil) → Version: New version → Deploy*. URL-nya tetap sama.
>
> Bila fitur baru butuh kode Apps Script yang lebih baru (mis. tanggal beli), halaman **Kelola aset** menampilkan banner kuning "masih versi lama" dan menyembunyikan kolom yang belum didukung, supaya tidak ada data yang hilang diam-diam. Tempel `Code.gs` terbaru lalu deploy versi baru; data di Sheet tidak berubah.

## Mengisi aset

Lewat halaman **Kelola aset** (tombol di dasbor). Kolom yang tampil menyesuaikan jenis aset. Isinya sama dengan tab `Aset` di Sheet, yang juga boleh kamu edit langsung.

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
| `costIdr` | Opsional: total modal dalam rupiah. Isi untuk aset dolar bila ingin untung/rugi memperhitungkan kurs saat beli |
| `yahoo` | Opsional: paksa simbol Yahoo Finance untuk ticker yang tidak biasa (mis. `BRK-B`) |
| `buyDate` | Opsional: tanggal beli `YYYY-MM-DD`. Bila beli beberapa kali, isi **tanggal beli pertama**. Hanya dicatat dan ditampilkan ("dibeli 3 Mar 2025 · 8 bln"); belum dipakai untuk menghitung kurs saat beli |

Aset `manual` dengan `qty` 1 dan `price` = saldo (mis. deposito) adalah cara termudah mencatat sesuatu yang tidak punya harga pasar.

## Privasi

- **Repo dan situs tidak berisi data.** GitHub Pages dapat dibuka siapa saja yang tahu URL-nya, **bahkan dari repo privat** (kecuali paket Enterprise). Karena itu asetmu dan riwayatmu hanya ada di Google Sheet milikmu, dan situs mengambilnya lewat Apps Script setelah kamu memasukkan kata sandi.
- **Satu-satunya pengaman adalah kata sandi `TOKEN`.** Siapa pun yang memegang URL Apps Script *dan* kata sandinya bisa membaca dan mengubah datamu. Tidak ada pembatasan percobaan, jadi pakai kata sandi panjang dan acak. Untuk menggantinya: ubah `TOKEN` di Script properties (langsung berlaku), perbarui secret `APPS_SCRIPT_TOKEN`, lalu masuk ulang di perangkatmu.
- Kata sandi hanya dikirim ke `script.google.com` (halaman menolak URL lain) dan disimpan di browser perangkat itu saja. Di perangkat bersama, tekan **Keluar**.
- Jangan bagikan Google Sheet-nya. Yang punya akses ke Sheet melihat semua datamu.
- Log GitHub Actions hanya menampilkan persentase, tidak pernah nominal rupiah.
- Tombol "Sembunyikan nominal" hanya kosmetik (misalnya ada orang melihat layarmu); datanya tetap ada di halaman.
- "Harga" aset `manual` adalah angka yang kamu ketik sendiri dan sering sama dengan saldomu, jadi ikut disembunyikan.

## Sumber data dan batasannya

| Aset | Sumber | Catatan |
|---|---|---|
| Saham IDX, saham AS, kurs USD/IDR | Yahoo Finance (cadangan: Stooq untuk saham AS & kurs) | Endpoint tidak resmi tanpa kontrak; bisa berubah atau menolak IP cloud. Cadangan Stooq belum teruji ke server aslinya |
| Kripto | CoinGecko (cadangan: Yahoo `BTC-USD` × kurs) | CoinGecko memberi harga rupiah langsung tetapi bisa membalas 429 (kena batas request); skrip menunggu sesuai `Retry-After`, lalu pindah ke Yahoo. Koin yang simbol Yahoo-nya bukan `<SIMBOL>-USD` bisa diatur lewat field `yahoo` |
| Emas | Harga emas dunia (futures `GC=F`, cadangan XAUUSD) × kurs ÷ 31,1035 | Harga **internasional per gram**, bukan harga Antam/toko emas. Untuk harga Antam pakai `manual` |

- Satu "foto" per hari pukul 07.30 WIB: IDX dan bursa AS sudah tutup, kripto diambil saat itu.
- Bila satu harga gagal diambil, dipakai harga terakhir dan baris ditandai **harga lama**. Bila belum pernah ada harganya (mis. salah ketik simbol), proses **dibatalkan** dan tidak menulis apa pun, supaya total tidak diam-diam salah. Workflow gagal sehingga GitHub memberi tahumu.
- "Hari ini" dihitung dari **pergerakan harga**, bukan selisih total, jadi setoran atau penarikan dana tidak terbaca sebagai untung/rugi.
- Untung/rugi aset dolar memakai kurs hari ini untuk modal, kecuali kamu mengisi `costIdr`.
- Rincian per aset hanya disimpan 2 hari terakhir (cukup untuk perubahan harian dan harga cadangan); total, modal, dan alokasi harian disimpan terus. Satu sel Sheet maksimal 50.000 karakter, sekitar 150 aset.
- Dua perangkat yang menyimpan daftar aset bersamaan: yang terakhir menyimpan menang.

## Bila ada masalah

| Pesan | Penyebab |
|---|---|
| `unauthorized` / "Kata sandi salah" | `TOKEN` di Script properties tidak sama dengan yang kamu ketik atau isi di secret |
| "Respons bukan JSON" | URL salah, atau deploy belum *Who has access: Anyone*, atau kode diubah tanpa *New version* |
| "Daftar aset kosong" (robot) | Belum ada aset: tambah lewat **Kelola aset** |
| Workflow merah dengan daftar aset | Simbol salah ketik / sumber harga menolak. Baca daftarnya di log Actions |

## Perintah lokal

```bash
npm test                                 # tes logika, parser, dan kode Apps Script (tanpa jaringan)
npm run serve                            # situs di http://localhost:8080
APPS_SCRIPT_URL=… APPS_SCRIPT_TOKEN=… npm run update:dry   # ambil harga & ringkas, tanpa menyimpan
```

Halaman tidak bisa dibuka dengan klik dua kali `index.html` (browser memblokir pemuatan modul dari `file://`); pakai `npm run serve`.

`npm test` menjalankan `apps-script/Code.gs` apa adanya di atas **tiruan** layanan Google. Itu membuktikan logikanya, bukan perilaku Google yang asli; cek dari ujung ke ujung dilakukan saat kamu memasang (langkah 7).

## Struktur

```
index.html, kelola.html, assets/   situs statis (HTML, CSS, JS murni, tanpa data)
apps-script/Code.gs                pintu data yang ditempel di Google Sheet
scripts/update.mjs                 robot harian: baca aset, ambil harga, simpan snapshot
scripts/lib/                       hitung (dipakai juga browser), sumber harga, klien API
test/                              tes (node --test)
.github/workflows/                 jadwal harian
```

Hanya untuk pencatatan pribadi, bukan saran investasi.
