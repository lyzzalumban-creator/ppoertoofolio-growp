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
    const bbcaRow = await page.locator('#holdings > li', { hasText: 'BBCA' }).innerText();
    check('B13 dasbor menampilkan tanggal beli dan lama dimiliki', /dibeli 3 Mar 2025 \(20 bln\)/.test(bbcaRow), bbcaRow.replace(/\n/g, ' | ').slice(0, 110));
    const total = await page.locator('.kpi').first().innerText();
    check('B2 total berformat rupiah', /Rp\s?\d{1,3}(\.\d{3})+/.test(total), total.replace(/\n/g, ' | '));
    check('B3 tombol Kelola aset di header, Keluar di bawah', (await page.locator('#actions').getByRole('link', { name: 'Kelola aset' }).isVisible()) && (await page.locator('#foot-actions').getByRole('button', { name: 'Keluar' }).isVisible()));
    const box = await page.locator('#chart svg').boundingBox();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
    check('B4 grafik + tooltip', await page.locator('#chart .tip').isVisible());
    await page.getByRole('button', { name: '1 bln' }).click();
    check('B5 rentang waktu berfungsi', (await page.getByRole('button', { name: '1 bln' }).getAttribute('aria-pressed')) === 'true');
    await page.getByRole('button', { name: 'Semua' }).click();
    await page.locator('.lg[data-type="crypto"]').click();
    check('B6 filter legenda', (await page.locator('#holdings > li').count()) === 2);
    await page.locator('.lg[data-type="crypto"]').click();
    await shot(page, 'v2-dash.png', { fullPage: true });

    const secrets = secretsOf(fake);
    const openAll = async () => { await page.evaluate(() => document.querySelectorAll('#holdings details').forEach((d) => { d.open = true; })); await page.waitForTimeout(80); };
    await openAll(); // rincian (harga, jumlah, modal) ikut diperiksa, bukan hanya ringkasan
    const normal = await page.locator('main').innerText();
    check('B7 kontrol: mode normal menampilkan angka milikmu', secrets.filter((s) => normal.includes(s)).length >= 2);
    await page.getByRole('button', { name: 'Sembunyikan nominal' }).click();
    const hidden = await page.locator('main').innerText();
    const leaked = secrets.filter((s) => hidden.includes(s));
    check('B8 sembunyikan nominal: tidak ada angka milikmu (termasuk harga aset manual)', leaked.length === 0, leaked.join(','));
    check('B9 jumlah unit tersembunyi, persentase tetap', !/lembar/.test(hidden) && /[+−]\d+,\d{2}%/.test(hidden));
    await shot(page, 'v2-hidden.png', { fullPage: true });
    check('B10 tanpa error konsol', errors.length === 0, errors.join(' | '));

    await page.locator('#foot-actions').getByRole('button', { name: 'Keluar' }).click();
    check('B11 Keluar -> form sambung & kredensial terhapus', (await page.locator('#connect').isVisible()) && (await page.evaluate(() => localStorage.getItem('pf-api'))) === null);
    check('B12 setelah Keluar, dasbor dan datanya tidak ada di halaman', !(await page.locator('#dash').isVisible()));
    await ctx.close();
  }

  // ============ C. kelola ============
  {
    const { ctx, page, fake } = await newPage();
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');
    await page.getByRole('link', { name: 'Kelola aset' }).click();
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
    check('D6c keadaan kosong: tombol Kelola aset & Keluar tetap ada, tombol nominal tidak', (await page.locator('#actions').getByRole('link', { name: 'Kelola aset' }).isVisible()) && (await page.locator('#foot-actions').getByRole('button', { name: 'Keluar' }).isVisible()) && !(await page.locator('#privacy').isVisible()));
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
      const price = await page.locator('#holdings dd[data-label="Harga"]').first().getAttribute('title');
      check('G4 tooltip harga tidak lagi menyebut "Penutupan" (bisa harga tengah sesi)', /^Harga per /.test(price), price);
      check('G5 catatan kaki menyebut 4 kali sehari dan bukan "sekali sehari"', /4 kali sehari/.test(await page.locator('footer.foot').innerText()) && !/sekali sehari/.test(await page.locator('footer.foot').innerText()));
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
    const t0 = await page.locator('main').innerText();
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
    check('H3 kartu utama punya mini-grafik tanpa teks/angka (aman saat nominal disembunyikan)', (await page.locator('.kpi.hero svg.spark path.line').count()) === 1 && (await page.locator('.kpi.hero svg.spark text').count()) === 0);
    check('H4 kartu utama menampilkan perubahan hari ini', /hari ini/.test(await page.locator('.kpi.hero .pill').innerText()), (await page.locator('.kpi.hero .pill').innerText()).replace(/\n/g, ' '));
    const row = page.locator('#holdings > li', { hasText: 'BBCA' });
    check('H5a baris aset tertutup: rincian tidak terlihat', !(await row.locator('dd[data-label="Harga"]').isVisible()));
    await row.locator('summary').click();
    check('H5b ketuk baris -> rincian terbuka (harga, jumlah, untung/rugi, modal)', (await row.locator('dd[data-label="Harga"]').isVisible()) && /Jumlah/.test(await row.innerText()) && /Modal/.test(await row.innerText()));
    await page.locator('#privacy').click(); // render ulang
    check('H5c baris yang terbuka tetap terbuka setelah render ulang', await row.locator('dd[data-label="Harga"]').isVisible());
    await page.locator('.lg[data-type="idx"]').click(); await page.locator('.lg[data-type="idx"]').click();
    check('H5d dan tetap terbuka setelah filter dipasang-dilepas', await row.locator('dd[data-label="Harga"]').isVisible());

    // muat ulang: panggilan baru ke Sheet, dan jam pembaruan ikut berganti
    const hist = fake.call({ token: fake.token, action: 'list' }).history;
    const lastSnap = hist.at(-1);
    const n0 = env.calls.length;
    fake.call({ token: fake.token, action: 'appendSnapshot', snapshot: { ...lastSnap, at: '2026-11-23T09:45:00Z' } });
    await page.getByRole('button', { name: 'Muat ulang' }).click();
    await page.waitForFunction(() => /16\.45 WIB/.test(document.getElementById('subtitle').textContent));
    check('H6 Muat ulang mengambil data baru tanpa memuat ulang halaman', env.calls.length === n0 + 1 && /16\.45 WIB/.test(await page.locator('#subtitle').innerText()));
    check('H6b tombol kembali aktif dan bertuliskan semula', (await page.locator('#reload').isEnabled()) && (await page.locator('#reload').innerText()) === 'Muat ulang');
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
    check('H8b hanya satu hari data: kartu utama tanpa mini-grafik dan memberi tahu "belum ada pembanding"', (await page.locator('.kpi.hero svg.spark').count()) === 0 && /belum ada pembanding/.test(await page.locator('.kpi.hero .pill').innerText()));
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
    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');
    const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    check('E1 HP dasbor: tanpa scroll horizontal', ov.sw <= ov.iw, JSON.stringify(ov));
    await shot(page, 'v2-m-dash.png', { fullPage: true });
    await page.goto(`${BASE}/kelola.html`);
    await page.waitForSelector('#list-card:not([hidden])');
    const ov2 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    check('E2 HP kelola: tanpa scroll horizontal', ov2.sw <= ov2.iw, JSON.stringify(ov2));
    await page.getByRole('button', { name: '+ Tambah aset' }).click();
    await shot(page, 'v2-m-form.png');
    const fits = await page.locator('#dlg').evaluate((d) => { const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
    check('E3 HP: dialog form muat di layar', fits);
    check('E4 HP: tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  server.close();
  const bad = results.filter((x) => !x).length;
  console.log(`\n${results.length - bad}/${results.length} lolos`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
