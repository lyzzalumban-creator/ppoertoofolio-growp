import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { moneyShort, state } = await import('../assets/lib.js');

test('moneyShort: rupiah ringkas (rb, jt, M), tanda, dan disamarkan saat nominal tersembunyi', () => {
  state.hidden = false;
  assert.equal(moneyShort(763_082, { sign: true }).replace(/\s/g, ' '), '+Rp 763 rb');
  assert.equal(moneyShort(-2_331_088).replace(/\s/g, ' '), '−Rp 2,3 jt');
  assert.equal(moneyShort(175_758_361, { sign: true }).replace(/\s/g, ' '), '+Rp 175,8 jt');
  assert.equal(moneyShort(1_234_000_000).replace(/\s/g, ' '), 'Rp 1,23 M');
  assert.match(moneyShort(9_500).replace(/\s/g, ' '), /^Rp 9\.500$/);
  assert.equal(moneyShort(null), '–');
  state.hidden = true;
  assert.equal(moneyShort(175_758_361), '••••••');
  state.hidden = false;
});
