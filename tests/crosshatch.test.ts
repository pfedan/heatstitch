import { describe, expect, it } from 'vitest';
import { gridFill } from '../src/digitize/deco';
import { crosshatchFill, CROSSHATCH_HALF, fillRegion, type FillParams, type FillResult } from '../src/digitize/fill';
import { buildRegion, sample, type Region } from '../src/digitize/region';
import type { Pt } from '../src/digitize/skeleton';
import { sewObjects } from '../src/model/objects';
import { analyze, measureFill, shapeTrust } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { Writer } from './helpers/designs';

const PX = 0.1;

/** A region from a test on pixel centers (mm), in a 40 × 40 mm window. */
function region(inside: (x: number, y: number) => boolean): Region {
  const W = 400;
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

const SHAPES: [string, Region][] = [
  ['disk', region((x, y) => Math.hypot(x - 20, y - 20) < 14)],
  // A letter E: concave, the rows of both layers split into sections at its arms.
  ['letter', region((x, y) => x > 5 && x < 35 && y > 2 && y < 38 && !(x > 14 && ((y > 9 && y < 17) || (y > 23 && y < 31))))],
  // A ring: a hole in the middle.
  ['ring', region((x, y) => { const d = Math.hypot(x - 20, y - 20); return d < 15 && d > 6; })],
];

const P: FillParams = { spacing: 1.6, stitch: 3, angle: 0, pull: 0, underlay: false };
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Direction of a stitch, 0 to 180 degrees. */
const dir = (a: Pt, b: Pt) => ((((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) % 180) + 180) % 180;
const apart = (a: number, b: number) => Math.min(Math.abs(a - b) % 180, 180 - (Math.abs(a - b) % 180));

describe('crosshatch', () => {
  for (const [name, r] of SHAPES) {
    for (const angle of [0, 30]) {
      it(`fills a ${name} at ${angle} degrees with two light layers crossing, in one go, inside the shape`, () => {
        const res = crosshatchFill(r, { ...P, angle }, [5, 20])!;
        expect(res).not.toBeNull();
        expect(res.under).toBe(0);
        // No jump inside: travel finds its way along the lines of thread.
        expect(res.runs).toHaveLength(1);
        const run = res.runs[0];
        let thread = 0;
        let longest = 0;
        const layer = [0, 0];
        // Thread inside the shape neither on a row nor along the outline: travel that shows.
        let astray = 0;
        for (const q of run) expect(sample(r, r.sdf, q[0], q[1]), `${q} outside`).toBeLessThan(0.3);
        let half = -1;
        for (let i = 1; i < run.length; i++) {
          const l = dist(run[i - 1], run[i]);
          thread += l;
          longest = Math.max(longest, l);
          const d = dir(run[i - 1], run[i]);
          const k = [angle - CROSSHATCH_HALF, angle + CROSSHATCH_HALF].findIndex((a) => apart(d, a) < 3);
          if (k >= 0) {
            layer[k] += l;
            // The first layer is sewn before the second.
            if (k === 1 && l > 2.7 && half < 0) half = i;
            if (k === 0 && l > 2.7 && half >= 0) expect.fail(`a row of the first layer after the second began (${i})`);
          } else {
            const mid: Pt = [(run[i - 1][0] + run[i][0]) / 2, (run[i - 1][1] + run[i][1]) / 2];
            if (sample(r, r.sdf, mid[0], mid[1]) < -0.8) astray += l;
          }
        }
        // Both layers at their angles, about as much thread each.
        expect(layer[0] / thread).toBeGreaterThan(0.38);
        expect(layer[1] / thread).toBeGreaterThan(0.38);
        expect(Math.abs(layer[0] - layer[1]) / thread).toBeLessThan(0.15);
        // Light: two layers of rows 1.6 mm apart lay 1.25 mm of thread per mm², half a usual 0.4 mm
        // fill, and the steps from row to row add some; more in the narrow arms of the letter, with
        // its many short rows and travel along the lines between the arms.
        expect(thread / r.areaMm2).toBeGreaterThan(1.2);
        expect(thread / r.areaMm2).toBeLessThan(name === 'letter' ? 1.85 : 1.55);
        // Only a few millimetres at most, where a way leaves the end of a row near a corner.
        expect(astray).toBeLessThan(8);
        // Stitches on a row up to the stitch length and a little at its ends; travel shorter.
        expect(longest).toBeLessThanOrEqual(P.stitch + 0.6 + 1e-6);
      });
    }
  }

  it('gets lighter with rows further apart', () => {
    const r = SHAPES[0][1];
    const thread = (spacing: number) => crosshatchFill(r, { ...P, spacing }, [5, 20])!.runs.flat().reduce((s, q, i, all) => s + (i ? dist(all[i - 1], q) : 0), 0);
    expect(thread(3)).toBeLessThan(thread(1.6) * 0.65);
  });

  it('ends near where the next object starts', () => {
    const r = SHAPES[0][1];
    const res = crosshatchFill(r, { ...P, end: [34, 20] }, [6, 20])!;
    const last = res.runs.at(-1)!.at(-1)!;
    expect(dist(last, [34, 20])).toBeLessThan(dist(last, [6, 20]));
  });
});

/** Stitches of `res` as a design from elsewhere, sewn in one go: nothing known but its stitches. */
function fromElsewhere(res: FillResult) {
  const w = new Writer();
  res.runs.forEach((run, k) => run.forEach((q, j) => (k === 0 && j === 0 ? w.start(q) : w.to(q))));
  const p = w.b.build('hatch', 'dst', [{ r: 40, g: 60, b: 160 }]);
  const kinds = stitchKinds(p);
  const [o] = sewObjects(p, kinds);
  const a = analyze(p, o, kinds);
  return { a, s: measureFill(p, a), trust: shapeTrust(p, o, a, measureFill(p, a).spacing) };
}

describe('crosshatch read from its stitches', () => {
  for (const [name, r] of SHAPES) {
    for (const [angle, spacing] of [[0, 1.6], [30, 2.5], [100, 1.2]]) {
      it(`knows a ${name} at ${angle} degrees, ${spacing} mm, and its whole area`, () => {
        const { a, s, trust } = fromElsewhere(crosshatchFill(r, { ...P, angle, spacing }, [5, 20])!);
        expect(s.pattern).toBe('crosshatch');
        expect(Math.min(Math.abs(s.angle - angle), 180 - Math.abs(s.angle - angle))).toBeLessThanOrEqual(1);
        expect(s.deco?.size).toBeCloseTo(spacing, 1);
        expect(s.stitch).toBeCloseTo(3, 0);
        expect(s.underlay).toBe(false);
        expect(a.parts.map((pt) => pt.kind)).toEqual(['fill']);
        // The net closed into its area: the shape, its hole kept.
        expect(a.fill!.areaMm2 / r.areaMm2).toBeGreaterThan(0.95);
        expect(a.fill!.areaMm2 / r.areaMm2).toBeLessThan(1.05);
        expect(trust).toBe('good');
      });
    }
  }

  it('leaves other fills as they are read: a tatami with crossing underlay, a grid of lines', () => {
    const disk = SHAPES[0][1];
    const tatami = fromElsewhere(fillRegion(disk, { ...P, spacing: 0.4, stitch: 4, underlay: true, underCross: true }, [5, 20])!);
    expect(tatami.s.pattern).not.toBe('crosshatch');
    const light = fromElsewhere(fillRegion(disk, { ...P, spacing: 1.2 }, [5, 20])!);
    expect(light.s.pattern).not.toBe('crosshatch');
    const grid = fromElsewhere(gridFill(disk, { size: 3, stitch: 2.5, seed: 1, triple: false }, 'diamond', [5, 20])!);
    expect(grid.s.pattern).not.toBe('crosshatch');
  });
});
