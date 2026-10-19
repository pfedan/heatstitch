import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { computeDensity, type DensityOptions } from '../../src/density/grid';
import { gaussianBlur } from '../../src/density/blur';
import { COLOR_CHANGE, JUMP, PatternBuilder, STITCH, TRIM, type Command, type Pattern } from '../../src/model/pattern';
import { parsePattern } from '../../src/parsers';
import { fromStored } from '../../src/storage/fileStore';
import { decodeProject } from '../../src/storage/project';
import { measureCoverage, PATCH } from '../../src/validation/coverage';
import { measurePattern, type Measurement } from '../../src/validation/measure';
import type { Profile } from '../../src/validation/profiles';
import { eStitchMask, satinMask } from '../../src/validation/satin';
import { shortStitchCounts, tagShortStitches } from '../../src/validation/shortStitches';
import { classify } from '../../src/validation/validate';
import { core } from '../../src/wasm/core';
import { DEMOS } from '../helpers/demos';
import { badgeDesign, letterDesign } from '../helpers/designs';
import { computeDensity as tsDensity } from './ts/density/grid';
import { gaussianBlur as tsBlur } from './ts/density/blur';
import { measureCoverage as tsCoverage } from './ts/validation/coverage';
import { stitchKinds as tsKinds } from './ts/validation/kinds';
import { measurePattern as tsMeasure } from './ts/validation/measure';
import { eStitchMask as tsEStitch, satinMask as tsSatin } from './ts/validation/satin';
import { shortStitchCounts as tsShortCounts, tagShortStitches as tsTags } from './ts/validation/shortStitches';

/**
 * Stage 1e of the Rust core (docs/rust-core.md): the density grid and the checks in Rust against
 * the TypeScript they replace (copied to tests/rust/ts), on the example files, the demo project,
 * the guide's demos, synthetic designs and random records. Same algorithms, same float steps
 * (f32 cells summed in f64, Math.hypot as V8 computes it), so everything must match exactly.
 */

const examples = ['cat-60mm.pes', 'demos/overlap.pes', 'demos/letters.pes', 'demos/patch.pes', 'demos/sun.dst', 'demos/confetti.pes', 'demos/leather-patch.dst'];
const projects = ['public/examples/demo/heatstitch-demo.heatstitch', 'tests/fixtures/demo-v2.heatstitch', 'tests/fixtures/wild-stitches.heatstitch', 'tests/fixtures/spiral-kind.heatstitch', 'tests/fixtures/cat-outline-sections.heatstitch'];

/** Deterministic random numbers (mulberry32). */
function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random records with every feature the checks look at: satin zigzags, fill rows, short stitches and locks, blanket stitches, jumps, trims, color changes, repeated points, long stitches. */
function randomPattern(seed: number): Pattern {
  const r = rand(seed);
  const b = new PatternBuilder();
  let x = 0;
  let y = 0;
  const to = (nx: number, ny: number, c: Command = STITCH) => {
    nx = Math.round(nx);
    ny = Math.round(ny);
    b.add(nx - x, ny - y, c);
    x = nx;
    y = ny;
  };
  const pieces = 8 + Math.floor(r() * 12);
  for (let k = 0; k < pieces; k++) {
    const kind = Math.floor(r() * 8);
    const n = 3 + Math.floor(r() * 40);
    const w = 3 + r() * 60;
    const step = 1 + r() * 6;
    const a = r() * Math.PI * 2;
    const [ux, uy] = [Math.cos(a), Math.sin(a)];
    if (kind === 0) for (let i = 0; i < n; i++) to(x + ux * step + (i % 2 ? -uy * w : uy * w), y + uy * step + (i % 2 ? ux * w : -ux * w));
    else if (kind === 1) {
      for (let i = 0; i < n; i++) {
        const s = i % 2 ? -1 : 1;
        to(x + ux * w * s, y + uy * w * s);
        to(x + ux * w * s * 0.5 - uy * 0.5, y + uy * w * s * 0.5 + ux * 0.5);
        to(x - uy * step, y + ux * step);
      }
    } else if (kind === 2) for (let i = 0; i < n; i++) to(x + (r() - 0.5) * 12, y + (r() - 0.5) * 12);
    else if (kind === 3) {
      const [sx, sy] = [x, y];
      for (let i = 0; i < 2 + Math.floor(r() * 5); i++) to(sx + (i % 2 ? 3 : 0), sy);
      to(sx, sy);
      to(x + ux * 30, y + uy * 30);
    } else if (kind === 4) {
      for (let i = 0; i < n; i++) {
        const [bx, by] = [x, y];
        to(bx - uy * 25, by + ux * 25);
        to(bx, by);
        to(bx + ux * 15, by + uy * 15);
      }
    } else if (kind === 5) {
      if (r() < 0.5) b.mark(TRIM);
      to(x + (r() - 0.5) * 400, y + (r() - 0.5) * 400, JUMP);
      if (r() < 0.3) to(x + 20, y + 5, JUMP);
    } else if (kind === 6) {
      b.mark(TRIM);
      b.mark(COLOR_CHANGE);
      to(x + (r() - 0.5) * 100, y + (r() - 0.5) * 100, JUMP);
    } else {
      to(x, y);
      to(x + ux * 150, y + uy * 150);
      to(x, y);
    }
  }
  return b.build(`random ${seed}`, 'dst', [{ r: 0, g: 0, b: 0 }]);
}

interface Case {
  name: string;
  p: Pattern;
}

const cases: Case[] = [];

beforeAll(async () => {
  for (const f of examples) cases.push({ name: f, p: parsePattern(readFileSync(`public/examples/${f}`), f) });
  for (const f of ['tests/fixtures/pingpong-confetti.pes', 'tests/fixtures/pyembroidery/sun.vp3']) cases.push({ name: f, p: parsePattern(readFileSync(f), f) });
  for (const path of projects) {
    const proj = await decodeProject(new Uint8Array(readFileSync(path)));
    for (const file of proj.files) {
      const o = parsePattern(file.data, file.name);
      cases.push({ name: `${path.split('/').pop()}: ${file.name}`, p: fromStored(o, file.working) ?? o });
    }
  }
  for (const d of DEMOS) cases.push({ name: `demo ${d.file}`, p: d.build() });
  cases.push({ name: 'letters', p: letterDesign() }, { name: 'badge', p: badgeDesign() });
  for (let s = 1; s <= 40; s++) cases.push({ name: `random ${s}`, p: randomPattern(s) });
  const empty = new PatternBuilder().build('empty', 'dst', []);
  const one = new PatternBuilder();
  one.add(5, 5, STITCH);
  cases.push({ name: 'empty', p: empty }, { name: 'one stitch', p: one.build('one', 'dst', []) });
}, 120_000);

/** Index of the first difference of two typed arrays (bit for bit), or -1. */
function firstDiff(a: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }, b: typeof a): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  const ab = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const bb = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < ab.length; i++) if (ab[i] !== bb[i]) return Math.floor(i / (a.byteLength / a.length));
  return -1;
}

function same(name: string, a: Float32Array | Uint8Array | Uint16Array, b: typeof a): void {
  const i = firstDiff(a, b);
  expect(i, `${name}: first difference at ${i} (${a[i]} against ${b[i]}), lengths ${a.length} / ${b.length}`).toBe(-1);
}

function sameMeasurement(name: string, a: Measurement, b: Measurement): void {
  expect([a.originX, a.originY, a.cols, a.rows, a.cellMm], name).toEqual([b.originX, b.originY, b.cols, b.rows, b.cellMm]);
  for (const k of ['density', 'satin', 'shorts', 'holes', 'cover', 'gapsLow', 'gapsHigh', 'longest'] as const) same(`${name} ${k}`, a[k], b[k]);
}

const densityOptions: DensityOptions[] = [
  { metric: 'thread', cellMm: 1, blurMm: 0, includeJumps: false },
  { metric: 'thread', cellMm: 0.5, blurMm: 1.5, includeJumps: true },
  { metric: 'thread', cellMm: 0.2, blurMm: 0.6, includeJumps: false, alignMm: 1, shiftMm: -0.05 },
  { metric: 'penetrations', cellMm: 1, blurMm: 0, includeJumps: false },
  { metric: 'penetrations', cellMm: 2, blurMm: 1, includeJumps: false },
];

describe('Rust checks against the TypeScript they replace', () => {
  it('has a corpus', () => {
    expect(cases.length).toBeGreaterThan(60);
  }, 600_000);

  it('density grids are identical', () => {
    for (const { name, p } of cases) {
      for (const opt of densityOptions) {
        const a = computeDensity(p, opt);
        const b = tsDensity(p, opt);
        const label = `${name} ${JSON.stringify(opt)}`;
        expect([a.cols, a.rows, a.originX, a.originY, a.cellMm, a.max], label).toEqual([b.cols, b.rows, b.originX, b.originY, b.cellMm, b.max]);
        same(label, a.data, b.data);
      }
      // With a filter and with bounds grown beyond the stitches (as the correction engine asks).
      const odd = (i: number) => i % 3 !== 0;
      const grown = { ...p, bounds: { minX: p.bounds.minX - 40, minY: p.bounds.minY - 40, maxX: p.bounds.maxX + 40, maxY: p.bounds.maxY + 40 } };
      for (const opt of [densityOptions[2], densityOptions[3]]) {
        same(`${name} filtered`, computeDensity(grown, opt, odd).data, tsDensity(grown, opt, odd).data);
      }
    }
  }, 600_000);

  it('the thread grid still sums to the thread length', () => {
    for (const { name, p } of cases) {
      let len = 0;
      for (let i = 1; i < p.cmd.length; i++) if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH) len += Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) / 10;
      const g = computeDensity(p, densityOptions[0]);
      let s = 0;
      for (const v of g.data) s += v;
      expect(Math.abs(s - len), name).toBeLessThanOrEqual(1e-4 * Math.max(1, len));
    }
  }, 600_000);

  it('blur is identical', () => {
    const r = rand(7);
    const d = Float32Array.from({ length: 40 * 30 }, () => (r() < 0.2 ? r() * 9 : 0));
    for (const sigma of [0.3, 1, 2.5, 3.0000000000000004]) same(`blur ${sigma}`, gaussianBlur(d, 40, 30, sigma), tsBlur(d, 40, 30, sigma));
  }, 600_000);

  it('satin, E stitch, short stitch and kind tags are identical', () => {
    for (const { name, p } of cases) {
      same(`${name} satin`, satinMask(p), tsSatin(p));
      same(`${name} narrow satin`, satinMask(p, 3), tsSatin(p, 3));
      same(`${name} E stitches`, eStitchMask(p), tsEStitch(p));
      const tags = tagShortStitches(p);
      same(`${name} short stitches`, tags, tsTags(p));
      same(`${name} kinds`, core().stitchKinds(p.x, p.y, p.cmd), tsKinds(p));
      same(`${name} short counts`, shortStitchCounts(p, tags, -3.05, -7.05, 40, 30), tsShortCounts(p, tags, -3.05, -7.05, 40, 30));
    }
  }, 600_000);

  it('measurements are identical', () => {
    for (const { name, p } of cases) {
      sameMeasurement(name, measurePattern(p), tsMeasure(p));
      sameMeasurement(`${name} without gaps`, measurePattern(p, undefined, false), tsMeasure(p, undefined, false));
    }
  }, 600_000);

  it('measurements with fabric laid on and open fills are identical', () => {
    for (const { name, p } of cases) {
      // Records marked as placement lines (PATCH) in stretches, and others as open on purpose.
      const skip = new Uint8Array(p.cmd.length);
      for (let i = 0; i < skip.length; i++) skip[i] = Math.floor(i / 50) % 3 === 1 ? PATCH : Math.floor(i / 70) % 4 === 2 ? 1 : 0;
      sameMeasurement(`${name} skip`, measurePattern(p, skip), tsMeasure(p, skip));
      const m = tsMeasure(p);
      const mean = Float32Array.from(m.density, (v) => v * 0.6);
      const a = measureCoverage(p, mean, m.originX, m.originY, m.cols, m.rows, skip);
      const b = tsCoverage(p, mean, m.originX, m.originY, m.cols, m.rows, skip);
      for (const k of ['cover', 'gapsLow', 'gapsHigh', 'longest'] as const) same(`${name} coverage ${k}`, a[k], b[k]);
    }
  }, 600_000);

  it('findings a user sees are identical', () => {
    const profiles: Profile[] = [
      { fabric: 'woven', thread: '40' },
      { fabric: 'knit', thread: '40' },
      { fabric: 'leather', thread: '40' },
    ];
    for (const { name, p } of cases) {
      const a = measurePattern(p);
      const b = tsMeasure(p);
      for (const profile of profiles) {
        const ra = classify(a, profile);
        const rb = classify(b, profile);
        expect(ra.zones, `${name} ${profile.fabric}`).toEqual(rb.zones);
        same(`${name} levels`, ra.level, rb.level);
        same(`${name} reasons`, ra.reasons, rb.reasons);
      }
    }
  }, 600_000);

  it.runIf(process.env.BENCH)('timing on the largest design', () => {
    const big = cases.reduce((a, c) => (c.p.cmd.length > a.p.cmd.length ? c : a));
    const time = (f: () => unknown) => {
      for (let i = 0; i < 3; i++) f();
      const t: number[] = [];
      for (let i = 0; i < 15; i++) {
        const s = performance.now();
        f();
        t.push(performance.now() - s);
      }
      return t.sort((x, y) => x - y)[7].toFixed(1);
    };
    const opt = densityOptions[2];
    console.log(
      `${big.name} (${big.p.cmd.length} records): computeDensity ${time(() => tsDensity(big.p, opt))} -> ${time(() => computeDensity(big.p, opt))} ms, ` +
        `measurePattern ${time(() => tsMeasure(big.p))} -> ${time(() => measurePattern(big.p))} ms, ` +
        `without gaps ${time(() => tsMeasure(big.p, undefined, false))} -> ${time(() => measurePattern(big.p, undefined, false))} ms`,
    );
  }, 600_000);
});
