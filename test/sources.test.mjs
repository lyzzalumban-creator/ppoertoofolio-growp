// Tes parser dengan bentuk respons yang ditiru dari format API.
// CATATAN: ini BUKAN bukti API aslinya masih berformat sama; itu baru terbukti saat workflow jalan di GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCoinGeckoIdr, fetchStooqClose, fetchYahooClose, parseStooq, parseYahoo } from '../scripts/lib/sources.mjs';

const yahoo = (closes, ts, extra = {}) => ({
  chart: { error: null, result: [{
    meta: { currency: 'IDR', exchangeTimezoneName: 'Asia/Jakarta', ...extra },
    timestamp: ts,
    indicators: { quote: [{ close: closes }] },
  }] },
});

test('parseYahoo mengambil penutupan terakhir yang bukan null', () => {
  // 2026-11-20 09:00 WIB, 2026-11-23 09:00 WIB, dan satu hari tanpa data
  const ts = [Date.parse('2026-11-20T02:00:00Z') / 1000, Date.parse('2026-11-23T02:00:00Z') / 1000, Date.parse('2026-11-24T02:00:00Z') / 1000];
  const r = parseYahoo(yahoo([9800, 9900, null], ts), 'BBCA.JK');
  assert.deepEqual(r, { price: 9900, asOf: '2026-11-23', currency: 'IDR' });
});

test('parseYahoo: tanggal mengikuti zona waktu bursa (AS)', () => {
  const ts = [Date.parse('2026-11-23T21:00:00Z') / 1000]; // tutup bursa NY, tanggal 23 di sana
  const r = parseYahoo(yahoo([190.5], ts, { currency: 'USD', exchangeTimezoneName: 'America/New_York' }), 'AAPL');
  assert.equal(r.asOf, '2026-11-23');
  assert.equal(r.currency, 'USD');
});

test('parseYahoo: error yang jelas untuk simbol salah / tanpa harga', () => {
  assert.throws(() => parseYahoo({ chart: { result: null, error: { description: 'No data found' } } }, 'XXXX'), /XXXX.*No data found/);
  assert.throws(() => parseYahoo(yahoo([null, null], [1, 2]), 'ZZZ'), /tidak ada harga penutupan/);
});

test('fetchYahooClose mencoba host cadangan bila host pertama gagal', async () => {
  const seen = [];
  const get = async (url) => {
    seen.push(new URL(url).host);
    if (seen.length === 1) throw new Error('HTTP 429');
    return yahoo([100], [Date.parse('2026-11-23T02:00:00Z') / 1000]);
  };
  const r = await fetchYahooClose('BBCA.JK', { get });
  assert.equal(r.price, 100);
  assert.deepEqual(seen, ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']);
});

test('parseStooq membaca baris data terakhir', () => {
  const csv = 'Date,Open,High,Low,Close,Volume\n2026-11-20,1,2,0.5,1.5,100\n2026-11-23,1,2,0.5,16250.5,100\n';
  assert.deepEqual(parseStooq(csv, 'usdidr'), { price: 16250.5, asOf: '2026-11-23' });
  assert.throws(() => parseStooq('No data', 'x'), /tidak ada data/);
  assert.deepEqual(parseStooq('Date,Open,High,Low,Close,Volume\n2026-11-20,1,2,0.5,3\n2026-11-23,1,2,0.5,N/D,0\n', 'x'), { price: 3, asOf: '2026-11-20' });
});

test('fetchStooqClose memakai get dengan json:false', async () => {
  let opts;
  const get = async (_u, o) => { opts = o; return 'Date,Open,High,Low,Close,Volume\n2026-11-23,1,1,1,4000,1\n'; };
  assert.equal((await fetchStooqClose('xauusd', { get })).price, 4000);
  assert.equal(opts.json, false);
});

test('fetchCoinGeckoIdr memetakan id -> harga rupiah dan melewatkan id yang tidak ada', async () => {
  let called;
  const get = async (url, o) => {
    called = { url, o };
    return { bitcoin: { idr: 1_050_000_000, last_updated_at: Date.parse('2026-11-23T20:00:00Z') / 1000 }, ethereum: {} };
  };
  const m = await fetchCoinGeckoIdr(['bitcoin', 'ethereum', 'nope'], { get, apiKey: 'k' });
  assert.deepEqual([...m.keys()], ['bitcoin']);
  assert.deepEqual(m.get('bitcoin'), { price: 1_050_000_000, asOf: '2026-11-24' }); // 03:00 WIB
  assert.match(called.url, /ids=bitcoin,ethereum,nope/);
  assert.equal(called.o.headers['x-cg-demo-api-key'], 'k');
});
