import { beforeAll, describe, expect, it } from 'vitest';
import { areaOfForm, gapAt, loadOps, type Obstacle } from '../src/shape/ops';
import { flatten, type Form } from '../src/shape/path';
import { ellipsePath, parsePath } from '../src/shape/svgPath';

const ID: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
const area = (d: string): Obstacle => ({ form: parsePath(d, ID), line: false, width: 0 });
const formOf = (r: ReturnType<typeof gapAt>): Form => {
  if (!('form' in r)) throw new Error(`no gap: ${r.none}`);
  return r.form;
};
const box = (f: Form) => {
  const pts = f.paths.flatMap((p) => flatten(p, 0.05));
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v * 100) / 100);
};

beforeAll(() => loadOps());

describe('gapAt (Flächen-Werkzeug)', () => {
  // A frame: a square with a square hole.
  const frame = area('M0 0 H40 V40 H0 Z M10 10 H30 V30 H10 Z');

  it('fills the hole of a frame up to its edge, or a gap away from it', () => {
    const f = formOf(gapAt([frame], [20, 20], 0, 'closed'));
    expect(box(f)).toEqual([10, 10, 30, 30]);
    expect(areaOfForm(f)).toBeCloseTo(400, 0);
    const g = formOf(gapAt([frame], [20, 20], 2, 'closed'));
    expect(box(g)).toEqual([12, 12, 28, 28]);
  });

  it('makes nothing outside every shape, nor on a shape', () => {
    expect(gapAt([frame], [60, 20], 0, 'closed')).toEqual({ none: 'outside' });
    expect(gapAt([frame], [5, 20], 0, 'closed')).toEqual({ none: 'covered' });
    // A gap closed up by a large distance.
    expect(gapAt([frame], [20, 20], 10, 'closed')).toEqual({ none: 'covered' });
  });

  it('finds the area shut in by several shapes together, and by lines as wide as their thread', () => {
    // Four bars around a square, touching at the corners.
    const bars = [area('M0 0 H40 V5 H0 Z'), area('M0 35 H40 V40 H0 Z'), area('M0 0 H5 V40 H0 Z'), area('M35 0 H40 V40 H35 Z')];
    expect(box(formOf(gapAt(bars, [20, 20], 0, 'closed')))).toEqual([5, 5, 35, 35]);
    // A coloring page: a circle drawn as a line 0.4 mm wide.
    const ring: Obstacle = { form: parsePath(ellipsePath(0, 0, 10, 10), ID), line: true, width: 0.4 };
    const disk = formOf(gapAt([ring], [0, 0], 0.5, 'closed'));
    expect(areaOfForm(disk)).toBeCloseTo(Math.PI * 9.3 * 9.3, 0);
    expect(gapAt([ring], [20, 0], 0.5, 'closed')).toEqual({ none: 'outside' });
  });

  it('with the convex hull bridges a bay straight, and outside the hull fills every gap in it', () => {
    // A C open to the right: no closed gap, but a bay.
    const c = area('M0 0 H30 V10 H10 V20 H30 V30 H0 Z');
    expect(gapAt([c], [20, 15], 0, 'closed')).toEqual({ none: 'outside' });
    const bay = formOf(gapAt([c], [20, 15], 0, 'hull'));
    expect(box(bay)).toEqual([10, 10, 30, 20]);
    expect(areaOfForm(bay)).toBeCloseTo(200, 0);
    // Two bays; a click beside the hull takes both as one form.
    const e = area('M0 0 H30 V5 H10 V12.5 H30 V17.5 H10 V25 H30 V30 H0 Z');
    const both = formOf(gapAt([e], [50, 15], 0, 'hull'));
    expect(both.paths).toHaveLength(2);
    expect(areaOfForm(both)).toBeCloseTo(2 * 20 * 7.5, 0);
  });
});
