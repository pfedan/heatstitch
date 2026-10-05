import { describe, expect, it } from 'vitest';
import { digitizeDefaults, digitizeShapes, type ShapeInput } from '../src/digitize/digitize';
import type { Pt } from '../src/digitize/skeleton';
import { sewObjects } from '../src/model/objects';
import { forget, keepShape, remembered, rememberShapes, restitch } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { flatten, type Mat } from '../src/shape/path';
import { parsePath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';

// The u of a logo set in a sans serif font (glyph outline, font units, y up).
const U = 'M392 0V69H390Q381 52 366.5 37.0Q352 22 332.5 11.0Q313 0 289.5 -7.0Q266 -14 240 -14Q190 -14 155.5 4.0Q121 22 99.5 50.5Q78 79 68.5 115.5Q59 152 59 190V498H224V228Q224 207 227.0 188.0Q230 169 238.5 154.0Q247 139 261.0 130.5Q275 122 298 122Q341 122 363.5 154.0Q386 186 386 229V498H550V0Z';

const near = (q: Pt, line: Pt[]) => {
  let best = Infinity;
  for (let k = 1; k < line.length; k++) {
    const [a, b] = [line[k - 1], line[k]];
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const l2 = vx * vx + vy * vy;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / l2)) : 0;
    best = Math.min(best, Math.hypot(q[0] - a[0] - vx * t, q[1] - a[1] - vy * t));
  }
  return best;
};

const form = (s: number) => parsePath(U, [s, 0, 0, -s, 0, 520 * s] as Mat);
const off = (cols: { left: Pt[]; right: Pt[] }[][], edge: Pt[][]) => Math.max(...cols.flat().flatMap((c) => [...c.left, ...c.right]).map((q) => Math.min(...edge.map((l) => near(q, l)))));
const SATIN = { spacing: 0.4, edge: 0.2, short: true, underlay: true, tolerance: 0.15 };

/** The u digitized as the import does it, with what it remembers. */
function imported(s: number) {
  const shapes: ShapeInput[] = [{ color: 0, kind: 'fill', form: form(s) }];
  const d = digitizeShapes(shapes, [{ r: 40, g: 180, b: 120 }], digitizeDefaults(DEFAULT_PROFILE), { w: 10, h: 10 }, false);
  const p = d.pattern;
  const objs = sewObjects(p, stitchKinds(p));
  rememberShapes(p, objs, d.starts, d.objects.map((o) => o.shape), d.objects);
  const edge = d.objects[0].form!.paths.map((x) => flatten(x, 0.05));
  return { d, p, objs, o: objs[0], edge };
}

/** Penetrations nearer the other rail than the line between their neighbours by about a short stitch (15 % of the width). */
function dents(cols: { left: Pt[]; right: Pt[] }[][]): number {
  const one = (rail: Pt[], other: Pt[]) => {
    let n = 0;
    for (let i = 1; i + 1 < rail.length; i++) {
      const m: Pt = [(rail[i - 1][0] + rail[i + 1][0]) / 2, (rail[i - 1][1] + rail[i + 1][1]) / 2];
      const w = Math.hypot(m[0] - other[i][0], m[1] - other[i][1]);
      if (w - Math.hypot(rail[i][0] - other[i][0], rail[i][1] - other[i][1]) > Math.max(0.15, w * 0.13)) n++;
    }
    return n;
  };
  return cols.flat().reduce((a, c) => a + one(c.left, c.right) + one(c.right, c.left), 0);
}

describe('satin from a vector file', () => {
  it('keeps its shape from the import, its rails lying on its edge', () => {
    const { d, p, objs, o, edge } = imported(0.014);
    expect(d.objects[0].kind).toBe('satin');
    try {
      expect(remembered(p, o)?.form).toBeTruthy();
      const cols = keepShape(p, o, stitchKinds(p)).columns!;
      expect(off(cols, edge)).toBeLessThan(0.05);
      // Sewn again: still a satin, the shape kept.
      const r = restitch(p, objs, [o.index], { kind: 'satin', s: SATIN }, stitchKinds(p), 2);
      expect(r.failed).toEqual([]);
      expect(r.memory[0].form).toBeTruthy();
      // Read from the stitches alone (a file from elsewhere): no dents of short stitches either.
      forget(p, o);
      expect(dents(keepShape(p, o, stitchKinds(p)).columns!)).toBe(0);
    } finally {
      forget(p, o);
    }
  });
});
