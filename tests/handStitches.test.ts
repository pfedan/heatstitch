import { describe, expect, it } from 'vitest';
import { HAND_STITCHES, HAND_WIDTH, MOTIF_PERIOD, motifStitches, type HandStitch } from '../src/digitize/motif';
import { lineStitches, resewLine } from '../src/model/line';
import { borderStitches, layersOf, passesOf, timesOf, type PathStitch } from '../src/model/along';
import { addShape } from '../src/model/addShape';
import { sewObjects } from '../src/model/objects';
import { remembered } from '../src/model/restitch';
import { digitizeDefaults } from '../src/digitize/digitize';
import { sample } from '../src/digitize/region';
import { regionOf } from '../src/shape/rasterize';
import { parsePath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { validatePattern } from '../src/validation/validate';
import { CRITICAL } from '../src/validation/thresholds';
import type { Pt } from '../src/digitize/skeleton';
import type { Mat } from '../src/shape/path';

/**
 * Hand stitches (stem, feather, Cretan, chevron) as motifs of a line: their stitches lie in
 * bundles, whole figures fit the line and each piece between its corners, and the bundles do not
 * make the density check critical.
 */

const ID: Mat = [1, 0, 0, 1, 0, 0];
const straight = parsePath('M0 0 L30 0', ID);
const flat = (runs: Pt[][]) => runs.flat();
const seg = (pts: Pt[]) => pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
const line = (motif: HandStitch, more: Partial<PathStitch> = {}): PathStitch => ({ type: 'motif', motif, width: HAND_WIDTH[motif], ...more });
const key = (p: Pt) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;

describe('hand stitches', () => {
  for (const motif of HAND_STITCHES) {
    it(`sews ${motif} in one run within its width, from one end of the line to the other`, () => {
      const runs = lineStitches(straight, line(motif));
      expect(runs.length).toBe(1);
      const pts = runs[0];
      const w = HAND_WIDTH[motif];
      expect(pts.every(([x, y]) => Math.abs(y) <= w / 2 + 0.01 && x > -0.01 && x < 30.01)).toBe(true);
      // Both sides of the line reached, and both ends.
      expect(Math.max(...pts.map(([, y]) => y))).toBeGreaterThan(w / 2 - 0.01);
      expect(Math.min(...pts.map(([, y]) => y))).toBeLessThan(-w / 2 + 0.01);
      expect(Math.min(...pts.map(([x]) => x))).toBeLessThan(0.01);
      expect(Math.max(...pts.map(([x]) => x))).toBeGreaterThan(29.99);
      // Stitches no longer than a hand stitch's longest, none a mere dot.
      const lens = seg(pts).filter((l) => l > 1e-9);
      expect(Math.max(...lens)).toBeLessThanOrEqual(4.5 + 1e-6);
      expect(Math.min(...lens)).toBeGreaterThan(0.45);
    });

    it(`sews each stitch of ${motif} three times by default, once or five times when asked`, () => {
      // Over the same two holes: count the stitches between each pair of holes.
      const most = (st: PathStitch) => {
        const pts = flat(lineStitches(straight, st));
        const n = new Map<string, number>();
        for (let i = 1; i < pts.length; i++) {
          const k = [key(pts[i - 1]), key(pts[i])].sort().join('|');
          n.set(k, (n.get(k) ?? 0) + 1);
        }
        return Math.max(...n.values());
      };
      // Feather arms, Cretan spurs and chevron bars go out and back: twice at least.
      const twice = motif !== 'stem';
      expect(most(line(motif))).toBe(3);
      expect(most(line(motif, { repeat: 1 }))).toBe(twice ? 2 : 1);
      expect(most(line(motif, { repeat: 5 }))).toBe(5);
    });
  }

  it('keeps the repeat for the bundles, never on top of them', () => {
    const st = line('stem', { repeat: 5 });
    expect(layersOf(st)).toBe(5);
    expect(timesOf(st)).toBe(1);
    expect(passesOf(st)).toBe(1);
    expect(layersOf(line('stem'))).toBe(3);
    // Also when the repeat was set as the whole line before (a figure motif's setting kept).
    expect(passesOf(line('feather', { repeat: 3, whole: true }))).toBe(1);
  });

  it('fits whole figures: a stem stitch ends where the line ends, a chevron bar too', () => {
    // 31 mm at 2 mm: 16 steps, 15 stitches each two steps long.
    const l: Pt[] = [[0, 0], [31, 0]];
    const stem = motifStitches(l, false, 'stem', 1.4, MOTIF_PERIOD.stem, 1, 0, 1, 1);
    expect(stem.length).toBe(15 * 2);
    expect(stem[stem.length - 1][0]).toBeCloseTo(31, 6);
    const chevron = motifStitches(l, false, 'chevron', 4, 3, 1, 0, 1, 1);
    expect(Math.min(...chevron.map(([x]) => x))).toBeCloseTo(0, 6);
    expect(Math.max(...chevron.map(([x]) => x))).toBeCloseTo(31, 6);
  });

  it('starts the figures afresh at a corner, a whole number on each side of it', () => {
    // An L of two legs, 20 and 13 mm: feather V's of about 3 mm on each, a bottom on the corner.
    const l: Pt[] = [[0, 0], [20, 0], [20, 13]];
    const pts = motifStitches(l, false, 'feather', 5, 3, 1, 0, 1, 1);
    const near = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.2;
    // The corner gets a bottom of a V (a sixth of the width beside it), not a stitch across it.
    expect(pts.some((p) => near(p, [20, 0]))).toBe(true);
    // Nothing lies far outside the L's band.
    expect(pts.every(([x, y]) => x > -0.1 && x < 22.6 && y > -2.6 && y < 13.1)).toBe(true);
  });

  it('alternates all round a closed line: an even number of figures', () => {
    const circle: Pt[] = [];
    for (let i = 0; i <= 200; i++) circle.push([10 * Math.cos((2 * Math.PI * i) / 200), 10 * Math.sin((2 * Math.PI * i) / 200)]);
    for (const motif of ['feather', 'cretan', 'chevron'] as const) {
      const pts = motifStitches(circle, true, motif, 4, 3.3, 1, 0, 1, 1);
      // Back where it started.
      expect(Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1])).toBeLessThan(1e-6);
      // Points on the outer side and on the inner side alike.
      const r = pts.map(([x, y]) => Math.hypot(x, y));
      expect(r.filter((v) => v > 11.9).length).toBeGreaterThan(5);
      expect(r.filter((v) => v < 8.1).length).toBeGreaterThan(5);
    }
  });

  it('goes along a fill border, inside the area width', () => {
    const W = 300;
    const mask = new Uint8Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) mask[y * W + x] = Math.hypot((x + 0.5) * 0.1 - 15, (y + 0.5) * 0.1 - 15) < 9 ? 1 : 0;
    const disk = regionOf(mask, 0, 0, W, W, 0.1)!;
    const d = flat(borderStitches(disk, line('cretan', { width: 3 }), [15, 5])).map(([x, y]) => sample(disk, disk.sdfBase, x, y));
    expect(Math.max(...d.map(Math.abs))).toBeLessThan(1.8);
  });

  it('is remembered with the line and makes no critical density, also five times over', () => {
    const options = digitizeDefaults(DEFAULT_PROFILE);
    const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;
    // A curve with a tight bend and a corner, where bundles crowd most.
    const curve = parsePath('M0 0 C 15 -20, 30 20, 45 0 L 45 25 C 35 35, 25 15, 15 30', ID);
    for (const motif of HAND_STITCHES) {
      for (const repeat of [undefined, 5]) {
        for (const width of [1, HAND_WIDTH[motif]]) {
          const a = addShape(empty, { form: curve, kind: 'stroke', width: 0.4 }, { r: 200, g: 30, b: 30 }, null, options)!;
          const st = line(motif, { width, ...(repeat ? { repeat } : {}) });
          const r = resewLine(a.pattern, 0, curve, st, 7)!;
          const [o] = sewObjects(r.pattern);
          expect(remembered(r.pattern, o)?.line).toEqual(st);
          const v = validatePattern(r.pattern, DEFAULT_PROFILE);
          expect(v.worst, `${motif} ${width} mm ${repeat ?? 3}×`).toBeLessThan(CRITICAL);
        }
      }
    }
  });
});
