import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskLines, scrub, sensitiveStrings } from '../scripts/lib/privacy.mjs';

const assets = [
  { type: 'idx', symbol: 'CUAN', name: 'Petrindo Jaya' },
  { type: 'us', symbol: 'panw', name: 'Palo Alto' },
  { type: 'us', symbol: 'F' },
  { type: 'crypto', symbol: 'BTC', coingeckoId: 'bitcoin', yahoo: 'BTC-USD' },
  { type: 'manual', symbol: 'KAS', name: '  ' },
];

test('sensitiveStrings: kode, nama, ID CoinGecko, simbol Yahoo; tanpa duplikat dan tanpa string kosong', () => {
  const s = sensitiveStrings(assets);
  for (const want of ['CUAN', 'Petrindo Jaya', 'panw', 'Palo Alto', 'F', 'BTC', 'bitcoin', 'BTC-USD', 'KAS']) assert.ok(s.includes(want), want);
  assert.ok(!s.includes('') && !s.includes('  '));
  assert.equal(sensitiveStrings([{ symbol: 'ABC' }, { symbol: 'abc' }]).length, 1);
});

test('maskLines: hanya nilai >= 3 huruf, dengan variasi besar-kecil huruf', () => {
  const lines = maskLines(sensitiveStrings(assets));
  assert.ok(lines.every((l) => l.startsWith('::add-mask::')));
  const vals = lines.map((l) => l.slice('::add-mask::'.length));
  for (const want of ['CUAN', 'cuan', 'panw', 'PANW', 'bitcoin', 'BITCOIN', 'BTC-USD', 'Petrindo Jaya', 'KAS']) assert.ok(vals.includes(want), want);
  assert.ok(!vals.includes('F') && !vals.includes('f'), 'kode 1 huruf akan mengaburkan huruf lain di seluruh log');
});

test('maskLines: tanda % di-escape dan nilai berbaris-baru dilewati (agar perintah tidak rusak)', () => {
  const lines = maskLines(['Dana 100%', 'a\nb-baris']);
  assert.deepEqual(lines, ['::add-mask::Dana 100%25', '::add-mask::DANA 100%25', '::add-mask::dana 100%25']);
});

test('scrub: teks panjang diganti di mana pun, tidak peduli besar-kecil huruf, juga di dalam kata gabungan', () => {
  const s = sensitiveStrings(assets);
  assert.equal(scrub('#2 idx: Yahoo: tidak ada data untuk cuan.JK (simbol salah?)', s), '#2 idx: Yahoo: tidak ada data untuk ***.JK (simbol salah?)');
  assert.equal(scrub('assets[1] (PANW): qty harus angka', s), 'assets[1] (***): qty harus angka');
  assert.equal(scrub('Palo Alto dan Petrindo Jaya', s), '*** dan ***');
});

test('scrub: kode 1 huruf hanya diganti bila berdiri sendiri, huruf dalam kata lain tidak disentuh', () => {
  const s = sensitiveStrings(assets);
  const out = scrub('Gagal: (F) tidak ada; fetch failed; Yahoo: F? Format ok', s);
  assert.ok(out.includes('(***)') && out.includes('***?'), out);
  assert.ok(out.includes('fetch failed') && out.includes('Format ok') && out.includes('Gagal'), out);
});

test('scrub: nama panjang diganti utuh (tidak menyisakan separuh setelah kata pendeknya diganti)', () => {
  const s = ['Bank', 'Bank Central Asia'];
  assert.equal(scrub('Bank Central Asia gagal', s), '*** gagal');
});

test('scrub: karakter khusus regex pada simbol aman (BRK.B, ^JKSE, C++)', () => {
  assert.equal(scrub('harga BRK.B dan ^JKSE dan C++ ok', ['BRK.B', '^JKSE', 'C++']), 'harga *** dan *** dan *** ok');
  assert.equal(scrub('BRKXB tetap', ['BRK.B']), 'BRKXB tetap'); // titik harfiah, bukan "sembarang karakter"
});

test('scrub tanpa daftar sensitif tidak mengubah apa pun', () => {
  assert.equal(scrub('apa saja', []), 'apa saja');
});
