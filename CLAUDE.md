# Lumbung: pegangan untuk sesi kerja

Dasbor portofolio investasi **pribadi** bernama **Lumbung**. HTML/CSS/JS murni, **tanpa framework, tanpa build, tanpa library eksternal**.
Data ada di Google Sheet milik pengguna (lewat Apps Script); harga diambil robot GitHub Actions 4 kali sehari.
Repo ini **publik**, jadi tidak boleh ada data pribadi di dalamnya (kode, URL, kata sandi, nominal).

## Arsitektur dan berkas

```
Web (index.html, kelola.html) ──┐
                                ├──► Apps Script (apps-script/Code.gs) ──► Google Sheet (tab Aset, Riwayat)
Robot (scripts/update.mjs) ─────┘
```

| Berkas | Peran |
|---|---|
| `index.html`, `assets/app.js`, `assets/style.css` | Dasbor satu halaman. `app.js` hanya: ambil data (`list`) **sekali**, rute `#/…`, header, layar sambung/kosong/gagal, muat ulang, keluar |
| `assets/lib.js` | Bersama semua tampilan: `TYPE`, pemformat (`money`, `pct`, `delta`…), `state`, `subscribe`/`notify` (menggambar ulang semua halaman) |
| `assets/views/*.js` | Satu berkas per halaman: `beranda`, `analisis`, `aset`, `profil` (+ `chart` untuk grafik). Tiap modul mengekspor `render()` (gambar dari `state`) dan `show(sub)` bila perlu |
| `assets/nav.js`, `assets/theme.js` | Menu utama (dipakai `index.html` dan `kelola.html`); `theme.js` skrip biasa di `<head>` yang memasang tema sebelum halaman digambar |
| `assets/stats.js` | Hitungan kinerja murni (tanpa DOM): indeks return berantai dari `dayPct`, return bulanan, penurunan terdalam, urutan aset, sorotan, pergerakan harian, target, risiko, konsentrasi, per jenis. Dites di `test/stats.test.mjs` |
| `kelola.html`, `assets/kelola.js` | Tambah/ubah/hapus aset. Validasi memakai `scripts/lib/portfolio.mjs` yang sama dengan robot |
| `assets/creds.js`, `scripts/lib/api.mjs` | URL + kata sandi di localStorage (hanya dikirim ke `script.google.com`); klien API |
| `apps-script/Code.gs` | Ditempel **manual** oleh pengguna di Sheet-nya. Mengubahnya butuh deploy versi baru oleh pengguna; naikkan `VERSION` bila format berubah |
| `scripts/update.mjs`, `scripts/lib/*` | Robot: baca aset, ambil harga (Yahoo, CoinGecko), riwayat mundur dari `buyDate`, simpan snapshot |
| `scripts/lib/privacy.mjs` | Menjaga log Actions bebas data pribadi |
| `.github/workflows/daily-update.yml` | Jadwal 01.30, 07.30, 13.30, 19.30 WIB |
| `test/` | Tes unit (`npm test`) dan tes browser (`npm run test:e2e`) |

Situs di-deploy GitHub Pages **langsung dari branch default** (`ccr-a48c8f74-yrr8qi`): push, tunggu sekitar 30 detik. Tidak ada PR atau merge.

### Kontrak data

Aset: `type` (`idx|us|crypto|gold|manual`), `symbol`, `name`, `qty`, `avgCost`, `coingeckoId`, `price`, `currency`, `costIdr`, `yahoo`, `buyDate` (`YYYY-MM-DD`).
Snapshot (satu per tanggal): `date, fx, total, cost, pnl, pnlPct, dayPnl, dayPct, byType{tipe:{value,weight}}, at` (jam pengambilan, ISO) dan `positions[]` (`type, symbol, name, buyDate?, qty, price, currency, priceIdr, value, cost, pnl, pnlPct, dayPct, asOf, weight, stale?`). `positions` hanya ada di **2 snapshot terakhir**; sisanya hanya total dan alokasi. Perubahan UI tidak boleh mengubah kontrak ini tanpa menyentuh Apps Script dan robot.

## Aturan yang harus dijaga

**Privasi (repo publik)**
- Log GitHub Actions bisa dibaca siapa pun: jangan cetak kode saham, bobot, persentase, nominal, tanggal beli, atau jumlah hari riwayat (membuka tanggal beli paling awal). Pesan error memakai nomor aset (`#2 idx`).
- Jangan menaruh URL Apps Script, kata sandi, ID Sheet, atau data asli pengguna di repo, commit, atau chat. Kata sandi tidak pernah diminta.
- Nominal tersembunyi secara bawaan di dasbor (`localStorage pf-hidden`). Mini-grafik hanya bentuk, tanpa angka.

**Kode (prinsip Ponytail)**
- Tulis seminimal mungkin: pakai yang sudah ada dan fitur bawaan browser (mis. `<details>`, `<dialog>`) sebelum menambah kode; jangan menambah dependensi.
- Jangan memangkas: validasi di batas kepercayaan, penanganan error yang mencegah data hilang, keamanan, aksesibilitas.
- Logika baru yang bercabang/parser/uang wajib punya tes. Hapus kode yang tidak lagi dipakai.

**Komunikasi**
- Bahasa Indonesia, ringkas. Bedakan jelas yang **sudah terbukti** dari yang **belum dicek**; jangan menyatakan berhasil tanpa bukti (tes, tangkapan layar, atau pembacaan data asli).
- Keputusan desain yang subjektif: beri rekomendasi dan sebut pilihan yang diambil, jangan bertele-tele.

## Mengerjakan UI/UX

- Warna dan tema ada sebagai token di `:root` pada `assets/style.css`, **ditulis sekali dengan `light-dark()`** (terang | gelap; butuh browser 2024+). Tema mengikuti perangkat kecuali dipaksa lewat `data-theme` (Profil > Tema, kunci `pf-theme`). Jangan menaruh warna mentah di tempat lain.
- Urutan kerja: **HP dulu** (390px), lalu desktop (1280px). Pengguna memakai HP.
- Semua teks dalam Bahasa Indonesia; angka rupiah `Rp 1.234.567`, persen `+1,23%`. Arah naik/turun selalu pakai panah dan tanda, bukan hanya warna.
- Target sentuh minimal 44px; ukuran huruf input 16px (iOS tidak memperbesar layar); hormati `prefers-reduced-motion`.

Keputusan desain yang sudah diambil (identitas **Lumbung**, Nov 2026; terinspirasi Snowball Analytics, PortfolioX, dan sebuah aplikasi pelacak di HP pengguna, tetapi sengaja tidak meniru):
- **Warna "Nila & Sogan"**: latar krem hangat, aksen nila (indigo batik), cokelat soga untuk garis modal; tema gelap indigo malam. Semua pasangan teks/latar ≥ 4,5:1 (dicek dengan hitungan WCAG). Logo: atap lumbung di atas tiga batang naik.
- **Navigasi**: bilah menu bawah di HP (Beranda, Analisis, Aset, Kelola, Profil), jadi bilah atas yang menempel di desktop. Halaman-halaman ada dalam satu `index.html` dengan rute hash (`#/beranda`, `#/analisis/<bagian>`, `#/aset/<jenis>`, `#/profil`) supaya data (Apps Script lambat) diambil sekali dan tombol kembali serta tautan langsung berfungsi. Pindah halaman memberi fokus ke judul halaman dan mengganti `document.title`; `body[data-route]` menandai rute selesai diproses (dipakai tes). **Kelola** tetap `kelola.html` (halaman terpisah) dengan menu dan header yang sama.
- **Beranda**: kartu utama gelap bermotif kawung (total nilai, "Hari ini" dan "Sejak beli" dengan persen selalu tampil dan rupiah hanya bila tidak disembunyikan, mini-grafik "30 hari"), kartu kecil Modal dan Bulan ini; *Sorotan* (satu aset ≥ 30% atau satu jenis ≥ 60%, aset `manual` dikecualikan, plus harga lama; ambang di `LIMIT` pada `stats.js`; hanya persen); grafik nilai dengan **garis modal putus-putus** (hanya saat nominal tampil) dan rentang 1/3/6 bln, 1 thn, Semua; *Pergerakan hari ini* (3 naik dan 3 turun dari `dayPct`); Alokasi ringkas (tiap jenis menaut ke `#/aset/<jenis>`); *Target* (**disimpan di `localStorage` kunci `pf-goal`, per perangkat, tidak masuk Sheet**, nominal ikut disamarkan). Desktop: grafik kiri, Alokasi dan Target bertumpuk di kanan, Pergerakan di bawah.
- **Analisis** (sub-menu berupa tautan rute): *Kinerja* (return tertimbang waktu, penurunan terdalam, bulan terbaik/terburuk, kalender return bulanan, untung/rugi per aset), *Alokasi* (3 aset terbesar, "setara N aset", aset dan jenis terbesar, untung/rugi per jenis), *Risiko* (volatilitas setahun dari `dayPct` harian dengan 365 hari, penurunan saat ini, hari terbaik/terburuk; butuh ≥ 14 hari), *Riwayat* (tabel harian, 30 per halaman). Semua persen kecuali kolom nilai.
- **Aset**: cari (nama/kode), chip jenis (rute), urutan (nilai, untung/rugi, naik hari ini, nama), baris `<details>` yang bisa dibuka.
- **Profil**: saklar sembunyikan nominal (bawaan: tersembunyi; sama dengan ikon mata di header), tema Otomatis/Terang/Gelap, target, status data (versi Apps Script), Muat ulang, Kelola, Tentang (catatan sumber harga), Keluar. Bisa dibuka walau data kosong/gagal.
- Tetap: kerangka pemuatan; subjudul "Diperbarui … (N jam lalu)" kuning bila lebih dari 12 jam; tombol muat ulang berupa ikon di header (`aria-busy` saat memuat).

Referensi metrik (dari rekaman layar aplikasi pelacak lain milik pengguna, Nov 2026; angka di video adalah data pribadi, jangan disalin ke repo/chat). Menu aplikasi itu: Dashboard, Analytics (Overview, Diversification, Dividends, Growth, Metrics), Calendar, Portfolio (Holdings, Transactions, Corporate actions), Profile. Metrik yang dianggap penting dan statusnya di Lumbung:
- Sudah ada: nilai total, total untung/rugi (nominal dan %), perubahan harian, grafik nilai dengan rentang waktu dan garis modal, alokasi per jenis dan konsentrasi, return bulanan, kinerja per aset, TWR, penurunan terdalam dan saat ini, volatilitas, hari terbaik/terburuk, riwayat harian, aset naik/turun terbanyak, peringatan konsentrasi, target nilai, pencarian aset.
- Bisa dihitung dari data sekarang, belum dibuat: Sharpe/Sortino (butuh suku bunga bebas risiko, putuskan dulu asumsinya), IRR dari `buyDate` + `cost` (hanya aset yang punya tanggal beli), rentang 7 hari dan YTD.
- Butuh data baru (ubah robot + Apps Script + `VERSION`): **pembanding indeks** (kalimat "unggul/tertinggal dari S&P 500/IHSG selama 3 bulan" + beta), dividen (yield, yield on cost, pendapatan pasif, kalender), sektor dan negara per aset, fee dan realized P&L (butuh riwayat transaksi), saldo kas terpisah.
- Navigasi di aplikasi itu berupa **bilah menu bawah** (5 menu) dan sub-tab di Analytics; Lumbung memakai pola yang sama (dengan nama sendiri).

Ide yang belum dikerjakan (belum diputuskan pengguna): uji pembaca layar sungguhan; PWA (ikon di layar utama HP); onboarding saat pertama kali; tata letak tablet; halaman detail aset dengan grafik harga (butuh riwayat per aset: kontrak data hanya menyimpan `positions` di 2 snapshot terakhir); Kelola aset digabung ke SPA. Butuh perubahan robot/Apps Script (kontrak data): **pembanding IHSG/S&P 500**, **target alokasi** per jenis, dividen/pendapatan pasif, kalender dividen/laporan keuangan. Paparan mata uang sengaja belum dibuat: kripto bertipe IDR walau bergerak mengikuti dolar, jadi angkanya akan menyesatkan.

## Menjalankan tes

```bash
npm test            # unit: logika, parser, kode Apps Script di atas tiruan Google (tanpa jaringan)
npm run test:e2e    # browser (Chromium + Playwright): ±157 cek; E2E_SHOTS=1 menyimpan tangkapan layar ke test/e2e/shots/
npm run serve       # situs di http://localhost:8080 (jangan buka index.html lewat file://)
```

Tes browser memakai tiruan Apps Script (`test/fake-appsscript.mjs`) lewat `page.route`, jadi tidak menyentuh Sheet asli. **Bila DOM berubah, perbarui selektornya dan tambah cek untuk perilaku baru.** Tiruan Google bukan bukti perilaku Google asli.
Integrasi robot dengan harga Yahoo asli pernah diuji di sesi sebelumnya tetapi skripnya tidak disimpan di repo.

## Status dan yang belum terbukti

- Sheet pengguna masih berisi **data contoh** (dua aset percobaan). Sebelum memasukkan data asli: ganti aset di Kelola, **kosongkan tab `Riwayat`** (robot hanya mengisi celah di depan dan tidak menimpa snapshot yang ada), lalu jalankan workflow.
- Run terjadwal otomatis pertama belum pernah diamati; hanya run manual.
- Stooq (cadangan saham AS/kurs) belum teruji ke server aslinya.
- Kurs USD/IDR dari Yahoo kadang melompat ±3,5% per hari (kemungkinan data sumber kurang bersih), sehingga nilai rupiah aset dolar bergerigi; untung/rugi persen tidak terpengaruh.
- GitHub menonaktifkan jadwal otomatis di repo publik bila 60 hari tanpa aktivitas.
