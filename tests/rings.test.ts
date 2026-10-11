import { beforeAll, describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { pathLength } from '../src/digitize/fill';
import { contourFill } from '../src/digitize/flow';
import { coverage } from '../src/digitize/measure';
import { buildRegion, type Region } from '../src/digitize/region';
import type { Pt } from '../src/digitize/skeleton';
import { spiralFill } from '../src/digitize/spiral';
import { addShape } from '../src/model/addShape';
import { rememberObjects, sewObjects } from '../src/model/objects';
import { STITCH, type Pattern } from '../src/model/pattern';
import { remember, restitch, type FillPattern, type FillSettings } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { loadOps } from '../src/shape/ops';
import type { Mat } from '../src/shape/path';
import { parsePath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { CRITICAL, validatePattern } from '../src/validation/validate';

/**
 * Contour fill and spiral (src/digitize/rings.ts) in shapes the old spiral could not fill: the
 * turns lie one spacing apart, the line goes from ring to ring without a step or a needle point
 * sewn twice, and a shape that divides or has a hole is still one run.
 */

const PX = 0.1;
const S = 0.4;
const params = { spacing: S, stitch: 4, angle: 0, pull: 0, underlay: false };

/** A region from a test on pixel centers (mm), in a 50 × 50 mm window. */
function region(inside: (x: number, y: number) => boolean): Region {
  const W = 500;
  const comp = new Int32Array(W * W);
  let minX = W;
  let minY = W;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside((x + 0.5) * PX, (y + 0.5) * PX)) continue;
      comp[y * W + x] = 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return buildRegion(comp, new Uint8Array(W * W), W, 1, 1, { minX, minY, maxX, maxY }, W, PX, 0, () => false);
}

/** A leaf: pointed at both ends and bent, so no point inside sees all of its edge. */
const leaf = (x: number, y: number) => {
  const t = (x - 8) / 34;
  if (t <= 0 || t >= 1) return false;
  return Math.abs(y - 25 + 6 * Math.sin(Math.PI * t)) < 8.5 * Math.sin(Math.PI * t) ** 0.8;
};
const SHAPES: Record<string, (x: number, y: number) => boolean> = {
  oval: (x, y) => ((x - 25) / 15) ** 2 + ((y - 25) / 9) ** 2 < 1,
  leaf,
  L: (x, y) => x > 5 && x < 40 && y > 5 && y < 45 && !(x > 17 && y < 33),
  dumbbell: (x, y) => Math.hypot(x - 10, y - 25) < 8 || Math.hypot(x - 40, y - 25) < 8 || (x > 10 && x < 40 && Math.abs(y - 25) < 2.6),
  ring: (x, y) => Math.hypot(x - 25, y - 25) < 12 && Math.hypot(x - 25, y - 25) > 5,
};
const regions = Object.fromEntries(Object.entries(SHAPES).map(([k, f]) => [k, region(f)]));

/**
 * The distance from points every half millimetre along the line to the next line beside it, on
 * either side along the normal (in spacings); the edge side finds none within three spacings.
 */
function gaps(line: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const cells = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x)},${Math.floor(y)}`;
  for (let i = 1; i < line.length; i++) {
    for (let x = Math.floor(Math.min(line[i - 1][0], line[i][0])); x <= Math.max(line[i - 1][0], line[i][0]); x++) {
      for (let y = Math.floor(Math.min(line[i - 1][1], line[i][1])); y <= Math.max(line[i - 1][1], line[i][1]); y++) cells.set(key(x, y), [...(cells.get(key(x, y)) ?? []), i]);
    }
  }
  const out: number[] = [];
  let i = 1;
  for (let a = 0.25; a < cum[cum.length - 1]; a += 0.5) {
    while (cum[i] < a) i++;
    const [p, q] = [line[i - 1], line[i]];
    const l = cum[i] - cum[i - 1];
    if (l < 1e-6) continue;
    const t = (a - cum[i - 1]) / l;
    const P: Pt = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    for (const side of [1, -1]) {
      const n: Pt = [(-(q[1] - p[1]) / l) * side, ((q[0] - p[0]) / l) * side];
      let best = Infinity;
      const seen = new Set<number>();
      for (let d = 0; d <= 3 * S + 1; d += 0.5) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (const j of cells.get(key(P[0] + n[0] * d + dx, P[1] + n[1] * d + dy)) ?? []) {
              if (seen.has(j) || Math.abs(cum[j] - a) < 1.2 * S + 0.3) continue;
              seen.add(j);
              const [A, B] = [line[j - 1], line[j]];
              const e: Pt = [B[0] - A[0], B[1] - A[1]];
              const den = n[0] * e[1] - n[1] * e[0];
              if (Math.abs(den) < 1e-9) continue;
              const u = ((A[0] - P[0]) * e[1] - (A[1] - P[1]) * e[0]) / den;
              const v = ((A[0] - P[0]) * n[1] - (A[1] - P[1]) * n[0]) / den;
              if (u > 1e-4 && v >= 0 && v <= 1) best = Math.min(best, u);
            }
          }
        }
      }
      if (best <= 3 * S) out.push(best / S);
    }
  }
  return out;
}

const share = (xs: number[], ok: (x: number) => boolean) => xs.filter(ok).length / xs.length;

/** Needle points that come back to where another one lies (not its neighbours): a stitch sewn twice. */
function twice(runs: Pt[][]): number {
  const pts = runs.flat();
  let n = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 3; j < pts.length; j++) if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < 0.05) n++;
  }
  return n;
}

describe('spiral and contour fill in any shape', () => {
  for (const [name, r] of Object.entries(regions)) {
    for (const [mode, fill] of [
      ['spiral', spiralFill],
      ['contour', contourFill],
    ] as const) {
      it(`${mode} in a ${name}: one run, turns a spacing apart, area covered`, () => {
        const res = fill(r, params, [0, 0])!;
        expect(res, 'sewn').not.toBeNull();
        expect(res.runs, 'no jump').toHaveLength(1);
        const line = res.runs[0];
        // No stitch longer than asked (travel stitches are shorter).
        for (let i = 1; i < line.length; i++) expect(Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])).toBeLessThan(params.stitch + 0.01);
        expect(coverage(r, res.runs, 0.3)).toBeGreaterThan(0.97);
        // As much thread as rows a spacing apart would take (travel adds a little in branched shapes;
        // the ring's ridge falls just short of room for one more line on each side).
        expect(pathLength(line) / r.areaMm2).toBeGreaterThan(0.9 / S);
        expect(pathLength(line) / r.areaMm2).toBeLessThan(1.12 / S);
        const g = gaps(line);
        expect(share(g, (x) => x > 0.7 && x < 1.3), 'near the spacing').toBeGreaterThan(0.9);
        expect(share(g, (x) => x < 0.5), 'crowded').toBeLessThan(0.04);
        expect(share(g, (x) => x > 1.6), 'open').toBeLessThan(0.05);
      });
    }
  }

  it('fills shapes the old spiral turned down (not seen whole from any point inside)', () => {
    for (const name of ['leaf', 'L', 'dumbbell', 'ring']) expect(spiralFill(regions[name], params, [0, 0]), name).not.toBeNull();
  });

  it('passes from ring to ring without a needle point sewn twice', () => {
    for (const name of ['oval', 'leaf', 'L']) {
      for (const fill of [contourFill, spiralFill]) expect(twice(fill(regions[name], params, [0, 0])!.runs), name).toBe(0);
    }
  });

  it('keeps the needle points of neighbouring turns from lining up into spokes or steps', () => {
    // A needle point within 1.125 spacings of one on another turn lies almost straight beside it.
    // An even split per turn with a growing offset put a third to two thirds of them there.
    const beside = (run: Pt[]) => run.filter((q, i) => run.some((o, j) => Math.abs(j - i) > 3 && Math.hypot(o[0] - q[0], o[1] - q[1]) < 1.125 * S)).length / run.length;
    for (const name of ['oval', 'leaf', 'L']) {
      for (const fill of [contourFill, spiralFill]) expect(beside(fill(regions[name], params, [0, 0])!.runs[0]), name).toBeLessThan(0.12);
    }
  });

  it('starts at the edge nearest the needle and ends inside', () => {
    const r = regions.oval;
    const res = spiralFill(r, params, [25, 0])!;
    const first = res.runs[0][0];
    expect(Math.hypot(first[0] - 25, first[1] - 16)).toBeLessThan(1);
    const last = res.runs[0][res.runs[0].length - 1];
    expect(Math.hypot((last[0] - 25) / 15, (last[1] - 25) / 9)).toBeLessThan(0.6);
  });

  it('is too small for a ring only below a millimetre or so', () => {
    expect(spiralFill(region((x, y) => Math.hypot(x - 25, y - 25) < 0.15), params, [0, 0])).toBeNull();
    expect(spiralFill(region((x, y) => Math.hypot(x - 25, y - 25) < 1.2), params, [0, 0])).not.toBeNull();
  });
});

describe('spiral and contour fill in the app', () => {
  beforeAll(loadOps);
  const ID: Mat = [1, 0, 0, 1, 0, 0];
  const options = digitizeDefaults(DEFAULT_PROFILE);
  const empty = { name: 'x', format: 'dst', x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } } as unknown as Pattern;
  const heart = (() => {
    const pts: string[] = [];
    for (let i = 0; i < 120; i++) {
      const t = (2 * Math.PI * i) / 120;
      pts.push(`${(20 + 13 * Math.sin(t) ** 3).toFixed(3)} ${(20 - (13 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))) / 16).toFixed(3)}`);
    }
    return `M${pts.join(' L')} Z`;
  })();
  const dumbbell = 'M8 17.4 A8 8 0 1 0 8 22.6 L32 22.6 A8 8 0 1 0 32 17.4 Z';

  /** The shapes sewn as fills, then each sewn anew with `pattern` as the stitch panel does. */
  function sewn(pattern: FillPattern): Pattern {
    let p = empty;
    for (const d of [heart, dumbbell]) p = addShape(p, { form: parsePath(d, ID), kind: 'fill' }, { r: 200, g: 30, b: 60 }, null, options)!.pattern;
    const s: FillSettings = { pattern, spacing: options.spacing, spacingEnd: 1, offset: 0.25, angle: NaN, stitch: 4, underlay: true, edge: options.pull, tolerance: options.tolerance };
    for (let o = 0; o < 2; o++) {
      const kinds = stitchKinds(p);
      const r = restitch(p, sewObjects(p, kinds), [o], { kind: 'fill', s }, kinds, options.trimMm);
      expect(r.failed, `${pattern} ${o}`).toEqual([]);
      rememberObjects(r.pattern, [r.starts[0]], r.ends[0]);
      const q = r.pattern;
      const now = sewObjects(q, stitchKinds(q));
      let n = 0;
      let at = -1;
      for (let i = 0; i < q.cmd.length && at < 0; i++) if (q.cmd[i] === STITCH && ++n === r.starts[0] + 1) at = now.findIndex((y) => y.first <= i && y.last >= i);
      remember(q, now[at], r.memory[0]);
      p = q;
    }
    return p;
  }

  for (const pattern of ['spiral', 'contour'] as FillPattern[]) {
    it(`${pattern}: a heart and a dumbbell stay fills, nothing critical even on knits`, () => {
      const p = sewn(pattern);
      expect(sewObjects(p, stitchKinds(p)).map((o) => o.kind)).toEqual(['fill', 'fill']);
      for (const fabric of ['woven', 'knit'] as const) {
        const v = validatePattern(p, { ...DEFAULT_PROFILE, fabric });
        expect(v.zones.filter((z) => z.level === CRITICAL), fabric).toEqual([]);
      }
    });
  }
});
