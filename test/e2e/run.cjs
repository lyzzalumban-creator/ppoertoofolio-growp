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

const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const usdF = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'USD' });
const nb = (x) => x.replace(/\s/g, ' '); // Intl memakai spasi tak-terputus; teks halaman dinormalkan, jadi harapan juga
const flat = (x) => x.replace(/\s+/g, ' ').trim();
const p2 = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const p1 = (v) => `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
const todayWib = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const AH = (key) => `#/aset/${encodeURIComponent(key)}`; // alamat halaman satu aset

(async () => {
  const { createFake } = await load('test/fake-appsscript.mjs');
  const { seedFake } = await load('test/e2e/seed.mjs');
  const { buildSnapshot } = await load('scripts/lib/portfolio.mjs');
  const stats = await load('assets/stats.js');
  const server = await serve();
  BASE = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();

  // Satu "Google" tiruan per skenario; request ke script.google.com dialihkan ke sana.
  // env.mode: ok | abort (jaringan putus) | html (halaman masuk Google) | lost (Sheet sudah berubah, balasannya hilang)
  async function newPage({ touch = false, w = 1280, h = 900, dark = false, withHistory = true, fake: given, seedOpts = {}, freshStorage = false } = {}) {
    const fake = given || createFake();
    if (!given) seedFake(fake, { withHistory, ...seedOpts });
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light', ...(touch ? { hasTouch: true, isMobile: true } : {}) });
    // Bawaan aplikasi: nominal tersembunyi. Tes lama mengharapkan terlihat, jadi diatur '0' kecuali freshStorage.
    if (!freshStorage) await ctx.addInitScript(() => { try { if (localStorage.getItem('pf-hidden') === null) localStorage.setItem('pf-hidden', '0'); } catch {} });
    const page = await ctx.newPage();
    const env = { mode: 'ok', fake, delay: 0, calls: [], actions: [], other: [], contentTypes: [] };
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
      const req = route.request();
      if (!req.url().startsWith('https://script.google.com/')) { env.other.push(req.url()); return route.abort(); }
      if (env.delay) await new Promise((r) => setTimeout(r, env.delay));
      env.calls.push(req.method());
      env.contentTypes.push(req.headers()['content-type']);
      try { env.actions.push(JSON.parse(req.postData() || '{}').action); } catch { env.actions.push('?'); }
      if (env.mode === 'abort') return route.abort();
      if (env.mode === 'html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Sign in</html>' });
      const out = env.fake.call(req.postData() || '');
      if (env.mode === 'lost') return route.abort();
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
  const routed = (page, p) => page.waitForFunction((x) => document.body.dataset.route === x, p);
  const nav = async (page, key) => { await page.locator(`#nav-${key}`).click(); await routed(page, key); };
  const goto = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await routed(page, hash.replace(/^#\/?/, '')); };
  const openDash = async (page, fake, hash = '') => {
    await page.goto(`${BASE}/index.html${hash}`);
    await connect(page, { token: fake.token });
    await page.waitForSelector('#nav:not([hidden])');
  };
  const sheetOf = (fake) => fake.call({ token: fake.token, action: 'list' });
  const secretsOf = (fake) => {
    const L = sheetOf(fake).history.at(-1);
    return [L.total, L.cost, Math.abs(L.pnl), ...L.positions.flatMap((p) => [p.value, Math.abs(p.pnl)]), ...Object.values(L.byType).map((t) => t.value)].map((v) => idr.format(Math.abs(v)));
  };
  // Tombol + membuka menu; pilih satu tindakan (cash | asset | fx | convert).
  const openAdd = async (page, act) => { await page.locator('#nav-add').click(); await page.locator(`[data-menu-act="${act}"]`).click(); };
  const holdSyms = (page) => page.locator('#holdings .hold .h-id b').allInnerTexts();
  const isOpen = (page, id) => page.locator(`#${id}`).evaluate((d) => d.open);
  const toastText = (page) => page.locator('#toast').innerText();

  // ============ A. sambung ============
  {
    const { ctx, page, fake, env, errors } = await newPage();
    await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
    check('A1 awal: form sambung tampil, dasbor dan menu tersembunyi', (await page.locator('#connect').isVisible()) && !(await page.locator('#dash').isVisible()) && !(await page.locator('#nav').isVisible()));
    const raw = await (await ctx.request.get(`${BASE}/index.html`)).text();
    const bodyText = await page.locator('body').innerText();
    check('A1b halaman sebelum tersambung tidak berisi angka portofolio (HTML maupun teks)', !/Rp\s?\d/.test(raw + bodyText) && !/\d{1,3}(\.\d{3}){2,}/.test(bodyText));
    check('A2 belum ada request ke Google sebelum disambungkan', env.calls.length === 0);
    await shot(page, 'connect.png');

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
    check('A7 kata sandi benar -> Beranda dengan ringkasan', await page.locator('#summary .sum-value').isVisible());
    check('A8 permintaan memakai text/plain (simple request, tanpa preflight)', env.contentTypes.every((t) => /^text\/plain/.test(t)), [...new Set(env.contentTypes)].join());
    check('A9 kredensial tersimpan di browser', !!(await page.evaluate(() => localStorage.getItem('pf-api'))));

    const before = env.calls.length;
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#dash:not([hidden])');
    check('A10 muat ulang -> langsung dasbor tanpa form, satu panggilan', !(await page.locator('#connect').isVisible()) && env.calls.length === before + 1);
    check('A11 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============ B. Beranda dan sembunyikan nominal ============
  {
    const { ctx, page, fake, errors } = await newPage();
    await openDash(page, fake);
    await page.waitForSelector('#dash:not([hidden])');
    check('B1 Beranda: ringkasan, 9 aset di daftar, 5 jenis di alokasi', (await page.locator('#holdings .hold').count()) === 9 && (await page.locator('#legend .lg').count()) === 5 && /9 aset/.test(await page.locator('#hold-count').innerText()));
    const total = await page.locator('#summary .sum-value').innerText();
    check('B2 total berformat rupiah = total robot (tanpa perubahan, tampilan langsung sama persis)', nb(total) === nb(idr.format(sheetOf(fake).history.at(-1).total)), total);
    const navs = await page.locator('#nav a, #nav button').evaluateAll((els) => els.map((a) => `${a.textContent.trim()}${a.getAttribute('aria-current') ? '*' : ''}`).join());
    check('B3 menu: Beranda, Analisis, tombol Tambah, Aktivitas, Profil; hanya Beranda yang aktif', navs === 'Beranda*,Analisis,Tambah,Aktivitas,Profil', navs);
    const box = await page.locator('#chart svg').boundingBox();
    const lastDate = sheetOf(fake).history.at(-1).date;
    check('B4 grafik: bawaan menunjuk titik terakhir dengan gelembung nilai (= total) dan tanggalnya di bawah', await page.locator('#chart .tip').isVisible() && nb(await page.locator('#chart .tip b').innerText()) === nb(idr.format(sheetOf(fake).history.at(-1).total)) && (await page.locator('#chart .dpill').innerText()) === '23 Nov 2026' && lastDate === '2026-11-23');
    const before = await page.locator('#chart .dpill').innerText();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    check('B4b menggeser/mengarahkan kursor: tanggal di bawah dan nilai ikut berubah; garis putus-putus vertikal ada', (await page.locator('#chart .dpill').innerText()) !== before && (await page.locator('#chart .cursor line').count()) === 1);
    await page.mouse.move(box.x + box.width * 0.5, box.y - 40);
    check('B4c kursor keluar dari grafik: kembali ke titik terakhir', (await page.locator('#chart .dpill').innerText()) === before);
    await shot(page, 'grafik.png');
    await page.locator('#ranges').getByRole('button', { name: '1 bln' }).click();
    check('B5 rentang waktu berfungsi', (await page.locator('#ranges').getByRole('button', { name: '1 bln' }).getAttribute('aria-pressed')) === 'true');
    await page.locator('#ranges').getByRole('button', { name: 'YTD' }).click();
    check('B5y YTD: grafik hanya berisi titik tahun berjalan', (await page.locator('#chart svg').count()) === 1 && (await page.locator('#ranges').getByRole('button', { name: 'YTD' }).getAttribute('aria-pressed')) === 'true');
    await page.locator('#ranges').getByRole('button', { name: 'Semua' }).click();

    await page.locator('#legend [data-filter="crypto"]').click();
    check('B6 ketuk Kripto di Alokasi -> daftar hanya kripto, chip dan baris alokasi menandai pilihan', JSON.stringify((await holdSyms(page)).sort()) === '["BTC","ETH"]' && /2 dari 9 aset/.test(await page.locator('#filter-note').innerText()) && (await page.locator('#chips [data-filter="crypto"]').getAttribute('aria-pressed')) === 'true' && (await page.locator('#legend [data-filter="crypto"]').getAttribute('aria-pressed')) === 'true');
    await page.locator('#legend [data-filter="crypto"]').click();
    check('B6b ketuk lagi -> filter lepas', (await page.locator('#holdings .hold').count()) === 9 && (await page.locator('#filter-note').innerText()) === '');
    await page.locator('#chips [data-filter="idx"]').click();
    await page.locator('#chips [data-filter=""]').click();
    check('B6c chip "Semua" melepas filter', (await page.locator('#holdings .hold').count()) === 9);
    await shot(page, 'beranda.png', { fullPage: true });

    // textContent (bukan innerText): ikut memeriksa halaman yang sedang tertutup.
    const secrets = secretsOf(fake);
    await page.locator('#holdings .hold', { hasText: 'BBCA' }).click();
    await routed(page, `aset/${encodeURIComponent('idx:BBCA')}`);
    const normal = await page.locator('main').textContent();
    check('B7 kontrol: mode normal menampilkan angka milikmu (termasuk jumlah lembar di halaman aset)', secrets.filter((s) => normal.includes(s)).length >= 2 && /1\.000 lembar/.test(normal));
    await page.getByRole('button', { name: 'Sembunyikan nominal' }).click(); // disembunyikan saat grafik Beranda tertutup
    const hidden = await page.locator('main').textContent();
    const leaked = secrets.filter((s) => hidden.includes(s));
    check('B8 sembunyikan nominal: tidak ada angka milikmu di halaman mana pun (termasuk harga aset manual)', leaked.length === 0, leaked.join(','));
    check('B8b saat tersembunyi tidak ada sumbu rupiah ("jt") yang tertinggal', !/\d+ jt/.test(hidden));
    check('B9 jumlah unit tersembunyi, persentase tetap', !/\d\s(lembar|gram)\b/.test(hidden) && /[+−]\d+,\d{2}%/.test(hidden), (hidden.match(/.{30}(lembar|gram\b).{10}/g) || []).join(' | '));
    await nav(page, 'beranda');
    check('B9b kembali ke Beranda: grafik digambar ulang dalam persen', (await page.locator('#chart svg').count()) === 1 && /%/.test(await page.locator('#chart .tip').textContent()) && !/Rp/.test(await page.locator('#chart .tip').textContent()));
    await shot(page, 'beranda-hidden.png', { fullPage: true });
    check('B10 tanpa error konsol', errors.length === 0, errors.join(' | '));

    await nav(page, 'profil');
    await page.locator('#logout').click();
    check('B11 Keluar (di Profil) -> form sambung & kredensial terhapus', (await page.locator('#connect').isVisible()) && (await page.evaluate(() => localStorage.getItem('pf-api'))) === null);
    check('B12 setelah Keluar, dasbor, menu, dan datanya tidak tampil', !(await page.locator('#dash').isVisible()) && !(await page.locator('#nav').isVisible()) && !/Rp\s?\d/.test(await page.locator('body').innerText()));
    await ctx.close();
  }

  // ============ B2. grafik di layar sentuh ============
  {
    const { ctx, page, fake, errors } = await newPage({ touch: true, w: 820, h: 1180 });
    await openDash(page, fake);
    await page.waitForSelector('#chart .dpill');
    const first = await page.locator('#chart .dpill').innerText();
    const bx = await page.locator('#chart svg').boundingBox();
    const hold = async (x, y) => { // sentuh dan tahan lewat CDP; kembalikan fungsi untuk mengangkat jari
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      return () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const lift = await hold(bx.x + bx.width * 0.3, bx.y + bx.height * 0.5);
    await page.waitForTimeout(100);
    const picked = await page.locator('#chart .dpill').innerText();
    check('B5a disentuh: gelembung dan tanggal pindah ke titik yang disentuh', picked !== first && (await page.locator('#chart .tip').isVisible()));
    await lift();
    await page.waitForTimeout(150);
    check('B5b jari diangkat: kembali menunjuk titik terakhir', (await page.locator('#chart .dpill').innerText()) === first);
    const lift2 = await hold(bx.x + bx.width - 1, bx.y + bx.height * 0.5);
    await page.waitForTimeout(100);
    check('B5d sentuh dekat tepi kanan: gelembung tetap di dalam kotak grafik', await page.locator('#chart .tip').evaluate((t) => { const r = t.getBoundingClientRect(); const b = document.getElementById('chart').getBoundingClientRect(); return r.left >= b.left - 1 && r.right <= b.right + 1; }));
    await lift2();
    check('B5c tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============ O. mode demo ============
  {
    const { ctx, page, fake, env, errors } = await newPage({ freshStorage: true });
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('#connect:not([hidden])');
    check('O1 form sambung punya tombol "Coba demo"', await page.locator('#demo-btn').isVisible());
    await page.locator('#demo-btn').click();
    await page.waitForSelector('#dash:not([hidden])');
    check('O2 demo: dasbor langsung terbuka, banner "Mode demo", subjudul demo, menu tampil', /Mode demo/.test(await page.locator('#banner').innerText()) && /Demo/.test(await page.locator('#subtitle').innerText()) && (await page.locator('#nav').isVisible()));
    check('O3 demo tidak memanggil Google sama sekali dan tidak menyimpan kredensial; pilihan sembunyikan nominalmu tidak berubah', env.calls.length === 0 && (await page.evaluate(() => localStorage.getItem('pf-api'))) === null && (await page.evaluate(() => localStorage.getItem('pf-hidden'))) === null);
    check('O4 demo menampilkan angka (nominal tampil) dan banyak aset', /Rp\s?\d/.test(await page.locator('#summary .sum-value').innerText()) && (await page.locator('#holdings .hold').count()) >= 8);
    await page.locator('#ranges').getByRole('button', { name: '1 thn' }).click();
    check('O5 grafik portofolio 1 tahun: gelembung bertanggal hari ini', /2026/.test(await page.locator('#chart .dpill').innerText()) && (await page.locator('#chart path.line').count()) === 1);
    await nav(page, 'aktivitas');
    const jb = await page.locator('#txs .tx').count();
    await page.locator('#aktnav').getByRole('link', { name: 'Trading emas' }).click();
    await routed(page, 'aktivitas/trading');
    const fxn = await page.locator('#fxlist .tx').count();
    check('O6 banyak transaksi: Jual-beli >= 30 baris, Trading emas >= 50 trade, grafik 12 bulan', jb >= 30 && fxn >= 50 && (await page.locator('#fxchart rect.bar').count()) === 12, `${jb} / ${fxn}`);
    check('O6b tab Jual-beli memuat baris Beli, Jual, dan Tukar', await (async () => { await goto(page, '#/aktivitas/jual-beli'); const t = await page.locator('#txs .tx-kind').allInnerTexts(); return ['Beli', 'Jual', 'Tukar'].every((k) => t.includes(k)); })());
    await goto(page, '#/analisis/bulanan');
    check('O7 Analisis > Bulanan: 12 batang, daftar 12 bulan', (await page.locator('#mchart rect.bar').count()) === 12 && (await page.locator('#mlist .mrow').count()) === 12);
    await goto(page, '#/analisis/riwayat');
    for (let i = 0; i < 14 && (await page.locator('#hist-more').isVisible()); i++) await page.locator('#hist-more').click();
    check('O8 riwayat 1 tahun penuh (366 hari)', (await page.locator('#hist tbody tr').count()) === 366);
    // ubah data di demo: jual aset, hanya di memori
    const cashBefore = flat(await page.locator('#legend').innerText());
    await goto(page, `#/aset/${encodeURIComponent('idx:BBCA')}`);
    await page.locator('[data-act="sell"]').click();
    await page.fill('#t-qty', '100');
    await page.locator('#t-save').click();
    await page.waitForFunction(() => !document.getElementById('trade-dlg').open);
    check('O9 jual di demo berhasil (pesan keuntungan), tetap tanpa panggilan Google', /Terjual/.test(await toastText(page)) && env.calls.length === 0);
    await nav(page, 'beranda');
    check('O9b tampilan ikut berubah (alokasi berbeda dari sebelum jual)', flat(await page.locator('#legend').innerText()) !== cashBefore);
    await page.locator('#set-reload').count();
    await nav(page, 'profil');
    check('O10 Profil: tombol "Keluar dari demo"; Muat ulang data membuat demo dari awal tanpa jaringan', (await page.locator('#logout').innerText()) === 'Keluar dari demo');
    await page.locator('#set-reload').click();
    await page.waitForTimeout(200);
    check('O10b setelah muat ulang demo: tetap mode demo, 0 panggilan', /Mode demo/.test(await page.locator('#banner').innerText()) && env.calls.length === 0);
    await nav(page, 'profil');
    await page.locator('#logout').click();
    const o11 = [await page.locator('#connect').isVisible(), !(await page.locator('#banner').isVisible()), !/Rp\s?\d/.test(await page.locator('main').innerText()), (await page.evaluate(() => localStorage.getItem('pf-hidden'))) === null];
    check('O11 keluar dari demo: kembali ke form sambung, banner hilang, tidak ada data di halaman, penyimpanan tetap kosong', o11.every(Boolean), o11.join());
    check('O12 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // ?demo membuka demo langsung; bila sudah tersambung, keluar dari demo kembali ke data asli dan kredensial tidak terhapus
    const { ctx, page, fake, env } = await newPage();
    await openDash(page, fake);
    const n = env.calls.length;
    await page.goto(`${BASE}/index.html?demo`);
    await page.waitForSelector('#banner:not([hidden])');
    check('O13 ?demo membuka demo walau sudah tersambung, tanpa panggilan baru', /Mode demo/.test(await page.locator('#banner').innerText()) && env.calls.length === n);
    await nav(page, 'profil');
    await page.locator('#logout').click();
    await page.waitForFunction(() => !/Demo/.test(document.getElementById('subtitle').textContent) && document.getElementById('banner').hidden && !document.getElementById('nav').hidden);
    check('O14 keluar dari demo: kredensial TIDAK terhapus dan data asli dimuat lagi', !!(await page.evaluate(() => localStorage.getItem('pf-api'))) && !/Mode demo/.test(await page.locator('#subtitle').innerText()) && env.calls.length === n + 1);
    await ctx.close();
  }

  // ============ O2. detail ketuk di grafik batang ============
  {
    const { ctx, page, fake, errors } = await newPage({ touch: true, w: 820, h: 1180 });
    await openDash(page, fake, '#/analisis/bulanan');
    await page.waitForSelector('#mchart rect.bar');
    const bars = page.locator('#mchart rect.bar');
    const box = await bars.nth(2).boundingBox();
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, b) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
    await touch('touchStart', box);
    await page.waitForTimeout(100);
    const tipTxt = flat(await page.locator('#mchart .tip').innerText());
    check('O15 disentuh: gelembung memuat nama bulan dan persen; batang ditandai', /\d{4}/.test(tipTxt) && /%/.test(tipTxt) && (await page.locator('#mchart rect.bar.sel').count()) === 1, tipTxt);
    await touch('touchEnd', box);
    await page.waitForTimeout(150);
    check('O15b jari diangkat: gelembung dan tanda batang hilang', !(await page.locator('#mchart .tip').isVisible()) && (await page.locator('#mchart rect.bar.sel').count()) === 0);
    await page.locator('#privacy').click();
    const b2 = await bars.nth(1).boundingBox();
    await touch('touchStart', b2);
    await page.waitForTimeout(100);
    check('O15c nominal tersembunyi: gelembung tanpa rupiah, persen tetap', !/Rp/.test(await page.locator('#mchart .tip').innerText()) && /%/.test(await page.locator('#mchart .tip').innerText()));
    await touch('touchEnd', b2);
    check('O16 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============ C. tambah, ubah, hapus aset (lembar dari tombol + dan dari halaman aset) ============
  {
    const { ctx, page, fake, errors } = await newPage();
    await openDash(page, fake);
    const list = () => sheetOf(fake).assets;
    await page.locator('#nav-add').click();
    check('C0 tombol + membuka menu dengan 4 pilihan: Kas, Beli aset, Trade emas, Tukar mata uang', (await isOpen(page, 'menu-dlg')) && (await page.locator('#menu-dlg .menu-item').allInnerTexts()).map(flat).join() === 'Kas,Beli aset,Trade emas,Tukar mata uang');
    await page.locator('[data-menu-act="asset"]').click();
    check('C1 "Beli aset": lembar terbuka tanpa tombol Hapus, ada pilihan "Bayar dari kas" berisi KAS', (await isOpen(page, 'asset-dlg')) && (await page.locator('#f-h').innerText()) === 'Beli aset' && !(await page.locator('#f-del').isVisible()) && (await page.locator('#pay-field').isVisible()) && /^Kas ·/.test(await page.locator('#f-pay').innerText()));
    check('C1b pilihan jenis: Kas dulu, tanpa Emas', (await page.locator('#f-type option').allInnerTexts()).map((t) => t.split(' ')[0]).join() === 'Kas,Saham,Saham,Kripto,Lainnya');
    await page.selectOption('#f-type', 'crypto');
    check('C2 jenis kripto menampilkan kolom ID CoinGecko; kolom manual tersembunyi', (await page.locator('label[data-for="crypto"]').isVisible()) && !(await page.locator('label[data-for="manual"]').isVisible()));
    await page.fill('#f-symbol', 'sol'); // diketik huruf kecil, harus tersimpan SOL
    await page.fill('#f-name', 'Solana');
    await page.fill('#f-coingeckoId', 'Solana'); // harus tersimpan huruf kecil
    await page.fill('#f-qty', '1.5');
    await page.fill('#f-avgCost', '1000000');
    await shot(page, 'form-tambah.png');
    await page.locator('#f-save').click();
    await routed(page, `aset/${encodeURIComponent('crypto:SOL')}`);
    const sol = list().find((a) => a.symbol === 'SOL');
    check('C3 aset baru tersimpan di Sheet dengan tipe yang benar', sol && sol.qty === 1.5 && sol.avgCost === 1_000_000 && sol.coingeckoId === 'solana' && sol.type === 'crypto' && !('price' in sol), JSON.stringify(sol));
    check('C3b setelah simpan: lembar tertutup, halaman aset baru terbuka "Menunggu harga", ada pesan', !(await isOpen(page, 'asset-dlg')) && (await page.locator('#detail .d-name').innerText()) === 'Solana' && /Menunggu harga/.test(await page.locator('#detail').innerText()) && /Dibeli dari kas/.test(await toastText(page)));
    const kasNow = list().find((a) => a.symbol === 'KAS').qty;
    const buyTx = sheetOf(fake).transactions.find((t) => t.symbol === 'SOL');
    check('C3b2 pembelian memotong kas (3.000.000 - 1,5 x 1.000.000 = 1.500.000) dan tercatat sebagai transaksi Beli', kasNow === 1_500_000 && buyTx && buyTx.kind === 'buy' && buyTx.qty === 1.5 && buyTx.price === 1_000_000, `${kasNow} ${JSON.stringify(buyTx)}`);
    await nav(page, 'beranda');
    const wait = page.locator('#holdings .hold.wait');
    check('C3c Beranda: aset baru ada di daftar dengan tanda "Menunggu harga"; ringkasan memberi tahu belum masuk total', (await wait.count()) === 1 && /SOL/.test(await wait.innerText()) && /1 aset menunggu harga/.test(await page.locator('#summary').innerText()));

    // validasi: duplikat dan kosong
    await openAdd(page, 'asset');
    await page.selectOption('#f-type', 'idx');
    await page.fill('#f-symbol', 'BBCA');
    await page.fill('#f-qty', '5');
    await page.fill('#f-avgCost', '9000');
    await page.locator('#f-save').click();
    await page.waitForSelector('#f-err:not([hidden])');
    check('C5 duplikat ditolak dengan pesan jelas, lembar tetap terbuka', /duplikat/.test(await page.locator('#f-err').innerText()) && (await isOpen(page, 'asset-dlg')));
    await page.fill('#f-symbol', 'ASII');
    check('C5b galat duplikat hilang begitu kode dibetulkan', !(await page.locator('#f-err').isVisible()));
    await page.fill('#f-qty', '1000');
    await page.fill('#f-avgCost', '9000');
    await page.locator('#f-save').click();
    await page.waitForSelector('#f-err:not([hidden])');
    check('C5c saldo kas tidak cukup ditolak dengan pesan jelas; Sheet dan kas tidak berubah', /Saldo kas KAS kurang/.test(await page.locator('#f-err').innerText()) && !list().some((a) => a.symbol === 'ASII') && list().find((a) => a.symbol === 'KAS').qty === 1_500_000);
    await page.fill('#f-qty', '');
    await page.locator('#f-save').click();
    await page.waitForFunction(() => /qty/.test(document.getElementById('f-err').textContent));
    check('C6 jumlah kosong ditolak; tombol Simpan bisa dipakai lagi', /qty/.test(await page.locator('#f-err').innerText()) && (await page.locator('#f-save').isEnabled()));
    check('C7 penolakan tidak mengubah Sheet', list().length === 10);
    await page.locator('#f-cancel').click();

    // ubah dari halaman aset
    await goto(page, AH('idx:BBCA'));
    await page.locator('[data-act="edit"]').click();
    check('C8 Ubah: lembar berjudul nama aset, terisi ulang, ada tombol Hapus', (await page.locator('#f-h').innerText()) === 'Ubah Bank Central Asia' && (await page.inputValue('#f-symbol')) === 'BBCA' && (await page.inputValue('#f-qty')) === '1000' && (await page.locator('#f-del').isVisible()));
    await page.fill('#f-qty', '1234');
    await page.locator('#f-save').click();
    await page.waitForFunction(() => !document.getElementById('asset-dlg').open);
    check('C8b jumlah baru tersimpan di aset yang benar dan langsung tampil', list().find((a) => a.symbol === 'BBCA').qty === 1234 && /1\.234 lembar/.test(await page.locator('#detail').innerText()) && /Perubahan tersimpan/.test(await toastText(page)));

    // hapus dari halaman aset
    await goto(page, AH('crypto:SOL'));
    page.once('dialog', (d) => d.dismiss());
    await page.locator('[data-act="del"]').click();
    check('C9 batal konfirmasi tidak menghapus', list().some((a) => a.symbol === 'SOL'));
    let confirmText = '';
    page.once('dialog', (d) => { confirmText = d.message(); d.accept(); });
    await page.locator('[data-act="del"]').click();
    await routed(page, 'beranda');
    check('C10 hapus (setelah konfirmasi): hilang dari Sheet, kembali ke Beranda; konfirmasi menyarankan Jual bila terjual', !list().some((a) => a.symbol === 'SOL') && (await page.locator('#holdings .hold').count()) === 9 && /Jual/.test(confirmText), confirmText);

    // manual: harga dan mata uang
    await openAdd(page, 'asset');
    await page.selectOption('#f-type', 'manual');
    await page.fill('#f-symbol', 'DEPO');
    await page.fill('#f-qty', '1');
    await page.fill('#f-price', '1100000');
    await page.fill('#f-avgCost', '1000000');
    await page.locator('#f-save').click();
    await routed(page, `aset/${encodeURIComponent('manual:DEPO')}`);
    const depo = list().find((a) => a.symbol === 'DEPO');
    check('C11 aset manual menyimpan harga & mata uang bawaan, dan langsung terhitung (tanpa menunggu robot)', depo && depo.price === 1_100_000 && depo.currency === 'IDR' && (await page.locator('#detail .d-value').innerText()) === idr.format(1_100_000), JSON.stringify(depo));

    // tanggal beli (saham AS dibayar dari kas dolar)
    await openAdd(page, 'asset');
    await page.selectOption('#f-type', 'us');
    check('C11b saham AS: pilihan kas hanya kas dolar (USD)', /^Dolar ·/.test(await page.locator('#f-pay').innerText()) && !/^Kas ·/.test(await page.locator('#f-pay').innerText()));
    await page.fill('#f-symbol', 'PANW'); await page.fill('#f-qty', '1'); await page.fill('#f-avgCost', '335.08');
    await page.fill('#f-buyDate', '2099-01-01');
    await page.locator('#f-save').click();
    await page.waitForSelector('#f-err:not([hidden])');
    check('C12 tanggal beli di masa depan ditolak dan tidak tersimpan', /masa depan/.test(await page.locator('#f-err').innerText()) && !list().some((a) => a.symbol === 'PANW'));
    await page.fill('#f-buyDate', '2025-03-03');
    await page.locator('#f-save').click();
    await routed(page, `aset/${encodeURIComponent('us:PANW')}`);
    const panw = list().find((a) => a.symbol === 'PANW');
    check('C13 tanggal beli tersimpan sebagai teks YYYY-MM-DD; kas dolar berkurang 335,08 (500 -> 164,92)', panw && panw.buyDate === '2025-03-03' && typeof panw.buyDate === 'string' && list().find((a) => a.symbol === 'USD').qty === 164.92, JSON.stringify(panw));
    await goto(page, AH('idx:BBCA'));
    check('C14 halaman aset menampilkan tanggal beli dan lama dimiliki', /Dibeli\s*3 Mar 2025\s*20 bln/i.test(await page.locator('#detail .stats').innerText()));
    await goto(page, AH('us:PANW'));
    await page.locator('[data-act="edit"]').click();
    check('C15 form ubah mengisi ulang tanggal', (await page.inputValue('#f-buyDate')) === '2025-03-03');
    await page.fill('#f-buyDate', '');
    await page.locator('#f-save').click();
    await page.waitForFunction(() => !document.getElementById('asset-dlg').open);
    check('C16 mengosongkan tanggal menghapusnya dari Sheet', !('buyDate' in list().find((a) => a.symbol === 'PANW')));

    // hapus lewat tombol di lembar Ubah
    await page.locator('[data-act="edit"]').click();
    page.once('dialog', (d) => d.accept());
    await page.locator('#f-del').click();
    await routed(page, 'beranda');
    check('C17 tombol "Hapus aset" di lembar Ubah juga menghapus dan menutup lembar', !list().some((a) => a.symbol === 'PANW') && !(await isOpen(page, 'asset-dlg')));
    check('C18 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============ T. beli / jual -> keuntungan terealisasi ============
  {
    const { ctx, page, fake, env, errors } = await newPage();
    await openDash(page, fake);
    const L0 = sheetOf(fake).history.at(-1);
    const pos0 = (s) => L0.positions.find((p) => p.symbol === s);
    const asset = (s) => sheetOf(fake).assets.find((a) => a.symbol === s);
    const txs = () => sheetOf(fake).transactions;
    const tradeDone = () => page.waitForFunction(() => !document.getElementById('trade-dlg').open);

    await goto(page, AH('idx:BBCA'));
    check('T1 halaman aset: tombol Beli, Jual, Ubah, Hapus (skrip versi 3)', (await page.locator('#detail .act').allInnerTexts()).map(flat).join() === 'Beli,Jual,Ubah,Hapus' && (await page.locator('[data-act="sell"]').getAttribute('aria-disabled')) === null);
    await page.locator('[data-act="sell"]').click();
    const kind = await page.locator('#trade-form input[name="kind"]:checked').inputValue();
    check('T2 Jual: lembar terbuka; harga terisi harga terakhir, tanggal hari ini (WIB), kepemilikan tampil', (await isOpen(page, 'trade-dlg')) && kind === 'sell' && (await page.locator('#t-h').innerText()) === 'Jual BBCA'
      && Number(await page.inputValue('#t-price')) === pos0('BBCA').price && (await page.inputValue('#t-date')) === todayWib() && /Dimiliki 1\.000 lembar/.test(await page.locator('#t-own').innerText()) && !(await page.locator('#t-fx-f').isVisible()));
    await page.fill('#t-qty', '1001');
    check('T3 jumlah melebihi kepemilikan: pratinjau memperingatkan', /Melebihi/.test(await page.locator('#t-preview').innerText()));
    await page.locator('#t-save').click();
    await page.waitForSelector('#t-err:not([hidden])');
    check('T3b menyimpan jumlah berlebih ditolak; Sheet tidak berubah, tanpa panggilan simpan', /melebihi/.test(await page.locator('#t-err').innerText()) && asset('BBCA').qty === 1000 && txs().length === 0 && !env.actions.includes('trade'));
    await page.fill('#t-qty', '400');
    check('T3c galat "melebihi" hilang begitu jumlahnya dibetulkan', !(await page.locator('#t-err').isVisible()));
    await page.fill('#t-price', '10000');
    const pv = nb(flat(await page.locator('#t-preview').innerText()));
    check('T4 pratinjau jual: hasil, modal porsi (harga rata-rata), keuntungan terealisasi dengan persen, sisa', pv.includes(nb(`Hasil jual ${idr.format(4_000_000)}`)) && pv.includes(nb(`Modal porsi ini ${idr.format(3_800_000)}`)) && pv.includes(nb(`▲ +${idr.format(200_000)} (+5,26%)`)) && /Sisa 600/.test(pv), pv);
    await shot(page, 'jual.png');
    await page.locator('#t-save').click();
    await tradeDone();
    const tx1 = txs()[0];
    check('T5 jual tersimpan: jumlah di Sheet berkurang, harga rata-rata tetap, transaksi tercatat lengkap', asset('BBCA').qty === 600 && asset('BBCA').avgCost === 9500 && txs().length === 1
      && tx1.kind === 'sell' && tx1.qty === 400 && tx1.price === 10_000 && tx1.costIdr === 3_800_000 && tx1.pnlIdr === 200_000 && tx1.date === todayWib() && /^tx-/.test(tx1.id), JSON.stringify(tx1));
    check('T5b pesan menyebut keuntungannya; tetap di halaman aset yang kini 600 lembar dengan 1 aktivitas', nb(await toastText(page)).includes(nb(`+${idr.format(200_000)}`)) && /600 lembar/.test(await page.locator('#detail').innerText()) && (await page.locator('#detail .tx').count()) === 1);
    const v600 = idr.format(600 * pos0('BBCA').price);
    await nav(page, 'beranda');
    check('T6 Beranda langsung berubah: Terealisasi +Rp 200.000, nilai BBCA = 600 × harga terakhir', nb(flat(await page.locator('#summary').innerText())).toLowerCase().includes(nb(`terealisasi +${idr.format(200_000)}`).toLowerCase()) && nb(await page.locator('#holdings .hold', { hasText: 'BBCA' }).innerText()).includes(nb(v600)));
    await nav(page, 'aktivitas');
    const real1 = nb(flat(await page.locator('#realized').innerText()));
    check('T7 Aktivitas: total terealisasi, tahun ini, 1 penjualan; baris Jual BBCA', real1.includes(nb(`+${idr.format(200_000)}`)) && /1 penjualan/.test(real1) && new RegExp(`Tahun ${todayWib().slice(0, 4)}`, 'i').test(real1) && /Jual\s*BBCA\s*400/.test(await page.locator('#txs').innerText()), real1);

    // rugi, aset dolar, jual semua -> aset hilang dari daftar
    await goto(page, AH('us:NVDA'));
    await page.locator('[data-act="sell"]').click();
    check('T8 aset dolar: kolom kurs tampil dan terisi kurs terakhir', (await page.locator('#t-fx-f').isVisible()) && Number(await page.inputValue('#t-fx')) === L0.fx && /US\$/.test(await page.locator('#t-price-l').innerText()));
    await page.locator('#t-all').click();
    await page.fill('#t-price', '100');
    await page.fill('#t-fx', '16000');
    check('T8b "Jual semua" mengisi seluruh kepemilikan; pratinjau rugi −Rp 960.000 dan "habis"', (await page.inputValue('#t-qty')) === '3' && nb(flat(await page.locator('#t-preview').innerText())).includes(nb(`▼ −${idr.format(960_000)}`)) && /habis/.test(await page.locator('#t-preview').innerText()));
    await page.locator('#t-save').click();
    await routed(page, 'aktivitas');
    const tx2 = txs().find((t) => t.symbol === 'NVDA');
    check('T9 jual habis: aset dihapus dari Sheet, pindah ke Aktivitas; rugi tercatat dalam rupiah dan dolar dengan kurs', !asset('NVDA') && tx2 && tx2.pnlIdr === -960_000 && tx2.pnl === -60 && tx2.fx === 16_000 && tx2.currency === 'USD', JSON.stringify(tx2));
    check('T9b total terealisasi = untung − rugi (−Rp 760.000, bertanda minus dan merah), 2 penjualan', nb(await page.locator('#realized .sum-value').innerText()) === nb(`−${idr.format(760_000)}`) && (await page.locator('#realized .sum-value').getAttribute('class')).includes('neg') && /2 penjualan/.test(await page.locator('#realized').innerText()));
    await nav(page, 'beranda');
    check('T9c Beranda: NVDA tidak ada lagi, 8 aset', !(await holdSyms(page)).includes('NVDA') && (await page.locator('#holdings .hold').count()) === 8);

    // beli lagi: harga rata-rata tertimbang
    await goto(page, AH('us:AAPL'));
    await page.locator('[data-act="buy"]').click();
    await page.fill('#t-qty', '2');
    await page.fill('#t-price', '200');
    await page.fill('#t-fx', '16000');
    const pvb = nb(flat(await page.locator('#t-preview').innerText()));
    check('T10 pratinjau beli: total (dengan rupiahnya), jumlah jadi, harga rata-rata baru', pvb.includes(nb(`Total beli ${usdF.format(400)} (${idr.format(6_400_000)})`)) && /Jumlah jadi 7/.test(pvb) && pvb.includes(nb(usdF.format(185.71))), pvb);
    await page.fill('#t-date', '2099-01-01');
    await page.locator('#t-save').click();
    await page.waitForSelector('#t-err:not([hidden])');
    check('T10b tanggal di masa depan ditolak, Sheet tidak berubah', /masa depan/.test(await page.locator('#t-err').innerText()) && asset('AAPL').qty === 5);
    await page.fill('#t-date', todayWib());
    await page.locator('#t-save').click();
    await tradeDone();
    const aapl = asset('AAPL');
    check('T11 beli tersimpan: jumlah 7, harga rata-rata tertimbang; transaksi beli tanpa untung/rugi', aapl.qty === 7 && Math.abs(aapl.avgCost - (5 * 180 + 2 * 200) / 7) < 1e-6 && txs().some((t) => t.kind === 'buy' && t.symbol === 'AAPL' && t.qty === 2 && !('pnlIdr' in t)) && /Pembelian tercatat/.test(await toastText(page)), JSON.stringify(aapl));

    // kiriman ulang aman: Sheet sudah berubah tapi balasannya hilang -> ulangi -> tidak dobel
    await goto(page, AH('idx:TLKM'));
    await page.locator('[data-act="sell"]').click();
    await page.fill('#t-qty', '100');
    await page.fill('#t-price', '3500');
    env.mode = 'lost';
    await page.locator('#t-save').click();
    await page.waitForSelector('#t-err:not([hidden])');
    const afterLost = { qty: asset('TLKM').qty, n: txs().filter((t) => t.symbol === 'TLKM').length };
    check('T12 balasan hilang: pesan galat, lembar tetap terbuka, tombol bisa diketuk lagi', (await isOpen(page, 'trade-dlg')) && (await page.locator('#t-save').isEnabled()) && afterLost.qty === 1900 && afterLost.n === 1, JSON.stringify(afterLost));
    env.mode = 'ok';
    await page.locator('#t-save').click();
    await tradeDone();
    check('T12b ulangi: TIDAK terjual dua kali dan transaksinya tetap satu', asset('TLKM').qty === 1900 && txs().filter((t) => t.symbol === 'TLKM').length === 1 && /1\.900 lembar/.test(await page.locator('#detail').innerText()));

    // rincian dan hapus catatan
    await nav(page, 'aktivitas');
    check('T13 Aktivitas: 4 transaksi, terbaru di atas', (await page.locator('#txs .tx').count()) === 4 && /TLKM/.test(await page.locator('#txs .tx').first().innerText()));
    await page.locator('#txs .tx', { hasText: 'BBCA' }).click();
    const xb = nb(flat(await page.locator('#x-body').innerText()));
    check('T14 rincian transaksi: Penjualan, jumlah × harga, modal porsi, keuntungan dengan persen', (await isOpen(page, 'tx-dlg')) && (await page.locator('#x-h').innerText()) === 'Penjualan' && xb.includes(nb(`400 × ${idr.format(10_000)}`)) && xb.includes(nb(`+${idr.format(200_000)} (+5,26%)`)), xb);
    await shot(page, 'rincian-transaksi.png');
    page.once('dialog', (d) => d.dismiss());
    await page.locator('#x-del').click();
    check('T14b batal hapus catatan: tidak berubah', txs().length === 4 && (await isOpen(page, 'tx-dlg')));
    page.once('dialog', (d) => d.accept());
    await page.locator('#x-del').click();
    await page.waitForFunction(() => !document.getElementById('tx-dlg').open);
    check('T15 hapus catatan: hilang dari Sheet dan Aktivitas, total terealisasi ikut berubah, jumlah aset TIDAK berubah', txs().length === 3 && !txs().some((t) => t.symbol === 'BBCA') && asset('BBCA').qty === 600
      && nb(await page.locator('#realized .sum-value').innerText()) === nb(`−${idr.format(930_000)}`) && (await page.locator('#txs .tx').count()) === 3);

    // nominal tersembunyi: Aktivitas tanpa rupiah dan tanpa jumlah unit
    await page.locator('#privacy').click();
    const act = await page.locator('#v-aktivitas').textContent();
    const qtyTexts = await page.locator('#txs .tx-main small').allInnerTexts();
    check('T16 nominal tersembunyi: Aktivitas tanpa rupiah, jumlah unit tersamar', !/Rp\s?\d/.test(act) && qtyTexts.every((t) => t.startsWith('••••••')) && /••••••/.test(await page.locator('#realized .sum-value').innerText()), qtyTexts.join(' | '));
    await page.locator('#txs .tx').first().click();
    const xh = nb(flat(await page.locator('#x-body').innerText())); // transaksi teratas: jual 100 TLKM @ 3.500, modal 320.000, untung 30.000
    check('T16b rincian transaksi saat tersembunyi: jumlah, modal, dan keuntungan tersamar (harga pasar per unit boleh)', xh.includes('•••••• ×') && !xh.includes('320.000') && !xh.includes('30.000') && !/\b100 ×/.test(xh), xh);
    await page.locator('#x-close').click();
    await page.locator('#privacy').click();

    // kas: tanpa jual-beli
    await goto(page, AH('cash:KAS'));
    check('T17 Kas: tanpa Beli/Jual; tombol Tukar, Ubah saldo, Hapus', (await page.locator('#detail .act').allInnerTexts()).map(flat).join() === 'Tukar,Ubah saldo,Hapus');
    check('T18 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============ N. uang lewat kas: jual masuk kas, tukar mata uang, trade emas ============
  {
    const { ctx, page, fake, env, errors } = await newPage();
    await openDash(page, fake);
    const asset = (sym) => sheetOf(fake).assets.find((a) => a.symbol === sym);
    const txs = () => sheetOf(fake).transactions;
    const done = (id) => page.waitForFunction((x) => !document.getElementById(x).open, id);

    // jual masuk ke kas yang sama mata uangnya
    await goto(page, AH('idx:BBCA'));
    await page.locator('[data-act="sell"]').click();
    check('N1 lembar Jual: ada "Masuk ke kas" dengan kas rupiah (bukan kas dolar)', /^Masuk ke kas/.test(await page.locator('#t-cash-l').innerText()) && /^Kas ·/.test(await page.locator('#t-cash').innerText()) && !/Dolar/.test(await page.locator('#t-cash').innerText()));
    await page.fill('#t-qty', '400'); await page.fill('#t-price', '10000');
    await page.locator('#t-save').click();
    await done('trade-dlg');
    check('N2 jual BBCA 400 x 10.000: kas rupiah bertambah 4.000.000 (3.000.000 -> 7.000.000)', asset('KAS').qty === 7_000_000 && asset('USD').qty === 500);
    await goto(page, AH('us:NVDA'));
    await page.locator('[data-act="sell"]').click();
    check('N3 saham AS: "Masuk ke kas" berisi kas dolar', /^Dolar ·/.test(await page.locator('#t-cash').innerText()));
    await page.locator('#t-all').click(); await page.fill('#t-price', '100'); await page.fill('#t-fx', '16000');
    await page.locator('#t-save').click();
    await done('trade-dlg');
    check('N4 jual saham AS: hasil dalam DOLAR masuk kas dolar (500 + 3 x 100 = 800), kas rupiah tidak ikut', asset('USD').qty === 800 && asset('KAS').qty === 7_000_000);

    // beli: saldo kurang ditolak, kas terpotong bila cukup
    await goto(page, AH('idx:TLKM'));
    await page.locator('[data-act="buy"]').click();
    check('N5 lembar Beli: "Bayar dari kas" dengan kas rupiah', /^Bayar dari kas/.test(await page.locator('#t-cash-l').innerText()) && /^Kas ·/.test(await page.locator('#t-cash').innerText()));
    await page.fill('#t-qty', '5000'); await page.fill('#t-price', '3000');
    check('N6 pratinjau beli: saldo kas kurang diperingatkan (15.000.000 > 7.000.000)', /Saldo kas kurang/.test(await page.locator('#t-preview').innerText()));
    await page.locator('#t-save').click();
    await page.waitForSelector('#t-err:not([hidden])');
    check('N6b menyimpan beli tanpa saldo cukup ditolak; aset dan kas tidak berubah', /Saldo kas KAS kurang/.test(await page.locator('#t-err').innerText()) && asset('TLKM').qty === 2000 && asset('KAS').qty === 7_000_000 && !txs().some((t) => t.kind === 'buy'));
    await page.fill('#t-qty', '1000');
    check('N6c galat hilang begitu jumlahnya dibetulkan; pratinjau tanpa peringatan saldo', !(await page.locator('#t-err').isVisible()) && !/Saldo kas kurang/.test(await page.locator('#t-preview').innerText()));
    await page.locator('#t-save').click();
    await done('trade-dlg');
    check('N7 beli 1.000 x 3.000 dari kas: kas berkurang 3.000.000 (7.000.000 -> 4.000.000), jumlah jadi 3.000', asset('KAS').qty === 4_000_000 && asset('TLKM').qty === 3000);

    // tukar mata uang (versi 4)
    await goto(page, AH('cash:KAS'));
    await page.locator('[data-act="convert"]').click();
    check('N8 Tukar dari halaman kas: lembar terbuka dengan kas itu sebagai asal; tujuannya kas dolar; kurs terisi', (await isOpen(page, 'conv-dlg')) && /^Kas ·/.test(await page.locator('#v-from').evaluate((e) => e.options[e.selectedIndex].text)) && /^Dolar ·/.test(await page.locator('#v-to').innerText()) && Number(await page.inputValue('#v-rate')) > 0 && /^Jumlah \(Rp\)/.test(await page.locator('#v-amt-l').innerText()));
    await page.fill('#v-amt', '1600000'); await page.fill('#v-rate', '16000');
    check('N9 pratinjau tukar: 1.600.000 / 16.000 = US$100,00', nb(flat(await page.locator('#v-preview').innerText())).includes(nb(`Diterima ${usdF.format(100)}`)), flat(await page.locator('#v-preview').innerText()));
    await shot(page, 'tukar.png');
    await page.fill('#v-amt', '9000000');
    check('N9b jumlah melebihi saldo: pratinjau memperingatkan', /Saldo (kas )?KAS kurang/.test(await page.locator('#v-preview').innerText()));
    await page.locator('#v-save').click();
    await page.waitForSelector('#v-err:not([hidden])');
    check('N9c menyimpan tukar melebihi saldo ditolak; kas tidak berubah', /Saldo KAS kurang/.test(await page.locator('#v-err').innerText()) && asset('KAS').qty === 4_000_000 && !txs().some((t) => t.kind === 'convert'));
    await page.fill('#v-amt', '1600000');
    check('N9d galat hilang begitu jumlahnya dibetulkan', !(await page.locator('#v-err').isVisible()));
    await page.locator('#v-save').click();
    await done('conv-dlg');
    const cv = txs().find((t) => t.kind === 'convert');
    check('N10 tukar tersimpan: kas rupiah 4.000.000 -> 2.400.000, kas dolar 800 -> 900; transaksi Tukar tercatat lengkap', asset('KAS').qty === 2_400_000 && asset('USD').qty === 900 && cv && cv.symbol === 'KAS' && cv.toSymbol === 'USD' && cv.qty === 1_600_000 && cv.price === 16_000 && cv.toQty === 100 && cv.currency === 'IDR', JSON.stringify(cv));
    // dolar -> rupiah lewat menu +
    await openAdd(page, 'convert');
    await page.selectOption('#v-from', 'cash:USD');
    check('N11 asal kas dolar: tujuan kas rupiah, label jumlah dalam US$', /^Kas ·/.test(await page.locator('#v-to').innerText()) && /^Jumlah \(US\$\)/.test(await page.locator('#v-amt-l').innerText()));
    await page.fill('#v-amt', '100'); await page.fill('#v-rate', '16250');
    await page.locator('#v-save').click();
    await done('conv-dlg');
    check('N12 tukar dolar -> rupiah: 100 x 16.250 = 1.625.000 masuk kas rupiah (2.400.000 -> 4.025.000); dolar 900 -> 800', asset('KAS').qty === 4_025_000 && asset('USD').qty === 800);
    await nav(page, 'aktivitas');
    const rowsJb = await page.locator('#txs .tx').allInnerTexts();
    check('N13 Aktivitas > Jual-beli memuat baris Tukar (dua), Jual, Beli; baris Tukar menampilkan asal -> tujuan', rowsJb.filter((t) => /^Tukar/.test(t)).length === 2 && rowsJb.some((t) => /KAS → USD/.test(t)) && rowsJb.some((t) => /^Jual/.test(t)) && rowsJb.some((t) => /^Beli/.test(t)), rowsJb.map(flat).join(' | '));

    // trade emas: profit dan rugi langsung ke kas dolar
    await openAdd(page, 'fx');
    check('N14 lembar Trade emas: Buy/Sell, Lot, Profit/Rugi, Jumlah, Tanggal, "Masuk ke kas" berisi kas dolar', (await isOpen(page, 'fx-dlg')) && /^Dolar ·/.test(await page.locator('#z-cash').innerText()) && (await page.locator('#z-date').inputValue()) === todayWib());
    await page.locator('#z-save').click();
    await page.waitForSelector('#z-err:not([hidden])');
    check('N15 menyimpan kosong ditolak: lot dan profit/rugi wajib', /Lot harus/.test(await page.locator('#z-err').innerText()) && /profit atau rugi/.test(await page.locator('#z-err').innerText()) && txs().filter((t) => t.kind === 'fx').length === 0);
    await page.fill('#z-lot', '0.05'); await page.fill('#z-amt', '25.5');
    check('N15b galat hilang saat isian dibetulkan; pratinjau kas dolar US$800 -> US$825,50', !(await page.locator('#z-err').isVisible()) && nb(flat(await page.locator('#z-preview').innerText())).includes(nb(`${usdF.format(800)} → ${usdF.format(825.5)}`)), flat(await page.locator('#z-preview').innerText()));
    await shot(page, 'trade-emas.png');
    await page.locator('#z-save').click();
    await done('fx-dlg');
    await routed(page, 'aktivitas/trading');
    const fx1 = txs().find((t) => t.kind === 'fx');
    check('N16 profit tersimpan: kas dolar +25,50 (800 -> 825,5); transaksi fx berisi tanggal, Buy, lot, profit', asset('USD').qty === 825.5 && fx1 && fx1.side === 'buy' && fx1.qty === 0.05 && fx1.pnl === 25.5 && fx1.symbol === 'XAUUSD' && fx1.date === todayWib() && fx1.currency === 'USD', JSON.stringify(fx1));
    check('N16b pindah ke tab Trading emas: ringkasan menampilkan total profit, 1 trade, win rate 100%', nb(flat(await page.locator('#fxsum').innerText())).includes(nb(`+${usdF.format(25.5)}`)) && /1 trade/.test(await page.locator('#fxsum').innerText()) && /100%/.test(await page.locator('#fxsum').innerText()) && (await page.locator('#aktnav a[aria-current="page"]').innerText()) === 'Trading emas');
    await openAdd(page, 'fx');
    await page.locator('#fx-form input[name="side"][value="sell"]').check({ force: true });
    await page.locator('#fx-form input[name="res"][value="loss"]').check({ force: true });
    await page.fill('#z-lot', '0.1'); await page.fill('#z-amt', '40');
    check('N17 rugi: pratinjau kas dolar US$825,50 -> US$785,50', nb(flat(await page.locator('#z-preview').innerText())).includes(nb(`${usdF.format(825.5)} → ${usdF.format(785.5)}`)), flat(await page.locator('#z-preview').innerText()));
    await page.locator('#z-save').click();
    await done('fx-dlg');
    const fx2 = txs().filter((t) => t.kind === 'fx').find((t) => t.pnl < 0);
    check('N17b rugi tersimpan negatif dan memotong kas dolar (785,5); sisi Sell', asset('USD').qty === 785.5 && fx2 && fx2.pnl === -40 && fx2.side === 'sell', JSON.stringify(fx2));
    const sumTxt = nb(flat(await page.locator('#fxsum').innerText()));
    check('N18 ringkasan: total −US$14,50, 2 trade, win rate 50%, menang/kalah 1 / 1, bulan ini −US$14,50', sumTxt.includes(nb(`−${usdF.format(14.5)}`)) && /2 trade/.test(sumTxt) && /50%/.test(sumTxt) && /1 \/ 1/.test(sumTxt), sumTxt);
    check('N18b grafik per bulan: satu batang merah (bulan ini bersih rugi), satu baris bulan; dua baris trade', (await page.locator('#fxchart rect.bar.neg').count()) === 1 && (await page.locator('#fxmonths .mrow').count()) === 1 && (await page.locator('#fxlist .tx').count()) === 2);
    await page.locator('#fxlist .tx').first().click();
    check('N19 rincian trade: judul "Trade emas", lot, rugi dengan tanda', (await isOpen(page, 'tx-dlg')) && (await page.locator('#x-h').innerText()) === 'Trade emas' && /Rugi/.test(await page.locator('#x-body').innerText()) && nb(await page.locator('#x-body').innerText()).includes(nb(`−${usdF.format(40)}`)));
    page.once('dialog', (d) => d.accept());
    await page.locator('#x-del').click();
    await page.waitForFunction(() => !document.getElementById('tx-dlg').open);
    check('N20 hapus catatan trade: hilang dari daftar, kas dolar TIDAK berubah (785,5)', txs().filter((t) => t.kind === 'fx').length === 1 && asset('USD').qty === 785.5 && (await page.locator('#fxlist .tx').count()) === 1);
    await page.locator('#privacy').click();
    const hidFx = await page.locator('#v-aktivitas').textContent();
    check('N21 nominal tersembunyi: tab Trading emas tanpa angka dolar (profit, grafik, daftar); win rate tetap', !/US\$\s?\d/.test(hidFx) && /100%/.test(hidFx) && !/\d+,5/.test(await page.locator('#fxchart').textContent()));
    await page.locator('#privacy').click();
    await goto(page, '#/aktivitas/jual-beli');
    check('N22 trade emas tidak masuk daftar Jual-beli maupun total terealisasi', !(await page.locator('#txs').innerText()).includes('XAUUSD') && /2 penjualan/.test(await page.locator('#realized').innerText()));
    // rugi melebihi saldo
    await openAdd(page, 'fx');
    await page.locator('#fx-form input[name="res"][value="loss"]').check({ force: true });
    await page.fill('#z-lot', '1'); await page.fill('#z-amt', '5000');
    check('N23 rugi melebihi saldo kas dolar: pratinjau memperingatkan', /Saldo kas kurang/.test(await page.locator('#z-preview').innerText()));
    await page.locator('#z-save').click();
    await page.waitForSelector('#z-err:not([hidden])');
    check('N23b menyimpan rugi melebihi saldo ditolak; kas dan catatan tidak berubah', /Saldo kas USD kurang/.test(await page.locator('#z-err').innerText()) && asset('USD').qty === 785.5 && txs().filter((t) => t.kind === 'fx').length === 1);
    await page.locator('#z-cancel').click();
    check('N24 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // tanpa kas dolar: jual saham AS membuat kas dolar otomatis; beli saham AS ditolak
    const { ctx, page, fake, errors } = await newPage();
    fake.call({ token: fake.token, action: 'saveAssets', assets: sheetOf(fake).assets.filter((a) => a.symbol !== 'USD') });
    await openDash(page, fake);
    await goto(page, AH('us:AAPL'));
    await page.locator('[data-act="buy"]').click();
    await page.fill('#t-qty', '1'); await page.fill('#t-price', '200'); await page.fill('#t-fx', '16000');
    check('N25 beli saham AS tanpa kas dolar: pratinjau "Belum ada kas dolar"', /Belum ada kas dolar/.test(await page.locator('#t-preview').innerText()));
    await page.locator('#t-save').click();
    await page.waitForSelector('#t-err:not([hidden])');
    check('N25b menyimpan ditolak dengan pesan yang sama; jumlah tetap', /Belum ada kas dolar/.test(await page.locator('#t-err').innerText()) && sheetOf(fake).assets.find((a) => a.symbol === 'AAPL').qty === 5);
    await page.locator('#t-cancel').click();
    await page.locator('[data-act="sell"]').click();
    check('N26 jual saham AS tanpa kas dolar: "Masuk ke kas" = kas baru otomatis', /Kas baru/.test(await page.locator('#t-cash').innerText()));
    await page.fill('#t-qty', '2'); await page.fill('#t-price', '200'); await page.fill('#t-fx', '16000');
    await page.locator('#t-save').click();
    await page.waitForFunction(() => !document.getElementById('trade-dlg').open);
    const usdCash = sheetOf(fake).assets.find((a) => a.type === 'cash' && a.currency === 'USD');
    check('N27 kas dolar dibuat otomatis berisi hasil jual (2 x 200 = US$400)', !!usdCash && usdCash.qty === 400 && usdCash.symbol === 'USD', JSON.stringify(usdCash));
    check('N28 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // sheet tanpa kas sama sekali: Beli aset dan Tukar mengarahkan ke Tambah kas
    const fk = createFake();
    const { ctx, page, errors } = await newPage({ fake: fk });
    await openDash(page, fk);
    await page.locator('#nav-add').click();
    await page.locator('[data-menu-act="asset"]').click();
    check('N29 belum ada kas: "Beli aset" mengarahkan ke lembar Tambah kas dengan pesan', (await isOpen(page, 'asset-dlg')) && (await page.locator('#f-h').innerText()) === 'Tambah kas' && /Tambah kas dulu/.test(await toastText(page)));
    await page.fill('#f-symbol', 'BCA'); await page.fill('#f-qty', '5000000');
    await page.locator('#f-save').click();
    await routed(page, `aset/${encodeURIComponent('cash:BCA')}`);
    await openAdd(page, 'asset');
    await page.fill('#f-symbol', 'BBCA'); await page.fill('#f-qty', '100'); await page.fill('#f-avgCost', '9000');
    await page.locator('#f-save').click();
    await routed(page, `aset/${encodeURIComponent('idx:BBCA')}`);
    check('N30 alur lengkap dari nol: kas 5.000.000 -> beli 100 BBCA @9.000 -> kas 4.100.000', sheetOf(fk).assets.find((a) => a.symbol === 'BCA').qty === 4_100_000 && sheetOf(fk).assets.find((a) => a.symbol === 'BBCA').qty === 100);
    check('N31 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // skrip versi 3: beli/jual jalan, tukar dan trade emas ditahan dengan pesan jelas
    const { ctx, page, fake, env } = await newPage();
    env.fake = { token: fake.token, call: (p) => { const r = fake.call(p); if (r && r.version) r.version = 3; return r; } };
    await openDash(page, fake);
    await openAdd(page, 'fx');
    check('N32 skrip v3: Trade emas tidak terbuka, pesan menyebut versi 4', !(await isOpen(page, 'fx-dlg')) && /versi 4/.test(await toastText(page)));
    await openAdd(page, 'convert');
    check('N32b skrip v3: Tukar mata uang tidak terbuka, pesan menyebut versi 4', !(await isOpen(page, 'conv-dlg')) && /versi 4/.test(await toastText(page)));
    await goto(page, AH('cash:KAS'));
    check('N32c skrip v3: tombol Tukar di halaman kas redup dengan catatan', (await page.locator('[data-act="convert"]').getAttribute('aria-disabled')) === 'true' && /Apps Script terbaru/.test(await page.locator('#detail .note').innerText()));
    await nav(page, 'profil');
    check('N32d Profil > Data menyebut tukar dan trade emas belum bisa', /tukar mata uang dan trade emas belum bisa/.test(await page.locator('#set-data').innerText()));
    await goto(page, AH('idx:BBCA'));
    await page.locator('[data-act="sell"]').click();
    check('N32e skrip v3: jual tetap bisa (lembar terbuka)', await isOpen(page, 'trade-dlg'));
    await ctx.close();
  }

  // ============ V. skrip Apps Script lama ============
  {
    // versi 2: tanggal beli bisa, jual-beli belum
    const { ctx, page, fake, env, errors } = await newPage();
    env.fake = { token: fake.token, call: (p) => { const r = fake.call(p); if (r && r.version) r.version = 2; delete r.transactions; return r; } };
    await openDash(page, fake, `#/aset/${encodeURIComponent('idx:BBCA')}`);
    await page.waitForSelector('#v-aset:not([hidden])');
    check('V1 skrip versi 2: tombol Beli/Jual dinonaktifkan dengan catatan cara memperbarui', (await page.locator('[data-act="sell"]').getAttribute('aria-disabled')) === 'true' && /Apps Script terbaru/.test(await page.locator('#detail .note').innerText()));
    await page.locator('[data-act="sell"]').click({ force: true }); // aria-disabled: tetap bisa diketuk, harus menjelaskan
    check('V1b mengetuk Jual: lembar tidak terbuka, pesan menjelaskan', !(await isOpen(page, 'trade-dlg')) && /versi 3/.test(await toastText(page)) && !env.actions.includes('trade'));
    await nav(page, 'profil');
    check('V1c Profil > Data menyebut jual-beli belum bisa dicatat', /jual-beli belum bisa dicatat/.test(await page.locator('#set-data').innerText()));
    check('V1d tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // tanpa versi (skrip paling lama): tanggal beli tidak dikirim
    const { ctx, page, fake, env } = await newPage();
    const sent = [];
    env.fake = { token: fake.token, call: (p) => {
      try { const q = JSON.parse(p); if (q.action === 'saveAssets') sent.push(...q.assets); } catch {}
      const r = fake.call(p);
      if (r) { delete r.version; delete r.transactions; }
      return r;
    } };
    await openDash(page, fake);
    await openAdd(page, 'cash');
    check('V2 skrip lama: lembar Tambah memberi catatan versi lama dan menyembunyikan tanggal beli', (await page.locator('#f-old').isVisible()) && !(await page.locator('#buy-field').isVisible()));
    await page.fill('#f-symbol', 'DOMPET'); await page.fill('#f-qty', '250000');
    await page.locator('#f-save').click();
    await page.waitForFunction(() => !document.getElementById('asset-dlg').open);
    const asii = sheetOf(fake).assets.find((a) => a.symbol === 'DOMPET');
    check('V3 menyimpan tetap berhasil, tanpa pernah mengirim buyDate ke skrip lama', !!asii && !sent.some((a) => 'buyDate' in a && a.symbol !== 'BBCA'), `terkirim buyDate: ${sent.filter((a) => 'buyDate' in a).map((a) => a.symbol).join() || 'tidak ada'}`);
    await ctx.close();
  }

  // ============ D. kegagalan dan keadaan kosong ============
  {
    const { ctx, page, fake, env } = await newPage();
    await openDash(page, fake);
    env.fake = createFake({ token: 'sudah-diganti' }); // kata sandi di Apps Script diganti
    await page.reload();
    await page.waitForSelector('#c-err:not([hidden])');
    check('D1 kata sandi sudah diganti -> form sambung dengan pesan, URL terisi', /tidak cocok/.test(await page.locator('#c-err').innerText()) && (await page.inputValue('#c-url')) === GURL);
    await page.goto(`${BASE}/kelola.html`);
    await page.waitForURL(/index\.html#\/beranda$/);
    check('D2 tautan lama kelola.html diteruskan ke dasbor', /index\.html#\/beranda$/.test(page.url()), page.url());
    await ctx.close();
  }
  {
    const { ctx, page, fake, env } = await newPage();
    await openDash(page, fake);
    env.mode = 'abort';
    await page.reload();
    await page.waitForSelector('#banner:not([hidden])');
    check('D3 jaringan putus -> pesan jelas, bukan halaman kosong', /tidak bisa dibaca/.test(await page.locator('#banner').innerText()));
    env.mode = 'html';
    await page.reload();
    await page.waitForSelector('#banner:not([hidden])');
    check('D4 Google membalas halaman HTML -> pesan ramah', /bukan JSON/.test(await page.locator('#banner').innerText()));
    await nav(page, 'profil');
    check('D4b saat gagal: Profil tetap bisa dibuka (Keluar terjangkau)', (await page.locator('#v-profil').isVisible()) && (await page.locator('#logout').isVisible()));
    await page.locator('#relink').click();
    check('D5 "Sambungkan ulang" membersihkan dan membuka form', (await page.locator('#connect').isVisible()) && (await page.evaluate(() => localStorage.getItem('pf-api'))) === null);
    await ctx.close();
  }
  {
    // aset ada, riwayat belum ada (robot belum jalan)
    const { ctx, page, fake, errors } = await newPage({ withHistory: false });
    await openDash(page, fake);
    await page.waitForSelector('#dash:not([hidden])');
    const sum = await page.locator('#summary').innerText();
    check('D6 riwayat kosong: aset pasar "Menunggu harga", kas dan manual langsung terhitung', (await page.locator('#holdings .hold.wait').count()) === 7 && (await page.locator('#holdings .hold:not(.wait)').count()) === 2 && sum.includes(idr.format(8_000_000).replace(/\s/g, ' ').slice(0, 2)) && /7 aset menunggu harga/.test(sum), flat(sum));
    check('D6b keadaan ini BUKAN kegagalan: subjudul netral, tanpa banner merah, grafik menjelaskan butuh 2 hari', !/Gagal/.test(await page.locator('#subtitle').innerText()) && !(await page.locator('#banner').isVisible()) && /minimal 2 hari/.test(await page.locator('#chart').innerText()), await page.locator('#subtitle').innerText());
    await page.locator('#holdings .hold.wait', { hasText: 'BBCA' }).click();
    await routed(page, `aset/${encodeURIComponent('idx:BBCA')}`);
    check('D6c halaman aset yang belum berharga: "Menunggu harga" dan penjelasan, tetap bisa diubah', /Menunggu harga/.test(await page.locator('#detail').innerText()) && (await page.locator('[data-act="edit"]').isVisible()));
    check('D6d tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // Sheet kosong sama sekali: ajakan menambah aset pertama
    const fk = createFake();
    const { ctx, page, errors } = await newPage({ fake: fk });
    await openDash(page, fk);
    await page.waitForSelector('#dash:not([hidden])');
    check('D7 Sheet kosong: ajakan "Mulai dari kas" dengan tombol Tambah kas, tanpa grafik, alokasi, dan alat daftar', /Mulai dari kas/.test(await page.locator('#summary').innerText()) && !(await page.locator('#chart-card').isVisible()) && !(await page.locator('#alloc-card').isVisible()) && !(await page.locator('#hold-tools').isVisible()));
    await page.locator('#summary [data-add]').click();
    check('D7b tombolnya membuka lembar "Tambah kas" (jenis Kas terpilih, tanpa kolom bayar dari kas)', (await isOpen(page, 'asset-dlg')) && (await page.locator('#f-h').innerText()) === 'Tambah kas' && (await page.inputValue('#f-type')) === 'cash' && !(await page.locator('#pay-field').isVisible()));
    await page.selectOption('#f-type', 'cash');
    await page.fill('#f-symbol', 'BCA');
    await page.fill('#f-qty', '1000000');
    await page.locator('#f-save').click();
    await routed(page, `aset/${encodeURIComponent('cash:BCA')}`);
    await nav(page, 'beranda');
    check('D7c aset pertama (kas) langsung terhitung di total tanpa menunggu robot', (await page.locator('#summary .sum-value').innerText()) === idr.format(1_000_000));
    check('D7d tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 500 } });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
    await page.waitForTimeout(300);
    check('D8 index.html dari file:// -> petunjuk npm run serve', /npm run serve/.test(await page.locator('#banner').innerText()));
    await ctx.close();
  }

  // ============ G. jam pembaruan & penanda basi ============
  for (const [label, seedOpts, want] of [
    ['G1 ada jam pembaruan', {}, { text: /^Diperbarui 23 Nov, 13\.30 WIB \(.+[\s ]lalu\)$/, stale: null }],
    ['G2 jam pembaruan sudah 3 hari -> bertanda basi', { at: '2026-11-20T06:30:00Z' }, { text: /^Diperbarui 20 Nov, 13\.30 WIB \(\d+[\s ]hari[\s ]lalu\)$/, stale: true }],
    ['G3 snapshot lama tanpa jam -> tampil data per tanggal, tidak bertanda basi', { at: null }, { text: /^Data per 23 Nov 2026$/, stale: false }],
  ]) {
    const { ctx, page, fake } = await newPage({ seedOpts });
    await openDash(page, fake);
    await page.waitForSelector('#dash:not([hidden])');
    const sub = (await page.locator('#subtitle').innerText()).trim();
    const stale = await page.locator('#subtitle').evaluate((n) => n.classList.contains('stale'));
    check(`${label}`, want.text.test(sub) && (want.stale === null || stale === want.stale), `"${sub}" stale=${stale}`);
    if (label.startsWith('G1')) {
      await goto(page, AH('idx:BBCA'));
      check('G4 halaman aset: harga terakhir bertanggal ("per 23 Nov 2026"), bukan "penutupan"', /Harga terakhir\s*Rp\s[\d.]+\s*per 23 Nov 2026/i.test(await page.locator('#detail .stats').innerText()) && !/[Pp]enutupan/.test(await page.locator('#detail').innerText()));
      await nav(page, 'profil');
      const about = await page.locator('#v-profil .prose').innerText();
      check('G5 Profil > Tentang menyebut 4 kali sehari dan bukan "sekali sehari"', /4 kali sehari/.test(about) && !/sekali sehari/.test(about));
    }
    await ctx.close();
  }

  // ============ H. bawaan tersembunyi, kartu aset, muat ulang, kerangka ============
  {
    const { ctx, page, fake } = await newPage({ freshStorage: true });
    await openDash(page, fake);
    await page.waitForSelector('#dash:not([hidden])');
    const secrets = secretsOf(fake);
    const t0 = await page.locator('main').textContent();
    check('H1 kunjungan pertama: nominal tersembunyi (tanpa pernah menekan apa pun)', (await page.locator('#privacy').getAttribute('aria-label')) === 'Tampilkan nominal' && /••••••/.test(await page.locator('#summary .sum-value').innerText()) && secrets.every((x) => !t0.includes(x)));
    await page.getByRole('button', { name: 'Tampilkan nominal' }).click();
    check('H2a setelah diketuk: nominal tampil dan tombol berganti nama', /Rp\s?\d/.test(await page.locator('#summary .sum-value').innerText()) && (await page.locator('#privacy').getAttribute('aria-label')) === 'Sembunyikan nominal');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#dash:not([hidden])');
    check('H2b pilihan "tampil" diingat setelah muat ulang', /Rp\s?\d/.test(await page.locator('#summary .sum-value').innerText()));
    await page.getByRole('button', { name: 'Sembunyikan nominal' }).click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#dash:not([hidden])');
    check('H2c pilihan "sembunyi" juga diingat', /••••••/.test(await page.locator('#summary .sum-value').innerText()));
    await ctx.close();
  }
  {
    const { ctx, page, fake, env } = await newPage();
    await openDash(page, fake);
    await page.waitForSelector('#dash:not([hidden])');
    const sum = flat(await page.locator('#summary').innerText());
    check('H3 ringkasan: "hari ini" dengan panah dan tanda, lalu Modal, Untung, Terealisasi, Bulan ini', /[▲▼]\s?[+−]\d+,\d{2}%.*hari ini/.test(sum) && /Modal.*Untung\s*[▲▼]\s?[+−]\d+,\d{2}%.*Terealisasi\s*–.*Bulan ini/i.test(sum), sum);
    check('H4 kartu aset: mini-grafik harga (bentuk saja, tanpa teks) untuk aset non-kas', (await page.locator('#holdings .hold svg.spark').count()) === 7 && (await page.locator('#holdings svg.spark text').count()) === 0);
    const bbca = await page.locator('#holdings .hold', { hasText: 'BBCA' }).getAttribute('href');
    check('H5 kartu aset menaut ke halaman asetnya', bbca === AH('idx:BBCA'), bbca);

    // muat ulang: panggilan baru ke Sheet, dan jam pembaruan ikut berganti
    const lastSnap = sheetOf(fake).history.at(-1);
    const n0 = env.calls.length;
    fake.call({ token: fake.token, action: 'appendSnapshot', snapshot: { ...lastSnap, at: '2026-11-23T09:45:00Z' } });
    await page.getByRole('button', { name: 'Muat ulang', exact: true }).click();
    await page.waitForFunction(() => /16\.45 WIB/.test(document.getElementById('subtitle').textContent));
    check('H6 Muat ulang mengambil data baru tanpa memuat ulang halaman', env.calls.length === n0 + 1 && /16\.45 WIB/.test(await page.locator('#subtitle').innerText()));
    check('H6b tombol muat ulang kembali aktif, tidak lagi sibuk, namanya tetap', (await page.locator('#reload').isEnabled()) && (await page.locator('#reload').getAttribute('aria-busy')) === null && (await page.locator('#reload').getAttribute('aria-label')) === 'Muat ulang');
    await ctx.close();
  }
  {
    const { ctx, page, fake, env } = await newPage();
    await openDash(page, fake);
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
    // kode pasar huruf besar, label manual apa adanya; hanya satu hari data
    const fk = createFake();
    const assets = [{ type: 'us', symbol: 'panw', qty: 1, avgCost: 100 }, { type: 'manual', symbol: 'Depo Bca', qty: 1, price: 5_000_000, avgCost: 4_000_000 }];
    fk.call({ token: fk.token, action: 'saveAssets', assets });
    const snap = buildSnapshot({ date: '2026-11-23', assets, quotes: new Map([['us:panw', { price: 120, asOf: '2026-11-20' }], ['manual:Depo Bca', { price: 5_000_000, asOf: '2026-11-23' }]]), fx: 16_000 });
    fk.call({ token: fk.token, action: 'appendSnapshot', snapshot: { ...snap, at: '2026-11-23T06:30:00Z' } });
    const { ctx, page } = await newPage({ fake: fk });
    await openDash(page, fk);
    await page.waitForSelector('#dash:not([hidden])');
    const list = await page.locator('#holdings').innerText();
    check('H8 "panw" tampil PANW; label manual "Depo Bca" tidak diubah', /PANW/.test(list) && !/panw/.test(list) && /Depo Bca/.test(list), flat(list).slice(0, 120));
    check('H8b hanya satu hari data: ringkasan memberi tahu "belum ada pembanding", grafik butuh 2 hari', /belum ada pembanding/.test(await page.locator('#summary .today').innerText()) && /minimal 2 hari/.test(await page.locator('#chart').innerText()));
    await goto(page, '#/analisis/kinerja');
    check('H8c hanya satu hari data: Kinerja memberi tahu butuh 2 hari, tanpa metrik palsu', /minimal 2 hari/.test(await page.locator('#metrics').innerText()) && (await page.locator('#metrics .tile').count()) === 0);
    await ctx.close();
  }

  // ============ I. identitas, menu, rute, urutan, garis modal, kinerja ============
  {
    const { ctx, page, fake, env, errors } = await newPage();
    await openDash(page, fake);
    await page.waitForSelector('#dash:not([hidden])');
    check('I0 identitas: judul halaman dan nama Lumbung', (await page.title()) === 'Beranda · Lumbung' && (await page.locator('h1').innerText()) === 'Lumbung');
    const views = () => page.evaluate(() => ['beranda', 'aset', 'analisis', 'aktivitas', 'profil'].map((k) => `${k}:${!document.getElementById(`v-${k}`).hidden}`).join());
    check('I1 awal: hanya Beranda yang tampil', (await views()) === 'beranda:true,aset:false,analisis:false,aktivitas:false,profil:false', await views());

    // Pindah halaman tidak boleh mengambil data lagi (Apps Script lambat).
    const n0 = env.calls.length;
    const seen = [];
    for (const k of ['analisis', 'aktivitas', 'profil', 'beranda']) { await nav(page, k); seen.push(await views()); }
    await page.locator('#holdings .hold').first().click();
    await page.waitForFunction(() => document.body.dataset.route.startsWith('aset/'));
    seen.push(await views());
    check('I2 pindah halaman (menu dan kartu aset): satu halaman tampil tiap kali, TANPA memanggil Sheet lagi', env.calls.length === n0 && seen.every((v) => v.split(',').filter((x) => x.endsWith('true')).length === 1), `${env.calls.length - n0} panggilan tambahan`);
    check('I2b halaman aset: menu Beranda tetap aktif, judul dokumen "Aset"', (await page.locator('#nav-beranda').getAttribute('aria-current')) === 'page' && (await page.title()) === 'Aset · Lumbung');
    await page.locator('#detail .back').click();
    await routed(page, 'beranda');
    await nav(page, 'analisis');
    check('I3 judul dokumen dan fokus ikut pindah (pembaca layar tahu halaman berganti)', (await page.title()) === 'Analisis · Lumbung' && (await page.evaluate(() => document.activeElement.id)) === 'vt-analisis');
    await page.goBack();
    check('I4 tombol kembali membawa ke halaman sebelumnya', (await views()).startsWith('beranda:true') && (await page.locator('#nav-beranda').getAttribute('aria-current')) === 'page');
    await page.goto(`${BASE}/index.html${AH('crypto:ETH')}`);
    await page.waitForSelector('#v-aset:not([hidden])');
    check('I5 tautan langsung ke satu aset: halaman aset terbuka setelah data dimuat', (await page.locator('#detail .d-name').innerText()) === 'Ethereum' && (await page.locator('#achart svg').count()) === 1);
    await goto(page, AH('idx:ZZZZ'));
    check('I5b aset yang tidak ada (mis. sudah terjual): pesan jelas dan tautan ke Aktivitas', /tidak ada lagi/.test(await page.locator('#detail').innerText()) && (await page.locator('#detail a[href="#/aktivitas"]').count()) === 1);
    await goto(page, '#/halaman-tidak-ada');
    check('I5c rute tak dikenal = Beranda', (await views()).startsWith('beranda:true'));

    // urutan aset
    const L = sheetOf(fake).history.at(-1);
    const want = (k) => stats.sortPositions(L.positions, k).map((p) => p.symbol).join();
    const got = {};
    for (const k of ['value', 'pnlPct', 'dayPct', 'name']) { await page.selectOption('#sort', k); got[k] = (await holdSyms(page)).join(); }
    check('I6 Urutkan: nilai, untung, naik hari ini, nama', ['value', 'pnlPct', 'dayPct', 'name'].every((k) => got[k] === want(k)) && got.value !== got.name, JSON.stringify(got));
    await page.selectOption('#sort', 'value');

    // garis modal
    check('I7 grafik nominal punya garis modal putus-putus dan keterangannya', (await page.locator('#chart path.cost').count()) === 1 && /Modal/.test(await page.locator('#chart-key').innerText()));
    await page.locator('#privacy').click();
    check('I7b saat tersembunyi (grafik persen): tanpa garis modal', (await page.locator('#chart path.cost').count()) === 0 && (await page.locator('#chart-key').innerText()) === '');
    await page.locator('#privacy').click();

    // kinerja, dibandingkan dengan hitungan dari riwayat tiruan
    const hist = sheetOf(fake).history;
    const months = stats.monthlyReturns(hist);
    await goto(page, '#/analisis/kinerja');
    const tiles = await page.locator('#metrics .tile').allInnerTexts();
    check('I8 Kinerja: 4 metrik; return tertimbang waktu = hitungan berantai dari dayPct', tiles.length === 4 && tiles[0].includes(p2(stats.returnIndex(hist).at(-1).idx - 1)), flat(tiles[0]));
    await page.locator('#subnav').getByRole('link', { name: 'Bulanan' }).click();
    await routed(page, 'analisis/bulanan');
    const last = months.at(-1);
    const rows0 = await page.locator('#mlist .mrow').allInnerTexts();
    check('I9 Bulanan: satu batang dan satu baris per bulan (maks. 12), terbaru di atas, dengan nama bulan', (await page.locator('#mchart rect.bar').count()) === Math.min(12, months.length) && rows0.length === Math.min(12, months.length) && /^Nov 2026/.test(rows0[0]), rows0[0]);
    check('I9b baris terbaru: rupiah = jumlah perubahan harian bulan itu (bertanda), dan persen = return bulan itu tanpa tanda ganda', nb(flat(rows0[0])).includes(nb(`${last.pnl >= 0 ? '+' : '−'}${idr.format(Math.abs(last.pnl))}`)) && flat(rows0[0]).includes(p2(last.ret).replace(/^[+−]/, '')), flat(rows0[0]));
    check('I9c batang hijau untuk bulan naik dan merah untuk turun (sesuai tanda return); label batang ada', (await page.locator('#mchart rect.bar.pos').count()) === months.slice(-12).filter((m) => m.ret > 0).length && (await page.locator('#mchart rect.bar.neg').count()) === months.slice(-12).filter((m) => m.ret < 0).length && (await page.locator('#mchart text.bv').count()) === Math.min(12, months.length));
    await page.locator('#mrange [data-m="all"]').click();
    check('I9d rentang "Semua" bisa dipilih; 12 bln kembali', (await page.locator('#mrange [data-m="all"]').getAttribute('aria-pressed')) === 'true' && (await page.locator('#mrange [data-m="12"]').getAttribute('aria-pressed')) === 'false');
    await page.locator('#mrange [data-m="12"]').click();
    await page.locator('#privacy').click();
    const rowsH = flat((await page.locator('#mlist').innerText()));
    check('I9e nominal tersembunyi: baris bulanan tanpa rupiah, persen tetap; batang tanpa angka rupiah', !/Rp/.test(rowsH) && /\d+,\d{2}%/.test(rowsH));
    await page.locator('#privacy').click();
    await shot(page, 'bulanan.png', { fullPage: true });
    const prOrder = (await page.locator('#perf .pr-n').allInnerTexts()).join();
    check('I10 untung/rugi per aset: satu batang per aset (tanpa Kas), terurut dari tertinggi', prOrder === [...L.positions].filter((p) => p.type !== 'cash').sort((a, b) => b.pnlPct - a.pnlPct).map((p) => p.symbol).join(), prOrder);
    await nav(page, 'beranda');
    check('I11 ringkasan "Bulan ini" sama dengan bulan terakhir di kalender', flat(await page.locator('#summary').innerText()).includes(`Bulan ini ${months.at(-1).ret > 0 ? '▲' : '▼'} ${p2(months.at(-1).ret)}`.replace('▲ ', '▲').replace('▼ ', '▼')) || flat(await page.locator('#summary').innerText()).includes(p2(months.at(-1).ret)));
    check('I12 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============ K. Analisis, cari aset, Profil, tema ============
  {
    const { ctx, page, fake, errors } = await newPage();
    await openDash(page, fake, '#/analisis');
    await page.waitForSelector('#v-analisis:not([hidden])');
    const hist = sheetOf(fake).history;
    const L = hist.at(-1);
    check('K1 #/analisis tanpa bagian = Kinerja; sub-menu menandai bagian yang aktif', (await page.locator('#an-kinerja').isVisible()) && !(await page.locator('#an-risiko').isVisible()) && /Kinerja/.test(await page.locator('#subnav a[aria-current="page"]').innerText()));

    await page.locator('#subnav').getByRole('link', { name: 'Alokasi' }).click();
    await routed(page, 'analisis/alokasi');
    const ts = stats.byTypePnl(L.positions);
    const tOrder = Object.keys(ts).sort((a, b) => ts[b].value - ts[a].value);
    const filters = await page.locator('#types .ty').evaluateAll((as) => as.map((a) => a.dataset.filter));
    check('K2 Alokasi: satu baris per jenis, urut dari nilai terbesar', JSON.stringify(filters) === JSON.stringify(tOrder), filters.join());
    check('K2b untung/rugi jenis terbesar = hitungan dari posisi', (await page.locator('#types .ty').first().innerText()).includes(p2(ts[tOrder[0]].pnlPct)));
    const c = stats.concentration(L.positions.filter((p) => p.type !== 'cash'));
    const split = stats.cashSplit(L);
    const ct = await page.locator('#conc .tile').allInnerTexts();
    check('K3 Alokasi: Kas, Diinvestasikan, lalu 3 aset terbesar dan "setara N aset" (di luar kas) sesuai hitungan', ct.length === 4 && /^Kas/i.test(ct[0]) && ct[0].includes(p1(split.weight)) && /^Diinvestasikan/i.test(ct[1]) && ct[2].includes(p1(c.top3)) && ct[3].includes(`${c.effective.toLocaleString('id-ID', { maximumFractionDigits: 1 })} aset`), flat(ct.join(' | ')));
    check('K3b baris jenis Kas tidak menampilkan untung/rugi (selalu nol)', !/[▲▼]|0,00%/.test(await page.locator('#types .ty[data-filter="cash"]').innerText()));
    await page.locator('#types .ty[data-filter="crypto"]').click();
    await routed(page, 'beranda');
    check('K3c ketuk jenis di Analisis > Alokasi -> Beranda dengan daftar tersaring jenis itu', JSON.stringify((await holdSyms(page)).sort()) === '["BTC","ETH"]' && (await page.locator('#chips [data-filter="crypto"]').getAttribute('aria-pressed')) === 'true');
    await page.locator('#chips [data-filter=""]').click();

    await goto(page, '#/analisis/risiko');
    const r = stats.riskStats(hist);
    const dd = stats.currentDrawdown(stats.returnIndex(hist));
    const rt = await page.locator('#risk .tile').allInnerTexts();
    check('K4 Risiko: volatilitas, penurunan saat ini, hari terbaik dan terburuk sesuai hitungan', rt.length === 4 && rt[0].includes(p1(r.vol)) && rt[1].includes(p2(dd.pct)) && rt[2].includes(p2(r.best.pct)) && rt[3].includes(p2(r.worst.pct)), flat(rt.join(' | ')));

    await page.locator('#subnav').getByRole('link', { name: 'Riwayat' }).click();
    await routed(page, 'analisis/riwayat');
    const rows = () => page.locator('#hist tbody tr').count();
    const first = flat(await page.locator('#hist tbody tr').first().innerText());
    check('K5 Riwayat: 30 hari dulu, terbaru di atas (23 Nov 2026), dengan nilai dan persen', (await rows()) === 30 && /^23 Nov 2026 Rp/.test(first) && /[▲▼]/.test(first), first);
    await page.locator('#hist-more').click();
    const after1 = await rows();
    for (let i = 0; i < 3; i++) if (await page.locator('#hist-more').isVisible()) await page.locator('#hist-more').click();
    check('K5b "Tampilkan lebih banyak" menambah 30 per ketukan, hilang bila semua sudah tampil', after1 === 60 && (await rows()) === hist.length && !(await page.locator('#hist-more').isVisible()), `${after1} -> ${await rows()} dari ${hist.length}`);
    await page.locator('#privacy').click();
    check('K5c nominal tersembunyi: kolom Nilai tersamar, persen tetap', !/\d{1,3}(\.\d{3}){2,}/.test(await page.locator('#hist tbody').innerText()) && /[+−]\d+,\d{2}%/.test(await page.locator('#hist tbody').innerText()));
    await page.locator('#privacy').click();

    // Cari aset (di Beranda)
    await nav(page, 'beranda');
    const nAset = () => page.locator('#holdings .hold').count();
    await page.locator('#q').pressSequentially('ba');
    check('K6 mengetik di kolom cari tidak menghilangkan fokus atau isinya', (await page.evaluate(() => document.activeElement.id)) === 'q' && (await page.inputValue('#q')) === 'ba');
    await page.fill('#q', 'bank');
    check('K6b cari "bank": hanya Bank Central Asia, catatan "1 dari 9 aset"', (await nAset()) === 1 && /Bank Central Asia/.test(await page.locator('#holdings').innerText()) && /1 dari 9 aset/.test(await page.locator('#filter-note').innerText()));
    await page.fill('#q', 'tlkm');
    check('K6c cari lewat kode (besar/kecil sama saja)', (await nAset()) === 1 && /Telkom/.test(await page.locator('#holdings').innerText()));
    await page.fill('#q', 'zzz');
    check('K6d tidak ada yang cocok: pesan jelas', (await nAset()) === 0 && /Tidak ada aset yang cocok/.test(await page.locator('#holdings').innerText()));
    await page.fill('#q', 'eth');
    await page.locator('#chips [data-filter="crypto"]').click();
    check('K6e filter jenis dan cari digabung', (await nAset()) === 1 && /Ethereum/.test(await page.locator('#holdings').innerText()) && /1 dari 9 aset/.test(await page.locator('#filter-note').innerText()));
    await page.fill('#q', '');
    await page.locator('#chips [data-filter=""]').click();

    // Profil
    await nav(page, 'profil');
    check('K7 Profil: saklar nominal mencerminkan pilihan (uji ini: nominal tampil)', (await page.locator('#set-hide').getAttribute('aria-checked')) === 'false');
    await page.locator('#set-hide').click();
    check('K7b saklar -> nominal tersembunyi; tombol mata di header dan penyimpanan ikut', (await page.locator('#set-hide').getAttribute('aria-checked')) === 'true' && (await page.locator('#privacy').getAttribute('aria-label')) === 'Tampilkan nominal' && (await page.evaluate(() => localStorage.getItem('pf-hidden'))) === '1');
    await page.locator('#privacy').click();
    check('K7c tombol mata di header mengembalikan saklar', (await page.locator('#set-hide').getAttribute('aria-checked')) === 'false');
    check('K7d data: jumlah aset, hari riwayat, transaksi, versi skrip', new RegExp(`^9 aset, riwayat ${hist.length} hari, 0 transaksi\\. Skrip Apps Script versi 4\\.$`).test(await page.locator('#set-data').innerText()), await page.locator('#set-data').innerText());
    check('K7e target belum diatur', /Belum diatur/.test(await page.locator('#set-goal').innerText()));
    await page.locator('#v-profil [data-goal="open"]').click();
    await page.fill('#goal-input', '150000000');
    await page.getByRole('button', { name: 'Simpan' }).click();
    check('K8 target diatur dari Profil: tampil di Profil, dan di Beranda', (await page.locator('#set-goal').innerText()).includes(idr.format(150_000_000)) && (await page.locator('#goal').textContent()).includes(idr.format(150_000_000)));
    await page.locator('#set-hide').click();
    check('K8b nominal tersembunyi: target di Profil ikut tersamar', !(await page.locator('#set-goal').innerText()).includes('150.000.000'));
    await page.locator('#v-profil [data-menu]').click();
    check('K8c Profil > Data > "Tambah" membuka menu +', await isOpen(page, 'menu-dlg'));
    await page.locator('#m-close').click();
    check('K9 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // Tema: Otomatis mengikuti perangkat; Terang/Gelap memaksa; pilihan diingat dan terpasang sebelum halaman digambar
    const LIGHT = 'rgb(242, 243, 247)', DARK = 'rgb(13, 14, 19)';
    for (const [deviceDark, forced, forcedBg, deviceBg] of [[false, 'dark', DARK, LIGHT], [true, 'light', LIGHT, DARK]]) {
      const { ctx, page, fake } = await newPage({ dark: deviceDark });
      await openDash(page, fake, '#/profil');
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

  // ============ J. sorotan dan target ============
  {
    const { ctx, page, fake, errors } = await newPage();
    await openDash(page, fake);
    await page.waitForSelector('#dash:not([hidden])');
    const L = sheetOf(fake).history.at(-1);
    const top = [...L.positions].filter((p) => !['manual', 'cash'].includes(p.type)).sort((a, b) => b.weight - a.weight)[0];
    const ins = await page.locator('#insight-list').innerText();
    check('J1 sorotan: aset terbesar (≥30%) diperingatkan dengan bobotnya, tanpa nominal', top.weight >= 0.3 && ins.includes(top.name) && ins.includes(p1(top.weight)) && !/Rp|\d{1,3}(\.\d{3}){2,}/.test(ins), flat(ins));
    check('J1b sorotan punya judul tersembunyi untuk pembaca layar', (await page.locator('#ins-h').textContent()) === 'Perlu diperhatikan');

    check('J3 belum ada target: ajakan dan tombol Atur target', /Tetapkan target/.test(await page.locator('#goal').innerText()) && (await page.locator('#goal [data-goal="open"]').innerText()) === 'Atur target');
    await page.locator('#goal [data-goal="open"]').click();
    check('J3b dialog terbuka, "Hapus target" belum tampil', (await isOpen(page, 'goal-dlg')) && !(await page.locator('#goal-del').isVisible()));
    for (const bad of ['', '0', '-5']) {
      await page.fill('#goal-input', bad);
      await page.locator('#goal-form').getByRole('button', { name: 'Simpan' }).click();
      if (!(await page.locator('#goal-err').isVisible()) || !(await isOpen(page, 'goal-dlg'))) { check(`J4 target "${bad}" ditolak dan dialog tetap terbuka`, false); break; }
    }
    check('J4 target kosong, 0, atau negatif ditolak; tidak ada yang tersimpan', (await page.evaluate(() => localStorage.getItem('pf-goal'))) === null);
    const goal = 150_000_000;
    await page.fill('#goal-input', String(goal));
    await page.locator('#goal-form').getByRole('button', { name: 'Simpan' }).click();
    const wantPct = Math.floor((L.total / goal) * 100);
    const gtxt = nb(await page.locator('#goal').innerText());
    check('J5 target tersimpan: persen = total ÷ target (dibulatkan ke bawah), sisa dan target tampil', !(await isOpen(page, 'goal-dlg')) && gtxt.includes(`${wantPct}%`) && gtxt.includes(nb(idr.format(goal))) && gtxt.includes(nb(`Sisa ${idr.format(goal - L.total)}`)), flat(gtxt));
    check('J5b cincin punya label untuk pembaca layar; ringkasan menampilkan garis kemajuan', (await page.locator('#goal .ring').getAttribute('aria-label')) === `${wantPct} persen menuju target` && (await page.locator('#summary .goal-line').innerText()).includes(`${wantPct}% dari target`));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#dash:not([hidden])');
    check('J6 target diingat setelah muat ulang', (await page.locator('#goal').innerText()).includes(`${wantPct}%`));

    await page.locator('#privacy').click();
    const hid = await page.locator('main').textContent();
    check('J7 nominal tersembunyi: target dan sisa tidak bocor, persen tetap', !hid.includes(idr.format(goal)) && !hid.includes(idr.format(goal - L.total)) && (await page.locator('#goal').innerText()).includes(`${wantPct}%`));
    await page.locator('#privacy').click();

    await page.locator('#goal [data-goal="open"]').click();
    check('J8 dialog ubah terisi target lama dan menawarkan Hapus', (await page.inputValue('#goal-input')) === String(goal) && (await page.locator('#goal-del').isVisible()));
    await page.fill('#goal-input', '1000');
    await page.locator('#goal-form').getByRole('button', { name: 'Batal' }).click();
    check('J8b Batal tidak mengubah target', (await page.evaluate(() => localStorage.getItem('pf-goal'))) === String(goal));
    await page.locator('#goal [data-goal="open"]').click();
    await page.fill('#goal-input', '1000');
    await page.locator('#goal-form').getByRole('button', { name: 'Simpan' }).click();
    check('J9 target sudah terlewati: "Target tercapai", cincin 100%', /Target tercapai/.test(await page.locator('#goal').innerText()) && (await page.locator('#goal .hole').innerText()) === '100%');
    await page.locator('#goal [data-goal="open"]').click();
    await page.getByRole('button', { name: 'Hapus target' }).click();
    check('J10 Hapus target: kembali ke ajakan dan localStorage bersih', /Tetapkan target/.test(await page.locator('#goal').innerText()) && (await page.evaluate(() => localStorage.getItem('pf-goal'))) === null);

    // tata letak desktop: grafik dan daftar di kiri, Alokasi dan Target bertumpuk di kanan
    const bb = (sel) => page.locator(sel).boundingBox();
    const [sumB, chart, hold, alloc, g] = [await bb('#summary'), await bb('#chart-card'), await bb('#holdings-sec'), await bb('#alloc-card'), await bb('#goal')];
    check('J11 desktop: ringkasan, grafik, daftar di kolom kiri; Alokasi lalu Target di kolom kanan', alloc.x > chart.x + chart.width - 1 && Math.abs(alloc.y - sumB.y) < 2 && g.y > alloc.y + alloc.height && hold.y > chart.y + chart.height && Math.abs(hold.x - chart.x) < 1, JSON.stringify({ chart, alloc, g, hold }));
    check('J12 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await shot(page, 'beranda-desktop.png', { fullPage: true });
    await ctx.close();
  }
  {
    // portofolio seimbang (5 aset x 20%, 5 jenis): tanpa sorotan
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
    await openDash(page, fk);
    await page.waitForSelector('#dash:not([hidden])');
    check('J13 portofolio seimbang: tidak ada sorotan sama sekali', !(await page.locator('#insights').isVisible()) && (await page.locator('.insight').count()) === 0);
    await ctx.close();
  }

  // ============ L. Kas ============
  {
    const { ctx, page, fake, errors } = await newPage();
    await openDash(page, fake);
    const list = () => sheetOf(fake).assets;
    await goto(page, AH('cash:KAS'));
    const kas = flat(await page.locator('#detail .stats').textContent());
    check('L1 halaman Kas: Saldo dan bobot, tanpa Harga, Modal, Untung', nb(kas).includes(nb(`Saldo${idr.format(3_000_000)}`)) && !/Harga|Modal|Untung/.test(kas) && !(await page.locator('#achart').count()), kas);

    await openAdd(page, 'cash');
    // Isi dulu sebagai saham lalu ganti ke Kas: kolom yang sempat terisi tidak boleh ikut tersimpan.
    await page.selectOption('#f-type', 'idx');
    await page.fill('#f-avgCost', '9999');
    await page.fill('#f-buyDate', '2025-01-01');
    await page.selectOption('#f-type', 'cash');
    const shown = async (sels) => Promise.all(sels.map((q) => page.locator(q).isVisible()));
    const yes = await shown(['#f-symbol', '#f-name', '#f-qty', '#f-currency']);
    const no = await shown(['#f-avgCost', '#f-buyDate', '#f-price', '#f-coingeckoId', '#asset-form .adv']);
    check('L2 jenis Kas: hanya label, nama, saldo, mata uang; harga beli, tanggal, harga, ID CoinGecko, opsi lanjutan tersembunyi', yes.every(Boolean) && no.every((v) => !v), `tampil ${yes} | tersembunyi ${no}`);
    check('L2b label menyesuaikan jenis: "Label" dan "Saldo"', /^Label/.test(await page.locator('#l-symbol').innerText()) && /^Saldo/.test(await page.locator('#l-qty').innerText()));
    await page.fill('#f-symbol', 'dolar');
    await page.fill('#f-qty', '-5');
    await page.selectOption('#f-currency', 'USD');
    await page.locator('#f-save').click();
    await page.waitForSelector('#f-err:not([hidden])');
    check('L3 saldo negatif ditolak dengan pesan jelas, lembar tetap terbuka, Sheet tidak berubah (saldo 0 sah: kas boleh habis)', /qty harus angka 0 atau lebih/.test(await page.locator('#f-err').innerText()) && (await isOpen(page, 'asset-dlg')) && list().length === 9);
    await page.fill('#f-qty', '1500');
    await page.locator('#f-save').click();
    await routed(page, `aset/${encodeURIComponent('cash:dolar')}`);
    const usd = list().find((a) => a.symbol === 'dolar');
    check('L4 Kas dolar tersimpan: label apa adanya (tidak dibesarkan), saldo, USD; tanpa harga beli, harga, tanggal', !!usd && usd.type === 'cash' && usd.qty === 1500 && usd.currency === 'USD' && !usd.avgCost && !usd.price && !usd.buyDate, JSON.stringify(usd));
    const L = sheetOf(fake).history.at(-1);
    const dol = nb(flat(await page.locator('#detail .stats').textContent()));
    check('L4b halaman kas dolar langsung terhitung: saldo dolar, setara rupiah dengan kurs terakhir', dol.includes(nb(`Saldo${usdF.format(1500)}`)) && dol.includes(nb(`Setara rupiah${idr.format(Math.round(1500 * L.fx))}`)) && dol.includes(nb(`kurs ${idr.format(L.fx)}`)), dol);

    await page.locator('[data-act="edit"]').click();
    check('L5 ubah Kas: jenis, saldo, dan mata uang terisi ulang', (await page.inputValue('#f-type')) === 'cash' && (await page.inputValue('#f-qty')) === '1500' && (await page.inputValue('#f-currency')) === 'USD');
    await page.selectOption('#f-type', 'idx');
    check('L5b ganti jenis ke Saham IDX: harga beli dan tanggal muncul lagi', (await page.locator('#f-avgCost').isVisible()) && (await page.locator('#f-buyDate').isVisible()));
    await page.selectOption('#f-type', 'cash');
    await page.fill('#f-qty', '2000');
    await page.locator('#f-save').click();
    await page.waitForFunction(() => !document.getElementById('asset-dlg').open);
    const after = list().find((a) => a.symbol === 'dolar');
    check('L5c saldo diubah dan tetap Kas dolar tanpa kolom lain', after.qty === 2000 && after.type === 'cash' && after.currency === 'USD' && !after.avgCost);
    check('L6 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // 2 kas (rupiah + dolar) dan 1 saham. Kas dikecualikan dari konsentrasi dan batang untung/rugi.
    const fk = createFake();
    const assets = [
      { type: 'cash', symbol: 'BCA', name: 'Rekening BCA', qty: 5_000_000 },
      { type: 'cash', symbol: 'DOLAR', qty: 1000, currency: 'USD' },
      { type: 'idx', symbol: 'BBCA', qty: 100, avgCost: 9000 },
    ];
    fk.call({ token: fk.token, action: 'saveAssets', assets });
    const quotes = new Map([['cash:BCA', { price: 1, asOf: '2026-11-23' }], ['cash:DOLAR', { price: 1, asOf: '2026-11-23' }], ['idx:BBCA', { price: 10_000, asOf: '2026-11-23' }]]);
    fk.call({ token: fk.token, action: 'appendSnapshot', snapshot: { ...buildSnapshot({ date: '2026-11-23', assets, quotes, fx: 16_000 }), at: '2026-11-23T06:30:00Z' } });
    const secrets = [idr.format(21_000_000), idr.format(5_000_000), usdF.format(1000), idr.format(16_000_000), idr.format(22_000_000), idr.format(1_000_000)];

    const { ctx, page, errors } = await newPage({ fake: fk });
    await openDash(page, fk);
    await page.waitForSelector('#dash:not([hidden])');
    check('L7 Beranda: Kas masuk alokasi (95,5%), dan kas yang mendominasi TIDAK memicu sorotan konsentrasi', /Kas\s*95,5%/.test(flat(await page.locator('#legend').innerText())) && !(await page.locator('#insights').isVisible()));
    await page.locator('#chips [data-filter="cash"]').click();
    check('L8 chip Kas: dua kartu kas, tanpa mini-grafik', (await page.locator('#holdings .hold').count()) === 2 && (await page.locator('#holdings svg.spark').count()) === 0);
    await page.locator('#chips [data-filter=""]').click();

    await goto(page, '#/analisis/alokasi');
    const t = (await page.locator('#conc .tile').allInnerTexts()).map(flat);
    check('L9 Alokasi: Kas = rekening + dolar, Diinvestasikan = saham saja', nb(t[0]).includes(nb(idr.format(21_000_000))) && t[0].includes('95,5%') && nb(t[1]).includes(nb(idr.format(1_000_000))), t.join(' | '));
    check('L9b konsentrasi dihitung di antara yang diinvestasikan: satu saham = "setara 1 aset", 100%', t[2].includes('100%') && t[3].includes('1 aset'), t[2] + ' | ' + t[3]);
    await goto(page, '#/analisis/kinerja');
    check('L9c batang untung/rugi hanya saham (Kas tidak ikut)', (await page.locator('#perf .pr-n').allInnerTexts()).join() === 'BBCA');

    await goto(page, AH('cash:DOLAR'));
    const normal = await page.locator('main').textContent();
    check('L10 kontrol: saat nominal tampil, saldo kas ada di halaman', secrets.filter((x) => normal.includes(x)).length >= 4);
    await page.locator('#privacy').click();
    const hid = await page.locator('main').textContent();
    check('L10b nominal tersembunyi: saldo kas (rupiah dan dolar), setaranya, kas total, dan total tidak bocor di halaman mana pun', secrets.filter((x) => hid.includes(x)).length === 0, secrets.filter((x) => hid.includes(x)).join(','));
    check('L11 tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ============ M. ketahanan: web lama vs data baru, galat terisolasi, berkas berversi ============
  {
    // M1: jenis aset yang belum dikenal (mis. robot sudah lebih baru dari web di cache HP) tidak boleh membekukan dasbor
    const fk = createFake();
    const assets = [{ type: 'idx', symbol: 'BBCA', qty: 100, avgCost: 9000 }, { type: 'cash', symbol: 'KAS', qty: 1_000_000 }];
    fk.call({ token: fk.token, action: 'saveAssets', assets });
    const snap = buildSnapshot({ date: '2026-11-23', assets, quotes: new Map([['idx:BBCA', { price: 10_000, asOf: '2026-11-23' }], ['cash:KAS', { price: 1, asOf: '2026-11-23' }]]), fx: null });
    for (const p of snap.positions) if (p.type === 'cash') p.type = 'jenisbaru';
    snap.byType = { idx: snap.byType.idx, jenisbaru: snap.byType.cash };
    fk.call({ token: fk.token, action: 'appendSnapshot', snapshot: { ...snap, at: '2026-11-23T06:30:00Z' } });
    const { ctx, page, errors } = await newPage({ fake: fk });
    const reqs = [];
    page.on('request', (r) => { if (/\/assets\/|\/scripts\//.test(r.url())) reqs.push(r.url()); });
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fk.token });
    await page.waitForSelector('#nav:not([hidden])', { timeout: 5000 }).catch(() => {}); // bila membeku: gagal jelas, bukan menghentikan suite
    check('M1 riwayat memuat jenis aset tak dikenal: dasbor tetap terbuka (kerangka hilang, ringkasan tampil), tanpa pesan galat', !(await page.locator('#skeleton').isVisible()) && (await page.locator('#summary .sum-value').isVisible()) && !(await page.locator('#render-err').isVisible()) && errors.length === 0, errors.join(' | '));
    const unversioned = reqs.filter((u) => !/\?v=[0-9a-f]{10}$/.test(u));
    check('M3 semua JS/CSS dimuat dengan penanda versi (?v=), termasuk impor di dalam modul', reqs.length >= 10 && unversioned.length === 0, unversioned.join(', ') || `${reqs.length} berkas`);
    await ctx.close();
  }
  {
    // M1b: daftar aset di Sheet berisi jenis tak dikenal: tetap terdaftar, tidak bisa dibuka di form (agar tidak tersimpan rusak)
    const fk = createFake();
    fk.call({ token: fk.token, action: 'saveAssets', assets: [{ type: 'idx', symbol: 'BBCA', qty: 1, avgCost: 1 }] });
    const { ctx, page, env, errors } = await newPage({ fake: fk });
    env.fake = { token: fk.token, call: (p) => { const r = fk.call(p); if (r.assets) r.assets.push({ type: 'jenisbaru', symbol: 'X', qty: 1 }); return r; } };
    await openDash(page, fk);
    await page.waitForSelector('#dash:not([hidden])');
    check('M1b aset berjenis tak dikenal tetap terdaftar dengan labelnya', /jenisbaru/.test(await page.locator('#holdings').innerText()));
    await goto(page, AH('jenisbaru:X'));
    await page.locator('[data-act="edit"]').click();
    check('M1c membuka Ubah untuk jenis tak dikenal: lembar tidak terbuka, ada pesan', !(await isOpen(page, 'asset-dlg')) && /belum dikenal/.test(await toastText(page)) && errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // M2: riwayat berbentuk aneh: bukan kerangka abadi, tapi pesan jelas; Profil (Keluar) tetap terjangkau
    const fk = createFake();
    seedFake(fk, { days: 3 });
    const last = sheetOf(fk).history.at(-1);
    fk.call({ token: fk.token, action: 'appendSnapshot', snapshot: { ...last, positions: 'rusak' } }); // data cacat
    const { ctx, page } = await newPage({ fake: fk });
    await page.goto(`${BASE}/index.html`);
    await connect(page, { token: fk.token });
    await page.waitForSelector('#nav:not([hidden])', { timeout: 5000 }).catch(() => {});
    const msg = await page.locator('#banner').innerText();
    check('M2 data cacat: kerangka hilang, menu tampil, pesan menyebut data tidak terbaca', !(await page.locator('#skeleton').isVisible()) && (await page.locator('#nav').isVisible()) && /tidak terbaca/.test(msg), flat(msg));
    await nav(page, 'profil');
    check('M2b Profil tetap bisa dipakai', (await page.locator('#v-profil').isVisible()) && (await page.locator('#logout').isVisible()));
    await ctx.close();
  }
  {
    // M2c: satu bagian gagal digambar (catatan transaksi rusak): bagian lain tetap jalan dan pesannya terlihat
    const fk = createFake();
    seedFake(fk, { days: 20 });
    const { ctx, page, env } = await newPage({ fake: fk });
    env.fake = { token: fk.token, call: (p) => { const r = fk.call(p); if (r.history) r.transactions = 'rusak'; return r; } };
    await openDash(page, fk);
    await page.waitForSelector('#render-err:not([hidden])', { timeout: 5000 }).catch(() => {});
    const msg = await page.locator('#render-err').innerText();
    check('M2c bagian yang gagal disebut namanya (Beranda, Aktivitas), kerangka hilang', /gagal digambar/.test(msg) && /Beranda/.test(msg) && /Aktivitas/.test(msg) && !(await page.locator('#skeleton').isVisible()), flat(msg));
    await nav(page, 'analisis');
    check('M2d bagian yang sehat (Analisis) tetap tampil dengan angkanya', (await page.locator('#metrics .tile').count()) === 4);
    await ctx.close();
  }

  // ============ E. HP (gelap) dan desktop ============
  {
    const { ctx, page, fake, errors } = await newPage({ w: 390, h: 844, dark: true });
    await page.goto(`${BASE}/index.html`);
    await shot(page, 'm-connect.png');
    check('E0 sebelum tersambung: menu utama belum tampil', !(await page.locator('#nav').isVisible()));
    await connect(page, { token: fake.token });
    await page.waitForSelector('#dash:not([hidden])');
    // ada satu transaksi supaya baris Aktivitas ikut diperiksa
    await goto(page, AH('idx:BBCA'));
    await page.locator('[data-act="sell"]').click();
    await page.fill('#t-qty', '100');
    await shot(page, 'm-jual.png');
    const sheetFits = await page.locator('#trade-dlg').evaluate((d) => { const r = d.getBoundingClientRect(); const s = document.getElementById('t-save').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && s.bottom <= innerHeight && s.top >= 0; });
    check('E3 HP: lembar Jual muat di layar dan tombol simpannya terlihat', sheetFits);
    await page.locator('#t-save').click();
    await page.waitForFunction(() => !document.getElementById('trade-dlg').open);

    // Target sentuh: aturan proyek minimal 44 px (HP dulu). Elemen yang tersembunyi tidak ikut (lebar 0).
    const tooSmall = (sel) => page.evaluate((q) => [...document.querySelectorAll(q)].filter((el) => { const r = el.getBoundingClientRect(); return r.width && (r.height < 44 || r.width < 44); }).map((el) => `${el.id || el.textContent.trim().slice(0, 20)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`), sel);
    const TOUCH = '#nav a, #nav-add, #subnav a, .seg button, .lg, .ty, #chips button, #q, #sort, .hold, .act, .back, .tx, .switch, #set-theme, .set-actions .btn, .set-row .btn, #hist-more, #privacy, #reload, #goal .btn, #logout';
    const small = [], over = [];
    for (const r of ['beranda', 'analisis/kinerja', 'analisis/alokasi', 'analisis/risiko', 'analisis/riwayat', 'aktivitas', 'profil', `aset/${encodeURIComponent('crypto:ETH')}`, `aset/${encodeURIComponent('cash:KAS')}`]) {
      await goto(page, `#/${r}`);
      await page.waitForTimeout(60);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (o > 0) over.push(`${r}:${o}px`);
      small.push(...(await tooSmall(TOUCH)).map((x) => `${r}> ${x}`));
      await shot(page, `m-${r.replace(/[/%]/g, '_')}.png`, { fullPage: true });
    }
    check('E1 HP: setiap halaman (9 rute, termasuk halaman aset dan Aktivitas) tanpa scroll horizontal', over.length === 0, over.join());
    for (const id of ['asset-dlg']) {
      await openAdd(page, 'asset');
      small.push(...(await tooSmall('#asset-dlg .btn, #asset-dlg input, #asset-dlg select, #asset-dlg summary')).map((x) => `${id}> ${x}`));
      await page.locator('#f-cancel').click();
    }
    check('E5 HP: tombol, menu, kartu, kolom, dan pilihan di semua halaman minimal 44×44 px', small.length === 0, small.join(', '));

    await goto(page, '#/beranda');
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const nbx = await page.locator('#nav').boundingBox();
    check('E6 HP: menu utama menempel di dasar layar walau halaman digulir ke bawah', Math.abs(nbx.y + nbx.height - 844) <= 1 && nbx.width === 390, JSON.stringify(nbx));
    const clear = await page.evaluate(() => [...document.querySelectorAll('#v-beranda .home-main > *:not([hidden])')].pop().getBoundingClientRect().bottom <= document.getElementById('nav').getBoundingClientRect().top + 0.5);
    check('E7 HP: isi paling bawah tidak tertutup menu', clear);
    const addBox = await page.locator('#nav-add svg').boundingBox();
    check('E7b HP: tombol + di tengah menu bawah', Math.abs(addBox.x + addBox.width / 2 - 195) < 4, JSON.stringify(addBox));
    check('E4 HP: tanpa error konsol', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, fake } = await newPage();
    await openDash(page, fake);
    await page.waitForSelector('#dash:not([hidden])');
    await page.evaluate(() => scrollTo(0, 600));
    const nbx = await page.locator('#nav').boundingBox();
    check('E8 desktop: menu utama jadi bilah atas yang menempel saat menggulir, dengan tombol Tambah berlabel', Math.abs(nbx.y) <= 1 && nbx.width > 600 && nbx.height < 80 && (await page.locator('#nav-add').innerText()).trim() === 'Tambah', JSON.stringify(nbx));
    await openAdd(page, 'asset');
    const dlg = await page.locator('#asset-dlg').boundingBox();
    check('E9 desktop: lembar tampil di tengah layar, bukan menempel di bawah', dlg.y > 10 && Math.abs(dlg.x + dlg.width / 2 - 640) < 2, JSON.stringify(dlg));
    await ctx.close();
  }

  await browser.close();
  server.close();
  const bad = results.filter((x) => !x).length;
  console.log(`\n${results.length - bad}/${results.length} lolos`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
