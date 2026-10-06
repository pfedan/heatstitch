#!/usr/bin/env node
// Converts the thread palettes of Ink/Stitch (github.com/inkstitch/inkstitch, folder `palettes`,
// GIMP palette files) into the thread catalogs of heatstitch (public/threads/catalogs.json).
// Only the palette data is read: maker, line, color number, name and an RGB value per thread.
//
//   node tools/threads/convert.mjs <inkstitch>/palettes [commit]
//
// The palettes come with Ink/Stitch under the GPL 3.0; the converted file keeps that license and
// is loaded by the app as data (public/threads/LICENSE.md). Paint charts and hand embroidery floss
// are left out. Brother Embroidery only lends its numbers to the built-in PEC palette of the app.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [src, commit = ''] = process.argv.slice(2);
if (!src) {
  console.error('usage: node tools/threads/convert.mjs <inkstitch>/palettes [commit]');
  process.exit(1);
}
const OUT = new URL('../../public/threads/', import.meta.url).pathname;

/** Not machine embroidery thread, or already in the app. */
const SKIP = new Set(['RAL', 'DMC', 'Anchor', 'Simthread Glow In The Dark 15 Colors']);

/** Shown first in the list: the threads hobby embroiderers in Europe and the US use most. */
const COMMON = [
  'Madeira Polyneon',
  'Madeira Rayon',
  'Isacord Polyester',
  'Gunold Polyester',
  'Gutermann Creativ Dekor',
  'Mettler Poly Sheen',
  'Sulky Rayon',
  'Sulky Polyester',
  'Robison-Anton Polyester',
  'Robison-Anton Rayon',
  'Marathon Polyester',
  'Marathon Rayon',
  'Brothread 40',
  'Simthread Polyester 63 Brother Colors',
  'Janome',
  'Floriani Polyester',
];

/** Display names where the file name is not how the thread is sold. */
const RENAME = {
  'Gutermann Creativ Dekor': 'Gütermann Creativ Dekor',
  'Simthread Polyester 63 Brother Colors': 'Simthread 63 (Brother colors)',
  'Marathon Rayon V3': 'Marathon Rayon (V3)',
  'MTB - Embroidex': 'MTB Embroidex',
  'Viking Palette': 'Husqvarna Viking',
};

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
const hex = (r, g, b) => [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

function parse(text) {
  const out = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*\S)\s*$/.exec(line);
    if (!m) continue;
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    if ([r, g, b].some((v) => v > 255)) continue;
    // "Name   Number", in two palettes followed by measured L,a,b values.
    const words = m[4].split(/\s+/).filter((w) => !/^-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(w));
    const number = words.length > 1 ? words.pop() : '';
    const name = words.join(' ');
    const key = number || name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push([hex(r, g, b), number, name]);
  }
  return out;
}

const catalogs = [];
for (const file of readdirSync(src).sort()) {
  const m = /^InkStitch (.+)\.gpl$/.exec(file);
  if (!m || SKIP.has(m[1])) continue;
  const threads = parse(readFileSync(join(src, file), 'utf8'));
  if (threads.length < 10) continue;
  const name = RENAME[m[1]] ?? m[1];
  catalogs.push({ id: slug(m[1]), name, common: COMMON.includes(m[1]) || undefined, threads });
}
const rank = (c) => {
  const i = COMMON.findIndex((n) => (RENAME[n] ?? n) === c.name);
  return i < 0 ? COMMON.length : i;
};
catalogs.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

mkdirSync(OUT, { recursive: true });
const data = { source: `https://github.com/inkstitch/inkstitch/tree/${commit || 'main'}/palettes`, license: 'GPL-3.0', catalogs };
writeFileSync(join(OUT, 'catalogs.json'), JSON.stringify(data).replace(/\],\[/g, '],\n['));
const total = catalogs.reduce((n, c) => n + c.threads.length, 0);
console.log(`${catalogs.length} catalogs, ${total} threads`);
