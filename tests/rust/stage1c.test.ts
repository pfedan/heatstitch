import { describe, expect, it } from 'vitest';
import * as rsRegion from '../../src/digitize/region';
import * as rsSkeleton from '../../src/digitize/skeleton';
import * as rsMeasure from '../../src/digitize/measure';
import * as rsMedial from '../../src/digitize/medial';
import * as rsInner from '../../src/digitize/satinInner';
import * as rsCdt from '../../src/shape/cdt';
import { inside } from '../../src/digitize/rungs';
import { areaLoops } from '../../src/digitize/satinSuggest';
import * as tsRegion from './ts/region';
import * as tsSkeleton from './ts/skeleton';
import * as tsMeasure from './ts/measure';
import * as tsMedial from './ts/medial';
import * as tsInner from './ts/satinInner';
import * as tsCdt from './ts/cdt';
import { rng } from '../helpers/images';

/**
 * Stage 1c of the Rust core (docs/rust-core.md): regions, centerlines, the triangulation and the
 * medial axis. The TypeScript as it was (tests/rust/ts) and the Rust core run on the same areas and
 * must agree exactly: the algorithms are the same, and the core does its arithmetic as JavaScript
 * does (Math.hypot, Math.round, Float32Array rounding).
 */

type Pt = [number, number];
const PX = 0.1;
const W = 500;

/** Component map of a test on pixel centers (mm) in a 50 × 50 mm picture, with its box. */
function comp(f: (x: number, y: number) => boolean) {
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
  return { map, labels, bbox: { minX, minY, maxX, maxY } };
}

const star = (cx: number, cy: number, size: number): Pt[] => {
  const R = size / 2 / Math.cos((18 * Math.PI) / 180);
  return Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.382 * R : R;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Pt;
  });
};
const circle = (cx: number, cy: number, r: number, n = 90): Pt[] => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)] as Pt);
const U: Pt[] = [[5, 5], [45, 5], [45, 35], [33, 35], [33, 15], [17, 15], [17, 35], [5, 35]];
const blob = (): Pt[] =>
  Array.from({ length: 120 }, (_, i) => {
    const t = (2 * Math.PI * i) / 120;
    const r = 17 + 3 * Math.cos(3 * t);
    return [25 + r * Math.cos(t), 25 + r * Math.sin(t)] as Pt;
  });
const holes = [0, 1, 2].map((k) => circle(25 + 8 * Math.cos((2 * Math.PI * k) / 3 + 1), 25 + 8 * Math.sin((2 * Math.PI * k) / 3 + 1), 2.5, 36));
/** Distance from p to a polyline. */
const toLine = (p: Pt, line: Pt[]) => {
  let d = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const v = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1]) / (v[0] ** 2 + v[1] ** 2 || 1)));
    d = Math.min(d, Math.hypot(p[0] - a[0] - v[0] * t, p[1] - a[1] - v[1] * t));
  }
  return d;
};
const spiral: Pt[] = Array.from({ length: 400 }, (_, i) => {
  const t = (i / 400) * 5 * Math.PI;
  const r = 3 + 1.2 * t;
  return [25 + r * Math.cos(t), 25 + r * Math.sin(t)];
});
/** A speckled scan: a noisy blob with pinholes and a ragged edge. */
const noisy = (() => {
  const rand = rng(7);
  const speck = new Set<number>();
  for (let k = 0; k < 400; k++) speck.add(Math.floor(rand() * W * W));
  const wob = Array.from({ length: 16 }, () => rand());
  return (x: number, y: number) => {
    if (speck.has(Math.round(y / PX - 0.5) * W + Math.round(x / PX - 0.5))) return false;
    const a = Math.atan2(y - 25, x - 25);
    let r = 14;
    for (let k = 0; k < 8; k++) r += 1.6 * wob[2 * k] * Math.cos((k + 2) * a + 6 * wob[2 * k + 1]);
    return Math.hypot(x - 25, y - 25) < r + 0.15 * Math.sin(37 * a);
  };
})();

const AREAS: [string, (x: number, y: number) => boolean][] = [
  ['star', (x, y) => inside(star(25, 25, 38), [x, y])],
  ['U', (x, y) => inside(U, [x, y])],
  ['blob with holes', (x, y) => inside(blob(), [x, y]) && !holes.some((h) => inside(h, [x, y]))],
  ['ring', (x, y) => Math.abs(Math.hypot(x - 25, y - 25) - 12) < 3],
  ['spiral stroke', (x, y) => toLine([x, y], spiral) < 0.7],
  ['letters', (x, y) => (Math.abs(x - 10) < 1.5 && y > 8 && y < 40) || (Math.abs(y - 24) < 1.2 && x > 10 && x < 22) || (Math.abs(x - 22) < 1.5 && y > 8 && y < 40) || (Math.hypot(x - 36, y - 24) < 9 && Math.hypot(x - 36, y - 24) > 6.5)],
  ['speckled scan', noisy],
  // Its window reaches past the picture's edge, where the grown field must stop.
  ['at the edge', (x, y) => x < 6 + 3 * Math.sin(y / 3) && y > 0.3 && y < 49.8],
];

const build = (m: typeof tsRegion | typeof rsRegion, c: ReturnType<typeof comp>, grow = 0) =>
  m.buildRegion(c.map, c.labels, W, 1, 1, c.bbox, W, PX, grow, (l) => l === 2);

/** Times f over n runs (ms each). */
function time(f: () => unknown, n = 3): number {
  f();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) f();
  return (performance.now() - t0) / n;
}
const timings: Record<string, [number, number]> = {};
const timed = (name: string, ts: () => unknown, rs: () => unknown) => {
  const [a, b] = [time(ts), time(rs)];
  const [x, y] = timings[name] ?? [0, 0];
  timings[name] = [x + a, y + b];
};

describe('stage 1c: TypeScript and Rust agree', () => {
  for (const [name, f] of AREAS) {
    describe(name, () => {
      const c = comp(f);
      const tsR = build(tsRegion, c, 0.3);
      const rsR = build(rsRegion, c, 0.3);

      it('builds the same region and fields', () => {
        expect(rsR.mask).toEqual(tsR.mask);
        expect(rsR.inside).toEqual(tsR.inside);
        expect(rsR.sdfBase).toEqual(tsR.sdfBase);
        expect(rsR.sdf).toEqual(tsR.sdf);
        expect([rsR.x0, rsR.y0, rsR.w, rsR.h, rsR.areaMm2]).toEqual([tsR.x0, tsR.y0, tsR.w, tsR.h, tsR.areaMm2]);
        const plain = build(rsRegion, c);
        expect(plain.sdf).toBe(plain.sdfBase);
        expect(rsRegion.signedField(tsR.mask, tsR.w, tsR.h, PX)).toEqual(tsRegion.signedField(tsR.mask, tsR.w, tsR.h, PX));
        // Both keep the last fields: a new scale each run misses the cache, as a new area does.
        let k = 0;
        timed('signedField', () => tsRegion.signedField(tsR.mask, tsR.w, tsR.h, PX * (1 + ++k * 1e-9)), () => rsRegion.signedField(tsR.mask, tsR.w, tsR.h, PX * (1 + ++k * 1e-9)));
      });

      it('traces the same outlines', () => {
        for (const level of [0, -0.5, 0.3]) expect(rsRegion.outline(tsR, level)).toEqual(tsRegion.outline(tsR, level));
        expect(rsRegion.outline(tsR, 0, tsR.sdf)).toEqual(tsRegion.outline(tsR, 0, tsR.sdf));
        timed('outline', () => tsRegion.outline(tsR), () => rsRegion.outline(tsR));
      });

      it('grows and shrinks the same', () => {
        for (const mm of [1, -0.5, -0.05, -30]) {
          const [a, b] = [tsRegion.expandRegion(tsR, mm), rsRegion.expandRegion(tsR, mm)];
          if (!a || !b) {
            expect(b).toBe(a);
            continue;
          }
          expect(b).toEqual(a);
        }
      });

      it('finds the same skeleton', () => {
        expect(rsSkeleton.thin(tsR)).toEqual(tsSkeleton.thin(tsR));
        const [a, b] = [tsSkeleton.skeleton(tsR), rsSkeleton.skeleton(tsR)];
        expect(b).toEqual(a);
        timed('skeleton', () => tsSkeleton.skeleton(tsR), () => rsSkeleton.skeleton(tsR));
      });

      it('measures the same coverage', () => {
        const g = tsSkeleton.skeleton(tsR);
        const runs = g.branches.map((br) => br.pts.filter((_, i) => i % 7 === 0));
        expect(rsMeasure.coverage(tsR, runs)).toBe(tsMeasure.coverage(tsR, runs));
        expect(rsMeasure.coverage(tsR, runs, 0.6)).toBe(tsMeasure.coverage(tsR, runs, 0.6));
        timed('coverage', () => tsMeasure.coverage(tsR, runs), () => rsMeasure.coverage(tsR, runs));
      });

      it('triangulates and finds the same medial axis and plan', () => {
        const { outsides, holes: hs } = areaLoops(tsR);
        const t = rsCdt.triangulate([...outsides, ...hs]);
        expect(t).toEqual(tsCdt.triangulate([...outsides, ...hs]));
        expect(rsMedial.medialAxis(outsides, hs)).toEqual(tsMedial.medialAxis(outsides, hs));
        for (const max of [7, 3]) expect(rsInner.planInner(outsides, hs, max)).toEqual(tsInner.planInner(outsides, hs, max));
        timed('medialAxis', () => tsMedial.medialAxis(outsides, hs), () => rsMedial.medialAxis(outsides, hs));
        timed('planInner', () => tsInner.planInner(outsides, hs, 7), () => rsInner.planInner(outsides, hs, 7));
      });
    });
  }

  it('triangulates degenerate outlines the same', () => {
    const cases: Pt[][][] = [
      // A bow tie (self-crossing), duplicate points, a spike back along itself, collinear runs.
      [[[0, 0], [10, 10], [10, 0], [0, 10]]],
      [[[0, 0], [5, 0], [5, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
      [[[0, 0], [10, 0], [10, 5], [20, 5], [10, 5], [10, 10], [0, 10]]],
      [Array.from({ length: 200 }, (_, i): Pt => (i < 100 ? [i * 0.1, 0] : [(199 - i) * 0.1, 1]))],
      // Touching and overlapping outlines, a hole touching its outside.
      [circle(10, 10, 5, 64), circle(18, 10, 5, 64)],
      [[[0, 0], [10, 0], [10, 10], [0, 10]], [[0, 0], [5, 3], [3, 5]]],
      // Points on a grid finer than the snap.
      [circle(0, 0, 0.002, 30)],
      [[[0, 0], [1, 0]]],
    ];
    for (const loops of cases) expect(rsCdt.triangulate(loops)).toEqual(tsCdt.triangulate(loops));
  });

  it('reports the timings', () => {
    const rows = Object.entries(timings).map(([k, [a, b]]) => `${k.padEnd(12)} TypeScript ${a.toFixed(1).padStart(7)} ms  Rust ${b.toFixed(1).padStart(7)} ms  ${(a / b).toFixed(1)}x`);
    console.log(`Stage 1c over ${AREAS.length} areas (sum of the mean per area):\n${rows.join('\n')}`);
  });
});
