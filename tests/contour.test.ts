import { beforeAll, describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import type { Pt } from '../src/digitize/skeleton';
import { addShape } from '../src/model/addShape';
import { addContour, behindCovered, contourAt, contourSource, gapAt } from '../src/model/contour';
import { lineToFill } from '../src/model/line';
import { geoUse } from '../src/model/geo';
import { sewObjects } from '../src/model/objects';
import type { Pattern } from '../src/model/pattern';
import { remembered } from '../src/model/restitch';
import { loadOps } from '../src/shape/ops';
import { flatten, type Form, type Mat } from '../src/shape/path';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';

const ID: Mat = [1, 0, 0, 1, 0, 0];
beforeAll(loadOps);
const options = digitizeDefaults(DEFAULT_PROFILE);
const green = { r: 60, g: 170, b: 70 };
const red = { r: 200, g: 30, b: 30 };
const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;

const rect = (x: number, y: number, w: number, h: number) => parsePath(rectPath(x, y, w, h, 0, 0), ID);
const pointsOf = (f: Form): Pt[] => f.paths.flatMap((p) => flatten(p, 0.05));

/** Distance of `q` to the rectangle (0 inside). */
const toRect = (q: Pt, x: number, y: number, w: number, h: number) => Math.hypot(Math.max(x - q[0], 0, q[0] - x - w), Math.max(y - q[1], 0, q[1] - y - h));

/** Distance of `q` to the segment a-b. */
function toSegment(q: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
}

/** A green 30 x 20 mm rectangle and a red disc (r 6) beside it. */
function design(): Pattern {
  const p = addShape(empty, { form: rect(0, 0, 30, 20), kind: 'fill' }, green, null, options)!.pattern;
  return addShape(p, { form: parsePath(ellipsePath(50, 10, 6, 6), ID), kind: 'fill' }, red, 0, options)!.pattern;
}

describe('Kontur drumherum', () => {
  it('lies the distance around a fill, measured independently of the code', () => {
    const p = design();
    for (const d of [2, 0.5, 6, -2]) {
      const s = contourSource(p, [0])!;
      const f = contourAt(s.source, d)!;
      expect(f.paths).toHaveLength(1);
      for (const q of pointsOf(f)) {
        // Inside, the distance to the nearest side.
        const want = d >= 0 ? toRect(q, 0, 0, 30, 20) : -Math.min(q[0], 30 - q[0], q[1], 20 - q[1]);
        expect(Math.abs(want - d)).toBeLessThan(0.05);
      }
    }
  });

  it('goes round a line with the width it is sewn in', () => {
    for (const width of [0, 3]) {
      const p = addShape(empty, { form: parsePath('M0 0 L40 0', ID), kind: 'stroke', width }, red, null, options)!.pattern;
      const f = contourAt(contourSource(p, [0])!.source, 2)!;
      // Running stitch counts as a thread 0.4 mm wide.
      const reach = 2 + Math.max(0.4, width) / 2;
      for (const q of pointsOf(f)) expect(Math.abs(toSegment(q, [0, 0], [40, 0]) - reach)).toBeLessThan(0.05);
    }
  });

  it('goes round a closed line as a ring, not as a filled area', () => {
    const p = addShape(empty, { form: parsePath(ellipsePath(0, 0, 10, 10), ID), kind: 'stroke', width: 0 }, red, null, options)!.pattern;
    const f = contourAt(contourSource(p, [0])!.source, 1)!;
    // Outside and inside the ring.
    expect(f.paths).toHaveLength(2);
    const radii = f.paths.map((path) => Math.hypot(...flatten(path, 0.1)[0]));
    expect(radii.sort((a, b) => a - b).map((r) => Math.round(r * 10) / 10)).toEqual([8.8, 11.2]);
  });

  it('keeps the hole of a ring-shaped fill', () => {
    const ring = parsePath(`${ellipsePath(0, 0, 12, 12)} ${ellipsePath(0, 0, 6, 6)}`, ID);
    const p = addShape(empty, { form: ring, kind: 'fill' }, green, null, options)!.pattern;
    const f = contourAt(contourSource(p, [0])!.source, 2)!;
    const radii = f.paths.map((path) => Math.hypot(...flatten(path, 0.1)[0]));
    expect(radii.sort((a, b) => a - b).map((r) => Math.round(r * 10) / 10)).toEqual([4, 14]);
  });

  it('leaves out holes too small to sew round', () => {
    const ring = parsePath(`${ellipsePath(0, 0, 12, 12)} ${ellipsePath(0, 0, 3.5, 3.5)}`, ID);
    const p = addShape(empty, { form: ring, kind: 'fill' }, green, null, options)!.pattern;
    // The hole is 1.5 mm across at 2 mm (7 mm²): only the outline is left.
    expect(contourAt(contourSource(p, [0])!.source, 2)!.paths).toHaveLength(1);
    expect(contourAt(contourSource(p, [0])!.source, 1)!.paths).toHaveLength(2);
  });

  it('is one line around several objects, in the thread of the first, after the last', () => {
    const p = design();
    const r = addContour(p, [0, 1], 2, options)!;
    expect(r.missing).toBe(0);
    const objs = sewObjects(r.pattern);
    expect(objs).toHaveLength(3);
    expect(r.index).toBe(2);
    const c = objs[r.index];
    expect(c.color).toMatchObject(green);
    const m = remembered(r.pattern, c)!;
    expect(geoUse(m)).toBe('line');
    expect(m.line?.type).toBe('run');
    // Rectangle and disc lie 14 mm apart: two rings at 2 mm.
    expect(m.geo!.paths).toHaveLength(2);
    // Far enough apart that they meet once they are grown by half their gap.
    expect(contourAt(r.source, 7.5)!.paths).toHaveLength(1);
  });

  it('comes right after the last selected object', () => {
    const p = design();
    const r = addContour(p, [0], 2, options)!;
    expect(r.index).toBe(1);
    expect(sewObjects(r.pattern)[2].color).toMatchObject(red);
  });

  it('is nothing when the distance inside leaves nothing', () => {
    expect(addContour(design(), [0], -11, options)).toBeNull();
  });

  it('reads the distance at a point', () => {
    const s = contourSource(design(), [0])!.source;
    expect(gapAt(s, [35, 10])).toBeCloseTo(5, 2);
    expect(gapAt(s, [15, 3])).toBeCloseTo(-3, 2);
    expect(gapAt(s, [33, 24])).toBeCloseTo(5, 2);
  });

  it('moves before the motif it encloses, to be filled as its ground', () => {
    const p = design();
    const r = addContour(p, [0, 1], 9, options)!;
    // One ring around both now: it encloses them.
    expect(remembered(r.pattern, sewObjects(r.pattern)[r.index])!.geo!.paths).toHaveLength(1);
    const id = sewObjects(r.pattern)[r.index].id;
    const b = behindCovered(r.pattern, r.index, options.trimMm)!;
    expect(b.covered).toBe(2);
    expect(b.index).toBe(0);
    const objs = sewObjects(b.pattern);
    expect(objs[0].id).toBe(id);
    expect(objs.map((o) => o.color.r)).toEqual([green.r, green.r, red.r]);
    const f = lineToFill(b.pattern, b.index, { pattern: 'tatami', spacing: 0.4, offset: 0.25, angle: NaN, stitch: 3.5, underlay: true, edge: 0, tolerance: 0.1 } as never, options.trimMm)!;
    expect(f.pattern).toBeTruthy();
    // A contour around only part of the design stays where it is.
    const c = addContour(p, [0], 2, options)!;
    expect(behindCovered(c.pattern, c.index, options.trimMm)!.covered).toBe(1);
    const d = addContour(p, [1], 2, options)!;
    expect(behindCovered(d.pattern, d.index, options.trimMm)!.index).toBe(1);
  });
});
