import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGES, ROOT, moduleGraph, webVersion } from '../scripts/web-version.mjs';

test('penanda versi web cocok dengan isi berkas (bila gagal: jalankan npm run versi)', () => {
  const v = webVersion();
  for (const [page, entry] of Object.entries(PAGES)) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
    assert.ok(m, `${page}: import map tidak ada`);
    assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'), `${page}: import map harus sebelum skrip module`);
    const map = JSON.parse(m[1]).imports;
    for (const f of moduleGraph([entry])) assert.equal(map[`./${f}`], `./${f}?v=${v}`, `${page}: ${f} belum berversi ${v}`);
    const refs = [...html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)].map((x) => x[1]);
    assert.ok(refs.length >= 4, `${page}: tag ke assets/ tidak ditemukan`);
    for (const r of refs) assert.ok(r.endsWith(`?v=${v}`), `${page}: ${r} belum berversi ${v}`);
  }
});

test('graf modul menemukan modul bertingkat (views -> lib/stats, kelola -> portfolio)', () => {
  const app = moduleGraph(['assets/app.js']);
  for (const f of ['assets/lib.js', 'assets/stats.js', 'assets/views/chart.js', 'scripts/lib/api.mjs']) assert.ok(app.includes(f), f);
  assert.ok(moduleGraph(['assets/kelola.js']).includes('scripts/lib/portfolio.mjs'));
});
