import { beforeAll, describe, expect, it } from 'vitest';
import { areaOfForm, loadOps, offsetForm, subtractForm, unionForms } from '../src/shape/ops';
import { bezier, segment, segments, type Form, type Mat } from '../src/shape/path';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const rect = (x: number, y: number, w: number, h: number) => parsePath(rectPath(x, y, w, h, 0, 0), ID);
const disc = (cx: number, cy: number, r: number) => parsePath(ellipsePath(cx, cy, r, r), ID);

beforeAll(loadOps);

/** Points along all curves of a form. */
function along(f: Form, per = 40): [number, number][] {
  return f.paths.flatMap((p) => Array.from({ length: segments(p) }, (_, k) => Array.from({ length: per }, (_, i) => bezier(segment(p, k), i / per))).flat());
}

describe('shape operations on curves', () => {
  it('joins overlapping areas exactly and keeps their nodes', () => {
    const a = rect(0, 0, 10, 10);
    const b = disc(10, 5, 4);
    const u = unionForms([a, b])!;
    expect(u.paths).toHaveLength(1);
    // Square plus the half disc outside it.
    expect(areaOfForm(u)).toBeCloseTo(100 + areaOfForm(b) / 2, 6);
    // The square's corners and the disc's outer node are nodes of the result, unchanged.
    const at = new Set(u.paths[0].nodes.map((n) => `${n.p[0]},${n.p[1]}`));
    for (const q of ['0,0', '0,10', '14,5']) expect(at.has(q), q).toBe(true);
    // The disc's nodes stay smooth, the square's corners stay corners.
    expect(u.paths[0].nodes.find((n) => n.p[0] === 14)!.smooth).toBe(true);
    expect(u.paths[0].nodes.find((n) => n.p[0] === 0 && n.p[1] === 0)!.smooth).toBe(false);
  });

  it('keeps apart areas apart and fills holes by their rule', () => {
    const u = unionForms([rect(0, 0, 5, 5), rect(10, 0, 5, 5)])!;
    expect(u.paths).toHaveLength(2);
    expect(areaOfForm(u)).toBeCloseTo(50, 6);
    const ring: Form = { paths: [...rect(0, 0, 20, 20).paths, ...rect(5, 5, 10, 10).paths] };
    expect(areaOfForm(ring)).toBeCloseTo(300, 6);
    // A square over the hole closes it.
    expect(areaOfForm(unionForms([ring, rect(4, 4, 12, 12)])!)).toBeCloseTo(400, 6);
  });

  it('cuts one area out of another on its curve', () => {
    const left = subtractForm(rect(0, 0, 20, 20), disc(20, 10, 6))!;
    // (A disc of four curves is 0.03 % more than a circle.)
    expect(areaOfForm(left)).toBeCloseTo(400 - areaOfForm(disc(20, 10, 6)) / 2, 6);
    // Every point of the result is outside the disc (or on its edge).
    for (const [x, y] of along(left)) expect(Math.hypot(x - 20, y - 10)).toBeGreaterThan(6 - 1e-6);
    // Covered completely: nothing left.
    expect(subtractForm(disc(5, 5, 2), rect(0, 0, 10, 10))).toBeNull();
    // Apart: unchanged.
    expect(areaOfForm(subtractForm(rect(0, 0, 5, 5), rect(10, 0, 5, 5))!)).toBeCloseTo(25, 6);
  });

  it('grows and shrinks an area by a distance, round at corners', () => {
    const sq = rect(0, 0, 10, 10);
    const g = offsetForm(sq, 2)!;
    // Square plus four sides plus a full circle of the corners.
    expect(areaOfForm(g)).toBeCloseTo(100 + 4 * 20 + Math.PI * 4, 1);
    const shrunk = offsetForm(sq, -2)!;
    expect(areaOfForm(shrunk)).toBeCloseTo(36, 1);
    expect(offsetForm(sq, -6)).toBeNull();
    // A disc stays a disc: every point within 0.05 mm of the new radius.
    const d = offsetForm(disc(0, 0, 5), 3)!;
    for (const [x, y] of along(d)) expect(Math.abs(Math.hypot(x, y) - 8)).toBeLessThan(0.05);
  });

  it('grows the holes of an area inward', () => {
    const ring: Form = { paths: [...rect(0, 0, 20, 20).paths, ...rect(5, 5, 10, 10).paths] };
    const g = offsetForm(ring, 1)!;
    // Outer 22x22 with round corners, hole 8x8 (its corners stay sharp).
    expect(areaOfForm(g)).toBeCloseTo(484 - (4 - Math.PI) - 64, 1);
  });

  it('turns a line into a band', () => {
    const line: Form = { paths: [{ closed: false, nodes: [{ p: [0, 0], a: [0, 0], b: [0, 0], smooth: false }, { p: [10, 0], a: [10, 0], b: [10, 0], smooth: false }] }] };
    const band = offsetForm(line, 1, 0.4)!;
    // 10 long, 2.4 wide, with round ends.
    expect(areaOfForm(band)).toBeCloseTo(10 * 2.4 + Math.PI * 1.2 * 1.2, 1);
  });
});
