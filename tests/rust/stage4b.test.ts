import { describe, expect, it } from 'vitest';
import { buildRegion, type Region } from '../../src/digitize/region';
import { inside } from '../../src/digitize/rungs';
import type { Pt } from '../../src/digitize/skeleton';
import * as rsApplique from '../../src/model/applique';
import { coversOver, type Cover } from '../../src/model/covers';
import * as rsGeo from '../../src/model/geo';
import { overlaps, sewObjects } from '../../src/model/objects';
import * as rsOrder from '../../src/model/order';
import { STITCH } from '../../src/model/pattern';
import * as rsRestitch from '../../src/model/restitch';
import { autoReversible } from '../../src/model/reverse';
import * as rsSew from '../../src/model/sew';
import * as rsTravel from '../../src/model/travel';
import { designs } from './designs';
import * as tsApplique from './ts/model/applique';
import * as tsGeo from './ts/model/geo';
import * as tsOrder from './ts/model/order';
import * as tsRestitch from './ts/model/restitch';
import * as tsSew from './ts/model/sew';
import * as tsTravel from './ts/model/travel';
import { v8Math } from './v8math';

/**
 * Stage 4b of the Rust core: one object sewn in one call (sewOne), fills from their settings with
 * what lies on top, areas traced from stitches and grown, the hidden way between objects and the
 * order the optimizer plans. The TypeScript as it was (tests/rust/ts/model) and the core sew the
 * objects of designs in public/examples and fills made up here, and agree exactly: the same
 * needle points, the same runs marked for a trim or a stop, the same areas and orders.
 */

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
const marked = (runs: Pt[][], trim: WeakSet<Pt[]>, stop: WeakSet<Pt[]>) => runs.map((r) => ({ r, m: (trim.has(r) ? 1 : 0) | (stop.has(r) ? 2 : 0) }));
const tsMarks = (runs: Pt[][]) => marked(runs, tsRestitch.trimBefore, tsApplique.stopBefore);
const rsMarks = (runs: Pt[][]) => marked(runs, rsRestitch.trimBefore, rsApplique.stopBefore);
const sewn = (s: { runs: Pt[][]; under: number } | null, marks: (r: Pt[][]) => unknown) => s && { runs: marks(s.runs), under: s.under };
const filled = (f: rsRestitch.NewFill | null, marks: (r: Pt[][]) => unknown) => f && { ...f, runs: marks(f.runs) };

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
const AREAS: [string, Region][] = [
  ['U', comp((x, y) => inside(U, [x, y]))],
  ['ring', comp(ring)],
];
/** What lies on top of the areas: a bar across. */
const BAR: Cover[] = [{ region: comp((x, y) => Math.abs(y - 22) < 3 && x > 2 && x < 40), overlap: 0.2 }];

type Fill = rsRestitch.FillSettings;
const BASE: Fill = { pattern: 'tatami', spacing: 0.4, spacingEnd: 0.4, offset: 0.25, angle: 30, stitch: 4, underlay: true, edge: 0.2, tolerance: 0.15 };
const FILLS: [string, Partial<Fill>][] = [
  ['tatami', {}],
  ['tatami with crossed underlay along the edge, trims saved', { underCross: true, underEdge: true, saveTrims: true, rowEnds: 'edge' }],
  ['tatami irregular', { rough: 0.8, roughSeed: 5 }],
  ['tatami grown', { expand: 0.6 }],
  ['tatami shrunk', { expand: -0.5 }],
  ['tatami no underlay under what lies on top', { underCover: true, underInset: 0.5 }],
  ['tatami embossed', { deco: { emboss: 'hearts', embossSize: 6, embossStrong: true } }],
  ['tatami textured', { deco: { texture: 'herringbone', textureSize: 3 } }],
  ['gradient', { pattern: 'gradient', spacingEnd: 1.2, deco: { fade: 'in' } as never }],
  ['contour', { pattern: 'contour' }],
  ['spiral', { pattern: 'spiral' }],
  ['guided', { pattern: 'guided', guides: [[[2, 2], [20, 10], [40, 4]]], gradient: true, spacingEnd: 0.8 }],
  ['waves', { pattern: 'waves', deco: { height: 2.5, length: 15 } }],
  ['grain', { pattern: 'grain', deco: { strength: 0.8, seed: 3 } }],
  ['rays', { pattern: 'rays', deco: { focus: [0.3, 0.2] } }],
  ['swirl', { pattern: 'swirl', deco: { centers: [[0.3, 0.3], [0.7, 0.6]] } }],
  ['circles', { pattern: 'circles' }],
  ['meander', { pattern: 'meander', deco: { size: 3, seed: 2 } }],
  ['maze', { pattern: 'maze' }],
  ['grid', { pattern: 'grid', deco: { grid: 'brick' } }],
  ['motifs', { pattern: 'motifs', deco: { figure: 'stars', triple: true } }],
  ['echo', { pattern: 'echo' }],
  ['cross', { pattern: 'cross', deco: { cross: 'double', angle: 10 } }],
  ['cross half on its own grid', { pattern: 'cross', deco: { cross: 'half', ownGrid: true } }],
  ['crosshatch', { pattern: 'crosshatch', deco: { size: 2 } }],
];
/** Patterns whose fields take long: compared on one area. */
const ONE_AREA: Record<string, string> = { guided: 'ring', grain: 'U', rays: 'ring', swirl: 'U', circles: 'ring', crosshatch: 'U' };
const ROWS: [Pt, Pt][] = Array.from({ length: 60 }, (_, k): [Pt, Pt] => [[2, 2 + k * 0.6], [40, 4 + k * 0.6 + Math.sin(k / 6) * 3]]);
/** Designs with fills of many kinds, lines, borders, satins and appliqués, and files from elsewhere (sewn in a few seconds). */
const SOME = new Set(['Blume', 'Musterkarte Offen', 'Aufnäher', 'Handtuch', 'Satinflächen', 'Applikation', 'Linieneffekte', 'demos/overlap.pes', 'demos/confetti.pes', 'svg kirschen', 'svg overlapping-circles', 'svg abzeichen']);
let loaded: ReturnType<typeof designs> | undefined;
const some = () => (loaded ??= designs((name) => SOME.has(name)));

const ZIGZAG = { angle: 10, straight: true, height: 1.5, wave: [0.8, 0.2] as Pt, phase: 0.3, spacing: 0.5, stitch: 3, first: [0, 0] as [number, number], thread: 0 };

describe.runIf(v8Math)('stage 4b: TypeScript and Rust agree', () => {
  it(
    'on fills of every pattern',
    check(() => {
      for (const [area, r] of AREAS) {
        for (const [name, s] of FILLS) {
          const fill = { ...BASE, ...s } as Fill;
          // The slow fields on one area each, nothing on top (the same code as on the other).
          if (ONE_AREA[name] && ONE_AREA[name] !== area) continue;
          for (const covers of ONE_AREA[name] ? [undefined] : [undefined, BAR]) {
            const tag = `${area}: ${name}${covers ? ', a bar on top' : ''}`;
            const way = { start: [3, 5] as Pt, end: [30, 28] as Pt, travel: r, covers };
            same(tag, filled(tsRestitch.fillRuns(r, fill, way), tsMarks), filled(rsRestitch.fillRuns(r, fill, way), rsMarks));
          }
        }
        // Rows that follow old stitches: their course, or their zigzag laid out again.
        const follow = { ...BASE, pattern: 'follow' } as Fill;
        const way = { start: [3, 5] as Pt, rows: ROWS };
        same(`${area}: follow`, filled(tsRestitch.fillRuns(r, follow, way), tsMarks), filled(rsRestitch.fillRuns(r, follow, way), rsMarks));
        same(`${area}: follow a gradient`, filled(tsRestitch.fillRuns(r, { ...follow, gradient: true, spacingEnd: 1 }, way), tsMarks), filled(rsRestitch.fillRuns(r, { ...follow, gradient: true, spacingEnd: 1 }, way), rsMarks));
        const zig = { ...way, zigzag: ZIGZAG };
        same(`${area}: follow a zigzag`, filled(tsRestitch.fillRuns(r, follow, zig), tsMarks), filled(rsRestitch.fillRuns(r, follow, zig), rsMarks));
      }
    }),
    60_000,
  );

  it(
    'on every object of every design, sewn in one call, and on the areas traced from it',
    check(async () => {
      const kinds = new Map<string, number>();
      for (const { name, pattern: p } of await some()) {
        const objs = sewObjects(p);
        objs.forEach((o, k) => {
          const what = `${name} #${o.index}`;
          // The area its stitches cover, as the files from elsewhere are read.
          const segs: number[] = [];
          for (let i = o.first + 1; i <= o.last; i++) if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH) segs.push(i);
          if (k % 3 === 0) {
            same(`${what} traceRegion`, tsRestitch.traceRegion(p, segs, 0.3, 0.2), rsRestitch.traceRegion(p, segs, 0.3, 0.2));
            same(`${what} traceRegion open`, tsRestitch.traceRegion(p, segs, 0.5, 0, false), rsRestitch.traceRegion(p, segs, 0.5, 0, false));
          }
          const spec = rsSew.specOf(p, o);
          if (!spec) return;
          kinds.set(spec.kind, (kinds.get(spec.kind) ?? 0) + 1);
          const next = objs[k + 1];
          const from: Pt = [o.minX / 10, o.minY / 10];
          const to: Pt | undefined = next && [p.x[next.first] / 10, p.y[next.first] / 10];
          const covers = spec.kind === 'fill' ? coversOver(p, objs, o, spec.area.pxMm) : undefined;
          const way = { from, to, covers };
          same(`${what} ${spec.kind}`, sewn(tsSew.sewOne(spec, way), tsMarks), sewn(rsSew.sewOne(spec, way), rsMarks));
          if (spec.kind !== 'fill') return;
          // With its underlay left out under what lies on top.
          const under = { ...spec, fill: { ...spec.fill, underlay: true, underCover: true } };
          if (covers?.length) same(`${what} fill, no underlay under covers`, sewn(tsSew.sewOne(under, way), tsMarks), sewn(rsSew.sewOne(under, way), rsMarks));
          for (const grow of [0.3, -0.3]) same(`${what} grownArea ${grow}`, tsGeo.grownArea(spec.area, grow), rsGeo.grownArea(spec.area, grow));
        });
      }
      expect([...kinds.keys()].sort()).toEqual(['applique', 'border', 'fill', 'line', 'satin']);
    }),
    120_000,
  );

  it(
    'on the hidden ways between objects and the orders planned',
    check(async () => {
      let ways = 0;
      for (const { name, pattern: p } of await some()) {
        const objs = sewObjects(p);
        const hides = objs.map((o) => rsTravel.hidingOf(rsRestitch.remembered(p, o)));
        for (let k = 1; k < objs.length; k++) {
          const areas = hides.slice(k).filter((h): h is rsTravel.Hiding => !!h);
          if (!areas.length) continue;
          const [a, b] = [objs[k - 1], objs[k]];
          const at = (i: number): Pt => [p.x[i] / 10, p.y[i] / 10];
          for (const [s, t] of [[at(a.last), at(b.first)], [at(a.first), at(b.last)]]) {
            const w = tsTravel.hiddenWay(s, t, areas);
            same(`${name} #${k} hiddenWay`, w, rsTravel.hiddenWay(s, t, areas));
            if (w) ways++;
          }
        }
        const over = overlaps(p, objs);
        const reversible = objs.map((o) => autoReversible(p, o));
        for (const o of [
          { combineColors: true, shortestWays: true, trimMm: 2 },
          { combineColors: false, shortestWays: true, trimMm: 5 },
          { combineColors: true, shortestWays: false, trimMm: 2 },
        ]) {
          same(`${name} planCandidates ${JSON.stringify(o)}`, tsOrder.planCandidates(p, objs, over, o), rsOrder.planCandidates(p, objs, over, o));
          same(`${name} planCandidates reversed ${JSON.stringify(o)}`, tsOrder.planCandidates(p, objs, over, o, reversible), rsOrder.planCandidates(p, objs, over, o, reversible));
        }
      }
      // Hidden ways are found, not only refused.
      expect(ways).toBeGreaterThan(10);
    }),
    120_000,
  );

  it('compares enough cases', () => {
    expect(cases).toBeGreaterThan(400);
  });
});
