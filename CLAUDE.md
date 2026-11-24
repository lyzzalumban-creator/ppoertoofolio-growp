# Lumbung: pegangan untuk sesi kerja

Dasbor portofolio investasi **pribadi** bernama **Lumbung**. HTML/CSS/JS murni, **tanpa framework, tanpa build, tanpa library eksternal**.
Data ada di Google Sheet milik pengguna (lewat Apps Script); harga diambil robot GitHub Actions 4 kali sehari.
Repo ini **publik**, jadi tidak boleh ada data pribadi di dalamnya (kode, URL, kata sandi, nominal).

## Arsitektur dan berkas

```
Web (index.html) ──────────┐
                           ├──► Apps Script (apps-script/Code.gs) ──► Google Sheet (tab Aset, Riwayat, Transaksi)
Robot (scripts/update.mjs) ┘
```

| Berkas | Peran |
|---|---|
| `index.html`, `assets/app.js`, `assets/style.css` | Dasbor satu halaman. `app.js` hanya: ambil data (`list`) **sekali**, rute `#/…`, header, layar sambung/gagal, muat ulang, keluar, dan `safely()` (galat satu halaman dilaporkan di `#render-err`, halaman lain tetap jalan) |
| `assets/data.js` | Lapisan data web: `setData`, `recompute` (tampilan langsung), `saveAssets`, `trade`, `deleteTx`. Setiap simpan langsung memperbarui `state` lalu `notify()`, tanpa memuat ulang |
| `assets/lib.js` | Bersama semua tampilan: `TYPE`/`typeOf`/`colorOf` (tahan jenis tak dikenal), pemformat (`money`, `pct`, `delta`…), `state`, `latest()`, `canTrade()`, `toast`, `subscribe`/`notify` |
| `assets/views/*.js` | `beranda`, `detail` (rute `aset`), `analisis`, `aktivitas`, `profil`, `sheets` (semua lembar/dialog: tambah/ubah/hapus aset, beli/jual, rincian transaksi), `chart` (grafik garis, mini-grafik). Tiap halaman mengekspor `render()` dan `show(sub)` bila perlu |
| `assets/nav.js`, `assets/theme.js` | Menu utama; `theme.js` skrip biasa di `<head>` yang memasang tema sebelum halaman digambar |
| `assets/stats.js` | Hitungan murni (tanpa DOM): `liveView` (snapshot "sekarang" dari daftar aset + harga terakhir, memakai `buildSnapshot` robot), indeks return berantai dari `dayPct`, return bulanan, penurunan terdalam, urutan aset, sorotan, target, risiko, konsentrasi, per jenis. Dites di `test/stats.test.mjs` |
| `scripts/lib/trade.mjs` | Jual/beli murni: `checkTrade`, `sell` (keuntungan terealisasi, dasar modal harga rata-rata), `buy` (rata-rata tertimbang), `txRecord`, `realized`. Dites di `test/trade.test.mjs` |
| `kelola.html` | Hanya meneruskan tautan lama ke `index.html#/beranda` (Kelola sudah masuk ke dasbor) |
| `assets/creds.js`, `scripts/lib/api.mjs` | URL + kata sandi di localStorage (hanya dikirim ke `script.google.com`); klien API |
| `apps-script/Code.gs` | Ditempel **manual** oleh pengguna di Sheet-nya. Mengubahnya butuh deploy versi baru oleh pengguna; naikkan `VERSION` bila format berubah (sekarang **3**: tab Transaksi, aksi `trade` dan `deleteTx` di bawah `LockService`) |
| `scripts/update.mjs`, `scripts/lib/*` | Robot: baca aset, ambil harga (Yahoo, CoinGecko), riwayat mundur dari `buyDate`, simpan snapshot |
| `scripts/lib/privacy.mjs` | Menjaga log Actions bebas data pribadi |
| `scripts/web-version.mjs` | `npm run versi`: memberi `?v=<hash>` pada semua JS/CSS di `index.html` (import map) agar HP tidak mencampur berkas lama dan baru. **Jalankan setiap kali mengubah berkas web**; `test/version.test.mjs` gagal bila lupa |
| `.github/workflows/daily-update.yml` | Jadwal 01.30, 07.30, 13.30, 19.30 WIB |
| `test/` | Tes unit (`npm test`) dan tes browser (`npm run test:e2e`) |

Situs di-deploy GitHub Pages **langsung dari branch default** (`ccr-a48c8f74-yrr8qi`). Pekerjaan sesi masuk lewat PR ke branch itu bila pengguna memintanya.

### Kontrak data

Aset: `type` (`idx|us|crypto|gold|cash|manual`), `symbol`, `name`, `qty`, `avgCost`, `coingeckoId`, `price`, `currency`, `costIdr`, `yahoo`, `buyDate` (`YYYY-MM-DD`). **`cash`** (kas): hanya `symbol` (label bebas), `name`, `qty` (= saldo dalam mata uangnya), dan `currency` (`IDR|USD`); `avgCost`/`price`/`buyDate` tidak dipakai dan tidak disimpan. Harganya selalu 1, modal = nilai (untung/rugi selalu 0; kas dolar ikut kurs hanya di nilai dan perubahan harian). Apps Script tidak memvalidasi jenis, jadi jenis baru tidak butuh deploy ulang `Code.gs`.
Snapshot (satu per tanggal): `date, fx, total, cost, pnl, pnlPct, dayPnl, dayPct, byType{tipe:{value,weight}}, at` (jam pengambilan, ISO), `px{"jenis:kode": hargaRupiah}` (harga per aset, ada di **semua** snapshot; dipakai grafik harga dan mini-grafik) dan `positions[]` (`type, symbol, name, buyDate?, qty, price, currency, priceIdr, value, cost, pnl, pnlPct, dayPct, asOf, weight, stale?`). `positions` hanya ada di **2 snapshot terakhir**.
Transaksi (tab `Transaksi`, satu baris per jual/beli): `id` (acak, kunci anti-dobel), `date`, `kind` (`buy|sell`), `type`, `symbol`, `name`, `qty`, `price` (mata uang aset), `currency`, `fx?` (aset dolar), lalu untuk jual `costIdr`, `pnl` (mata uang aset), `pnlIdr`; `at`. `trade` menyimpan daftar aset baru **dan** mencatat transaksi dalam satu panggilan; id yang sama tidak dicatat dua kali. Menghapus catatan tidak mengubah jumlah aset.
Perubahan UI tidak boleh mengubah kontrak ini tanpa menyentuh Apps Script dan robot.

## Aturan yang harus dijaga

**Privasi (repo publik)**
- Log GitHub Actions bisa dibaca siapa pun: jangan cetak kode saham, bobot, persentase, nominal, tanggal beli, atau jumlah hari riwayat (membuka tanggal beli paling awal). Pesan error memakai nomor aset (`#2 idx`).
- Jangan menaruh URL Apps Script, kata sandi, ID Sheet, atau data asli pengguna di repo, commit, atau chat. Kata sandi tidak pernah diminta.
- Nominal tersembunyi secara bawaan di dasbor (`localStorage pf-hidden`): rupiah, jumlah unit (termasuk di Aktivitas dan rincian transaksi), harga aset manual, saldo kas. Mini-grafik hanya bentuk, tanpa angka. Lembar isian (tambah/jual) memang menampilkan angka yang sedang diketik.

**Kode (prinsip Ponytail)**
- Tulis seminimal mungkin: pakai yang sudah ada dan fitur bawaan browser (mis. `<details>`, `<dialog>`) sebelum menambah kode; jangan menambah dependensi.
- Jangan memangkas: validasi di batas kepercayaan, penanganan error yang mencegah data hilang, keamanan, aksesibilitas.
- Logika baru yang bercabang/parser/uang wajib punya tes. Hapus kode yang tidak lagi dipakai.
- Data dari Sheet bisa berbentuk aneh atau lebih baru dari web di cache HP: jangan biarkan satu galat membekukan kerangka pemuatan (lihat `safely`, `typeOf`, dan `try` di sekitar `setData`).

**Komunikasi**
- Bahasa Indonesia, ringkas. Bedakan jelas yang **sudah terbukti** dari yang **belum dicek**; jangan menyatakan berhasil tanpa bukti (tes, tangkapan layar, atau pembacaan data asli).
- Keputusan desain yang subjektif: beri rekomendasi dan sebut pilihan yang diambil, jangan bertele-tele.

## Mengerjakan UI/UX

- Warna dan tema ada sebagai token di `:root` pada `assets/style.css`, **ditulis sekali dengan `light-dark()`** (terang | gelap; butuh browser 2024+). Tema mengikuti perangkat kecuali dipaksa lewat `data-theme` (Profil > Tema, kunci `pf-theme`). Jangan menaruh warna mentah di tempat lain.
- Urutan kerja: **HP dulu** (390px), lalu desktop (1280px). Pengguna memakai HP.
- Semua teks dalam Bahasa Indonesia; angka rupiah `Rp 1.234.567`, persen `+1,23%`. Arah naik/turun selalu pakai panah dan tanda, bukan hanya warna.
- Target sentuh minimal 44px; ukuran huruf input 16px (iOS tidak memperbesar layar); hormati `prefers-reduced-motion`.

Keputusan desain yang sudah diambil (desain ulang Nov 2026 mengacu **Stocketa**, aplikasi pelacak saham yang bersih, tanpa meniru; identitas Lumbung tetap):
- **Gaya**: kartu putih bersudut besar dengan bayangan halus di latar abu dingin (gelap: hampir hitam), angka besar, grafik berwarna mengikuti arah (hijau naik, merah turun, dengan area gradasi), pil persen. Aksen **nila**, garis modal **soga** putus-putus. Semua pasangan teks/latar ≥ 4,5:1 (dicek dengan hitungan WCAG). Logo: atap lumbung di atas tiga batang naik.
- **Navigasi**: bilah menu bawah di HP (Beranda, Analisis, tombol **+** bulat di tengah, Aktivitas, Profil), jadi bilah atas yang menempel di desktop dengan tombol "Tambah". Rute hash dalam satu `index.html`: `#/beranda`, `#/aset/<encodeURIComponent(jenis:kode)>`, `#/analisis/<bagian>`, `#/aktivitas`, `#/profil`; data (Apps Script lambat) diambil sekali, tombol kembali dan tautan langsung berfungsi. Halaman aset menandai menu Beranda. Pindah halaman memberi fokus ke judul halaman dan mengganti `document.title`; `body[data-route]` menandai rute selesai diproses (dipakai tes).
- **Lembar** (`<dialog class="sheet">`): muncul dari bawah di HP, di tengah di desktop; baris tombol menempel di bawah lembar. Semua perubahan data lewat lembar: tambah/ubah/hapus aset, beli/jual (dengan pratinjau sebelum simpan), rincian transaksi. Pesan singkat (`toast`) setelah simpan.
- **Tampilan langsung**: tambah/ubah/beli/jual langsung terhitung dengan harga terakhir yang diketahui (`liveView`); aset tanpa harga tampil "Menunggu harga" dan ringkasan menyebut berapa yang belum masuk total. Kas dan manual langsung terhitung.
- **Beranda**: kartu ringkasan (total, pil "hari ini" dengan rupiah hanya bila tidak disembunyikan, Modal, Untung, **Terealisasi**, Bulan ini, garis kemajuan target), *Sorotan* (satu aset ≥ 30% atau satu jenis ≥ 60%, `cash` dan `manual` dikecualikan, plus harga lama; ambang di `LIMIT`; hanya persen), grafik nilai dengan **garis modal** (hanya saat nominal tampil) dan rentang 1/3/6 bln, 1 thn, Semua; daftar **kartu aset** (kode, nama, mini-grafik 30 hari dari `px`, nilai, persen hari ini, bar bobot) dengan cari, urut (nilai, untung, naik hari ini, nama) dan chip jenis (filter di `state`, bukan rute). Samping (desktop) / bawah (HP): Alokasi donat (ketuk jenis = saring daftar) dan *Target* (**`localStorage pf-goal`, per perangkat, tidak masuk Sheet**). Sheet kosong: ajakan "Tambah aset pertama". "Pergerakan hari ini" digantikan urutan "Naik hari ini".
- **Halaman aset**: kembali, lencana jenis + nama, nilai dan pil hari ini, grafik harga dari `px` (dolar dalam US$; manual saat tersembunyi dalam persen) dengan rentang sendiri, tombol **Beli, Jual, Ubah, Hapus** tepat di bawah grafik, statistik, aktivitas aset itu. Kas: hanya Saldo (+ setara rupiah dan kurs untuk dolar), "Ubah saldo", tanpa jual-beli. Skrip < v3: Beli/Jual `aria-disabled` dengan catatan.
- **Jual**: jumlah (+ "Jual semua"), harga per unit (terisi harga terakhir), kurs untuk aset dolar, tanggal (bawaan hari ini WIB, tidak boleh masa depan); pratinjau hasil jual, modal porsi, keuntungan terealisasi (rupiah dan %), sisa. Jual habis menghapus aset dan pindah ke Aktivitas. Id transaksi dibuat saat lembar dibuka, jadi menekan simpan lagi setelah gagal tidak dobel.
- **Aktivitas**: total keuntungan terealisasi, tahun ini (WIB), jumlah transaksi; daftar per bulan, terbaru di atas; ketuk untuk rincian dan "Hapus catatan".
- **Analisis** (sub-menu berupa tautan rute): *Kinerja* (return tertimbang waktu, penurunan terdalam, bulan terbaik/terburuk, kalender return bulanan, untung/rugi per aset), *Alokasi* (Kas dan Diinvestasikan terpisah; 3 aset terbesar dan "setara N aset" **di luar kas**; per jenis, ketuk = Beranda tersaring), *Risiko* (volatilitas setahun dari `dayPct` dengan 365 hari, penurunan saat ini, hari terbaik/terburuk; butuh ≥ 14 hari), *Riwayat* (tabel harian, 30 per halaman). Menjual tidak terbaca sebagai untung/rugi (TWR dari harga).
- **Profil**: saklar sembunyikan nominal (bawaan tersembunyi; sama dengan ikon mata di header), tema, target, status data (jumlah aset, hari riwayat, transaksi, versi Apps Script), Muat ulang, Tambah aset, Tentang, Keluar. Bisa dibuka walau data gagal.
- Tetap: kerangka pemuatan; subjudul "Diperbarui … (N jam lalu)" kuning bila lebih dari 12 jam; tombol muat ulang berupa ikon di header (`aria-busy` saat memuat).

Referensi metrik (dari rekaman layar aplikasi pelacak lain milik pengguna, Nov 2026; angka di video adalah data pribadi, jangan disalin ke repo/chat). Menu aplikasi itu: Dashboard, Analytics (Overview, Diversification, Dividends, Growth, Metrics), Calendar, Portfolio (Holdings, Transactions, Corporate actions), Profile. Metrik yang dianggap penting dan statusnya di Lumbung:
- Sudah ada: nilai total, total untung/rugi (nominal dan %), perubahan harian, grafik nilai dengan rentang waktu dan garis modal, grafik harga per aset, alokasi per jenis dan konsentrasi, return bulanan, kinerja per aset, TWR, penurunan terdalam dan saat ini, volatilitas, hari terbaik/terburuk, riwayat harian, urutan naik hari ini, peringatan konsentrasi, target nilai, pencarian aset, **jual-beli dan keuntungan terealisasi**.
- Bisa dihitung dari data sekarang, belum dibuat: Sharpe/Sortino (butuh suku bunga bebas risiko, putuskan dulu asumsinya), IRR dari `buyDate` + `cost` (hanya aset yang punya tanggal beli), rentang 7 hari dan YTD.
- Butuh data baru (ubah robot + Apps Script + `VERSION`): **pembanding indeks** (kalimat "unggul/tertinggal dari S&P 500/IHSG selama 3 bulan" + beta), dividen (yield, yield on cost, pendapatan pasif, kalender), sektor dan negara per aset, fee transaksi.

Ide yang belum dikerjakan (belum diputuskan pengguna): uji pembaca layar sungguhan; PWA (ikon di layar utama HP); tata letak tablet; dasar modal FIFO (sekarang harga rata-rata); mengubah catatan transaksi (sekarang hanya hapus). Butuh perubahan robot/Apps Script (kontrak data): **pembanding IHSG/S&P 500**, **target alokasi** per jenis, dividen/pendapatan pasif, kalender dividen/laporan keuangan. Paparan mata uang sengaja belum dibuat: kripto bertipe IDR walau bergerak mengikuti dolar, jadi angkanya akan menyesatkan.

## Menjalankan tes

```bash
npm test            # unit: logika, jual-beli, parser, kode Apps Script di atas tiruan Google (tanpa jaringan), penanda versi web
npm run test:e2e    # browser (Chromium + Playwright): ±220 cek, ±35 detik; E2E_SHOTS=1 menyimpan tangkapan layar ke test/e2e/shots/
npm run versi       # perbarui penanda ?v= setelah mengubah berkas web
npm run serve       # situs di http://localhost:8080 (jangan buka index.html lewat file://)
```

Tes browser memakai tiruan Apps Script (`test/fake-appsscript.mjs`, menjalankan `Code.gs` asli di `vm`) lewat `page.route`, jadi tidak menyentuh Sheet asli. Mode `lost` menirukan balasan yang hilang setelah Sheet berubah (uji kirim ulang). **Bila DOM berubah, perbarui selektornya dan tambah cek untuk perilaku baru.** Label `.stats dt` dan sejenisnya ditulis kapital lewat CSS, jadi `innerText` mengembalikan huruf besar; Intl di Node dan Chromium bisa beda jenis spasi, normalkan dengan `nb()`. Tiruan Google bukan bukti perilaku Google asli.
Setelah perubahan besar, lakukan uji mutasi (tanam bug, pastikan suite gagal); skripnya tidak disimpan di repo.
Integrasi robot dengan harga Yahoo asli pernah diuji di sesi sebelumnya tetapi skripnya tidak disimpan di repo.

## Status dan yang belum terbukti

- **`Code.gs` versi 3 sudah terpasang di Sheet pengguna dan teruji sungguhan** (Nov 2026, lewat iPad): deploy versi baru, Profil menyebut versi 3, satu penjualan tercatat di tab `Transaksi`. Belum diamati: kirim ulang saat jaringan putus dan dua perangkat menyimpan bersamaan (`LockService`); itu baru teruji di tiruan.
- Sheet pengguna masih berisi **data contoh** (dua aset percobaan). Sebelum memasukkan data asli: ganti aset lewat dasbor, **kosongkan tab `Riwayat`** (robot hanya mengisi celah di depan dan tidak menimpa snapshot yang ada), lalu jalankan workflow.
- Snapshot lama di Sheet pengguna belum punya `px`; grafik harga per aset terisi sejak run robot berikutnya (riwayat mundur juga mengisinya).
- Run terjadwal otomatis pertama belum pernah diamati; hanya run manual.
- Stooq (cadangan saham AS/kurs) belum teruji ke server aslinya.
- Kurs USD/IDR dari Yahoo kadang melompat ±3,5% per hari (kemungkinan data sumber kurang bersih), sehingga nilai rupiah aset dolar bergerigi; untung/rugi persen tidak terpengaruh.
- GitHub menonaktifkan jadwal otomatis di repo publik bila 60 hari tanpa aktivitas.
