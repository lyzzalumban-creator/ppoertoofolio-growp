# Lumbung

Dasbor pribadi yang menggabungkan semua portofolio investasimu (saham IDX, saham AS, kripto, emas, reksa dana, kas) di satu halaman. Aset diisi **lewat web**, data disimpan di **Google Sheet-mu sendiri**, dan harga diperbarui **4 kali sehari** (01.30, 07.30, 13.30, dan 19.30 WIB).

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
7. **Pakai:** buka situsmu, tempel URL dan kata sandi (sekali per perangkat), buka **Kelola aset** dan tambah asetmu. Lalu tab *Actions → Update harga harian → Run workflow*. Sesudah itu jalan sendiri 4 kali sehari.

Aset yang kamu tambah muncul di dasbor setelah update harga berikutnya (maksimal 1 hari, atau langsung bila kamu menekan *Run workflow*).

> **Mengubah kode Apps Script nanti?** Perubahan baru aktif setelah *Deploy → Manage deployments → Edit (ikon pensil) → Version: New version → Deploy*. URL-nya tetap sama.
>
> Bila fitur baru butuh kode Apps Script yang lebih baru (mis. tanggal beli), halaman **Kelola aset** menampilkan banner kuning "masih versi lama" dan menyembunyikan kolom yang belum didukung, supaya tidak ada data yang hilang diam-diam. Tempel `Code.gs` terbaru lalu deploy versi baru; data di Sheet tidak berubah.

## Mengisi aset

Lewat halaman **Kelola aset** (menu **Kelola** di bawah layar). Kolom yang tampil menyesuaikan jenis aset. Isinya sama dengan tab `Aset` di Sheet, yang juga boleh kamu edit langsung.

| Field | Keterangan |
|---|---|
| `type` | `idx` saham Indonesia · `us` saham AS · `crypto` kripto · `gold` emas · `cash` kas (rekening, dompet, tunai) · `manual` yang lain (reksa dana, deposito) |
| `symbol` | `idx`: kode tanpa `.JK` (mis. `BBCA`). `us`: ticker (mis. `AAPL`). `cash` dan `manual`: label bebas (mis. `BCA`, `TUNAI`) |
| `name` | Nama yang tampil (opsional) |
| `qty` | Jumlah. **`idx` dalam LEMBAR, bukan lot** (1 lot = 100 lembar). `gold` dalam gram. `manual` dalam unit. **`cash` = saldo** (dalam mata uangnya) |
| `avgCost` | Tidak dipakai untuk `cash`. Harga beli rata-rata **per unit**, dalam mata uang aset: rupiah untuk `idx`/`crypto`/`gold`/`manual`, dolar untuk `us` |
| `coingeckoId` | Wajib untuk `crypto`. Lihat "API ID" di halaman koin di coingecko.com (mis. `bitcoin`) |
| `price` | Wajib untuk `manual`: harga per unit saat ini. Kamu perbarui sendiri |
| `currency` | Hanya `manual` dan `cash`: `IDR` (default) atau `USD` |
| `costIdr` | Opsional: total modal dalam rupiah. Isi untuk aset dolar bila ingin untung/rugi memperhitungkan kurs saat beli |
| `yahoo` | Opsional: paksa simbol Yahoo Finance untuk ticker yang tidak biasa (mis. `BRK-B`) |
| `buyDate` | Opsional: tanggal beli `YYYY-MM-DD`. Bila beli beberapa kali, isi **tanggal beli pertama**. Ditampilkan ("dibeli 3 Mar 2025 · 8 bln") dan dipakai untuk [membangun riwayat mundur](#riwayat-mundur-dari-tanggal-beli); belum dipakai untuk menghitung kurs saat beli |

**Kas** (`cash`) cukup label, saldo, dan mata uang: harganya selalu 1, tanpa harga beli, dan untung/ruginya selalu nol. Saldo dolar ikut kurs USD/IDR di nilainya. Kas tidak dihitung sebagai konsentrasi risiko, dan Analisis > Alokasi menampilkan *Kas* dan *Diinvestasikan* terpisah. Menambah jenis ini **tidak** butuh menempel ulang `Code.gs`: cukup perbarui kodenya di repo.

Aset `manual` dengan `qty` 1 dan `price` = saldo (mis. deposito) adalah cara termudah mencatat sesuatu yang tidak punya harga pasar.

## Privasi

- **Repo dan situs tidak berisi data.** GitHub Pages dapat dibuka siapa saja yang tahu URL-nya, **bahkan dari repo privat** (kecuali paket Enterprise). Karena itu asetmu dan riwayatmu hanya ada di Google Sheet milikmu, dan situs mengambilnya lewat Apps Script setelah kamu memasukkan kata sandi.
- **Satu-satunya pengaman adalah kata sandi `TOKEN`.** Siapa pun yang memegang URL Apps Script *dan* kata sandinya bisa membaca dan mengubah datamu. Tidak ada pembatasan percobaan, jadi pakai kata sandi panjang dan acak. Untuk menggantinya: ubah `TOKEN` di Script properties (langsung berlaku), perbarui secret `APPS_SCRIPT_TOKEN`, lalu masuk ulang di perangkatmu.
- Kata sandi hanya dikirim ke `script.google.com` (halaman menolak URL lain) dan disimpan di browser perangkat itu saja. Di perangkat bersama, tekan **Keluar**.
- Jangan bagikan Google Sheet-nya. Yang punya akses ke Sheet melihat semua datamu.
- **Log GitHub Actions di repo publik bisa dibaca siapa pun yang punya akun GitHub.** Karena itu robot di sana **tidak mencetak** kode saham, bobot, untung/rugi, nominal, maupun tanggal beli; yang tampil hanya status dan jumlah ("2 aset, tersimpan"). Sebagai jaring pengaman, kode, nama, dan ID CoinGecko asetmu didaftarkan ke fitur penyamaran GitHub (`::add-mask::` → `***`), dan pesan error memakai **nomor aset** (urutan di daftar Kelola, mis. `#2 idx`) alih-alih kodenya. Kode 1–2 huruf (mis. `F`) tidak bisa didaftarkan ke GitHub karena akan mengaburkan huruf lain; untuknya robot menyamarkan sendiri. Di komputermu sendiri (`npm run update:dry`) log tetap lengkap.
- **Jadwal otomatis bisa dimatikan GitHub:** di repo publik, bila **60 hari tanpa aktivitas** (commit), GitHub menonaktifkan workflow terjadwal. Kamu mendapat email, dan cukup mengaktifkannya lagi di tab Actions. Dasbor menampilkan "diperbarui … (N jam lalu)" dan warnanya berubah bila lebih dari 12 jam, jadi mudah terlihat bila jadwalnya berhenti.
- **Nominal tersembunyi secara bawaan** pada kunjungan pertama di sebuah browser; ketuk ikon mata di pojok kanan atas untuk menampilkannya (pilihanmu diingat di browser itu). Ini hanya kosmetik, misalnya bila ada orang melihat layarmu: datanya tetap ada di halaman. Mini-grafik di kartu utama hanya menampilkan bentuknya, tanpa angka.
- **Halaman Analisis** (Kinerja, Alokasi, Risiko, Riwayat) menghitung return bulanan, return tertimbang waktu, penurunan, volatilitas, dan konsentrasi dari perubahan harga harian, jadi menambah atau menjual aset tidak terbaca sebagai untung/rugi. Hampir semuanya dalam persen, jadi tetap tampil saat nominal disembunyikan.
- **Menu bawah** (Beranda, Analisis, Aset, Kelola, Profil) dan **tema** (Otomatis/Terang/Gelap) diatur di halaman Profil. Target nilai disimpan di browser perangkat itu saja.
- "Harga" aset `manual` adalah angka yang kamu ketik sendiri dan sering sama dengan saldomu, jadi ikut disembunyikan. Saldo `cash` juga disamarkan.

## Sumber data dan batasannya

| Aset | Sumber | Catatan |
|---|---|---|
| Saham IDX, saham AS, kurs USD/IDR | Yahoo Finance (cadangan: Stooq untuk saham AS & kurs) | Endpoint tidak resmi tanpa kontrak; bisa berubah atau menolak IP cloud. Cadangan Stooq belum teruji ke server aslinya |
| Kripto | CoinGecko (cadangan: Yahoo `BTC-USD` × kurs) | CoinGecko memberi harga rupiah langsung tetapi bisa membalas 429 (kena batas request); skrip menunggu sesuai `Retry-After`, lalu pindah ke Yahoo. Koin yang simbol Yahoo-nya bukan `<SIMBOL>-USD` bisa diatur lewat field `yahoo` |
| Emas | Harga emas dunia (futures `GC=F`, cadangan XAUUSD) × kurs ÷ 31,1035 | Harga **internasional per gram**, bukan harga Antam/toko emas. Untuk harga Antam pakai `manual` |

- **4 kali sehari:** 07.30 WIB menangkap penutupan bursa AS dan kripto pagi, 19.30 WIB menangkap penutupan IDX (tutup sekitar 16.00 WIB), sedangkan 13.30 dan 01.30 memberi pembaruan di tengah sesi. Selama bursa buka, angka yang tampil adalah **harga terakhir**, bukan penutupan. Satu tanggal tetap satu snapshot: run berikutnya di hari yang sama menimpanya, jadi riwayat tidak membengkak. Jadwal GitHub bisa terlambat beberapa menit.
- Bila satu harga gagal diambil, dipakai harga terakhir dan baris ditandai **harga lama**. Bila belum pernah ada harganya (mis. salah ketik simbol), proses **dibatalkan** dan tidak menulis apa pun, supaya total tidak diam-diam salah. Workflow gagal sehingga GitHub memberi tahumu.
- "Hari ini" dihitung dari **pergerakan harga**, bukan selisih total, jadi setoran atau penarikan dana tidak terbaca sebagai untung/rugi.
- Untung/rugi aset dolar memakai kurs hari ini untuk modal, kecuali kamu mengisi `costIdr`.
- Rincian per aset hanya disimpan 2 hari terakhir (cukup untuk perubahan harian dan harga cadangan); total, modal, dan alokasi harian disimpan terus. Satu sel Sheet maksimal 50.000 karakter, sekitar 150 aset.
- Dua perangkat yang menyimpan daftar aset bersamaan: yang terakhir menyimpan menang.

## Riwayat mundur dari tanggal beli

Grafik digambar dari snapshot harian (satu per tanggal), dan robot baru mulai membuatnya sejak run pertama. Supaya grafik tidak menunggu berminggu-minggu, robot **mengisi riwayat ke belakang** dari harga penutupan historis Yahoo Finance, sejak `buyDate` paling awal.

- **Cara kerja:** isi **Tanggal beli** di Kelola aset, lalu jalankan *Run workflow*. Run itu mengisi semua hari dari tanggal beli sampai kemarin (satu panggilan per hari; puluhan hari = 1-3 menit). Bila riwayat sudah lengkap, tidak ada yang diulang.
- **Asumsi:** jumlah (`qty`) tiap aset dianggap **tetap sejak tanggal belinya**. Kalau kamu menambah beli di tengah jalan, nilai sebelum itu terlalu besar; ini keterbatasan satu-tanggal-per-aset.
- **Aset tanpa `buyDate` tidak ikut** (kapan mulai dimiliki tidak diketahui). Ia baru muncul sejak snapshot nyata pertama, jadi grafik nilai bisa melonjak pada hari itu. Begitu juga saat aset kedua "dibeli": nilai total naik karena aset itu mulai dihitung, bukan karena untung.
- **Batas:** maksimal 366 hari ke belakang (tanggal salah ketik seperti 2015 tidak membuat ribuan panggilan).
- **Hanya mengisi celah di depan.** Snapshot nyata yang sudah ada tidak pernah ditimpa. Mengubah tanggal beli ke tanggal yang **lebih awal** menambah riwayat di depan; mengubahnya **lebih lambat** tidak menghapus apa pun yang sudah ada.
- **Kripto** memakai harga Yahoo `<SIMBOL>-USD` × kurs pada hari itu, sedangkan snapshot harian memakai CoinGecko; selisih kecil bisa terlihat di sambungan keduanya. Akhir pekan dan libur memakai penutupan terakhir.
- **Gagal tidak menghalangi snapshot hari ini.** Bila pengambilan atau penyimpanan riwayat mundur gagal, robot memberi peringatan lalu tetap membuat snapshot hari ini; run berikutnya melanjutkan dari yang tertinggal.

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
