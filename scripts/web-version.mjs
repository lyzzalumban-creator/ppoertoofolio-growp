// Penanda versi berkas web. GitHub Pages menyimpan JS/CSS di cache 10 menit, jadi sesudah deploy HP bisa mencampur
// HTML baru dengan modul lama (atau sebaliknya); dasbor pernah macet karenanya. Setiap URL web diberi ?v=<hash isi
// semua berkas web>, dan import map di HTML memetakan tiap modul (termasuk impor di dalam modul) ke URL berversi itu.
// Begitu isi berubah, versinya berubah, browser wajib mengambil semuanya baru.
//   npm run versi   -> perbarui index.html dan kelola.html (test/version.test.mjs gagal bila lupa)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PAGES = { 'index.html': 'assets/app.js', 'kelola.html': 'assets/kelola.js' };
const CLASSIC = ['assets/theme.js', 'assets/nofile.js', 'assets/style.css'];

/** Semua modul yang dicapai dari entry lewat `import ... from './…'` (path relatif dari akar repo). */
export function moduleGraph(entries) {
  const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/^\s*import\s[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) stack.push(relative(ROOT, join(ROOT, dirname(f), m[1])));
  }
  return [...seen].sort();
}

export function webVersion() {
  const files = [...new Set([...moduleGraph(Object.values(PAGES)), ...CLASSIC])].sort();
  const h = createHash('sha256');
  for (const f of files) h.update(f).update('\0').update(readFileSync(join(ROOT, f))).update('\0');
  return h.digest('hex').slice(0, 10);
}

/** HTML dengan ?v= terbaru pada tag src/href ke assets/, dan import map untuk semua modul halaman itu. */
export function stamp(html, entry, v) {
  const imports = Object.fromEntries(moduleGraph([entry]).map((f) => [`./${f}`, `./${f}?v=${v}`]));
  const map = `<script type="importmap">\n  ${JSON.stringify({ imports }, null, 2).replace(/\n/g, '\n  ')}\n  </script>`;
  let out = html.replace(/((?:src|href)="assets\/[^"?]+)(\?v=[0-9a-f]+)?"/g, `$1?v=${v}"`);
  out = /<script type="importmap">[\s\S]*?<\/script>/.test(out)
    ? out.replace(/<script type="importmap">[\s\S]*?<\/script>/, map)
    : out.replace('<link rel="stylesheet"', `${map}\n  <link rel="stylesheet"`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const v = webVersion();
  for (const [page, entry] of Object.entries(PAGES)) {
    const p = join(ROOT, page);
    writeFileSync(p, stamp(readFileSync(p, 'utf8'), entry, v));
  }
  console.log(`versi web ${v}`);
}
