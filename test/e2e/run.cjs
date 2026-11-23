// Suite browser (Chromium + Playwright). Jalankan: npm run test:e2e
// Server statis kecil dijalankan sendiri; Apps Script ditiru (test/fake-appsscript.mjs) lewat page.route.
// E2E_SHOTS=1 menyimpan tangkapan layar ke test/e2e/shots/ (diabaikan Git).
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')));
}
const ROOT = path.resolve(__dirname, '../..');
const SHOTS = process.env.E2E_SHOTS ? path.join(__dirname, 'shots') : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const shot = async (page, name, opts = {}) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), ...opts }); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const serve = () => new Promise((resolve) => {
  const srv = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  srv.listen(0, '127.0.0.1', () => resolve(srv));
});
let BASE; // diisi setelah server statis jalan
const GURL = 'https://script.google.com/macros/s/AKfycbTEST/exec';

const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };

(async () => {
  const { createFake } = await load('test/fake-appsscript.mjs');
  const { seedFake } = await load('test/e2e/seed.mjs');
  const server = await serve();
  BASE = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();

  // Satu "Google" tiruan per skenario; request ke script.google.com dialihkan ke sana.
  async function newPage({ w = 1280, h = 900, dark = false, withHistory = true, fake: given, seedOpts = {}, freshStorage = false } = {}) {
    const fake = given || createFake();
    if (!given) seedFake(fake, { withHistory, ...seedOpts });
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light' });
    // Bawaan aplikasi: nominal tersembunyi. Tes lama mengharapkan terlihat, jadi diatur '0' kecuali freshStorage.
    if (!freshStorage) await ctx.addInitScript(() => { try { if (localStorage.getItem('pf-hidden') === null) localStorage.setItem('pf-hidden', '0'); } catch {} });
    const page = await ctx.newPage();
    const env = { mode: 'ok', fake, delay: 0, calls: [], other: [], contentTypes: [] };
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
      const req = route.request();
      if (!req.url().startsWith('https://script.google.com/')) { env.other.push(req.url()); return route.abort(); }
      if (env.delay) await new Promise((r) => setTimeout(r, env.delay));
      env.calls.push(req.method());
      env.contentTypes.push(req.headers()['content-type']);
      if (env.mode === 'abort') return route.abort();
      if (env.mode === 'html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Sign in</html>' });
      const out = env.fake.call(req.postData() || '');
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
    });
    return { ctx, page, fake, env, errors };
  }
  const connect = async (page, { url = GURL, token } = {}) => {
    await page.fill('#c-url', url);
    await page.fill('#c-token', token);
    await page.getByRole('button', { name: 'Sambungkan' }).click();
  };
  // Pindah halaman lewat hashchange (asinkron): tunggu sampai app menandai rute selesai diproses.
  const routed = (page, path) => page.waitForFunction((x) => document.body.dataset.route === x, path);
  const nav = async (page, key) => { await page.locator(`#nav-${key}`).click(); await routed(page, key); };
  const goto = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await routed(page, hash.replace(/^#\/?/, '')); };
  const secretsOf = (fake) => {
    const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
    const L = fake.call({ token: fake.token, action: 'list' }).history.at(-1);
    return [L.total, L.cost, Math.abs(L.pnl), ...L.positions.flatMap((p) => [p.value, Math.abs(p.pnl)]), ...Object.values(L.byType).map((t) => t.value)].map((v) => idr.format(Math.abs(v)));
  };

  // ============ A. sambung ============
  {
    const { ctx, page, fake, env, errors } = await newPage();
    await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
    check('A1 awal: form sambung tampil, dasbor tersembunyi', (await page.locator('#connect').isVisible()) && !(await page.locator('#dash').isVisible()));
    const raw = await (await ctx.request.get(`${BASE}/index.html`)).text();
    const bodyText = await page.locator('body').innerText();
    check('A1b halaman sebelum tersambung tidak berisi angka portofolio (HTML maupun teks)', !/Rp\s?\d/.test(raw + bodyText) && !/\d{1,3}(\.\d{3}){2,}/.test(bodyText));
    check('A2 belum ada request ke Google sebelum disambungkan', env.calls.length === 0);
    await shot(page, 'v2-connect.png');

    await connect(page, { url: 'https://evil.example.com/exec', token: 'rahasia' });
    check('A3 URL bukan script.google.com ditolak', /script\.google\.com/.test(await page.locator('#c-err').innerText()));
    check('A4 kata sandi TIDAK dikirim ke domain lain', env.other.length === 0 && env.calls.length === 0, env.other.join(','));

    await page.fill('#c-token', 'salah');
    await page.fill('#c-url', GURL);
    await page.getByRole('button', { name: 'Sambungkan' }).click();
    await page.waitForFunction(() => /salah/i.test(document.getElementById('c-err').textContent));
    check('A5 kata sandi salah -> pesan jelas, tetap di form', (await page.locator('#c-err').innerText()).includes('Kata sandi salah') && (await page.locator('#connect').isVisible()));
    check('A6 kata sandi salah tidak tersimpan', (await page.evaluate(() => localStorage.getItem('pf-api'))) === null);

    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');
    check('A7 kata sandi benar -> dasbor tampil', await page.locator('.kpi').first().isVisible());
    check('A8 permintaan memakai text/plain (simple request, tanpa preflight)', env.contentTypes.every((t) => /^text\/plain/.test(t)), [...new Set(env.contentTypes)].join());
    check('A9 kredensial tersimpan di browser', !!(await page.evaluate(() => localStorage.getItem('pf-api'))));

    const before = env.calls.length;
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#dash:not([hidden])');
    check('A10 muat ulang -> langsung dasbor tanpa form', !(await page.locator('#connect').isVisible()) && env.calls.length === before + 1);
    check('A11 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============ B. dasbor ============
  {
    const { ctx, page, fake, errors } = await newPage();
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');
    check('B1 3 kartu KPI (utama + 2), 9 baris aset, 5 jenis di legenda', (await page.locator('.kpi').count()) === 3 && (await page.locator('#holdings > li').count()) === 9 && (await page.locator('.lg').count()) === 5);
    await nav(page, 'aset');
    const bbcaRow = await page.locator('#holdings > li', { hasText: 'BBCA' }).innerText();
    check('B13 dasbor menampilkan tanggal beli dan lama dimiliki', /dibeli 3 Mar 2025 \(20 bln\)/.test(bbcaRow), bbcaRow.replace(/\n/g, ' | ').slice(0, 110));
    await nav(page, 'beranda');
    const total = await page.locator('.kpi').first().innerText();
    check('B2 total berformat rupiah', /Rp\s?\d{1,3}(\.\d{3})+/.test(total), total.replace(/\n/g, ' | '));
    const navs = await page.locator('#nav a').evaluateAll((as) => as.map((a) => `${a.textContent.trim()}${a.getAttribute('aria-current') ? '*' : ''}`).join());
    check('B3 menu utama: Beranda, Analisis, Aset, Kelola, Profil; hanya Beranda yang aktif', navs === 'Beranda*,Analisis,Aset,Kelola,Profil', navs);
    const box = await page.locator('#chart svg').boundingBox();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
    check('B4 grafik + tooltip', await page.locator('#chart .tip').isVisible());
    await page.getByRole('button', { name: '1 bln' }).click();
    check('B5 rentang waktu berfungsi', (await page.getByRole('button', { name: '1 bln' }).getAttribute('aria-pressed')) === 'true');
    await page.getByRole('button', { name: 'Semua' }).click();
    await page.locator('.lg[data-type="crypto"]').click();
    await routed(page, 'aset/crypto');
    check('B6 ketuk jenis di Alokasi -> halaman Aset terbuka, hanya jenis itu, filter ada di alamat', (await page.locator('#nav-aset').getAttribute('aria-current')) === 'page' && (await page.locator('#v-aset').isVisible()) && (await page.locator('#holdings > li').count()) === 2 && /2 dari 9 aset/.test(await page.locator('#filter-note').innerText()) && page.url().endsWith('#/aset/crypto'), page.url());
    await page.getByRole('link', { name: /^Semua/ }).click();
    await routed(page, 'aset');
    check('B6b chip "Semua" melepas filter', (await page.locator('#holdings > li').count()) === 9 && page.url().endsWith('#/aset'));
    await nav(page, 'beranda');
    await shot(page, 'v6-beranda.png', { fullPage: true });

    // textContent (bukan innerText): ikut memeriksa tab yang sedang tertutup dan rincian yang belum dibuka.
    const secrets = secretsOf(fake);
    const normal = await page.locator('main').textContent();
    check('B7 kontrol: mode normal menampilkan angka milikmu', secrets.filter((s) => normal.includes(s)).length >= 2);
    await nav(page, 'aset'); // sembunyikan saat grafik tertutup: grafik rupiah lama tidak boleh tertinggal
    await page.getByRole('button', { name: 'Sembunyikan nominal' }).click();
    const hidden = await page.locator('main').textContent();
    const leaked = secrets.filter((s) => hidden.includes(s));
    check('B8 sembunyikan nominal: tidak ada angka milikmu di halaman mana pun (termasuk harga aset manual)', leaked.length === 0, leaked.join(','));
    check('B8b saat tersembunyi grafik tidak menyimpan sumbu rupiah ("jt")', !/\d+ jt/.test(hidden));
    check('B9 jumlah unit tersembunyi, persentase tetap', !/lembar/.test(hidden) && /[+−]\d+,\d{2}%/.test(hidden));
    await nav(page, 'beranda');
    check('B9b kembali ke Beranda: grafik digambar ulang dalam persen', (await page.locator('#chart svg').count()) === 1 && /%/.test(await page.locator('#chart .axis').textContent()));
    await shot(page, 'v6-hidden.png', { fullPage: true });
    check('B10 tanpa error konsol', errors.length === 0, errors.join(' | '));

    await nav(page, 'profil');
    await page.locator('#logout').click();
    check('B11 Keluar (di Profil) -> form sambung & kredensial terhapus', (await page.locator('#connect').isVisible()) && (await page.evaluate(() => localStorage.getItem('pf-api'))) === null);
    check('B12 setelah Keluar, dasbor dan datanya tidak ada di halaman', !(await page.locator('#dash').isVisible()));
    await ctx.close();
  }

  // ============ C. kelola ============
  {
    const { ctx, page, fake } = await newPage();
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');
    await page.locator('#nav-kelola').click();
    await page.waitForSelector('#list-card:not([hidden])');
    const list = () => fake.call({ token: fake.token, action: 'list' }).assets;
    check('C1 daftar menampilkan 9 aset', (await page.locator('#assets li').count()) === 9 && list().length === 9);

    // tambah kripto
    await page.getByRole('button', { name: '+ Tambah aset' }).click();
    await page.selectOption('#f-type', 'crypto');
    check('C2 jenis kripto menampilkan kolom ID CoinGecko; kolom manual tersembunyi', (await page.locator('label[data-for="crypto"]').isVisible()) && !(await page.locator('label[data-for="manual"]').first().isVisible()));
    await page.fill('#f-symbol', 'sol'); // diketik huruf kecil, harus tersimpan SOL
    await page.fill('#f-name', 'Solana');
    await page.fill('#f-coingeckoId', 'Solana'); // harus tersimpan huruf kecil
    await page.fill('#f-qty', '3.5');
    await page.fill('#f-avgCost', '2000000');
    await shot(page, 'v2-kelola-form.png');
    await page.getByRole('button', { name: 'Simpan' }).click();
    await page.waitForFunction(() => !document.getElementById('dlg').open);
    const sol = list().find((a) => a.symbol === 'SOL');
    check('C3 aset baru tersimpan di Sheet dengan tipe yang benar', sol && sol.qty === 3.5 && sol.avgCost === 2_000_000 && sol.coingeckoId === 'solana' && sol.type === 'crypto' && !('price' in sol), JSON.stringify(sol));
    check('C4 daftar ikut bertambah & ada pesan tersimpan', (await page.locator('#assets li').count()) === 10 && /Tersimpan/.test(await page.locator('#status').innerText()));

    // validasi: duplikat dan kosong
    await page.getByRole('button', { name: '+ Tambah aset' }).click();
    await page.selectOption('#f-type', 'idx');
    await page.fill('#f-symbol', 'BBCA');
    await page.fill('#f-qty', '5');
    await page.fill('#f-avgCost', '9000');
    await page.getByRole('button', { name: 'Simpan' }).click();
    await page.waitForSelector('#f-err:not([hidden])');
    check('C5 duplikat ditolak dengan pesan jelas, dialog tetap terbuka', /duplikat/.test(await page.locator('#f-err').innerText()) && (await page.locator('#dlg').evaluate((d) => d.open)));
    await page.fill('#f-symbol', 'ASII');
    await page.fill('#f-qty', '');
    await page.getByRole('button', { name: 'Simpan' }).click();
    check('C6 jumlah kosong ditolak', /qty/.test(await page.locator('#f-err').innerText()));
    check('C7 penolakan tidak mengubah Sheet', list().length === 10);
    await page.getByRole('button', { name: 'Batal' }).click();

    // ubah
    await page.locator('[data-edit="0"]').click();
    const sym0 = await page.inputValue('#f-symbol');
    await page.fill('#f-qty', '1234');
    await page.getByRole('button', { name: 'Simpan' }).click();
    await page.waitForFunction(() => !document.getElementById('dlg').open);
    check('C8 ubah jumlah tersimpan pada aset yang benar', list().find((a) => a.symbol === sym0).qty === 1234, sym0);

    // hapus
    page.once('dialog', (d) => d.accept());
    await page.locator('[data-del="9"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#assets li').length === 9);
    check('C9 hapus (setelah konfirmasi) menghapus dari Sheet', !list().some((a) => a.symbol === 'SOL') && list().length === 9);
    page.once('dialog', (d) => d.dismiss());
    await page.locator('[data-del="0"]').click();
    check('C10 batal konfirmasi tidak menghapus', list().length === 9);

    // dolar & manual
    await page.getByRole('button', { name: '+ Tambah aset' }).click();
    await page.selectOption('#f-type', 'manual');
    await page.fill('#f-symbol', 'DEPO');
    await page.fill('#f-qty', '1');
    await page.fill('#f-price', '50000000');
    await page.fill('#f-avgCost', '48000000');
    await page.getByRole('button', { name: 'Simpan' }).click();
    await page.waitForFunction(() => !document.getElementById('dlg').open);
    const depo = list().find((a) => a.symbol === 'DEPO');
    check('C11 aset manual menyimpan harga & mata uang bawaan', depo && depo.price === 50_000_000 && depo.currency === 'IDR', JSON.stringify(depo));
    // ---- tanggal beli
    await page.getByRole('button', { name: '+ Tambah aset' }).click();
    await page.selectOption('#f-type', 'us');
    await page.fill('#f-symbol', 'PANW'); await page.fill('#f-qty', '1.5'); await page.fill('#f-avgCost', '335.08');
    await page.fill('#f-buyDate', '2099-01-01');
    await page.getByRole('button', { name: 'Simpan' }).click();
    await page.waitForSelector('#f-err:not([hidden])');
    check('C12 tanggal beli di masa depan ditolak dan tidak tersimpan', /masa depan/.test(await page.locator('#f-err').innerText()) && !list().some((a) => a.symbol === 'PANW'));
    await page.fill('#f-buyDate', '2025-03-03');
    await page.getByRole('button', { name: 'Simpan' }).click();
    await page.waitForFunction(() => !document.getElementById('dlg').open);
    const panw = list().find((a) => a.symbol === 'PANW');
    check('C13 tanggal beli tersimpan sebagai teks YYYY-MM-DD', panw && panw.buyDate === '2025-03-03' && typeof panw.buyDate === 'string', JSON.stringify(panw));
    check('C14 daftar menampilkan tanggal beli', /dibeli 3 Mar 2025/.test(await page.locator('#assets').innerText()));
    const last = (await page.locator('#assets li').count()) - 1;
    await page.locator(`[data-edit="${last}"]`).click();
    check('C15 form ubah mengisi ulang tanggal', (await page.inputValue('#f-buyDate')) === '2025-03-03');
    await shot(page, 'v3-form-date.png');
    await page.fill('#f-buyDate', '');
    await page.getByRole('button', { name: 'Simpan' }).click();
    await page.waitForFunction(() => !document.getElementById('dlg').open);
    check('C16 mengosongkan tanggal menghapusnya dari Sheet', !('buyDate' in list().find((a) => a.symbol === 'PANW')));
    await shot(page, 'v2-kelola.png', { fullPage: true });
    await ctx.close();
  }

  // ============ D. kegagalan ============
  {
    const { ctx, page, fake, env } = await newPage();
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');
    // kata sandi di Apps Script diganti: tiruan baru menolak token lama yang tersimpan di browser
    env.fake = createFake({ token: 'sudah-diganti' });
    await page.reload();
    await page.waitForSelector('#c-err:not([hidden])');
    check('D1 kata sandi sudah diganti -> form sambung dengan pesan, URL terisi', /tidak cocok/.test(await page.locator('#c-err').innerText()) && (await page.inputValue('#c-url')) === GURL);
    await page.goto(`${BASE}/kelola.html`);
    await page.waitForSelector('#banner:not([hidden])');
    check('D2 kelola dengan kata sandi usang -> banner dan tautan ke dasbor', /tidak cocok/.test(await page.locator('#banner').innerText()) && (await page.locator('#banner a').getAttribute('href')) === 'index.html');
    await ctx.close();
  }
  {
    const { ctx, page, fake, env } = await newPage();
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');
    env.mode = 'abort';
    await page.reload();
    await page.waitForSelector('#banner:not([hidden])');
    check('D3 jaringan putus -> pesan jelas, bukan halaman kosong', /tidak bisa dibaca/.test(await page.locator('#banner').innerText()));
    env.mode = 'html';
    await page.reload();
    await page.waitForSelector('#banner:not([hidden])');
    check('D4 Google membalas halaman HTML -> pesan ramah', /bukan JSON/.test(await page.locator('#banner').innerText()));
    await page.locator('#relink').click();
    check('D5 "Sambungkan ulang" membersihkan dan membuka form', (await page.locator('#connect').isVisible()) && (await page.evaluate(() => localStorage.getItem('pf-api'))) === null);
    await ctx.close();
  }
  {
    const { ctx, page, fake } = await newPage({ withHistory: false });
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fake.token });
    await page.waitForSelector('#banner:not([hidden])');
    const t = await page.locator('#banner').innerText();
    check('D6 aset ada tapi riwayat kosong -> petunjuk jalankan workflow + tautan Kelola', /Belum ada data/.test(t) && (await page.locator('#banner a[href="kelola.html"]').count()) === 1, t.replace(/\n/g, ' '));
    check('D6b keadaan kosong BUKAN kegagalan: subjudul netral, banner tidak merah', !/Gagal/.test(await page.locator('#subtitle').innerText()) && !(await page.locator('#banner').evaluate((b) => b.classList.contains('error'))), await page.locator('#subtitle').innerText());
    check('D6c keadaan kosong: menu tampil (Kelola terjangkau), tombol nominal tidak, halaman data tidak', (await page.locator('#nav-kelola').isVisible()) && !(await page.locator('#privacy').isVisible()) && !(await page.locator('#v-beranda').isVisible()));
    await nav(page, 'profil');
    check('D6d keadaan kosong: Profil tetap bisa dibuka, ada Keluar dan teks "Belum ada data"', (await page.locator('#v-profil').isVisible()) && (await page.locator('#logout').isVisible()) && /Belum ada data/.test(await page.locator('#set-data').innerText()));
    await shot(page, 'v2-empty.png');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 500 } });
    const page = await ctx.newPage();
    for (const f of ['index.html', 'kelola.html']) {
      await page.goto(pathToFileURL(path.join(ROOT, f)).href);
      await page.waitForTimeout(300);
      check(`D7 ${f} dari file:// -> petunjuk npm run serve`, /npm run serve/.test(await page.locator('#banner').innerText()));
    }
    await ctx.close();
  }

  // ============ G. jam pembaruan & penanda basi ============
  for (const [label, seedOpts, want] of [
    ['G1 ada jam pembaruan', {}, { text: /^Diperbarui 23 Nov, 13\.30 WIB \(.+[\s\u00a0]lalu\)$/, stale: null }],
    ['G2 jam pembaruan sudah 3 hari -> bertanda basi', { at: '2026-11-20T06:30:00Z' }, { text: /^Diperbarui 20 Nov, 13\.30 WIB \(\d+[\s\u00a0]hari[\s\u00a0]lalu\)$/, stale: true }],
    ['G3 snapshot lama tanpa jam -> tampil data per tanggal, tidak bertanda basi', { at: null }, { text: /^Data per 23 Nov 2026$/, stale: false }],
  ]) {
    const { ctx, page, fake } = await newPage({ seedOpts });
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');
    const sub = (await page.locator('#subtitle').innerText()).trim();
    const stale = await page.locator('#subtitle').evaluate((n) => n.classList.contains('stale'));
    check(`${label}`, want.text.test(sub) && (want.stale === null || stale === want.stale), `"${sub}" stale=${stale}`);
    if (label.startsWith('G1')) {
      await nav(page, 'aset');
      const price = await page.locator('#holdings dd[data-label="Harga"]').first().getAttribute('title');
      check('G4 tooltip harga tidak lagi menyebut "Penutupan" (bisa harga tengah sesi)', /^Harga per /.test(price), price);
      await nav(page, 'profil');
      const about = await page.locator('#v-profil .prose').innerText();
      check('G5 Profil > Tentang menyebut 4 kali sehari dan bukan "sekali sehari"', /4 kali sehari/.test(about) && !/sekali sehari/.test(about));
    }
    await ctx.close();
  }

  // ============ H. tampilan baru ============
  {
    // H1-H2: nominal tersembunyi secara bawaan; pilihan diingat
    const { ctx, page, fake } = await newPage({ freshStorage: true });
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');
    const secrets = secretsOf(fake);
    const t0 = await page.locator('main').textContent();
    check('H1 kunjungan pertama: nominal tersembunyi (tanpa pernah menekan apa pun)', (await page.locator('#privacy').getAttribute('aria-label')) === 'Tampilkan nominal' && /••••••/.test(await page.locator('.kpi.hero .value').innerText()) && secrets.every((x) => !t0.includes(x)));
    await page.getByRole('button', { name: 'Tampilkan nominal' }).click();
    check('H2a setelah diketuk: nominal tampil dan tombol berganti nama', /Rp\s?\d/.test(await page.locator('.kpi.hero .value').innerText()) && (await page.locator('#privacy').getAttribute('aria-label')) === 'Sembunyikan nominal');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#dash:not([hidden])');
    check('H2b pilihan "tampil" diingat setelah muat ulang', /Rp\s?\d/.test(await page.locator('.kpi.hero .value').innerText()));
    await page.getByRole('button', { name: 'Sembunyikan nominal' }).click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#dash:not([hidden])');
    check('H2c pilihan "sembunyi" juga diingat', /••••••/.test(await page.locator('.kpi.hero .value').innerText()));
    await ctx.close();
  }
  {
    // H3-H6: kartu utama, rincian aset, muat ulang
    const { ctx, page, fake, env } = await newPage();
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');
    check('H3 kartu utama punya mini-grafik tanpa teks/angka (aman saat nominal disembunyikan), berlabel "30 hari"', (await page.locator('.kpi.hero svg.spark path.line').count()) === 1 && (await page.locator('.kpi.hero svg.spark text').count()) === 0 && (await page.locator('.kpi.hero .spark-label').innerText()) === '30 hari');
    const heroTxt = (await page.locator('.kpi.hero').innerText()).replace(/\n/g, ' ');
    check('H4 kartu utama menampilkan "Hari ini" dan "Sejak beli" dengan panah dan tanda', /Hari ini\s*[▲▼]\s*[+−]\d+,\d{2}%/.test(heroTxt) && /Sejak beli\s*[▲▼]\s*[+−]\d+,\d{2}%/.test(heroTxt), heroTxt);
    await nav(page, 'aset');
    const row = page.locator('#holdings > li', { hasText: 'BBCA' });
    check('H5a baris aset tertutup: rincian tidak terlihat', !(await row.locator('dd[data-label="Harga"]').isVisible()));
    await row.locator('summary').click();
    check('H5b ketuk baris -> rincian terbuka (harga, jumlah, untung/rugi, modal)', (await row.locator('dd[data-label="Harga"]').isVisible()) && /Jumlah/.test(await row.innerText()) && /Modal/.test(await row.innerText()));
    await page.locator('#privacy').click(); // render ulang
    check('H5c baris yang terbuka tetap terbuka setelah render ulang', await row.locator('dd[data-label="Harga"]').isVisible());
    await nav(page, 'beranda');
    await page.locator('.lg[data-type="idx"]').click();
    await routed(page, 'aset/idx');
    await page.getByRole('link', { name: /^Semua/ }).click();
    await routed(page, 'aset');
    check('H5d dan tetap terbuka setelah filter dipasang-dilepas', await row.locator('dd[data-label="Harga"]').isVisible());

    // muat ulang: panggilan baru ke Sheet, dan jam pembaruan ikut berganti
    const hist = fake.call({ token: fake.token, action: 'list' }).history;
    const lastSnap = hist.at(-1);
    const n0 = env.calls.length;
    fake.call({ token: fake.token, action: 'appendSnapshot', snapshot: { ...lastSnap, at: '2026-11-23T09:45:00Z' } });
    await page.getByRole('button', { name: 'Muat ulang', exact: true }).click();
    await page.waitForFunction(() => /16\.45 WIB/.test(document.getElementById('subtitle').textContent));
    check('H6 Muat ulang mengambil data baru tanpa memuat ulang halaman', env.calls.length === n0 + 1 && /16\.45 WIB/.test(await page.locator('#subtitle').innerText()));
    check('H6b tombol muat ulang kembali aktif, tidak lagi sibuk, namanya tetap', (await page.locator('#reload').isEnabled()) && (await page.locator('#reload').getAttribute('aria-busy')) === null && (await page.locator('#reload').getAttribute('aria-label')) === 'Muat ulang');
    await ctx.close();
  }
  {
    // H7: kerangka pemuatan selama data lambat datang
    const { ctx, page, fake, env } = await newPage();
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');
    env.delay = 1500;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(250);
    check('H7a selama menunggu: kerangka tampil, dasbor dan form belum', (await page.locator('#skeleton').isVisible()) && !(await page.locator('#dash').isVisible()) && !(await page.locator('#connect').isVisible()));
    await page.waitForSelector('#dash:not([hidden])');
    check('H7b setelah data tiba: kerangka hilang', !(await page.locator('#skeleton').isVisible()));
    await ctx.close();
  }
  {
    // H8: kode aset pasar tampil huruf besar walau tersimpan huruf kecil; label manual dibiarkan
    const { buildSnapshot } = await load('scripts/lib/portfolio.mjs');
    const fk = createFake();
    const assets = [{ type: 'us', symbol: 'panw', qty: 1, avgCost: 100 }, { type: 'manual', symbol: 'Depo Bca', qty: 1, price: 5_000_000, avgCost: 4_000_000 }];
    fk.call({ token: fk.token, action: 'saveAssets', assets });
    const snap = buildSnapshot({ date: '2026-11-23', assets, quotes: new Map([['us:panw', { price: 120, asOf: '2026-11-20' }], ['manual:Depo Bca', { price: 5_000_000, asOf: '2026-11-23' }]]), fx: 16_000 });
    fk.call({ token: fk.token, action: 'appendSnapshot', snapshot: { ...snap, at: '2026-11-23T06:30:00Z' } });
    const { ctx, page } = await newPage({ fake: fk });
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fk.token });
    await page.waitForSelector('#dash:not([hidden])');
    const list = await page.locator('#holdings').innerText();
    check('H8 "panw" tampil PANW; label manual "Depo Bca" tidak diubah', /PANW/.test(list) && !/panw/.test(list) && /Depo Bca/.test(list), list.replace(/\n/g, ' | ').slice(0, 120));
    check('H8b hanya satu hari data: kartu utama tanpa mini-grafik dan memberi tahu "belum ada pembanding"', (await page.locator('.kpi.hero svg.spark').count()) === 0 && /belum ada pembanding/.test(await page.locator('.kpi.hero .today').innerText()));
    await goto(page, '#/analisis/kinerja');
    check('H8c hanya satu hari data: tab Kinerja memberi tahu butuh 2 hari, tanpa metrik palsu', /minimal 2 hari/.test(await page.locator('#months').innerText()) && (await page.locator('#metrics .tile').count()) === 0);
    await ctx.close();
  }

  // ============ I. identitas, menu, rute, urutan, garis modal, kinerja ============
  {
    const { ctx, page, fake, env, errors } = await newPage();
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');
    check('I0 identitas: judul halaman dan nama Lumbung', (await page.title()) === 'Beranda · Lumbung' && (await page.locator('h1').innerText()) === 'Lumbung');

    const views = () => page.evaluate(() => ['beranda', 'analisis', 'aset', 'profil'].map((k) => `${k}:${!document.getElementById(`v-${k}`).hidden}`).join());
    check('I1 awal: hanya Beranda yang tampil', (await views()) === 'beranda:true,analisis:false,aset:false,profil:false', await views());

    // Pindah halaman tidak boleh mengambil data lagi (Apps Script lambat).
    const n0 = env.calls.length;
    const seen = [];
    for (const k of ['analisis', 'aset', 'profil', 'beranda']) { await nav(page, k); seen.push(await views()); }
    check('I2 pindah halaman lewat menu: satu halaman tampil tiap kali, TANPA memanggil Sheet lagi', env.calls.length === n0 && seen.every((v) => v.split(',').filter((x) => x.endsWith('true')).length === 1), `${env.calls.length - n0} panggilan tambahan`);
    await nav(page, 'analisis');
    check('I3 judul dokumen dan fokus ikut pindah (pembaca layar tahu halaman berganti)', (await page.title()) === 'Analisis · Lumbung' && (await page.evaluate(() => document.activeElement.id)) === 'vt-analisis');
    await page.goBack();
    check('I4 tombol kembali membawa ke halaman sebelumnya', (await views()).startsWith('beranda:true') && (await page.locator('#nav-beranda').getAttribute('aria-current')) === 'page');
    await page.goto(`${BASE}/index.html#/aset/crypto`);
    await page.waitForSelector('#v-aset:not([hidden])');
    check('I5 tautan langsung #/aset/crypto: daftar Aset terfilter, chip Kripto aktif', (await page.locator('#holdings > li').count()) === 2 && /Kripto/.test(await page.locator('#chips a[aria-current="page"]').innerText()));
    await goto(page, '#/aset/ngawur');
    check('I5b jenis tak dikenal = Semua', (await page.locator('#holdings > li').count()) === 9 && /^Semua/.test(await page.locator('#chips a[aria-current="page"]').innerText()));
    await goto(page, '#/halaman-tidak-ada');
    check('I5c rute tak dikenal = Beranda', (await views()).startsWith('beranda:true'));

    // urutan aset
    const L = fake.call({ token: fake.token, action: 'list' }).history.at(-1);
    const want = (f) => [...L.positions].sort(f).map((p) => p.symbol).join();
    const order = () => page.evaluate(() => [...document.querySelectorAll('#holdings details')].map((d) => d.dataset.key.split(':')[1]).join());
    await nav(page, 'aset');
    const byVal = await order();
    await page.selectOption('#sort', 'pnlPct');
    const byPnl = await order();
    await page.selectOption('#sort', 'name');
    const byName = await order();
    check('I6 Urutkan: nilai, untung/rugi, nama', byVal === want((a, b) => b.value - a.value) && byPnl === want((a, b) => b.pnlPct - a.pnlPct) && byName === want((a, b) => a.name.localeCompare(b.name, 'id')), `${byPnl} | ${byName}`);
    await page.selectOption('#sort', 'value');

    // garis modal
    await nav(page, 'beranda');
    check('I7 grafik nominal punya garis modal putus-putus dan keterangannya', (await page.locator('#chart path.cost').count()) === 1 && /Modal/.test(await page.locator('#chart-key').innerText()));
    await page.locator('#privacy').click();
    check('I7b saat tersembunyi (grafik persen): tanpa garis modal', (await page.locator('#chart path.cost').count()) === 0 && (await page.locator('#chart-key').innerText()) === '');
    await page.locator('#privacy').click();

    // kinerja, dibandingkan dengan hitungan dari riwayat tiruan
    const { returnIndex, monthlyReturns } = await load('assets/stats.js');
    const hist = fake.call({ token: fake.token, action: 'list' }).history;
    const months = monthlyReturns(hist);
    const p2 = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    await goto(page, '#/analisis/kinerja');
    const tiles = await page.locator('#metrics .tile').allInnerTexts();
    check('I8 Kinerja: 4 metrik; return tertimbang waktu = hitungan berantai dari dayPct', tiles.length === 4 && tiles[0].includes(p2(returnIndex(hist).at(-1).idx - 1)), tiles[0].replace(/\n/g, ' '));
    check('I9 kalender: satu kotak per bulan (maks. 12) dengan panah dan tanda', (await page.locator('#months .mo').count()) === Math.min(12, months.length) && (await page.locator('#months .mo').last().innerText()).includes(p2(months.at(-1).ret)));
    const prOrder = (await page.locator('#perf .pr-n').allInnerTexts()).join();
    check('I10 untung/rugi per aset: satu batang per aset, terurut dari tertinggi', prOrder === want((a, b) => b.pnlPct - a.pnlPct), prOrder);
    await nav(page, 'beranda');
    check('I11 kartu "Bulan ini" sama dengan bulan terakhir di kalender', (await page.locator('.kpi', { hasText: 'Bulan ini' }).innerText()).includes(p2(months.at(-1).ret)));
    check('I12 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============ K. Analisis, cari aset, Profil, tema ============
  {
    const stats = await load('assets/stats.js');
    const { ctx, page, fake, errors } = await newPage();
    await page.goto(`${BASE}/index.html#/analisis`);
    await connect(page, { token: fake.token });
    await page.waitForSelector('#v-analisis:not([hidden])');
    const hist = fake.call({ token: fake.token, action: 'list' }).history;
    const L = hist.at(-1);
    const p2 = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    const p1 = (v) => `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
    check('K1 #/analisis tanpa bagian = Kinerja; sub-menu menandai bagian yang aktif', (await page.locator('#an-kinerja').isVisible()) && !(await page.locator('#an-risiko').isVisible()) && /Kinerja/.test(await page.locator('#subnav a[aria-current="page"]').innerText()));

    // Alokasi
    await page.locator('#subnav').getByRole('link', { name: 'Alokasi' }).click();
    await routed(page, 'analisis/alokasi');
    const ts = stats.byTypePnl(L.positions);
    const tOrder = Object.keys(ts).sort((a, b) => ts[b].value - ts[a].value);
    const hrefs = await page.locator('#types a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    check('K2 Alokasi: satu baris per jenis, urut dari nilai terbesar, tiap baris menaut ke Aset terfilter', JSON.stringify(hrefs) === JSON.stringify(tOrder.map((t) => `#/aset/${t}`)), hrefs.join());
    check('K2b untung/rugi jenis terbesar = hitungan dari posisi', (await page.locator('#types a').first().innerText()).includes(p2(ts[tOrder[0]].pnlPct)));
    const c = stats.concentration(L.positions);
    const ct = await page.locator('#conc .tile').allInnerTexts();
    check('K3 konsentrasi: 3 aset terbesar dan "setara N aset" sesuai hitungan', ct.length === 4 && ct[0].includes(p1(c.top3)) && ct[1].includes(`${c.effective.toLocaleString('id-ID', { maximumFractionDigits: 1 })} aset`), ct.slice(0, 2).join(' | ').replace(/\n/g, ' '));

    // Risiko
    await page.locator('#subnav').getByRole('link', { name: 'Risiko' }).click();
    await routed(page, 'analisis/risiko');
    const r = stats.riskStats(hist);
    const dd = stats.currentDrawdown(stats.returnIndex(hist));
    const rt = await page.locator('#risk .tile').allInnerTexts();
    check('K4 Risiko: volatilitas, penurunan saat ini, hari terbaik dan terburuk sesuai hitungan', rt.length === 4 && rt[0].includes(p1(r.vol)) && rt[1].includes(p2(dd.pct)) && rt[2].includes(p2(r.best.pct)) && rt[3].includes(p2(r.worst.pct)), rt.join(' | ').replace(/\n/g, ' '));

    // Riwayat
    await page.locator('#subnav').getByRole('link', { name: 'Riwayat' }).click();
    await routed(page, 'analisis/riwayat');
    const rows = () => page.locator('#hist tbody tr').count();
    const first = (await page.locator('#hist tbody tr').first().innerText()).replace(/\s+/g, ' ');
    check('K5 Riwayat: 30 hari dulu, terbaru di atas (23 Nov 2026), dengan nilai dan persen', (await rows()) === 30 && /^23 Nov 2026 Rp/.test(first) && /[▲▼]/.test(first), first);
    await page.locator('#hist-more').click();
    const after1 = await rows();
    for (let i = 0; i < 3; i++) if (await page.locator('#hist-more').isVisible()) await page.locator('#hist-more').click();
    check('K5b "Tampilkan lebih banyak" menambah 30 per ketukan, hilang bila semua sudah tampil', after1 === 60 && (await rows()) === hist.length && !(await page.locator('#hist-more').isVisible()), `${after1} -> ${await rows()} dari ${hist.length}`);
    await page.locator('#privacy').click();
    check('K5c nominal tersembunyi: kolom Nilai tersamar, persen tetap', !/\d{1,3}(\.\d{3}){2,}/.test(await page.locator('#hist tbody').innerText()) && /[+−]\d+,\d{2}%/.test(await page.locator('#hist tbody').innerText()));
    await page.locator('#privacy').click();

    // Cari aset
    await goto(page, '#/aset');
    const nAset = () => page.locator('#holdings details').count();
    await page.locator('#q').pressSequentially('ba');
    check('K6 mengetik di kolom cari tidak menghilangkan fokus atau isinya', (await page.evaluate(() => document.activeElement.id)) === 'q' && (await page.inputValue('#q')) === 'ba');
    await page.fill('#q', 'bank');
    check('K6b cari "bank": hanya Bank Central Asia, catatan "1 dari 9 aset"', (await nAset()) === 1 && /Bank Central Asia/.test(await page.locator('#holdings').innerText()) && /1 dari 9 aset/.test(await page.locator('#filter-note').innerText()));
    await page.fill('#q', 'tlkm');
    check('K6c cari lewat kode (besar/kecil sama saja)', (await nAset()) === 1 && /Telkom/.test(await page.locator('#holdings').innerText()));
    await page.fill('#q', 'zzz');
    check('K6d tidak ada yang cocok: pesan jelas', (await nAset()) === 0 && /Tidak ada aset yang cocok/.test(await page.locator('#holdings').innerText()));
    await goto(page, '#/aset/crypto');
    await page.fill('#q', 'eth');
    check('K6e filter jenis dan cari digabung', (await nAset()) === 1 && /Ethereum/.test(await page.locator('#holdings').innerText()) && /1 dari 9 aset/.test(await page.locator('#filter-note').innerText()));
    await page.fill('#q', '');

    // Profil
    await nav(page, 'profil');
    check('K7 Profil: saklar nominal mencerminkan pilihan (uji ini: nominal tampil)', (await page.locator('#set-hide').getAttribute('aria-checked')) === 'false');
    await page.locator('#set-hide').click();
    check('K7b saklar -> nominal tersembunyi; tombol mata di header dan penyimpanan ikut', (await page.locator('#set-hide').getAttribute('aria-checked')) === 'true' && (await page.locator('#privacy').getAttribute('aria-label')) === 'Tampilkan nominal' && (await page.evaluate(() => localStorage.getItem('pf-hidden'))) === '1');
    await page.locator('#privacy').click();
    check('K7c tombol mata di header mengembalikan saklar', (await page.locator('#set-hide').getAttribute('aria-checked')) === 'false');
    check('K7d data: jumlah aset, hari riwayat, versi skrip', new RegExp(`^9 aset, riwayat ${hist.length} hari\\. Skrip Apps Script versi \\d`).test(await page.locator('#set-data').innerText()), await page.locator('#set-data').innerText());
    check('K7e target belum diatur', /Belum diatur/.test(await page.locator('#set-goal').innerText()));
    await page.locator('#v-profil [data-goal="open"]').click();
    await page.fill('#goal-input', '150000000');
    await page.getByRole('button', { name: 'Simpan' }).click();
    const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
    check('K8 target diatur dari Profil: tampil di Profil, dan di Beranda', (await page.locator('#set-goal').innerText()).includes(idr.format(150_000_000)) && (await page.locator('#goal').textContent()).includes(idr.format(150_000_000)));
    await page.locator('#set-hide').click();
    check('K8b nominal tersembunyi: target di Profil ikut tersamar', !(await page.locator('#set-goal').innerText()).includes('150.000.000'));
    check('K9 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // Tema: Otomatis mengikuti perangkat; Terang/Gelap memaksa; pilihan diingat dan terpasang sebelum halaman digambar
    const LIGHT = 'rgb(245, 241, 234)', DARK = 'rgb(17, 18, 37)';
    for (const [deviceDark, forced, forcedBg, deviceBg] of [[false, 'dark', DARK, LIGHT], [true, 'light', LIGHT, DARK]]) {
      const { ctx, page, fake } = await newPage({ dark: deviceDark });
      await page.goto(`${BASE}/index.html#/profil`);
      await connect(page, { token: fake.token });
      await page.waitForSelector('#v-profil:not([hidden])');
      const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const tag = deviceDark ? 'perangkat gelap' : 'perangkat terang';
      check(`K10 tema Otomatis mengikuti ${tag}`, (await bg()) === deviceBg && (await page.evaluate(() => document.documentElement.dataset.theme)) === undefined, await bg());
      await page.selectOption('#set-theme', forced);
      check(`K10b pilih ${forced === 'dark' ? 'Gelap' : 'Terang'} di ${tag}: warna dipaksa, tersimpan`, (await bg()) === forcedBg && (await page.evaluate(() => localStorage.getItem('pf-theme'))) === forced, await bg());
      await page.reload({ waitUntil: 'domcontentloaded' });
      check('K10c setelah muat ulang tema sudah terpasang sejak awal (tanpa kedip)', (await page.evaluate(() => document.documentElement.dataset.theme)) === forced);
      await page.waitForSelector('#v-profil:not([hidden])');
      check('K10d pilihan tampil di menu Tema', (await page.inputValue('#set-theme')) === forced);
      await page.selectOption('#set-theme', 'auto');
      check('K10e kembali ke Otomatis: paksaan dilepas dan penyimpanan bersih', (await bg()) === deviceBg && (await page.evaluate(() => localStorage.getItem('pf-theme'))) === null);
      await ctx.close();
    }
  }

  // ============ J. halaman depan: sorotan, pergerakan hari ini, target ============
  {
    const { dayMovers } = await load('assets/stats.js');
    const { ctx, page, fake, errors } = await newPage();
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');
    const L = fake.call({ token: fake.token, action: 'list' }).history.at(-1);
    const pctTxt = (w) => `${(w * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;

    // Sorotan
    const top = [...L.positions].filter((p) => p.type !== 'manual').sort((a, b) => b.weight - a.weight)[0];
    const ins = await page.locator('#insight-list').innerText();
    check('J1 sorotan: aset terbesar (≥30%) diperingatkan dengan bobotnya, tanpa nominal', top.weight >= 0.3 && ins.includes(top.name) && ins.includes(pctTxt(top.weight)) && !/Rp|\d{1,3}(\.\d{3}){2,}/.test(ins), ins.replace(/\n/g, ' '));
    check('J1b sorotan punya judul tersembunyi untuk pembaca layar dan tidak menyaingi tab', (await page.locator('#ins-h').innerText()) === 'Perlu diperhatikan');

    // Pergerakan hari ini
    const mv = dayMovers(L.positions);
    const names = (grp) => page.locator('.mv-group', { hasText: grp }).locator('.n').evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim()));
    const sym = (p) => (p.type === 'manual' ? p.symbol : String(p.symbol).toUpperCase());
    check('J2 pergerakan hari ini: naik dan turun terbanyak sesuai hitungan, urut menurut persen', JSON.stringify(await names('Naik terbanyak')) === JSON.stringify(mv.gainers.map(sym)) && JSON.stringify(await names('Turun terbanyak')) === JSON.stringify(mv.losers.map(sym)), `${await names('Naik terbanyak')} | ${await names('Turun terbanyak')}`);
    check('J2b setiap baris pergerakan memakai panah dan tanda', /▲\s*\+\d/.test(await page.locator('.mv-group', { hasText: 'Naik terbanyak' }).innerText()) && /▼\s*−\d/.test(await page.locator('.mv-group', { hasText: 'Turun terbanyak' }).innerText()));

    // Target
    check('J3 belum ada target: ajakan dan tombol Atur target', /Tetapkan target/.test(await page.locator('#goal').innerText()) && (await page.locator('#goal [data-goal="open"]').innerText()) === 'Atur target');
    await page.locator('#goal [data-goal="open"]').click();
    check('J3b dialog terbuka, "Hapus target" belum tampil', (await page.locator('#goal-dlg').evaluate((d) => d.open)) && !(await page.locator('#goal-del').isVisible()));
    for (const bad of ['', '0', '-5']) {
      await page.fill('#goal-input', bad);
      await page.getByRole('button', { name: 'Simpan' }).click();
      if (!(await page.locator('#goal-err').isVisible()) || !(await page.locator('#goal-dlg').evaluate((d) => d.open))) { check(`J4 target "${bad}" ditolak dan dialog tetap terbuka`, false); break; }
    }
    check('J4 target kosong, 0, atau negatif ditolak; tidak ada yang tersimpan', (await page.evaluate(() => localStorage.getItem('pf-goal'))) === null);
    const goal = 150_000_000;
    await page.fill('#goal-input', String(goal));
    await page.getByRole('button', { name: 'Simpan' }).click();
    const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
    const wantPct = Math.floor((L.total / goal) * 100);
    const gtxt = await page.locator('#goal').innerText();
    check('J5 target tersimpan: persen = total ÷ target (dibulatkan ke bawah), sisa dan target tampil', !(await page.locator('#goal-dlg').evaluate((d) => d.open)) && gtxt.includes(`${wantPct}%`) && gtxt.includes(idr.format(goal)) && gtxt.includes(`Sisa ${idr.format(goal - L.total)}`), gtxt.replace(/\n/g, ' '));
    check('J5b cincin punya label untuk pembaca layar', (await page.locator('#goal .ring').getAttribute('aria-label')) === `${wantPct} persen menuju target`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#dash:not([hidden])');
    check('J6 target diingat setelah muat ulang', (await page.locator('#goal').innerText()).includes(`${wantPct}%`));

    // nominal tersembunyi: target dan sisa ikut disamarkan, persen tetap
    await page.locator('#privacy').click();
    const hid = await page.locator('main').textContent();
    check('J7 nominal tersembunyi: target dan sisa tidak bocor, persen tetap', !hid.includes(idr.format(goal)) && !hid.includes(idr.format(goal - L.total)) && (await page.locator('#goal').innerText()).includes(`${wantPct}%`));
    await page.locator('#privacy').click();

    // ubah, batal, hapus
    await page.locator('#goal [data-goal="open"]').click();
    check('J8 dialog ubah terisi target lama dan menawarkan Hapus', (await page.inputValue('#goal-input')) === String(goal) && (await page.locator('#goal-del').isVisible()));
    await page.fill('#goal-input', '1000');
    await page.getByRole('button', { name: 'Batal' }).click();
    check('J8b Batal tidak mengubah target', (await page.evaluate(() => localStorage.getItem('pf-goal'))) === String(goal));
    await page.locator('#goal [data-goal="open"]').click();
    await page.fill('#goal-input', '1000'); // jauh di bawah total
    await page.getByRole('button', { name: 'Simpan' }).click();
    check('J9 target sudah terlewati: "Target tercapai", cincin 100%', /Target tercapai/.test(await page.locator('#goal').innerText()) && (await page.locator('#goal .hole').innerText()) === '100%');
    await page.locator('#goal [data-goal="open"]').click();
    await page.getByRole('button', { name: 'Hapus target' }).click();
    check('J10 Hapus target: kembali ke ajakan dan localStorage bersih', /Tetapkan target/.test(await page.locator('#goal').innerText()) && (await page.evaluate(() => localStorage.getItem('pf-goal'))) === null);

    // tata letak desktop: Alokasi dan Target bertumpuk di kanan grafik, Pergerakan di bawah keduanya
    const bb = (sel) => page.locator(sel).boundingBox();
    const [chart, alloc, g, mvBox] = [await bb('.g-chart'), await bb('.g-alloc'), await bb('.g-goal'), await bb('.g-moves')];
    check('J11 desktop: Alokasi dan Target bertumpuk di kolom kanan; Pergerakan di bawah grafik', Math.abs(alloc.x - g.x) < 1 && g.y >= alloc.y + alloc.height && alloc.x > chart.x + chart.width - 1 && mvBox.y >= chart.y + chart.height && mvBox.y >= g.y + g.height - 1, JSON.stringify({ chart, alloc, g, mvBox }));
    check('J12 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await shot(page, 'v5-dash.png', { fullPage: true });
    await ctx.close();
  }
  {
    // portofolio seimbang (5 aset x 20%, 5 jenis) dan hanya satu hari data: tanpa sorotan, tanpa pembanding
    const { buildSnapshot } = await load('scripts/lib/portfolio.mjs');
    const fk = createFake();
    const assets = [
      { type: 'idx', symbol: 'AAA', qty: 1, avgCost: 90 }, { type: 'us', symbol: 'BBB', qty: 1, avgCost: 90 },
      { type: 'crypto', symbol: 'CCC', coingeckoId: 'ccc', qty: 1, avgCost: 90 }, { type: 'gold', symbol: 'XAU', qty: 1, avgCost: 90 },
      { type: 'manual', symbol: 'DDD', qty: 1, price: 100, avgCost: 90 },
    ];
    fk.call({ token: fk.token, action: 'saveAssets', assets });
    const quotes = new Map(assets.map((a) => [`${a.type}:${a.symbol}`, { price: 100, asOf: '2026-11-23' }]));
    fk.call({ token: fk.token, action: 'appendSnapshot', snapshot: { ...buildSnapshot({ date: '2026-11-23', assets, quotes, fx: 1 }), at: '2026-11-23T06:30:00Z' } });
    const { ctx, page } = await newPage({ fake: fk });
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fk.token });
    await page.waitForSelector('#dash:not([hidden])');
    check('J13 portofolio seimbang: tidak ada sorotan sama sekali', !(await page.locator('#insights').isVisible()) && (await page.locator('.insight').count()) === 0);
    check('J14 satu hari data: pergerakan hari ini memberi tahu belum ada pembanding', /Belum ada pergerakan/.test(await page.locator('#movers').innerText()) && (await page.locator('.mv-group').count()) === 0);
    await ctx.close();
  }

  // ============ F. skrip Apps Script LAMA (belum mengenal tanggal beli) ============
  {
    const { ctx, page, fake, env } = await newPage();
    const sent = [];
    env.fake = { token: fake.token, call: (p) => {
      try { const q = JSON.parse(p); if (q.action === 'saveAssets') sent.push(...q.assets); } catch {}
      const r = fake.call(p);
      if (r && r.version) delete r.version; // skrip lama tidak melaporkan versi
      return r;
    } };
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');
    await page.goto(`${BASE}/kelola.html`);
    await page.waitForSelector('#list-card:not([hidden])');
    const bn = await page.locator('#banner');
    check('F1 skrip lama -> banner peringatan (bukan merah) dengan petunjuk Deploy', /versi lama/.test(await bn.innerText()) && /New version/.test(await bn.innerText()) && !(await bn.evaluate((b) => b.classList.contains('error'))));
    await page.getByRole('button', { name: '+ Tambah aset' }).click();
    check('F2 kolom tanggal beli disembunyikan di form', !(await page.locator('#buy-field').isVisible()));
    await page.fill('#f-symbol', 'ASII'); await page.fill('#f-qty', '1'); await page.fill('#f-avgCost', '5000');
    await page.getByRole('button', { name: 'Simpan' }).click();
    await page.waitForFunction(() => !document.getElementById('dlg').open);
    const asii = fake.call({ token: fake.token, action: 'list' }).assets.find((a) => a.symbol === 'ASII');
    check('F3 menyimpan tetap berhasil, tanpa pernah mengirim buyDate ke skrip lama', !!asii && !sent.some((a) => 'buyDate' in a && a.symbol !== 'BBCA'), `terkirim buyDate: ${sent.filter((a) => 'buyDate' in a).map((a) => a.symbol).join() || 'tidak ada'}`);
    await ctx.close();
  }

  // ============ E. HP, gelap ============
  {
    const { ctx, page, fake, errors } = await newPage({ w: 390, h: 844, dark: true });
    await page.goto(`${BASE}/index.html`);
    await shot(page, 'v2-m-connect.png');
    check('E0 sebelum tersambung: menu utama belum tampil', !(await page.locator('#nav').isVisible()));
    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');

    // Target sentuh: aturan proyek minimal 44 px (HP dulu). Elemen yang tersembunyi tidak ikut (lebar 0).
    const tooSmall = (sel) => page.evaluate((q) => [...document.querySelectorAll(q)].filter((el) => { const r = el.getBoundingClientRect(); return r.width && (r.height < 44 || r.width < 44); }).map((el) => `${el.id || el.textContent.trim().slice(0, 20)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`), sel);
    const TOUCH = '#nav a, #subnav a, .seg button, .lg, .ty, .chips a, #q, #sort, .asset-row summary, .switch, #set-theme, .set-actions .btn, .set-row .btn, #hist-more, #privacy, #reload, #goal .btn, #logout';
    const small = [], over = [];
    for (const r of ['beranda', 'analisis/kinerja', 'analisis/alokasi', 'analisis/risiko', 'analisis/riwayat', 'aset', 'aset/crypto', 'profil']) {
      await goto(page, `#/${r}`);
      await page.waitForTimeout(60);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (o > 0) over.push(`${r}:${o}px`);
      small.push(...(await tooSmall(TOUCH)).map((x) => `${r}> ${x}`));
      await shot(page, `v6-m-${r.replace('/', '_')}.png`, { fullPage: true });
    }
    check('E1 HP: setiap halaman (8 rute) tanpa scroll horizontal', over.length === 0, over.join());

    // Menu bawah: menempel di dasar layar walau halaman digulir, dan tidak menutupi isi paling bawah
    await goto(page, '#/beranda');
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const nb = await page.locator('#nav').boundingBox();
    check('E6 HP: menu utama menempel di dasar layar walau halaman digulir ke bawah', Math.abs(nb.y + nb.height - 844) <= 1 && nb.width === 390, JSON.stringify(nb));
    const clear = await page.evaluate(() => document.querySelector('#v-beranda .foot').getBoundingClientRect().bottom <= document.getElementById('nav').getBoundingClientRect().top + 0.5);
    check('E7 HP: isi paling bawah tidak tertutup menu', clear);

    await page.goto(`${BASE}/kelola.html`);
    await page.waitForSelector('#list-card:not([hidden])');
    const ov2 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    check('E2 HP kelola: tanpa scroll horizontal', ov2.sw <= ov2.iw, JSON.stringify(ov2));
    const kn = await page.locator('#nav a').evaluateAll((as) => as.map((a) => `${a.textContent.trim()}${a.getAttribute('aria-current') ? '*' : ''}`).join());
    check('E2b kelola memakai menu yang sama; Kelola aktif', kn === 'Beranda,Analisis,Aset,Kelola*,Profil', kn);
    check('E2c kelola: tautan menu menuju halaman yang benar', (await page.locator('#nav-beranda').getAttribute('href')) === 'index.html#/beranda' && (await page.locator('#nav-profil').getAttribute('href')) === 'index.html#/profil');
    small.push(...(await tooSmall(`${TOUCH}, #assets .btn, #add`)).map((x) => `kelola> ${x}`));
    check('E5 HP: tombol, menu, tautan, kolom, dan pilihan di semua halaman minimal 44×44 px', small.length === 0, small.join(', '));
    await shot(page, 'v6-m-kelola.png', { fullPage: true });
    await page.getByRole('button', { name: '+ Tambah aset' }).click();
    await shot(page, 'v2-m-form.png');
    const fits = await page.locator('#dlg').evaluate((d) => { const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
    check('E3 HP: dialog form muat di layar', fits);
    check('E4 HP: tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // Desktop: menu jadi bilah atas yang menempel saat menggulir
    const { ctx, page, fake } = await newPage();
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');
    await page.evaluate(() => scrollTo(0, 600));
    const nb = await page.locator('#nav').boundingBox();
    check('E8 desktop: menu utama jadi bilah atas yang menempel saat menggulir', Math.abs(nb.y) <= 1 && nb.width > 600 && nb.height < 80, JSON.stringify(nb));
    await ctx.close();
  }

  await browser.close();
  server.close();
  const bad = results.filter((x) => !x).length;
  console.log(`\n${results.length - bad}/${results.length} lolos`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
