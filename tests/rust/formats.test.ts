import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Hoop } from '../../src/model/hoop';
import { COLOR_CHANGE, JUMP, STITCH, TRIM, type Pattern, type ThreadColor } from '../../src/model/pattern';
import { parsePattern } from '../../src/parsers';
import { pecColor } from '../../src/parsers/pecPalette';
import { writeDst } from '../../src/writers/dst';
import { writeExp } from '../../src/writers/exp';
import { writeJef } from '../../src/writers/jef';
import { writePecFile, writePes } from '../../src/writers/pes';
import { writeVp3 } from '../../src/writers/vp3';
import { writeXxx } from '../../src/writers/xxx';
import { DEMOS } from '../helpers/demos';
import { badgeDesign, letterDesign } from '../helpers/designs';
import { parsePattern as oldParsePattern } from './ts/parsers';
import { writeDst as oldDst } from './ts/writers/dst';
import { writeExp as oldExp } from './ts/writers/exp';
import { writeJef as oldJef } from './ts/writers/jef';
import { writePecFile as oldPec, writePes as oldPes } from './ts/writers/pes';
import { writeVp3 as oldVp3 } from './ts/writers/vp3';
import { writeXxx as oldXxx } from './ts/writers/xxx';

/**
 * The file formats in Rust (core/src/parsers, core/src/writers) against the TypeScript they
 * replaced (copied to tests/rust/ts): every example and fixture file, the demo designs and random
 * designs are read and written by both, and the records, colors and bytes must be identical.
 */

const DATE = new Date(2026, 9, 5, 12, 0, 0);
const HOOPS: (Hoop | null)[] = [null, { w: 100, h: 100 }, { w: 126, h: 110 }, { w: 130, h: 180 }, { w: 200, h: 200 }, { w: 360, h: 200 }];

type Write = (p: Pattern, hoop: Hoop | null) => Uint8Array;
const WRITERS: [string, Write, Write][] = [
  ['pes', (p, h) => oldPes(p, h), (p, h) => writePes(p, h)],
  ['dst', (p) => oldDst(p), (p) => writeDst(p)],
  ['jef', (p, h) => oldJef(p, DATE, h), (p, h) => writeJef(p, DATE, h)],
  ['exp', (p) => oldExp(p), (p) => writeExp(p)],
  ['vp3', (p) => oldVp3(p), (p) => writeVp3(p)],
  ['xxx', (p) => oldXxx(p), (p) => writeXxx(p)],
  ['pec', (p) => oldPec(p), (p) => writePecFile(p)],
];

/**
 * Text as browsers decode TextDecoder('latin1'), which is windows-1252 (WHATWG Encoding): the core
 * reads labels so. Node 22 decodes it as ISO-8859-1, so the old reader's text is mapped here.
 */
const CP1252 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018,
  0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];
const asBrowser = (s: string) => s.replace(/[\x80-\x9f]/g, (c) => String.fromCharCode(CP1252[c.charCodeAt(0) - 0x80]));
function textAsBrowser(c: ThreadColor): ThreadColor {
  const out = { ...c };
  for (const k of ['name', 'brand', 'catalog'] as const) if (out[k] !== undefined) out[k] = asBrowser(out[k]!);
  return out;
}

/** Both readers on the same bytes: the same design, or the same error. */
function readBoth(data: Uint8Array, name: string): Pattern | null {
  let want: Pattern | Error;
  let got: Pattern | Error;
  try {
    want = oldParsePattern(data, name);
  } catch (e) {
    want = e as Error;
  }
  try {
    got = parsePattern(data, name);
  } catch (e) {
    got = e as Error;
  }
  if (want instanceof Error || got instanceof Error) {
    expect(got instanceof Error ? got.message : 'read', name).toBe(want instanceof Error ? want.message : 'read');
    return null;
  }
  // VP3 text is UTF-8, the other formats' latin1.
  const browser = want.format !== 'vp3';
  expect(got.name, name).toBe(browser ? asBrowser(want.name) : want.name);
  expect(got.format, name).toBe(want.format);
  expect(Array.from(got.cmd), name).toEqual(Array.from(want.cmd));
  expect(Array.from(got.x), name).toEqual(Array.from(want.x));
  expect(Array.from(got.y), name).toEqual(Array.from(want.y));
  expect(got.colors, name).toEqual(browser ? want.colors.map(textAsBrowser) : want.colors);
  expect(got.bounds, name).toEqual(want.bounds);
  expect(got.hoop, name).toEqual(want.hoop);
  return got;
}

/** Index of the first byte that differs, -1 when there is none. */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return -1;
}

/** Both writers in every format (and hoop), then both readers on what they wrote. */
function writeBoth(p: Pattern, label: string, hoops: (Hoop | null)[] = [null]): void {
  for (const [format, old, now] of WRITERS) {
    for (const hoop of format === 'pes' || format === 'jef' ? hoops : [null]) {
      const what = `${label} as ${format}${hoop ? ` in ${hoop.w}x${hoop.h}` : ''}`;
      const want = old(p, hoop);
      const got = now(p, hoop);
      expect(got.length, what).toBe(want.length);
      expect(firstDifference(got, want), what).toBe(-1);
      readBoth(got, `${label}.${format}`);
    }
  }
}

function files(dir: URL): { name: string; data: Uint8Array }[] {
  const out: { name: string; data: Uint8Array }[] = [];
  for (const entry of readdirSync(dir)) {
    // The folders here have no dot in their names, the files all have one.
    if (!entry.includes('.')) out.push(...files(new URL(`${entry}/`, dir)));
    else if (/\.(pes|pec|dst|jef|exp|vp3|xxx|sew)$/i.test(entry)) out.push({ name: entry, data: new Uint8Array(readFileSync(new URL(entry, dir))) });
  }
  return out;
}

const FILES = [...files(new URL('../../public/examples/', import.meta.url)), ...files(new URL('../fixtures/', import.meta.url))];

/** Small deterministic generator, so a failure repeats. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A design of every kind of record: short and long stitches and jumps, trims, colors, odd names and threads. */
function randomDesign(seed: number): Pattern {
  const rnd = random(seed);
  const int = (n: number) => Math.floor(rnd() * n);
  const n = 50 + int(400);
  const x = new Int32Array(n);
  const y = new Int32Array(n);
  const cmd = new Uint8Array(n);
  let cx = int(200) - 100;
  let cy = int(200) - 100;
  let blocks = 1;
  for (let i = 0; i < n; i++) {
    const r = rnd();
    const c = r < 0.6 ? STITCH : r < 0.75 ? JUMP : r < 0.88 ? TRIM : r < 0.95 ? COLOR_CHANGE : STITCH;
    const reach = rnd() < 0.1 ? 3000 : rnd() < 0.3 ? 200 : 40;
    if (c === STITCH || c === JUMP) {
      cx += int(2 * reach + 1) - reach;
      cy += int(2 * reach + 1) - reach;
    }
    if (c === COLOR_CHANGE) blocks++;
    x[i] = cx;
    y[i] = cy;
    cmd[i] = c;
  }
  const names = ['', 'Käfer', 'a very long design name indeed', 'Ünïcödé ✿ 名前', 'tab\there'];
  const colors: ThreadColor[] = Array.from({ length: int(blocks + 2) }, () => {
    const k = rnd();
    if (k < 0.3) return pecColor(int(66));
    const c: ThreadColor = { r: int(256), g: int(256), b: int(256) };
    if (k < 0.5) c.name = names[int(names.length)];
    if (k < 0.4) Object.assign(c, { brand: 'Brand', catalog: String(int(9999)) });
    return c;
  });
  // Repeated colors, so blocks share threads.
  if (colors.length > 2) colors[colors.length - 1] = { ...colors[0] };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (cmd[i] !== STITCH) continue;
    minX = Math.min(minX, x[i]);
    maxX = Math.max(maxX, x[i]);
    minY = Math.min(minY, y[i]);
    maxY = Math.max(maxY, y[i]);
  }
  const bounds = minX === Infinity ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY };
  return { name: names[int(names.length)], format: 'pes', x, y, cmd, colors, bounds };
}

describe('file formats: Rust against the TypeScript it replaced', () => {
  it('finds the example files', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(15);
  });

  it.each(FILES)('reads and writes $name the same', ({ name, data }) => {
    const p = readBoth(data, name);
    expect(p).not.toBeNull();
    writeBoth(p!, name, HOOPS);
  });

  it('writes the demo designs and test designs the same', () => {
    for (const { file, build } of DEMOS) writeBoth(build(), file);
    writeBoth(letterDesign(), 'letters');
    writeBoth(badgeDesign(), 'badge', HOOPS);
  });

  it('writes random designs the same', () => {
    for (let seed = 1; seed <= 60; seed++) writeBoth(randomDesign(seed), `random ${seed}`, seed % 10 ? [null] : HOOPS);
  });

  it('reads damaged files the same', () => {
    const rnd = random(7);
    for (const { name, data } of FILES) {
      // Cut short anywhere.
      for (let k = 0; k < 40; k++) readBoth(data.subarray(0, Math.floor(rnd() * data.length)), name);
      // Bytes changed anywhere, also in the headers.
      for (let k = 0; k < 40; k++) {
        const bad = data.slice();
        for (let j = 0; j < 4; j++) bad[Math.floor(rnd() * (j < 2 ? Math.min(600, bad.length) : bad.length))] = Math.floor(rnd() * 256);
        readBoth(bad, name);
      }
    }
    for (const name of ['a.dst', 'a.jef', 'a.exp', 'a.xxx', 'a.sew', 'a.pes', 'a.vp3', 'a.txt']) readBoth(new Uint8Array(10), name);
  });

  it('reads every palette index the same', () => {
    // JEF and SEW files naming each palette index once, PEC blocks each slot.
    const jef = new Uint8Array(0x74 + 256 * 8 + 2);
    new DataView(jef.buffer).setUint32(0, 0x74 + 256 * 8, true);
    new DataView(jef.buffer).setInt32(24, 256, true);
    for (let k = 0; k < 256; k++) new DataView(jef.buffer).setInt32(0x74 + k * 4, k % 2 ? -k : k, true);
    const recs: number[] = [];
    for (let k = 0; k < 255; k++) recs.push(1, 1, 0x80, 0x01, 0, 0);
    readBoth(Uint8Array.from([...jef.subarray(0, 0x74 + 256 * 8), ...recs, 0x80, 0x10]), 'palette.jef');
    const sew = new Uint8Array(0x1d78);
    sew[0] = 200;
    for (let k = 0; k < 200; k++) sew[2 + 2 * k] = k;
    readBoth(Uint8Array.from([...sew, ...recs]), 'palette.sew');
    for (let k = 0; k < 256; k += 64) {
      const pec = writePecFile({ name: 'p', format: 'pec', x: new Int32Array(1), y: new Int32Array(1), cmd: new Uint8Array(1), colors: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } });
      pec[8 + 48] = 63;
      for (let j = 0; j < 64; j++) pec[8 + 49 + j] = k + j;
      readBoth(pec, 'palette.pec');
    }
  });
});
