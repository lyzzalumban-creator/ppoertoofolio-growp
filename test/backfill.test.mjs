import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, backfillDates, buildBackfill, closeOn, MAX_BACKFILL_DAYS } from '../scripts/lib/backfill.mjs';
import { parseYahooSeries, fetchYahooSeries } from '../scripts/lib/sources.mjs';
import { yahooSymbol } from '../scripts/lib/quotes.mjs';

const pts = (obj) => Object.entries(obj).map(([date, close]) => ({ date, close }));

test('addDays: lintas bulan dan tahun', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
});

test('backfillDates: mulai dari tanggal beli paling awal, berakhir SEBELUM snapshot pertama', () => {
  const assets = [{ buyDate: '2026-11-01' }, { buyDate: '2026-10-30' }, {}];
  assert.deepEqual(backfillDates({ assets, firstDate: '2026-11-03', today: '2026-11-23' }), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
});

test('backfillDates: riwayat kosong -> sampai kemarin (hari ini dibuat robot biasa)', () => {
  const r = backfillDates({ assets: [{ buyDate: '2026-11-21' }], firstDate: undefined, today: '2026-11-23' });
  assert.deepEqual(r, ['2026-11-21', '2026-11-22']);
});

test('backfillDates: tanpa tanggal beli, tanggal beli di masa depan, atau tak ada celah -> kosong', () => {
  assert.deepEqual(backfillDates({ assets: [{}, {}], today: '2026-11-23' }), []);
  assert.deepEqual(backfillDates({ assets: [{ buyDate: '2027-01-01' }], firstDate: '2026-11-23', today: '2026-11-23' }), []);
  assert.deepEqual(backfillDates({ assets: [{ buyDate: '2026-11-23' }], firstDate: '2026-11-23', today: '2026-11-23' }), []);
  assert.deepEqual(backfillDates({ assets: [{ buyDate: '2026-12-01' }], today: '2026-11-23' }), []);
});

test('backfillDates: dibatasi 366 hari ke belakang (tanggal salah ketik tidak meledak)', () => {
  const r = backfillDates({ assets: [{ buyDate: '2015-01-01' }], firstDate: '2026-11-23', today: '2026-11-23' });
  assert.equal(r.length, MAX_BACKFILL_DAYS);
  assert.equal(r[0], addDays('2026-11-23', -MAX_BACKFILL_DAYS));
  assert.equal(r.at(-1), '2026-11-22');
});

test('closeOn: penutupan terakhir pada/sebelum tanggal (akhir pekan memakai Jumat)', () => {
  const p = pts({ '2026-10-29': 10, '2026-10-30': 11, '2026-11-03': 12 }); // 31 Okt (Sabtu), 1-2 Nov libur
  assert.equal(closeOn(p, '2026-10-30'), 11);
  assert.equal(closeOn(p, '2026-10-31'), 11);
  assert.equal(closeOn(p, '2026-11-02'), 11);
  assert.equal(closeOn(p, '2026-11-03'), 12);
  assert.equal(closeOn(p, '2030-01-01'), 12);
  assert.equal(closeOn(p, '2026-10-28'), null); // sebelum data pertama
  assert.equal(closeOn([], '2026-10-28'), null);
  assert.equal(closeOn(undefined, '2026-10-28'), null);
});

const assets = [
  { type: 'idx', symbol: 'CUAN', qty: 1000, avgCost: 200, buyDate: '2026-10-30' },
  { type: 'us', symbol: 'PANW', qty: 2, avgCost: 100, buyDate: '2026-11-01' },
  { type: 'idx', symbol: 'TANPA', qty: 5, avgCost: 1 }, // tanpa tanggal beli: tidak boleh ikut
];
const series = new Map([
  ['idx:CUAN', pts({ '2026-10-29': 250, '2026-10-30': 300, '2026-11-02': 330, '2026-11-03': 360 })],
  ['us:PANW', pts({ '2026-10-29': 90, '2026-10-30': 95, '2026-11-02': 110, '2026-11-03': 120 })],
  ['idx:TANPA', pts({ '2026-10-29': 1 })],
]);
const fxSeries = pts({ '2026-10-29': 16_000, '2026-10-30': 16_100, '2026-11-02': 16_200, '2026-11-03': 16_300 });
const dates = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'];

test('buildBackfill: aset hanya ikut sejak tanggal belinya, dan aset tanpa tanggal tidak pernah ikut', () => {
  const r = buildBackfill({ assets, dates, series, fxSeries });
  assert.deepEqual(r.map((s) => s.date), dates);
  assert.deepEqual(r.map((s) => s.positions.map((p) => p.symbol).sort().join()), ['CUAN', 'CUAN', 'CUAN,PANW', 'CUAN,PANW']);
  assert.ok(r.every((s) => !s.positions.some((p) => p.symbol === 'TANPA')));
});

test('buildBackfill: nilai memakai penutupan terakhir (akhir pekan) dan kurs pada tanggal itu', () => {
  const r = buildBackfill({ assets, dates, series, fxSeries });
  assert.equal(r[0].total, 1000 * 300); // 30 Okt: CUAN saja
  assert.equal(r[1].total, 1000 * 300); // 31 Okt (Sabtu): penutupan Jumat
  // 1 Nov (Minggu): PANW baru dibeli; penutupan terakhir <= 1 Nov = 95 (30 Okt, SEBELUM tanggal beli), kurs 16.100
  assert.equal(r[2].total, 1000 * 300 + 2 * 95 * 16_100);
  // 2 Nov: harga dan kurs baru
  assert.equal(r[3].total, 1000 * 330 + 2 * 110 * 16_200);
  // modal aset dolar mengikuti kurs tanggal itu (konsisten dengan snapshot harian)
  assert.equal(r[3].cost, 1000 * 200 + 2 * 100 * 16_200);
});

test('buildBackfill: perubahan harian berantai dari snapshot sebelumnya', () => {
  const r = buildBackfill({ assets, dates, series, fxSeries });
  assert.equal(r[0].dayPct, null);
  assert.equal(r[1].dayPct, 0); // akhir pekan: harga sama
  const cuan = r[3].positions.find((p) => p.symbol === 'CUAN');
  assert.ok(Math.abs(cuan.dayPct - (330 / 300 - 1)) < 1e-6);
});

test('buildBackfill: tanggal dilewati bila aset yang sudah dimiliki belum punya harga', () => {
  const s2 = new Map(series);
  s2.set('idx:CUAN', pts({ '2026-11-02': 330 })); // data CUAN baru mulai 2 Nov
  const r = buildBackfill({ assets, dates, series: s2, fxSeries });
  assert.deepEqual(r.map((s) => s.date), ['2026-11-02']);
});

test('buildBackfill: aset dolar tanpa kurs -> tanggal dilewati, aset rupiah murni tetap jalan', () => {
  const noFx = buildBackfill({ assets, dates, series, fxSeries: null });
  assert.deepEqual(noFx.map((s) => s.date), ['2026-10-30', '2026-10-31']); // sebelum PANW dimiliki
});

test('buildBackfill: kripto = harga USD x kurs; emas = USD/ons x kurs / 31,1035; manual = harga tetap', () => {
  const a = [
    { type: 'crypto', symbol: 'BTC', coingeckoId: 'bitcoin', qty: 2, avgCost: 1, buyDate: '2026-10-30' },
    { type: 'gold', symbol: 'XAU', qty: 31.1034768, avgCost: 1, buyDate: '2026-10-30' },
    { type: 'manual', symbol: 'DEPO', qty: 1, price: 5_000_000, avgCost: 1, buyDate: '2026-10-30' },
  ];
  const sr = new Map([
    ['crypto:BTC', pts({ '2026-10-30': 60_000 })],
    ['gold:XAU', pts({ '2026-10-30': 3_000 })],
  ]);
  const [s] = buildBackfill({ assets: a, dates: ['2026-10-30'], series: sr, fxSeries: pts({ '2026-10-30': 16_000 }) });
  assert.equal(s.positions.find((p) => p.symbol === 'BTC').value, 2 * 60_000 * 16_000);
  assert.ok(Math.abs(s.positions.find((p) => p.symbol === 'XAU').value - 3_000 * 16_000) < 1e-3);
  assert.equal(s.positions.find((p) => p.symbol === 'DEPO').value, 5_000_000);
});

test('buildBackfill: tanpa aset bertanggal beli -> kosong', () => {
  assert.deepEqual(buildBackfill({ assets: [assets[2]], dates, series, fxSeries }), []);
});

test('parseYahooSeries: lewati null, tanggal menurut zona waktu bursa, satu titik per tanggal', () => {
  const t = (s) => Date.parse(s) / 1000;
  const data = { chart: { result: [{
    meta: { currency: 'IDR', exchangeTimezoneName: 'Asia/Jakarta' },
    timestamp: [t('2026-10-29T02:00:00Z'), t('2026-10-30T02:00:00Z'), t('2026-11-02T02:00:00Z'), t('2026-11-02T08:00:00Z')],
    indicators: { quote: [{ close: [100, null, 120, 125] }] },
  }] } };
  const r = parseYahooSeries(data, 'CUAN.JK');
  assert.deepEqual(r.points, [{ date: '2026-10-29', close: 100 }, { date: '2026-11-02', close: 125 }]);
  assert.equal(r.currency, 'IDR');
  assert.throws(() => parseYahooSeries({ chart: { result: null, error: { description: 'No data found' } } }, 'X'), /No data found/);
  assert.throws(() => parseYahooSeries({ chart: { result: [{ meta: {}, timestamp: [1], indicators: { quote: [{ close: [null] }] } }] } }, 'X'), /tidak ada riwayat/);
});

test('fetchYahooSeries: period1/period2 mencakup tanggal akhir, dan host cadangan dicoba', async () => {
  const urls = [];
  const get = async (u) => {
    urls.push(u);
    if (urls.length === 1) throw new Error('HTTP 429');
    return { chart: { result: [{ meta: { exchangeTimezoneName: 'UTC' }, timestamp: [1], indicators: { quote: [{ close: [5] }] } }] } };
  };
  const r = await fetchYahooSeries('BBCA.JK', '2026-10-01', '2026-10-02', { get });
  assert.equal(r.points.length, 1);
  assert.match(urls[1], /query2\.finance\.yahoo\.com/);
  const p1 = Number(/period1=(\d+)/.exec(urls[1])[1]);
  const p2 = Number(/period2=(\d+)/.exec(urls[1])[1]);
  assert.equal(p1, Date.parse('2026-10-01T00:00:00Z') / 1000);
  assert.equal(p2, Date.parse('2026-10-03T00:00:00Z') / 1000); // tanggal akhir ikut (eksklusif di Yahoo, jadi +1 hari)
  assert.match(urls[1], /interval=1d/);
});

test('yahooSymbol: idx, kripto, emas, dan penimpaan manual', () => {
  assert.equal(yahooSymbol({ type: 'idx', symbol: 'BBCA' }), 'BBCA.JK');
  assert.equal(yahooSymbol({ type: 'idx', symbol: 'BBCA.JK' }), 'BBCA.JK');
  assert.equal(yahooSymbol({ type: 'us', symbol: 'AAPL' }), 'AAPL');
  assert.equal(yahooSymbol({ type: 'crypto', symbol: 'BTC' }), 'BTC-USD');
  assert.equal(yahooSymbol({ type: 'gold', symbol: 'XAU' }), 'GC=F');
  assert.equal(yahooSymbol({ type: 'us', symbol: 'BRK.B', yahoo: 'BRK-B' }), 'BRK-B');
});
