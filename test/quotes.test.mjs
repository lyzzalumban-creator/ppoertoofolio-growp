import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectQuotes } from '../scripts/lib/quotes.mjs';
import { getUrl } from '../scripts/lib/sources.mjs';

const A = {
  bbca: { type: 'idx', symbol: 'BBCA', qty: 1, avgCost: 1 },
  aapl: { type: 'us', symbol: 'AAPL', qty: 1, avgCost: 1 },
  btc: { type: 'crypto', symbol: 'BTC', coingeckoId: 'bitcoin', qty: 1, avgCost: 1 },
  gold: { type: 'gold', symbol: 'XAU', qty: 1, avgCost: 1 },
  cash: { type: 'manual', symbol: 'KAS', qty: 1, price: 1, avgCost: 1 },
  usdManual: { type: 'manual', symbol: 'USDCASH', qty: 1, price: 1, currency: 'USD', avgCost: 1 },
};

// Sumber palsu: tiap fungsi bisa diatur; gagal = melempar.
function makeSrc(over = {}) {
  const calls = [];
  const yahooMap = {
    'BBCA.JK': { price: 10_000, asOf: '2026-11-23', currency: 'IDR' },
    AAPL: { price: 200, asOf: '2026-11-21', currency: 'USD' },
    'USDIDR=X': { price: 16_000, asOf: '2026-11-23' },
    'GC=F': { price: 3_110.34768, asOf: '2026-11-23', currency: 'USD' },
    'BTC-USD': { price: 60_000, asOf: '2026-11-24', currency: 'USD' },
    ...(over.yahooMap || {}),
  };
  return {
    calls,
    yahoo: async (s) => { calls.push(`yahoo:${s}`); if (!(s in yahooMap) || yahooMap[s] instanceof Error) throw yahooMap[s] || new Error(`Yahoo: ${s} tidak ada`); return yahooMap[s]; },
    stooq: async (s) => { calls.push(`stooq:${s}`); const m = (over.stooqMap || {})[s]; if (!m) throw new Error(`Stooq: ${s} tidak ada`); return m; },
    coingecko: async (ids) => { calls.push(`cg:${ids}`); if (over.cgFail) throw new Error('HTTP 429'); return new Map(ids.filter((i) => i === 'bitcoin').map((i) => [i, { price: 1_050_000_000, asOf: '2026-11-24' }])); },
  };
}
const warnings = [];
const warn = (m) => warnings.push(m);
const run = (assets, over = {}, extra = {}) => { warnings.length = 0; return collectQuotes({ assets, date: '2026-11-24', warn, src: makeSrc(over), ...extra }); };

test('semua sumber normal: harga, mata uang, dan konversi emas per gram', async () => {
  const r = await run([A.bbca, A.aapl, A.btc, A.gold, A.cash]);
  assert.deepEqual(r.problems, []);
  assert.equal(r.fx, 16_000);
  assert.equal(r.quotes.get('idx:BBCA').price, 10_000);
  assert.equal(r.quotes.get('us:AAPL').price, 200);
  assert.equal(r.quotes.get('crypto:BTC').price, 1_050_000_000);
  // 3110.34768 USD/ons * 16000 / 31.1034768 g = 1.600.000 per gram
  assert.ok(Math.abs(r.quotes.get('gold:XAU').price - 1_600_000) < 1e-3);
  assert.deepEqual(r.quotes.get('manual:KAS'), { price: 1, asOf: '2026-11-24' });
  assert.equal(warnings.length, 0);
});

test('CoinGecko kena 429 -> cadangan Yahoo BTC-USD x kurs', async () => {
  const src = makeSrc({ cgFail: true });
  const r = await collectQuotes({ assets: [A.btc], date: 'd', warn, src });
  assert.deepEqual(r.problems, []);
  assert.equal(r.quotes.get('crypto:BTC').price, 60_000 * 16_000);
  assert.equal(r.quotes.get('crypto:BTC').asOf, '2026-11-24');
  assert.ok(src.calls.includes('yahoo:BTC-USD'));
});

test('cadangan kripto memakai simbol Yahoo dari field "yahoo" bila ada', async () => {
  const src = makeSrc({ cgFail: true, yahooMap: { 'WBTC-USD': { price: 50_000, asOf: 'x', currency: 'USD' } } });
  const r = await collectQuotes({ assets: [{ ...A.btc, yahoo: 'WBTC-USD' }], date: 'd', warn, src });
  assert.equal(r.quotes.get('crypto:BTC').price, 50_000 * 16_000);
});

test('CoinGecko dan Yahoo sama-sama gagal -> masalah bila tak ada data lama', async () => {
  const r = await run([A.btc], { cgFail: true, yahooMap: { 'BTC-USD': new Error('HTTP 429') } });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /^#1 crypto:/); // nomor aset, bukan kode saham
});

test('Yahoo gagal -> pakai harga terakhir, ditandai stale', async () => {
  const lastKnown = { fx: 15_900, positions: [{ type: 'idx', symbol: 'BBCA', price: 9_500, asOf: '2026-11-20' }] };
  const r = await run([A.bbca], { yahooMap: { 'BBCA.JK': new Error('HTTP 429') } }, { lastKnown });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.quotes.get('idx:BBCA'), { price: 9_500, asOf: '2026-11-20', stale: true });
  assert.ok(warnings.some((w) => /harga terakhir per 2026-11-20/.test(w)));
});

test('Yahoo gagal dan belum pernah ada harga -> masalah (jangan diam-diam keliru)', async () => {
  const r = await run([A.bbca], { yahooMap: { 'BBCA.JK': new Error('HTTP 404') } });
  assert.equal(r.quotes.size, 0);
  assert.match(r.problems[0], /^#1 idx:/);
  assert.ok(!r.problems[0].includes('BBCA'), 'kode saham tidak boleh ada di pesan');
});

test('saham AS: Yahoo gagal -> cadangan Stooq', async () => {
  const r = await run([A.aapl], { yahooMap: { AAPL: new Error('HTTP 429') }, stooqMap: { 'aapl.us': { price: 201, asOf: '2026-11-21' } } });
  assert.deepEqual(r.problems, []);
  assert.equal(r.quotes.get('us:AAPL').price, 201);
});

test('kurs gagal diambil -> pakai kurs terakhir dari snapshot lama', async () => {
  const r = await run([A.aapl], { yahooMap: { 'USDIDR=X': new Error('x') } }, { lastKnown: { fx: 15_900, positions: [] } });
  assert.equal(r.fx, 15_900);
  assert.deepEqual(r.problems, []);
  assert.ok(warnings.some((w) => /kurs USD\/IDR memakai nilai terakhir/i.test(w)));
});

test('kurs gagal dan tak ada kurs lama -> aset dolar & emas jadi masalah', async () => {
  const r = await run([A.aapl, A.gold, A.bbca], { yahooMap: { 'USDIDR=X': new Error('x') } });
  const keys = r.problems.map((p) => p.split(':')[0]).sort();
  assert.deepEqual(keys, ['#1 us', '#2 gold']); // urutan = urutan aset di daftar
  assert.ok(r.quotes.has('idx:BBCA')); // aset rupiah tidak ikut terseret
});

test('kurs gagal tetapi tidak ada aset yang membutuhkannya -> bukan masalah', async () => {
  const r = await run([A.bbca, A.cash], { yahooMap: { 'USDIDR=X': new Error('x') } });
  assert.deepEqual(r.problems, []);
  assert.equal(r.fx, null);
});

test('kripto lewat CoinGecko tidak ikut gagal hanya karena kurs gagal (kurs cuma cadangan)', async () => {
  const r = await run([A.btc], { yahooMap: { 'USDIDR=X': new Error('x') } });
  assert.deepEqual(r.problems, []);
  assert.equal(r.quotes.get('crypto:BTC').price, 1_050_000_000);
});

test('harga lama aset dolar tanpa kurs tidak lolos diam-diam', async () => {
  const lastKnown = { positions: [{ type: 'us', symbol: 'AAPL', price: 190, asOf: '2026-11-20' }] }; // tanpa fx
  const r = await run([A.aapl], { yahooMap: { AAPL: new Error('x'), 'USDIDR=X': new Error('x') } }, { lastKnown });
  assert.equal(r.quotes.size, 0);
  assert.match(r.problems[0], /butuh kurs/);
});

test('mata uang sumber tidak cocok (mis. ticker bursa lain) ditolak', async () => {
  const r = await run([A.aapl], { yahooMap: { AAPL: { price: 150, asOf: 'd', currency: 'GBp' } } });
  assert.match(r.problems[0], /mata uang GBp/);
});

test('aset manual berdolar butuh kurs', async () => {
  const r = await run([A.usdManual], { yahooMap: { 'USDIDR=X': new Error('x') } });
  assert.match(r.problems[0], /butuh kurs/);
});

// ---------- getUrl: perilaku retry ----------

function stubFetch(responses) {
  const orig = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => {
    const r = responses[Math.min(n++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return new Response(r.body ?? '{"ok":true}', { status: r.status, headers: r.headers });
  };
  return { count: () => n, restore: () => { globalThis.fetch = orig; } };
}

test('getUrl: 429 lalu sukses -> menunggu sesuai Retry-After, lalu berhasil', async () => {
  const f = stubFetch([{ status: 429, headers: { 'retry-after': '7' } }, { status: 200 }]);
  const waits = [];
  try {
    assert.deepEqual(await getUrl('https://example.test/x', { wait: async (ms) => waits.push(ms) }), { ok: true });
  } finally { f.restore(); }
  assert.equal(f.count(), 2);
  assert.deepEqual(waits, [7000]);
});

test('getUrl: Retry-After dibatasi 30 detik; tanpa header jeda bertambah', async () => {
  const f = stubFetch([{ status: 429, headers: { 'retry-after': '600' } }, { status: 429 }, { status: 200 }]);
  const waits = [];
  try { await getUrl('https://example.test/x', { wait: async (ms) => waits.push(ms) }); } finally { f.restore(); }
  assert.deepEqual(waits, [30_000, 10_000]);
});

test('getUrl: 404 tidak di-retry; menyerah setelah percobaan terakhir tanpa menunggu lagi', async () => {
  let f = stubFetch([{ status: 404 }]);
  const waits = [];
  try { await assert.rejects(getUrl('https://example.test/x', { wait: async (ms) => waits.push(ms) }), /HTTP 404/); } finally { f.restore(); }
  assert.equal(f.count(), 1);
  assert.equal(waits.length, 0);

  f = stubFetch([{ status: 503 }]);
  try { await assert.rejects(getUrl('https://example.test/x', { wait: async (ms) => waits.push(ms) }), /HTTP 503/); } finally { f.restore(); }
  assert.equal(f.count(), 3);
  assert.equal(waits.length, 2); // 3 percobaan = 2 jeda
});

test('getUrl: error jaringan di-retry', async () => {
  const f = stubFetch([new Error('fetch failed'), { status: 200 }]);
  try { assert.deepEqual(await getUrl('https://example.test/x', { wait: async () => {} }), { ok: true }); } finally { f.restore(); }
  assert.equal(f.count(), 2);
});
