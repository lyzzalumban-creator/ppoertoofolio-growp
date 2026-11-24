import test from 'node:test';
import assert from 'node:assert/strict';
import { call } from '../scripts/lib/api.mjs';

const reply = (status, body) => ({ ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
// Urutan jawaban palsu: Response, atau Error yang dilempar. Mengembalikan jumlah panggilan.
function fakeFetch(seq) {
  const calls = { n: 0, signals: [] };
  globalThis.fetch = async (_u, o) => {
    calls.signals.push(!!o.signal);
    const r = seq[Math.min(calls.n++, seq.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  };
  return calls;
}
const fast = { delayMs: 0 };

test('call: bawaan satu kali coba, tanpa batas waktu (dasbor)', async () => {
  const c = fakeFetch([reply(500, 'x'), reply(200, { ok: true })]);
  await assert.rejects(call('u', 't', 'list'), /HTTP 500/);
  assert.equal(c.n, 1);
  assert.deepEqual(c.signals, [false]);
});

test('call: 500 sementara lalu berhasil = berhasil setelah coba lagi', async () => {
  const c = fakeFetch([reply(500, 'x'), reply(500, 'x'), reply(200, { ok: true, assets: [] })]);
  const d = await call('u', 't', 'list', {}, { retries: 2, timeoutMs: 1000, ...fast });
  assert.deepEqual(d, { ok: true, assets: [] });
  assert.equal(c.n, 3);
  assert.deepEqual(c.signals, [true, true, true], 'setiap percobaan punya batas waktu');
});

test('call: jaringan putus dan menggantung (timeout) juga dicoba lagi', async () => {
  const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
  const c = fakeFetch([new TypeError('fetch failed'), timeout, reply(200, { ok: true })]);
  assert.deepEqual(await call('u', 't', 'list', {}, { retries: 2, ...fast }), { ok: true });
  assert.equal(c.n, 3);
});

test('call: kehabisan percobaan = melempar galat terakhir', async () => {
  const c = fakeFetch([reply(500, 'x')]);
  await assert.rejects(call('u', 't', 'list', {}, { retries: 2, ...fast }), /HTTP 500/);
  assert.equal(c.n, 3);
});

test('call: kata sandi salah, galat data, 4xx, dan balasan bukan JSON TIDAK diulang', async () => {
  for (const r of [reply(200, { error: 'unauthorized' }), reply(200, { error: 'tx.qty harus angka lebih dari 0' }), reply(403, 'x'), reply(200, '<html>Sign in</html>')]) {
    const c = fakeFetch([r]);
    await assert.rejects(call('u', 't', 'list', {}, { retries: 2, ...fast }));
    assert.equal(c.n, 1);
  }
});
