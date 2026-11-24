import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFake } from './fake-appsscript.mjs';

const snap = (date, extra = {}) => ({ date, total: 100, positions: [{ symbol: 'X' }], ...extra });

test('tanpa/dengan kata sandi salah ditolak, aksi tak dikenal ditolak', () => {
  const f = createFake();
  assert.deepEqual(f.call({ action: 'list' }), { error: 'unauthorized' });
  assert.deepEqual(f.call({ action: 'list', token: 'salah' }), { error: 'unauthorized' });
  assert.deepEqual(f.call({ token: f.token, action: 'hapusSemua' }), { error: 'aksi tidak dikenal' });
  assert.deepEqual(f.call({ token: f.token, action: 'constructor' }), { error: 'aksi tidak dikenal' }); // bukan lewat prototipe
  assert.equal(f.sheets.size, 0, 'penolakan tidak boleh menyentuh Sheet');
});

test('TOKEN belum diisi di Script properties -> semua ditolak (gagal aman)', () => {
  const f = createFake({ token: '' });
  assert.deepEqual(f.call({ token: '', action: 'list' }), { error: 'unauthorized' });
});

test('JSON rusak -> error, bukan crash', () => {
  assert.match(createFake().call('{rusak').error, /JSON/i);
});

test('list pada Sheet kosong: tab dibuat otomatis, hasil kosong', () => {
  const f = createFake();
  const r = f.call({ token: f.token, action: 'list' });
  assert.deepEqual(r, { ok: true, version: 3, assets: [], history: [], transactions: [] });
  assert.deepEqual([...f.sheets.keys()].sort(), ['Aset', 'Riwayat', 'Transaksi']);
});

test('saveAssets lalu list: bolak-balik utuh, kolom kosong tidak ikut', () => {
  const f = createFake();
  const assets = [
    { type: 'idx', symbol: 'BBCA', name: 'BCA', qty: 1000, avgCost: 9500 },
    { type: 'crypto', symbol: 'BTC', coingeckoId: 'bitcoin', qty: 0.02, avgCost: 1e9 },
    { type: 'manual', symbol: 'KAS', qty: 3_000_000, price: 1, avgCost: 1, currency: 'IDR' },
  ];
  assert.deepEqual(f.call({ token: f.token, action: 'saveAssets', assets }), { ok: true, saved: 3 });
  assert.deepEqual(f.call({ token: f.token, action: 'list' }).assets, assets);
});

test('tipe angka tetap angka dan teks tetap teks (simbol berupa angka tidak jadi number)', () => {
  const f = createFake();
  f.call({ token: f.token, action: 'saveAssets', assets: [{ type: 'idx', symbol: '1234', name: '007', qty: 1, avgCost: 1 }] });
  // Sheets mengembalikan sel teks sebagai angka bila isinya mirip angka; tiruan: paksa lewat penyimpanan langsung
  f.sheets.get('Aset').rows[1][1] = 1234;
  const a = f.call({ token: f.token, action: 'list' }).assets[0];
  assert.strictEqual(a.symbol, '1234');
  assert.strictEqual(typeof a.qty, 'number');
});

test('saveAssets yang lebih pendek menghapus sisa baris lama', () => {
  const f = createFake();
  const mk = (s) => ({ type: 'idx', symbol: s, qty: 1, avgCost: 1 });
  f.call({ token: f.token, action: 'saveAssets', assets: [mk('A'), mk('B'), mk('C')] });
  f.call({ token: f.token, action: 'saveAssets', assets: [mk('A')] });
  assert.deepEqual(f.call({ token: f.token, action: 'list' }).assets.map((a) => a.symbol), ['A']);
});

test('saveAssets menolak bukan-daftar dan terlalu banyak', () => {
  const f = createFake();
  assert.match(f.call({ token: f.token, action: 'saveAssets', assets: 'x' }).error, /daftar/);
  assert.match(f.call({ token: f.token, action: 'saveAssets', assets: new Array(501).fill({ type: 'idx' }) }).error, /maks 500/);
});

test('teks berawalan = + - @ tidak menjadi rumus (disimpan sebagai teks)', () => {
  const f = createFake();
  f.call({ token: f.token, action: 'saveAssets', assets: [{ type: 'manual', symbol: 'X', name: '=IMPORTXML("http://evil")', qty: 1, price: 1, avgCost: 1 }] });
  assert.equal(f.call({ token: f.token, action: 'list' }).assets[0].name, '=IMPORTXML("http://evil")');
});

test('appendSnapshot: urut tanggal, tanggal sama diganti (idempoten)', () => {
  const f = createFake();
  const add = (s) => f.call({ token: f.token, action: 'appendSnapshot', snapshot: s });
  add(snap('2026-11-23'));
  add(snap('2026-11-21'));
  assert.equal(add(snap('2026-11-23', { total: 999 })).days, 2);
  const h = f.call({ token: f.token, action: 'list' }).history;
  assert.deepEqual(h.map((s) => s.date), ['2026-11-21', '2026-11-23']);
  assert.equal(h[1].total, 999);
});

test('appendSnapshot: rincian aset hanya dipertahankan untuk 2 hari terakhir', () => {
  const f = createFake();
  for (const d of ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']) f.call({ token: f.token, action: 'appendSnapshot', snapshot: snap(d) });
  const h = f.call({ token: f.token, action: 'list' }).history;
  assert.deepEqual(h.map((s) => 'positions' in s), [false, false, true, true]);
  assert.deepEqual(h.map((s) => s.total), [100, 100, 100, 100]); // total tetap utuh
});

test('appendSnapshot menolak tanggal tidak valid dan tidak merusak data', () => {
  const f = createFake();
  f.call({ token: f.token, action: 'appendSnapshot', snapshot: snap('2026-11-23') });
  for (const bad of [null, {}, { date: '23-11-2026' }, { date: '2026-11-23; DROP' }]) {
    assert.match(f.call({ token: f.token, action: 'appendSnapshot', snapshot: bad }).error, /YYYY-MM-DD/);
  }
  assert.equal(f.call({ token: f.token, action: 'list' }).history.length, 1);
});

// ---------- tanggal beli ----------

test('buyDate bolak-balik sebagai TEKS (bukan diubah Sheets menjadi tanggal)', () => {
  const f = createFake();
  const a = { type: 'idx', symbol: 'BBCA', qty: 1, avgCost: 1, buyDate: '2025-03-03' };
  f.call({ token: f.token, action: 'saveAssets', assets: [a, { type: 'idx', symbol: 'TLKM', qty: 1, avgCost: 1 }] });
  assert.strictEqual(typeof f.sheets.get('Aset').rows[1][10], 'string', 'sel tersimpan sebagai tanggal, bukan teks');
  const got = f.call({ token: f.token, action: 'list' }).assets;
  assert.strictEqual(got[0].buyDate, '2025-03-03');
  assert.ok(!('buyDate' in got[1]), 'aset tanpa tanggal tidak boleh punya buyDate');
});

test('tanggal yang diketik manual di Sheet (objek Date) kembali ke YYYY-MM-DD menurut zona waktu Sheet', () => {
  const f = createFake();
  f.call({ token: f.token, action: 'saveAssets', assets: [{ type: 'idx', symbol: 'BBCA', qty: 1, avgCost: 1 }] });
  // Pengguna mengetik 2025-03-03 di sel: Sheets menyimpannya sebagai tanggal tengah malam zona waktu Sheet (UTC+7).
  f.sheets.get('Aset').rows[1][10] = new Date('2025-03-03T00:00:00+07:00');
  assert.strictEqual(f.call({ token: f.token, action: 'list' }).assets[0].buyDate, '2025-03-03'); // di UTC akan jadi 03-02
});

test('baris lama yang lebih pendek dari jumlah kolom tidak menghasilkan "undefined"', () => {
  const f = createFake();
  f.call({ token: f.token, action: 'list' }); // membuat tab
  // Keadaan Sheet yang sudah ter-deploy sebelum kolom buyDate ada: header & baris hanya 10 kolom.
  f.sheets.get('Aset').rows = [
    ['type', 'symbol', 'name', 'qty', 'avgCost', 'coingeckoId', 'price', 'currency', 'costIdr', 'yahoo'],
    ['idx', 'CUAN', '', 1000, 200],
  ];
  const a = f.call({ token: f.token, action: 'list' }).assets[0];
  assert.deepEqual(a, { type: 'idx', symbol: 'CUAN', qty: 1000, avgCost: 200 });
  assert.ok(!JSON.stringify(a).includes('undefined'));
});

test('menyimpan ulang menaikkan header lama ke 11 kolom dan menjaga data', () => {
  const f = createFake();
  f.call({ token: f.token, action: 'list' });
  f.sheets.get('Aset').rows = [['type', 'symbol', 'name', 'qty', 'avgCost'], ['idx', 'CUAN', '', 1000, 200]];
  const cur = f.call({ token: f.token, action: 'list' }).assets;
  f.call({ token: f.token, action: 'saveAssets', assets: cur.map((x) => ({ ...x, buyDate: '2025-01-15' })) });
  const rows = f.sheets.get('Aset').rows;
  assert.strictEqual(rows[0].length, 11);
  assert.strictEqual(rows[0][10], 'buyDate');
  assert.deepEqual(f.call({ token: f.token, action: 'list' }).assets[0], { type: 'idx', symbol: 'CUAN', qty: 1000, avgCost: 200, buyDate: '2025-01-15' });
});

// ---------- transaksi (versi 3) ----------

const tx = (id, extra = {}) => ({ id, date: '2026-11-23', kind: 'sell', type: 'idx', symbol: 'BBCA', name: 'BCA', qty: 400, price: 10_000, currency: 'IDR', costIdr: 3_600_000, pnl: 400_000, pnlIdr: 400_000, at: '2026-11-23T05:00:00Z', ...extra });

test('trade: daftar aset tersimpan DAN catatan jual tercatat sekaligus; tanggal tetap teks', () => {
  const f = createFake();
  const r = f.call({ token: f.token, action: 'trade', assets: [{ type: 'idx', symbol: 'BBCA', qty: 600, avgCost: 9000 }], tx: tx('tx-00000001') });
  assert.deepEqual(r, { ok: true, saved: 1, recorded: true });
  const l = f.call({ token: f.token, action: 'list' });
  assert.equal(l.assets[0].qty, 600);
  assert.deepEqual(l.transactions, [tx('tx-00000001')]);
  assert.equal(typeof l.transactions[0].date, 'string');
  assert.equal(f.locks.held, 0, 'kunci dilepas');
});

test('trade dikirim ulang dengan id sama: catatan tidak dobel, daftar aset tetap benar', () => {
  const f = createFake();
  const req = { token: f.token, action: 'trade', assets: [{ type: 'idx', symbol: 'BBCA', qty: 600, avgCost: 9000 }], tx: tx('tx-00000002') };
  f.call(req);
  assert.deepEqual(f.call(req), { ok: true, saved: 1, recorded: false });
  assert.equal(f.call({ token: f.token, action: 'list' }).transactions.length, 1);
});

test('trade menolak isian cacat tanpa menyentuh Sheet', () => {
  const f = createFake();
  const assets = [{ type: 'idx', symbol: 'BBCA', qty: 1, avgCost: 1 }];
  for (const [bad, msg] of [[{ ...tx('pendek'), id: 'x' }, /tx.id/], [{ ...tx('tx-00000003'), kind: 'tukar' }, /kind/], [{ ...tx('tx-00000004'), date: '23/11/2026' }, /date/], [{ ...tx('tx-00000005'), qty: 0 }, /qty/]]) {
    assert.match(f.call({ token: f.token, action: 'trade', assets, tx: bad }).error, msg);
  }
  assert.match(f.call({ token: f.token, action: 'trade', assets }).error, /tx.id/);
  assert.ok(!f.sheets.has('Aset') && !f.sheets.has('Transaksi'));
});

test('deleteTx menghapus satu catatan saja; daftar aset tidak berubah', () => {
  const f = createFake();
  const assets = [{ type: 'idx', symbol: 'BBCA', qty: 600, avgCost: 9000 }];
  f.call({ token: f.token, action: 'trade', assets, tx: tx('tx-0000000a') });
  f.call({ token: f.token, action: 'trade', assets, tx: tx('tx-0000000b', { kind: 'buy', pnlIdr: undefined, pnl: undefined, costIdr: undefined }) });
  assert.deepEqual(f.call({ token: f.token, action: 'deleteTx', id: 'tx-0000000a' }), { ok: true, deleted: 1 });
  const l = f.call({ token: f.token, action: 'list' });
  assert.deepEqual(l.transactions.map((t) => t.id), ['tx-0000000b']);
  assert.deepEqual(l.assets, assets);
  assert.deepEqual(f.call({ token: f.token, action: 'deleteTx', id: 'tidak-ada' }), { ok: true, deleted: 0 });
  assert.equal(f.locks.held, 0);
});

test('nama transaksi berawalan = tetap teks (bukan rumus)', () => {
  const f = createFake();
  f.call({ token: f.token, action: 'trade', assets: [], tx: tx('tx-0000000c', { name: '=IMPORTXML("http://x")' }) });
  assert.equal(f.call({ token: f.token, action: 'list' }).transactions[0].name, '=IMPORTXML("http://x")');
});
