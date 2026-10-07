import { describe, expect, it } from 'vitest';
import { fillRegion } from '../src/digitize/fill';
import { sewObjects } from '../src/model/objects';
import { analyze, measureFill, shapeTrust } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { rasterize } from '../src/shape/rasterize';
import { ellipsePath, parsePath } from '../src/shape/svgPath';
import { Writer } from './helpers/designs';

/** A fill from elsewhere: rows of `spacing` to `spacingEnd` mm across an ellipse 24 by 30 mm, sewn in one go. */
function design(spacing: number, spacingEnd: number, angle = 0) {
  const r = rasterize(parsePath(ellipsePath(20, 20, 12, 15), [1, 0, 0, 1, 0, 0]), 0.1)!;
  const res = fillRegion(r, { spacing, spacingEnd, stitch: 3, angle, pull: 0, underlay: false }, [20, 5])!;
  const w = new Writer();
  res.runs.forEach((run, k) => run.forEach((q, j) => (k === 0 && j === 0 ? w.start(q) : w.to(q))));
  return { p: w.b.build('open', 'dst', [{ r: 40, g: 120, b: 190 }]), area: r.areaMm2 };
}

describe('fills read from their rows', () => {
  it('a gradient whose rows open up to 1 mm keeps its whole area and reads as a gradient', () => {
    const { p, area } = design(0.35, 1.0);
    const kinds = stitchKinds(p);
    const [o] = sewObjects(p, kinds);
    const a = analyze(p, o, kinds);
    expect(a.fill!.areaMm2).toBeGreaterThan(area * 0.85);
    expect(a.parts.filter((pt) => pt.kind === 'run').length).toBe(0);
    const s = measureFill(p, a);
    expect(s.pattern).toBe('gradient');
    expect(s.spacing).toBeCloseTo(0.35, 0);
    expect(s.spacingEnd).toBeGreaterThan(0.8);
    expect(shapeTrust(p, o, a, s.spacing)).toBe('good');
  });

  it('the gradient runs the way the rows open, also when sewn from the open side', () => {
    const { p } = design(1.0, 0.35);
    const kinds = stitchKinds(p);
    const [o] = sewObjects(p, kinds);
    const s = measureFill(p, analyze(p, o, kinds));
    expect(s.pattern).toBe('gradient');
    expect(s.spacing).toBeGreaterThan(0.8);
    expect(s.spacingEnd).toBeLessThan(0.5);
  });

  it('a light fill with rows 1.2 mm apart is one area, an even fill stays tatami', () => {
    const { p, area } = design(1.2, 1.2, 30);
    const kinds = stitchKinds(p);
    const [o] = sewObjects(p, kinds);
    const a = analyze(p, o, kinds);
    expect(a.fill!.areaMm2).toBeGreaterThan(area * 0.8);
    expect(measureFill(p, a).pattern).not.toBe('gradient');
  });
});
