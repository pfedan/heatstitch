import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { digitize, digitizeDefaults } from '../src/digitize/digitize';
import { buildRegion, type Region } from '../src/digitize/region';
import { contourField, fieldFill } from '../src/digitize/flow';
import { MIN_CURVE_STITCH, runStitch, TOLERANCE } from '../src/digitize/run';
import { spiralFill } from '../src/digitize/spiral';
import type { Pt } from '../src/digitize/skeleton';
import { DEFAULT_PREPARE, Preparer } from '../src/image/prepare';
import { sewObjects } from '../src/model/objects';
import { STITCH } from '../src/model/pattern';
import { analyze, measureRun, remembered, restitch, restoreRemembered } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { normalizeImage } from '../src/settings';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { BLACK, WHITE, shape } from './helpers/images';

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Points on a circle round c, every `step` degrees (from `from` to `to`). */
function arc(c: Pt, r: number, from = 0, to = 360, step = 1): Pt[] {
  const out: Pt[] = [];
  for (let a = from; a <= to + 1e-9; a += step) out.push([c[0] + r * Math.cos((a * Math.PI) / 180), c[1] + r * Math.sin((a * Math.PI) / 180)]);
  return out;
}

/** How far the stitches between the needle points cut into a circle: its radius minus the stitch middle's. */
function cut(pts: Pt[], c: Pt, r: number): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d = Math.max(d, r - dist([(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2], c));
  return d;
}

const lengths = (pts: Pt[]) => pts.slice(1).map((p, i) => dist(pts[i], p));

describe('max. deviation of running stitch', () => {
  it('shortens the stitches on a curve until they keep within the tolerance', () => {
    const c: Pt = [0, 0];
    const circle = arc(c, 6);
    let before = 0;
    for (const tol of [0.4, 0.2, 0.1, 0.05]) {
      const pts = runStitch(circle, 5, tol);
      expect(cut(pts, c, 6)).toBeLessThanOrEqual(tol + 1e-6);
      // Tighter keeps more stitches.
      expect(pts.length).toBeGreaterThan(before);
      before = pts.length;
    }
    // Without a tolerance worth the name, 5 mm stitches would cut the circle by half a millimeter.
    expect(cut(runStitch(circle, 5, 5), c, 6)).toBeGreaterThan(0.45);
    // Where even the shortest stitch (1 mm) cuts further, the stitches stay at about 1 mm.
    const small = runStitch(arc(c, 2), 4, 0.05);
    expect(Math.min(...lengths(small))).toBeGreaterThan(MIN_CURVE_STITCH * 0.95);
    expect(cut(small, c, 2)).toBeLessThan(1 / 16 + 0.03);
  });

  it('keeps the stitch length on straight stretches and never goes below the shortest stitch', () => {
    // 20 mm straight, then a half circle of 1 mm radius, then 20 mm straight back.
    const line: Pt[] = [];
    for (let x = 0; x <= 20; x += 0.5) line.push([x, 0]);
    line.push(...arc([20, 1], 1, -90, 90, 2).slice(1));
    for (let x = 20; x >= 0; x -= 0.5) line.push([x, 2]);
    const pts = runStitch(line, 3, 0.05);
    const l = lengths(pts);
    expect(Math.max(...l)).toBeCloseTo(3, 1);
    expect(Math.min(...l)).toBeGreaterThan(MIN_CURVE_STITCH * 0.9);
    // A straight line alone keeps its even stitches, whatever the tolerance.
    const straight: Pt[] = [[0, 0], [10, 0]];
    expect(runStitch(straight, 2.5, 0.05)).toEqual(runStitch(straight, 2.5, 0.5));
    expect(runStitch(straight, 2.5, 0.05)).toHaveLength(5);
  });

  it('defaults to 0.15 mm', () => {
    expect(TOLERANCE).toBe(0.15);
    const c: Pt = [0, 0];
    expect(cut(runStitch(arc(c, 2), 2.5), c, 2)).toBeLessThanOrEqual(TOLERANCE + 1e-6);
  });
});

/** A disk region of radius r (mm) at 0.1 mm per pixel. */
function disk(r: number): Region {
  const W = Math.ceil(2 * r * 10) + 20;
  const comp = new Int32Array(W * W);
  let minX = W;
  let minY = W;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      if (Math.hypot((x + 0.5) / 10 - W / 20, (y + 0.5) / 10 - W / 20) >= r) continue;
      comp[y * W + x] = 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return buildRegion(comp, new Uint8Array(W * W), W, 1, 1, { minX, minY, maxX, maxY }, W, 0.1, 0, () => false);
}

const count = (runs: Pt[][]) => runs.reduce((a, r) => a + r.length, 0);

describe('max. deviation of curved rows', () => {
  const r = disk(6);
  const params = { spacing: 0.5, stitch: 4, angle: 0, pull: 0, underlay: false };

  it('gives contour rings more stitches for a smaller tolerance', () => {
    const f = contourField(r);
    const loose = fieldFill(r, f.g, f, { ...params, tolerance: 0.5 }, [1, 6], true, 3)!;
    const tight = fieldFill(r, f.g, f, { ...params, tolerance: 0.05 }, [1, 6], true, 3)!;
    expect(count(tight.runs)).toBeGreaterThan(count(loose.runs) * 1.3);
  });

  it('keeps the outer turn of a spiral within the tolerance', () => {
    const c: Pt = [r.x0 * 0.1 + (r.w * 0.1) / 2, r.y0 * 0.1 + (r.h * 0.1) / 2];
    const loose = spiralFill(r, { ...params, tolerance: 0.5 }, [0, 6])!;
    const tight = spiralFill(r, { ...params, tolerance: 0.05 }, [0, 6])!;
    expect(count(tight.runs)).toBeGreaterThan(count(loose.runs));
    // The first turn: its stitches cut the edge by little more than the tolerance (the traced
    // edge is not quite a circle).
    const run = tight.runs[0];
    const first = run.filter((p) => dist(p, c) > 5.2);
    expect(first.length).toBeGreaterThan(10);
    expect(cut(first.slice(0, 10), c, dist(first[0], c))).toBeLessThan(0.12);
  });
});

describe('max. deviation in Image mode and stitch settings', () => {
  it('sews a thin open ring with more stitches and closer to it for a smaller tolerance', () => {
    // A ring of 4 mm radius, open on the right so the white inside is background too.
    const ring = (x: number, y: number) => Math.abs(Math.hypot(x - 15, y - 15) - 4) < 0.35 && !(x > 15 && Math.abs(y - 15) < 1.5);
    const img = shape(300, 300, (x, y) => (ring(x / 10, y / 10) ? BLACK : null), WHITE);
    const prep = new Preparer(img).run({ ...DEFAULT_PREPARE, widthMm: 30, minAreaMm2: 1 });
    const sew = (tolerance: number) => {
      const { pattern, objects } = digitize(prep, { ...digitizeDefaults(DEFAULT_PROFILE), tolerance }, 'ring');
      expect(objects.map((o) => o.kind)).toEqual(['run']);
      const pts: Pt[] = [];
      for (let i = 0; i < pattern.cmd.length; i++) if (pattern.cmd[i] === STITCH) pts.push([pattern.x[i] / 10, pattern.y[i] / 10]);
      return pts;
    };
    const loose = sew(0.5);
    const tight = sew(0.05);
    expect(tight.length).toBeGreaterThan(loose.length * 1.3);
    // Stitches cut the ring's middle line (radius 4) by no more than the tolerance and a pixel.
    expect(cut(tight.slice(5, -5), [0, 0], 4)).toBeLessThan(0.05 + 0.12);
    expect(cut(loose.slice(5, -5), [0, 0], 4)).toBeGreaterThan(0.2);
  });

  it('restitches running stitch with more stitches for a smaller tolerance', () => {
    // An outline of the cat (the underlays of the demo letters are parts of their fills and satins).
    const p = parsePattern(readFileSync(new URL('../public/examples/cat-60mm.pes', import.meta.url)), 'cat-60mm.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs.find((x) => x.kind === 'run' && x.stitches > 40)!;
    const m = measureRun(p, analyze(p, o, kinds).parts[0]);
    expect(m.tolerance).toBe(TOLERANCE);
    const n = (tolerance: number) => {
      const r = restitch(p, objs, [o.index], { kind: 'run', s: { ...m, stitch: 5, tolerance } }, kinds, 7);
      return r.ends[0] - r.starts[0];
    };
    expect(n(0.05)).toBeGreaterThanOrEqual(n(0.5));
  });

  it('keeps the setting with the image settings and reads stored fills without it', () => {
    expect(normalizeImage({ stitch: { tolerance: 0.3 } } as never).stitch.tolerance).toBe(0.3);
    expect(normalizeImage({ stitch: { tolerance: 'x' } } as never).stitch.tolerance).toBeUndefined();
    const fill = { pattern: 'tatami', spacing: 0.4, spacingEnd: 1, offset: 0.25, angle: 0, stitch: 4, underlay: true, edge: 0 };
    const p = parsePattern(readFileSync(new URL('../public/examples/demos/letters.pes', import.meta.url)), 'letters.pes');
    expect(restoreRemembered(p, [{ key: 'old', region: null, fill }])).toBe(1);
    expect(remembered(p, sewObjects(p, stitchKinds(p))[0])).toBeUndefined();
  });
});
