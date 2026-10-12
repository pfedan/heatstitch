#!/usr/bin/env node
// Builds the motif library (public/library) from Twemoji (github.com/jdecked/twemoji, graphics
// CC BY 4.0) with the names and keywords of Unicode CLDR as emojibase-data has them (MIT, Unicode
// License).
//
//   node tools/library/build.mjs <twemoji clone> <emojibase-data package> [commit]
//
// Only emoji that make sense as an embroidery motif are taken: animals, plants, food, the sky,
// celebrations, things and a few symbols. People, hands, flags, letters, arrows and the like stay
// out. Afterwards tools/library/check.mjs sews every motif and drops the ones that do not pass
// Prüfen.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [twemoji, emojibase, commit = ''] = process.argv.slice(2);
if (!twemoji || !emojibase) {
  console.error('usage: node tools/library/build.mjs <twemoji clone> <emojibase-data package> [commit]');
  process.exit(1);
}
const OUT = new URL('../../public/library/', import.meta.url).pathname;

/**
 * Categories of the library by emojibase subgroup (the number in data.json). The order here is the
 * order of the chips in the app.
 */
const CATEGORIES = [
  ['animals', [34, 35, 36, 37, 38, 39]],
  ['plants', [40, 41]],
  ['food', [42, 43, 44, 45, 46, 47, 48]],
  ['sky', [59]],
  ['celebrations', [60]],
  ['leisure', [61, 62, 63, 64, 67, 68]],
  ['travel', [49, 50, 51, 53, 54, 55, 56]],
  ['things', [58, 65, 66, 72, 74, 75, 78, 79, 81, 82]],
  ['faces', [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]],
  ['symbols', [14, 87, 96]],
];
const categoryOf = new Map(CATEGORIES.flatMap(([id, subs]) => subs.map((s) => [s, id])));

// Motifs that did not pass Prüfen last time (tools/library/check.mjs) stay out.
const EXCLUDED = new URL('./excluded.json', import.meta.url).pathname;
const excluded = new Set(existsSync(EXCLUDED) ? JSON.parse(readFileSync(EXCLUDED, 'utf8')).map((e) => e.id) : []);

const read = (lang) => JSON.parse(readFileSync(join(emojibase, lang, 'data.json'), 'utf8'));
const de = read('de');
const en = new Map(read('en').map((e) => [e.hexcode, e]));

/** The Twemoji file of an emoji: lower case code points, without the variation selector unless joined. */
function fileOf(hexcode) {
  const parts = hexcode.toLowerCase().split('-');
  const tries = [parts.join('-'), parts.filter((p) => p !== 'fe0f').join('-')];
  for (const name of tries) {
    const f = join(twemoji, 'assets', 'svg', `${name}.svg`);
    if (existsSync(f)) return f;
  }
  return null;
}

/** Keywords without the name itself and without duplicates. */
const tagsOf = (e, label) => [...new Set((e?.tags ?? []).map((s) => s.toLowerCase()))].filter((s) => s !== label.toLowerCase());

const motifs = [];
const packs = new Map(CATEGORIES.map(([id]) => [id, {}]));
let missing = 0;
for (const e of de) {
  const c = categoryOf.get(e.subgroup);
  if (!c) continue;
  const file = fileOf(e.hexcode);
  if (!file) {
    missing++;
    continue;
  }
  const id = file.split('/').pop().replace(/\.svg$/, '');
  if (excluded.has(id)) continue;
  const english = en.get(e.hexcode);
  const nameEn = english?.label ?? e.label;
  motifs.push({ id, c, de: e.label, en: nameEn, tde: tagsOf(e, e.label), ten: tagsOf(english, nameEn) });
  // The file as Twemoji has it; the app reads its viewBox and sews it at the size asked for.
  packs.get(c)[id] = readFileSync(file, 'utf8').trim();
}

rmSync(join(OUT, 'twemoji'), { recursive: true, force: true });
mkdirSync(join(OUT, 'twemoji'), { recursive: true });
for (const [c, pack] of packs) writeFileSync(join(OUT, 'twemoji', `${c}.json`), JSON.stringify(pack));
const index = {
  sources: [
    {
      id: 'twemoji',
      name: 'Twemoji',
      kind: 'svg',
      license: 'CC-BY-4.0',
      credit: 'Twemoji, © Twitter, Inc. and other contributors',
      url: 'https://github.com/jdecked/twemoji',
      ...(commit ? { commit } : {}),
      base: 'library/twemoji/',
      categories: CATEGORIES.map(([id]) => id).filter((id) => Object.keys(packs.get(id)).length),
      motifs,
    },
  ],
};
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));
console.log(`${motifs.length} motifs in ${CATEGORIES.length} categories; ${missing} without a Twemoji file`);
for (const [c, pack] of packs) console.log(`  ${c}: ${Object.keys(pack).length}`);
