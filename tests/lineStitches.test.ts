import { describe, expect, it } from 'vitest';
import { borderStitches, sewAlong, type PathStitch } from '../src/model/along';
import { lineStitches, resewLine } from '../src/model/line';
import { reverseLines, reversedForm } from '../src/model/reverse';
import { STITCH, type Pattern } from '../src/model/pattern';
import { addShape } from '../src/model/addShape';
import { sewObjects } from '../src/model/objects';
import { isLineStitch, remembered } from '../src/model/restitch';
import { digitizeDefaults } from '../src/digitize/digitize';
import { sample } from '../src/digitize/region';
import { regionOf } from '../src/shape/rasterize';
import { parsePath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import type { Pt } from '../src/digitize/skeleton';
import type { Mat } from '../src/shape/path';

const ID: Mat = [1, 0, 0, 1, 0, 0];
/** A straight line 30 mm to the right (y grows downward, as on screen). */
const straight = parsePath('M0 0 L30 0', ID);
const flat = (runs: Pt[][]) => runs.flat();
const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

describe('line stitches', () => {
  it('sew a bean stitch three or five times over each stitch', () => {
    const run = flat(lineStitches(straight, { type: 'run', width: 2, length: 2.5 })).length;
    const three = flat(lineStitches(straight, { type: 'triple', width: 2, length: 2.5 }));
    const five = flat(lineStitches(straight, { type: 'triple', width: 2, length: 2.5, repeat: 5 }));
    expect(three.length).toBe((run - 1) * 3 + 1);
    expect(five.length).toBe((run - 1) * 5 + 1);
    // Back and forth over the same holes, then on.
    expect(near(five[1], five[3]) && near(five[0], five[2]) && near(five[1], five[5])).toBe(true);
    expect(five.every(([, y]) => Math.abs(y) < 1e-6)).toBe(true);
  });

  it('sew an open zigzag across the line, without underlay', () => {
    const pts = flat(lineStitches(straight, { type: 'zigzag', width: 2 }));
    // Every point on one of the two sides, alternating, 1.5 mm apart on one side.
    expect(pts.every(([, y]) => Math.abs(Math.abs(y) - 1) < 0.05)).toBe(true);
    for (let i = 1; i < pts.length; i++) expect(Math.sign(pts[i][1])).toBe(-Math.sign(pts[i - 1][1]));
    expect(pts.length).toBeGreaterThan(30 / 1.5 * 2 - 4);
    expect(pts.length).toBeLessThan(30 / 1.5 * 2 + 4);
    // A wider spacing is more open.
    expect(flat(lineStitches(straight, { type: 'zigzag', width: 2, spacing: 3 })).length).toBeLessThan(pts.length * 0.6);
  });

  it('sew an E stitch with its edge on the line and its prongs to the right', () => {
    const st: PathStitch = { type: 'e', width: 2 };
    const pts = flat(lineStitches(straight, st));
    expect(pts.every(([, y]) => y > -0.05 && y < 2.05)).toBe(true);
    const prongs = pts.filter(([, y]) => y > 1.9).length;
    expect(prongs).toBeGreaterThan(30 / 2.5 - 2);
    expect(pts.filter(([, y]) => Math.abs(y) < 0.05).length).toBeGreaterThan(prongs);
    // The other side with flip; sewn the other way round, still on the side of the drawn line.
    expect(flat(lineStitches(straight, { ...st, flip: true })).every(([, y]) => y < 0.05)).toBe(true);
    expect(flat(lineStitches(straight, st, true)).every(([, y]) => y > -0.05)).toBe(true);
    expect(flat(sewAlong([[0, 0], [30, 0]], false, st, [30, 0])).every(([, y]) => y > -0.05)).toBe(true);
  });

  it('are kept with the line and read back from a project', () => {
    const options = digitizeDefaults(DEFAULT_PROFILE);
    const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;
    const a = addShape(empty, { form: straight, kind: 'stroke', width: 0.4 }, { r: 200, g: 30, b: 30 }, null, options)!;
    for (const st of [{ type: 'e', width: 2.5, flip: true, spacing: 3 }, { type: 'zigzag', width: 1.5 }, { type: 'triple', width: 2, repeat: 5 }] as PathStitch[]) {
      const r = resewLine(a.pattern, 0, straight, st, 7)!;
      const [o] = sewObjects(r.pattern);
      expect(remembered(r.pattern, o)?.line).toEqual(st);
      expect(o.kind).toBe(st.type === 'triple' ? 'run' : 'satin');
      expect(isLineStitch(st)).toBe(true);
    }
    expect(isLineStitch({ type: 'e', width: 2, flip: 'yes' })).toBe(false);
  });
});

describe('E stitch as a border', () => {
  const W = 300;
  const mask = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) mask[y * W + x] = Math.hypot((x + 0.5) * 0.1 - 15, (y + 0.5) * 0.1 - 15) < 9 ? 1 : 0;
  const disk = regionOf(mask, 0, 0, W, W, 0.1)!;
  const depth = (runs: Pt[][]) => flat(runs).map(([x, y]) => sample(disk, disk.sdfBase, x, y));

  it('reaches inside onto the area, or outside with flip', () => {
    const inward = depth(borderStitches(disk, { type: 'e', width: 2 }, [15, 5]));
    expect(Math.min(...inward)).toBeLessThan(-1.7);
    expect(Math.max(...inward)).toBeLessThan(0.2);
    const outward = depth(borderStitches(disk, { type: 'e', width: 2, flip: true }, [15, 5]));
    expect(Math.max(...outward)).toBeGreaterThan(1.7);
    expect(Math.min(...outward)).toBeGreaterThan(-0.2);
  });
});

describe('motif stitch', () => {
  const motifs = ['waves', 'scallops', 'hearts', 'chain'] as const;
  const seg = (pts: Pt[]) => pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));

  for (const motif of motifs) {
    it(`sews ${motif} as one run within its size, without too short or long stitches`, () => {
      const runs = lineStitches(straight, { type: 'motif', motif, width: 3 });
      expect(runs.length).toBe(1);
      const pts = runs[0];
      expect(pts.length).toBeGreaterThan(20);
      expect(pts.every(([x, y]) => Math.abs(y) <= 3.05 && x > -1.6 && x < 31.6)).toBe(true);
      const lens = seg(pts);
      expect(Math.min(...lens.slice(1, -1))).toBeGreaterThanOrEqual(0.6 - 1e-6);
      expect(Math.max(...lens)).toBeLessThanOrEqual(2.5 + 1e-6);
      // It runs from one end of the line to the other.
      expect(Math.hypot(pts[0][0], pts[0][1])).toBeLessThan(0.1);
      expect(Math.hypot(pts[pts.length - 1][0] - 30, pts[pts.length - 1][1])).toBeLessThan(3.1);
    });
  }

  it('puts scallops and hearts on the right of the line, on the left with flip', () => {
    // A heart hangs from the line by its notch: its lobes reach a third of its size over it.
    for (const [motif, over] of [['scallops', 0.1], ['hearts', 1.05]] as const) {
      expect(flat(lineStitches(straight, { type: 'motif', motif, width: 3 })).every(([, y]) => y > -over)).toBe(true);
      expect(Math.max(...flat(lineStitches(straight, { type: 'motif', motif, width: 3 })).map(([, y]) => y))).toBeGreaterThan(2.9);
      expect(flat(lineStitches(straight, { type: 'motif', motif, width: 3, flip: true })).every(([, y]) => y < over)).toBe(true);
      // Sewn the other way round, still on the right of the drawn line.
      expect(flat(lineStitches(straight, { type: 'motif', motif, width: 3 }, true)).every(([, y]) => y > -over)).toBe(true);
    }
  });

  it('fits a whole number of figures and repeats each stitch when asked', () => {
    // Waves 5 mm apart on 30 mm: six full waves, crossing the line twice each.
    const pts = flat(lineStitches(straight, { type: 'motif', motif: 'waves', width: 3 }));
    let cross = 0;
    for (let i = 1; i < pts.length; i++) if (Math.sign(pts[i][1]) !== Math.sign(pts[i - 1][1]) && Math.abs(pts[i][1]) > 0.05) cross++;
    expect(cross).toBeGreaterThanOrEqual(10);
    expect(cross).toBeLessThanOrEqual(13);
    const three = flat(lineStitches(straight, { type: 'motif', motif: 'waves', width: 3, repeat: 3 }));
    expect(three.length).toBe((pts.length - 1) * 3 + 1);
  });

  it('is an object of the kind running stitch, kept with the line', () => {
    const options = digitizeDefaults(DEFAULT_PROFILE);
    const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;
    const a = addShape(empty, { form: straight, kind: 'stroke', width: 0.4 }, { r: 200, g: 30, b: 30 }, null, options)!;
    const st: PathStitch = { type: 'motif', motif: 'hearts', width: 4, spacing: 10 };
    const r = resewLine(a.pattern, 0, straight, st, 7)!;
    const [o] = sewObjects(r.pattern);
    expect(remembered(r.pattern, o)?.line).toEqual(st);
    expect(isLineStitch({ type: 'motif', motif: 'stars', width: 3 })).toBe(false);
  });
});

describe('motif as a border', () => {
  const W = 300;
  const mask = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) mask[y * W + x] = Math.hypot((x + 0.5) * 0.1 - 15, (y + 0.5) * 0.1 - 15) < 9 ? 1 : 0;
  const disk = regionOf(mask, 0, 0, W, W, 0.1)!;
  const depth = (runs: Pt[][]) => flat(runs).map(([x, y]) => sample(disk, disk.sdfBase, x, y));

  it('puts hearts inside onto the area, or outside with flip', () => {
    const inward = depth(borderStitches(disk, { type: 'motif', motif: 'hearts', width: 2.5 }, [15, 5]));
    expect(Math.min(...inward)).toBeLessThan(-1.7);
    expect(Math.max(...inward)).toBeLessThan(1);
    const outward = depth(borderStitches(disk, { type: 'motif', motif: 'hearts', width: 2.5, flip: true }, [15, 5]));
    expect(Math.max(...outward)).toBeGreaterThan(1.7);
    expect(Math.min(...outward)).toBeGreaterThan(-1);
  });
});

describe('lines sewn from their other end', () => {
  const options = digitizeDefaults(DEFAULT_PROFILE);
  const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;
  const stitched = (p: Pattern) => {
    const [o] = sewObjects(p);
    const out: Pt[] = [];
    for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) out.push([p.x[i] / 10, p.y[i] / 10]);
    return out;
  };

  for (const st of [{ type: 'run', width: 2 }, { type: 'motif', motif: 'hearts', width: 3 }, { type: 'e', width: 2 }] as PathStitch[]) {
    it(`start at the other end and keep their side (${st.type})`, () => {
      const a = addShape(empty, { form: straight, kind: 'stroke', width: 0.4 }, { r: 200, g: 30, b: 30 }, null, options)!;
      const p = resewLine(a.pattern, 0, straight, st, 7)!.pattern;
      expect(stitched(p)[0][0]).toBeLessThan(1);
      const r = reverseLines(p, [0], 7);
      expect(r.failed).toEqual([]);
      const pts = stitched(r.pattern);
      expect(pts[0][0]).toBeGreaterThan(28);
      expect(pts[pts.length - 1][0]).toBeLessThan(2);
      // Hearts and prongs stay below the line (y down), as before.
      if (st.type !== 'run') expect(Math.max(...pts.map(([, y]) => y))).toBeGreaterThan(1.9);
      if (st.type !== 'run') expect(Math.min(...pts.map(([, y]) => y))).toBeGreaterThan(-1.1);
      // It remembers the turned curve: settings changed later keep the direction.
      const [o] = sewObjects(r.pattern);
      const known = remembered(r.pattern, o)!;
      const again = resewLine(r.pattern, 0, known.path!, known.line!, 7)!;
      expect(stitched(again.pattern)[0][0]).toBeGreaterThan(28);
      // Twice turned is as before.
      expect(stitched(reverseLines(r.pattern, [0], 7).pattern)[0][0]).toBeLessThan(1);
    });
  }

  it('turns a closed curve around without moving its start', () => {
    const ring = parsePath('M0 0 L10 0 L10 10 L0 10 Z', ID);
    const back = reversedForm(ring);
    expect(back.paths[0].nodes[0].p).toEqual(ring.paths[0].nodes[0].p);
    expect(back.paths[0].nodes[1].p).toEqual([0, 10]);
  });
});
