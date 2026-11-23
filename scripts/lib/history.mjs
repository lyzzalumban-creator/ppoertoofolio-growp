// Baca/tulis data/history.json. Satu snapshot = satu baris, jadi diff Git harian tetap ringkas.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function readHistory(path) {
  if (!existsSync(path)) return { version: 1, title: null, mode: 'full', updatedAt: null, snapshots: [] };
  const h = JSON.parse(readFileSync(path, 'utf8'));
  return { version: 1, title: null, mode: 'full', updatedAt: null, ...h, snapshots: h.snapshots || [] };
}

export function writeHistory(path, h) {
  const body = h.snapshots.map((s) => `    ${JSON.stringify(s)}`).join(',\n');
  const text =
    '{\n' +
    '  "version": 1,\n' +
    `  "title": ${JSON.stringify(h.title)},\n` +
    `  "mode": ${JSON.stringify(h.mode)},\n` +
    (h.demo ? '  "demo": true,\n' : '') +
    `  "updatedAt": ${JSON.stringify(h.updatedAt)},\n` +
    '  "snapshots": [\n' +
    (body ? `${body}\n` : '') +
    '  ]\n' +
    '}\n';
  writeFileSync(path, text);
}
