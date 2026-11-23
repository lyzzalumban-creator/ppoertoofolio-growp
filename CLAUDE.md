# Portofolio: pegangan untuk sesi kerja

Dasbor portofolio investasi **pribadi**. HTML/CSS/JS murni, **tanpa framework, tanpa build, tanpa library eksternal**.
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

Keputusan desain yang sudah diambil: gaya bersih seperti aplikasi dompet/bank; kartu utama (total nilai besar, pil perubahan hari ini, mini-grafik 30 hari) + dua kartu kecil; daftar aset ringkas yang bisa dibuka (`<details>`); ikon mata untuk sembunyikan nominal (bawaan: tersembunyi); "Keluar" di bawah; tombol Muat ulang; kerangka pemuatan; subjudul "Diperbarui … (N jam lalu)" yang berubah kuning bila lebih dari 12 jam.

Ide yang belum dikerjakan (belum diputuskan pengguna): halaman Kelola aset belum disamakan gayanya dengan dasbor; audit kontras dan pembaca layar; PWA (ikon di layar utama HP); tooltip pada mini-grafik; onboarding saat pertama kali; pilihan tema/warna aksen; tata letak tablet.

## Menjalankan tes

```bash
npm test            # unit: logika, parser, kode Apps Script di atas tiruan Google (tanpa jaringan)
npm run test:e2e    # browser (Chromium + Playwright): ±79 cek; E2E_SHOTS=1 menyimpan tangkapan layar ke test/e2e/shots/
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
