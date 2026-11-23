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
| `index.html`, `assets/app.js`, `assets/style.css` | Dasbor. `app.js` mengambil data (`list`) dan merender semuanya |
| `assets/stats.js` | Hitungan kinerja murni (tanpa DOM): indeks return berantai dari `dayPct`, return bulanan, penurunan terdalam, urutan aset. Dites di `test/stats.test.mjs` |
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

- Warna dan tema ada sebagai token di `:root` pada `assets/style.css` (terang, dan gelap lewat `prefers-color-scheme`). Jangan menaruh warna mentah di tempat lain.
- Urutan kerja: **HP dulu** (390px), lalu desktop (1280px). Pengguna memakai HP.
- Semua teks dalam Bahasa Indonesia; angka rupiah `Rp 1.234.567`, persen `+1,23%`. Arah naik/turun selalu pakai panah dan tanda, bukan hanya warna.
- Target sentuh minimal 44px; ukuran huruf input 16px (iOS tidak memperbesar layar); hormati `prefers-reduced-motion`.

Keputusan desain yang sudah diambil (identitas **Lumbung**, Nov 2026; terinspirasi Snowball Analytics dan PortfolioX tetapi sengaja tidak meniru):
- **Warna "Nila & Sogan"**: latar krem hangat, aksen nila (indigo batik), cokelat soga untuk garis modal; tema gelap indigo malam. Semua pasangan teks/latar ≥ 4,5:1 (dicek dengan hitungan WCAG). Logo: atap lumbung di atas tiga batang naik.
- **Kartu utama gelap** (seperti kartu bank) dengan motif kawung samar (CSS `mask`, warnanya dari token): total nilai, pil "Hari ini" dan "Sejak beli" (persen selalu tampil, rupiah hanya bila tidak disembunyikan), mini-grafik berlabel "30 hari". Dua kartu kecil: Modal, Bulan ini. Desktop: kartu kecil bertumpuk di kanan.
- **Tab** Ringkasan / Aset / Kinerja (pola ARIA tab, panah/Home/End, menempel di atas). Ringkasan: grafik nilai + **garis modal putus-putus** (hanya saat nominal tampil) + rentang 1/3/6 bln, 1 thn, Semua; Alokasi berupa donat di samping daftar jenis, mengetuk jenis membuka tab Aset yang terfilter. Aset: daftar `<details>` + pilihan **Urutkan** (nilai, untung/rugi, naik hari ini, nama). Kinerja (semua persen): return tertimbang waktu, penurunan terdalam, bulan terbaik/terburuk, **kalender return bulanan** (kotak berwarna sesuai besar gerak), batang untung/rugi per aset berpusat di nol.
- Tetap: ikon mata (bawaan: tersembunyi); "Keluar" di bawah; Muat ulang; kerangka pemuatan; subjudul "Diperbarui … (N jam lalu)" kuning bila lebih dari 12 jam.

Ide yang belum dikerjakan (belum diputuskan pengguna): halaman Kelola aset baru ikut token warna, tata letaknya belum disamakan; uji pembaca layar sungguhan; PWA (ikon di layar utama HP); onboarding saat pertama kali; tata letak tablet. Butuh perubahan robot/Apps Script (kontrak data): **pembanding IHSG/S&P 500**, **target alokasi** per jenis, dividen/pendapatan pasif, kalender dividen/laporan keuangan. Paparan mata uang sengaja belum dibuat: kripto bertipe IDR walau bergerak mengikuti dolar, jadi angkanya akan menyesatkan.

## Menjalankan tes

```bash
npm test            # unit: logika, parser, kode Apps Script di atas tiruan Google (tanpa jaringan)
npm run test:e2e    # browser (Chromium + Playwright): ±96 cek; E2E_SHOTS=1 menyimpan tangkapan layar ke test/e2e/shots/
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
