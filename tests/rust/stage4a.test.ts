import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRegion, type Region } from '../../src/digitize/region';
import { inside } from '../../src/digitize/rungs';
import type { Pt } from '../../src/digitize/skeleton';
import * as rsAlong from '../../src/model/along';
import * as rsApplique from '../../src/model/applique';
import { wholeOf } from '../../src/model/knockout';
import * as rsLine from '../../src/model/line';
import { sewObjects } from '../../src/model/objects';
import type { Pattern } from '../../src/model/pattern';
import * as rsRestitch from '../../src/model/restitch';
import * as rsOrder from '../../src/model/satinOrder';
import { specOf } from '../../src/model/sew';
import { parsePattern } from '../../src/parsers';
import type { Form } from '../../src/shape/path';
import { decodeProject } from '../../src/storage/project';
import * as tsAlong from './ts/model/along';
import * as tsApplique from './ts/model/applique';
import * as tsLine from './ts/model/line';
import * as tsRestitch from './ts/model/restitch';
import * as tsOrder from './ts/model/satinOrder';

/**
 * Stage 4a of the Rust core: sewing along lines and borders, satin from its rails (sections,
 * plans, chains and their best order, push and seam ends) and appliqués. The TypeScript as it was
 * (tests/rust/ts/model) and the core sew the objects of the demo project and shapes made up here,
 * and agree exactly: the same needle points, the same runs marked for a trim or a stop.
 */

type Rails = rsRestitch.Rails;
type Stitch = rsAlong.PathStitch;

/** Largest difference between two results; Infinity where their shapes differ. */
function diff(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a === b || (Number.isNaN(a) && Number.isNaN(b)) ? 0 : Math.abs(a - b) || Infinity;
  if (a === b) return 0;
  if (a == null || b == null) return Infinity;
  if (Array.isArray(a) || ArrayBuffer.isView(a)) {
    const [x, y] = [a as ArrayLike<unknown>, b as ArrayLike<unknown>];
    if (x.length !== y.length) return Infinity;
    let m = 0;
    for (let i = 0; i < x.length; i++) m = Math.max(m, diff(x[i], y[i]));
    return m;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    let m = 0;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) m = Math.max(m, diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
    return m;
  }
  return Infinity;
}

let off: string[] = [];
let cases = 0;
const same = (what: string, ts: unknown, rs: unknown) => {
  cases++;
  const d = diff(ts, rs);
  if (d > 0) off.push(`${what}: ${d}`);
};
const check = (f: () => void | Promise<void>) => async () => {
  off = [];
  await f();
  expect(off).toEqual([]);
};

/** Runs with the marks the sewing put on them: 1 a trim before, 2 a stop before. */
const marked = (runs: Pt[][], trim: WeakSet<Pt[]>, stop?: WeakSet<Pt[]>) => runs.map((r) => ({ r, m: (trim.has(r) ? 1 : 0) | (stop?.has(r) ? 2 : 0) }));
const tsMarks = (runs: Pt[][]) => marked(runs, tsRestitch.trimBefore, tsApplique.stopBefore);
const rsMarks = (runs: Pt[][]) => marked(runs, rsRestitch.trimBefore, rsApplique.stopBefore);

/** The satin functions on one part (columns of one object or chain). */
function satinPart(what: string, cols: Rails[], s: rsRestitch.SatinSettings) {
  const tsSteps: tsRestitch.SewnStep[] = [];
  const rsSteps: rsRestitch.SewnStep[] = [];
  const tsRuns = tsRestitch.satinRuns(cols, s, tsSteps);
  const rsRuns = rsRestitch.satinRuns(cols, s, rsSteps);
  same(`${what} satinRuns`, tsMarks(tsRuns), rsMarks(rsRuns));
  same(`${what} steps`, tsSteps, rsSteps);
  same(`${what} pushEnds`, tsRestitch.pushEnds(cols, s), rsRestitch.pushEnds(cols, s));
  same(`${what} seamEnds`, tsRestitch.seamEnds(cols, s), rsRestitch.seamEnds(cols, s));
  cols.forEach((c, k) => {
    same(`${what} previewPairs ${k}`, tsRestitch.previewPairs(c, s), rsRestitch.previewPairs(c, s));
    same(`${what} spacingAlong ${k}`, tsRestitch.spacingAlong(tsRestitch.columnOf(c), c, s.spacing, true), rsRestitch.spacingAlong(c, s.spacing, true));
  });
  same(`${what} partSteps`, tsOrder.partSteps(cols, s, 3), rsOrder.partSteps(cols, s, 3));
  if (cols.length < 2) return;
  same(`${what} bestChain`, tsRestitch.bestChain(cols, s), rsRestitch.bestChain(cols, s));
  same(`${what} chainCost`, tsRestitch.chainCost(cols, s), rsRestitch.chainCost(cols, s));
  same(`${what} travelOf`, tsRestitch.travelOf(cols, s), rsRestitch.travelOf(cols, s));
  // How much of each way between the steps shows, with the columns from the step's on still to come.
  const shown = tsRestitch.shownAmong(cols);
  const asks = rsSteps.filter((x) => x.way).map((x) => ({ way: x.way!, later: new Uint8Array(cols.length).fill(1, x.col) }));
  same(`${what} shownAmong`, asks.map((a) => shown(a.way, a.later)), rsRestitch.shownAmong(cols, asks));
}

/** Forms of lines and areas made up for this test. */
const P = (x: number, y: number): Pt => [x, y];
const node = (p: Pt, a = p, b = p) => ({ p, a, b, smooth: false });
const curve: Form = {
  paths: [
    { closed: false, nodes: [node(P(2, 30), P(2, 30), P(10, 5)), node(P(30, 30), P(22, 5), P(38, 40)), node(P(55, 20))] },
    { closed: true, nodes: [node(P(10, 45), P(10, 45), P(20, 40)), node(P(40, 50), P(30, 40), P(45, 60)), node(P(15, 62), P(25, 66), P(5, 60))] },
  ],
};
const touching: Form = {
  paths: [
    { closed: false, nodes: [node(P(0, 0)), node(P(30, 0))] },
    { closed: false, nodes: [node(P(15, 0)), node(P(15, 20))] },
    { closed: true, nodes: [node(P(10, 20)), node(P(20, 20)), node(P(20, 30)), node(P(10, 30))] },
    { closed: false, nodes: [node(P(40, 5)), node(P(50, 25))] },
  ],
};

const LINES: [string, Stitch][] = [
  ['run', { type: 'run', width: 2, length: 2.5 }],
  ['run there and back twice', { type: 'run', width: 2, length: 2, repeat: 2 }],
  ['run three times', { type: 'run', width: 2, repeat: 3 }],
  ['triple', { type: 'triple', width: 2 }],
  ['triple five', { type: 'triple', width: 2, repeat: 5, tolerance: 0.3 }],
  ['satin', { type: 'satin', width: 3 }],
  ['narrow satin', { type: 'satin', width: 0.8, spacing: 0.3 }],
  ['satin round, pulled, frayed left', { type: 'satin', width: 4, pull: 0.2, corner: 'round', ends: 'round', fringe: 1, fringeSide: 'left' }],
  ['satin capped, square ends, contour underlay, twice', { type: 'satin', width: 3, corner: 'cap', ends: 'square', under: 'contour', repeat: 2 }],
  ['satin with crossed underlay', { type: 'satin', width: 5, under: 'both', underCross: true }],
  ['zigzag', { type: 'zigzag', width: 2.5 }],
  ['zigzag three times', { type: 'zigzag', width: 2.5, repeat: 3 }],
  ['E stitch', { type: 'e', width: 3 }],
  ['E stitch flipped', { type: 'e', width: 3, flip: true, spacing: 2 }],
  ['waves', { type: 'motif', width: 3, motif: 'waves' }],
  ['hearts three times each', { type: 'motif', width: 4, motif: 'hearts', repeat: 3 }],
  ['scallops whole twice', { type: 'motif', width: 3, motif: 'scallops', repeat: 2, whole: true, flip: true }],
  ['stem cord', { type: 'motif', width: 1, motif: 'stem', cord: true }],
  ['feather', { type: 'motif', width: 5, motif: 'feather', repeat: 5 }],
  ['echo out', { type: 'run', width: 2, echo: { side: 'out', count: 2, gap: 3 } }],
  ['echo both, cut, triple', { type: 'triple', width: 2, echo: { side: 'both', count: 2, gap: 2.5, cut: true } }],
  ['echo there and back', { type: 'run', width: 2, repeat: 2, echo: { side: 'in', count: 1, gap: 2 } }],
  ['echo of a zigzag in phase', { type: 'zigzag', width: 2, echo: { side: 'both', count: 2, gap: 4, phase: 90 } }],
  ['echo of a motif, reversed, one copy in a thread of its own', { type: 'motif', width: 3, motif: 'waves', echo: { side: 'out', count: 3, gap: 4, phase: -45, reverse: true, colors: [null, { r: 1, g: 2, b: 3 }] } }],
  ['echo of a satin, only its second copy', { type: 'satin', width: 2, echo: { side: 'out', count: 2, gap: 4, only: [2] } }],
  ['echo skipping a copy', { type: 'e', width: 2, echo: { side: 'in', count: 3, gap: 3, skip: [2] } }],
  ['redwork', { type: 'run', width: 2, redwork: true }],
  ['redwork triple, wide gaps', { type: 'triple', width: 2, redwork: true, redworkGap: 3 }],
  [
    'satin in its own order',
    {
      type: 'satin',
      width: 3,
      order: [
        { rungs: [[0.3, 0.35]], cuts: [[0.5, 0.5]], plan: [{ sec: 1, flip: true, trim: false }, { sec: 0, flip: false, trim: true, mirror: true }] },
        { turned: true, mirror: true, spacings: [[0.5, 0.8]] },
      ],
    },
  ],
];

/** A bar from x0 to x1 at height y, w wide, its rails sampled every mm. */
const bar = (x0: number, x1: number, y: number, w: number, bend = 0): Rails => {
  const n = Math.max(2, Math.round(Math.abs(x1 - x0)));
  const at = (i: number, side: number): Pt => {
    const x = x0 + ((x1 - x0) * i) / n;
    return [x, y + side * (w / 2) + bend * Math.sin((i / n) * Math.PI)];
  };
  return { left: Array.from({ length: n + 1 }, (_, i) => at(i, -1)), right: Array.from({ length: n + 1 }, (_, i) => at(i, 1)) };
};
const chainOf = (cols: Rails[], c: number) => cols.map((r) => ({ ...r, chain: c }));
/** Strips of a fill cut apart, side by side and shuffled. */
const strips = (n: number, c: number) => chainOf(Array.from({ length: n }, (_, k) => bar(0 + (k % 3), 20 + (k % 2) * 3, ((k * 7) % n) * 3.2, 3.4, k % 2 ? 1 : 0)), c);
const SATIN: rsRestitch.SatinSettings = { spacing: 0.4, edge: 0.2, short: true, underlay: true, tolerance: 0.15 };
const SATINS: [string, Rails[], rsRestitch.SatinSettings][] = [
  ['a column', [bar(0, 30, 0, 4, 3)], SATIN],
  ['a column with rungs, cut lines and spacings', [{ ...bar(0, 40, 0, 5, 4), rungs: [[10, 12], [25, 24]], cuts: [[20, 20]], spacings: [[30, 0.7]] }], { ...SATIN, byWidth: true }],
  ['a column in a plan', [{ ...bar(0, 40, 0, 5), cuts: [[12, 12], [27, 27]], plan: [{ sec: 2, flip: true, trim: false }, { sec: 0, flip: false, trim: true }, { sec: 1, flip: true, trim: false, mirror: true }] }], SATIN],
  ['a column with free rungs', [{ ...bar(0, 30, 0, 6), cuts: [[15, 15]], spans: [[[5, -3], [9, 3]]] }], SATIN],
  ['contour underlay, mirrored, pushed', [{ ...bar(0, 30, 0, 5), mirror: true }, bar(30, 50, 0, 5)], { ...SATIN, under: 'contour', edgeAuto: true, edgeShare: 0.1 }],
  ['an E stitch', [bar(0, 30, 0, 3)], { ...SATIN, type: 'e', spacing: 2.5, short: false, underlay: false }],
  ['irregular and frayed', [bar(0, 30, 0, 6, 2), bar(0, 30, 8, 6)], { ...SATIN, rough: 0.6, roughSeed: 3, fringe: 1, fringeSide: 'left', edgeB: 0.4, edgeShareB: 0.05 }],
  ['a short chain', strips(5, 1), SATIN],
  ['a chain of eleven', strips(11, 2), { ...SATIN, under: 'zigzag' }],
  ['a long chain', strips(14, 3), SATIN],
  ['two chains and a column', [...strips(3, 4), bar(0, 20, 50, 3), ...strips(4, 5)], { ...SATIN, underlay: false }],
];

const PX = 0.15;
const W = 300;
function comp(f: (x: number, y: number) => boolean): Region {
  const map = new Int32Array(W * W);
  const labels = new Uint8Array(W * W).fill(2);
  let [minX, minY, maxX, maxY] = [W, W, 0, 0];
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      if (!f((x + 0.5) * PX, (y + 0.5) * PX)) continue;
      map[y * W + x] = 1;
      labels[y * W + x] = 1;
      [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
    }
  }
  return buildRegion(map, labels, W, 1, 1, { minX, minY, maxX, maxY }, W, PX, 0.3, (l) => l === 2)!;
}
const U: Pt[] = [[4, 4], [36, 4], [36, 30], [26, 30], [26, 13], [14, 13], [14, 30], [4, 30]];
const ring = (x: number, y: number) => Math.hypot(x - 22, y - 22) < 16 && Math.hypot(x - 24, y - 20) > 5;
const whole = comp(ring);
/** The ring with a bar across left out, as a shape on top leaves it (knockout). */
const cut = comp((x, y) => ring(x, y) && Math.abs(y - 22) > 2.5);
const AREAS: [string, Region, Region | null][] = [
  ['U', comp((x, y) => inside(U, [x, y])), null],
  ['ring', whole, null],
  ['ring cut by a shape on top', cut, whole],
];

const BORDERS: [string, Stitch][] = [
  ['run', { type: 'run', width: 2 }],
  ['triple outside', { type: 'triple', width: 2, offset: 0.5 }],
  ['satin', { type: 'satin', width: 2 }],
  ['satin inside, frayed outside', { type: 'satin', width: 3, offset: -1, fringe: 0.8, fringeSide: 'right' }],
  ['satin frayed', { type: 'satin', width: 2.5, fringe: 0.5, pull: 0.15 }],
  ['zigzag', { type: 'zigzag', width: 2 }],
  ['E stitch inward', { type: 'e', width: 2.5 }],
  ['E stitch outward', { type: 'e', width: 2.5, flip: true }],
  ['motif', { type: 'motif', width: 2, motif: 'scallops' }],
  ['hand stitch', { type: 'motif', width: 3, motif: 'chevron' }],
];

const APPLIQUES: [string, rsApplique.AppliqueSettings][] = [
  ['satin cover', { edge: 'satin', width: 3, fabric: 'woven', color: { r: 1, g: 2, b: 3 } }],
  ['E stitch cover, lines inside', { edge: 'e', width: 2.5, placeIn: 1, tackIn: 2, fabric: 'felt', color: { r: 1, g: 2, b: 3 } }],
  ['raw edge, no placement line, bean tack-down', { edge: 'none', width: 3, place: false, tack: { type: 'triple', width: 0, length: 2.5, repeat: 5 }, fabric: 'felt', color: { r: 1, g: 2, b: 3 } }],
  ['tack-down on the outline', { edge: 'satin', width: 4, tackIn: 0, fabric: 'woven', color: { r: 1, g: 2, b: 3 } }],
];

async function demoDesigns(): Promise<{ name: string; p: Pattern }[]> {
  const project = await decodeProject(new Uint8Array(readFileSync('public/examples/demo/heatstitch-demo.heatstitch')));
  return project.files.map((f) => {
    const p = parsePattern(f.data, f.name);
    rsRestitch.restoreRemembered(p, f.objects);
    return { name: f.title ?? f.name, p };
  });
}

describe('stage 4a: TypeScript and Rust agree', () => {
  it(
    'on every line, satin, border and appliqué of the demo project',
    check(async () => {
      const kinds = new Map<string, number>();
      for (const { name, p } of await demoDesigns()) {
        for (const o of sewObjects(p)) {
          const spec = specOf(p, o);
          if (!spec || spec.kind === 'fill') continue;
          kinds.set(spec.kind, (kinds.get(spec.kind) ?? 0) + 1);
          const what = `${name} #${o.index} ${spec.kind}`;
          const from: Pt = [o.minX / 10, o.minY / 10];
          if (spec.kind === 'line') {
            same(what, tsMarks(tsLine.lineStitches(spec.path, spec.line)), rsMarks(rsLine.lineStitches(spec.path, spec.line)));
            same(`${what} reversed`, tsMarks(tsLine.lineStitches(spec.path, spec.line, true, from)), rsMarks(rsLine.lineStitches(spec.path, spec.line, true, from)));
          } else if (spec.kind === 'satin') {
            spec.columns.forEach((cols, k) => satinPart(`${what} part ${k}`, cols, spec.satin));
          } else if (spec.kind === 'border') {
            const w = wholeOf(spec.area, spec.memory);
            same(what, tsMarks(tsAlong.borderStitches(spec.area, spec.border, from, w)), rsMarks(rsAlong.borderStitches(spec.area, spec.border, from, w)));
            if (spec.open) same(`${what} open`, tsMarks(tsAlong.openStitches(spec.open, spec.border, from, spec.area, w)), rsMarks(rsAlong.openStitches(spec.open, spec.border, from, spec.area, w)));
          } else {
            const a = tsApplique.appliqueRuns(spec.area, spec.applique, from, spec.shared);
            const b = rsApplique.appliqueRuns(spec.area, spec.applique, from, spec.shared);
            same(what, { runs: tsMarks(a.runs), under: a.under }, { runs: rsMarks(b.runs), under: b.under });
          }
        }
      }
      // Every kind the demo project has is compared.
      expect([...kinds.keys()].sort()).toEqual(['applique', 'border', 'line', 'satin']);
    }),
    60_000,
  );

  it(
    'on lines of every stitch',
    check(() => {
      for (const [name, st] of LINES) {
        for (const form of [curve, touching]) {
          const tag = `${name} on ${form === curve ? 'curves' : 'touching lines'}`;
          same(tag, tsMarks(tsLine.lineStitches(form, st)), rsMarks(rsLine.lineStitches(form, st)));
          same(`${tag} reversed from a point`, tsMarks(tsLine.lineStitches(form, st, true, [50, 30])), rsMarks(rsLine.lineStitches(form, st, true, [50, 30])));
        }
        const line: Pt[] = [[0, 0], [10, 2], [20, -3], [35, 4]];
        for (const shift of [0, 0.35]) same(`${name} sewAlong shifted ${shift}`, tsMarks(tsAlong.sewAlong(line, false, st, [36, 4], undefined, true, shift)), rsMarks(rsAlong.sewAlong(line, false, st, [36, 4], undefined, true, shift)));
      }
    }),
  );

  it(
    'on borders, open paths and seams of every stitch',
    check(() => {
      for (const [area, r, w] of AREAS) {
        same(`${area} borderLines`, tsAlong.borderLines(r, 0.2, w), rsAlong.borderLines(r, 0.2, w));
        for (const [name, st] of BORDERS) {
          const tag = `${area}: ${name}`;
          same(tag, tsMarks(tsAlong.borderStitches(r, st, [0, 0], w)), rsMarks(rsAlong.borderStitches(r, st, [0, 0], w)));
          same(`${tag} open`, tsMarks(tsAlong.openStitches(curve, st, [40, 40], r, w)), rsMarks(rsAlong.openStitches(curve, st, [40, 40], r, w)));
        }
      }
      const parts = [comp((x, y) => ring(x, y) && x < 22.2), comp((x, y) => ring(x, y) && x > 21.8)];
      for (const [name, st] of BORDERS) same(`seams: ${name}`, tsMarks(tsAlong.seamStitches(parts, whole, st, [5, 5])), rsMarks(rsAlong.seamStitches(parts, whole, st, [5, 5])));
    }),
  );

  it(
    'on appliqués',
    check(() => {
      for (const [area, r] of AREAS) {
        for (const [name, s] of APPLIQUES) {
          for (const shared of [null, cut]) {
            const tag = `${area}: ${name}${shared ? ', sharing its edge' : ''}`;
            const a = tsApplique.appliqueRuns(r, s, [1, 1], shared);
            const b = rsApplique.appliqueRuns(r, s, [1, 1], shared);
            same(tag, { runs: tsMarks(a.runs), under: a.under }, { runs: rsMarks(b.runs), under: b.under });
          }
        }
      }
    }),
  );

  it(
    'on satins of every kind',
    check(() => {
      for (const [name, cols, st] of SATINS) satinPart(name, cols, st);
    }),
  );

  it('compares enough cases', () => {
    expect(cases).toBeGreaterThan(500);
  });
});
