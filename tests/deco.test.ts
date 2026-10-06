import { describe, expect, it } from 'vitest';
import { crossFill, embossPoints, gridFill, motifInside, mazeFill, meanderFill, motifCrossings, regionBox, type OpenParams } from '../src/digitize/deco';
import { digitizeDefaults } from '../src/digitize/digitize';
import { fillRegion } from '../src/digitize/fill';
import { buildRegion, sample, type Region } from '../src/digitize/region';
import type { Pt } from '../src/digitize/skeleton';
import { addShape } from '../src/model/addShape';
import { blendObject } from '../src/model/blend';
import { syncBorders } from '../src/model/border';
import { takeOver } from '../src/model/knockout';
import { sewObjects } from '../src/model/objects';
import { COLOR_CHANGE, STITCH, type Pattern } from '../src/model/pattern';
import { DECO_PATTERNS, OPEN_PATTERNS, openOnPurpose, remembered, restitch, restoreRemembered, rememberedIn, forgetAll, type FillSettings } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { deleteObjects, mirrorMatrix, recolorObjects } from '../src/model/shapeOps';
import { transformRemembered } from '../src/model/transform';
import { ellipsePath, parsePath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';

const PX = 0.1;

/** A region from a test on pixel centers (mm), in a 30 × 30 mm window. */
function region(inside: (x: number, y: number) => boolean): Region {
  const W = 300;
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

const disk = region((x, y) => Math.hypot(x - 15, y - 15) < 10);
const square = region((x, y) => x > 5 && x < 25 && y > 5 && y < 25);
const open: OpenParams = { size: 2.5, stitch: 2.5, seed: 1, triple: false };

const allPoints = (runs: Pt[][]) => runs.flat();

/** Whether segments ab and cd cross (touching ends do not count). */
function cross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
}

describe('embossing', () => {
  it('puts a needle point on every crossing of a motif line and keeps stitches short', () => {
    const row = { o: [0, 7.3] as Pt, e: [1, 0] as Pt };
    const cr = motifCrossings('diamonds', 10, row, 0, 40);
    expect(cr.length).toBeGreaterThan(4);
    const regular = Array.from({ length: 11 }, (_, i) => i * 4);
    const pts = embossPoints(cr, regular, 4, 0, 40);
    for (const c of cr) expect(pts.some((u) => Math.abs(u - c) < 1e-9 || Math.abs(u - c) < 0.6)).toBe(true);
    const all = [0, ...pts, 40];
    for (let i = 1; i < all.length; i++) expect(all[i] - all[i - 1]).toBeLessThanOrEqual(4 * 1.4 + 1e-9);
    for (let i = 1; i < pts.length; i++) expect(pts[i]).toBeGreaterThan(pts[i - 1]);
  });

  it('keeps the motifs upright in the design, whatever the row direction', () => {
    // A row at 0 and one at 180 degrees through the same line cross the motif at the same points.
    const a = motifCrossings('stars', 8, { o: [0, 5], e: [1, 0] }, 0, 40);
    const b = motifCrossings('stars', 8, { o: [40, 5], e: [-1, 0] }, 0, 40).map((u) => 40 - u).reverse();
    expect(a.length).toBeGreaterThan(2);
    a.forEach((u, i) => expect(b[i]).toBeCloseTo(u, 6));
  });

  it('knows what lies inside a motif', () => {
    // Size 10: a diamond per 10 x 18.8 mm tile, stars and hearts at a quarter and three quarters.
    expect(motifInside('diamonds', 10, [5, 9.4])).toBe(true);
    expect(motifInside('diamonds', 10, [1, 1])).toBe(false);
    expect(motifInside('diamonds', 10, [25, 9.4 + 18.8])).toBe(true);
    expect(motifInside('stars', 10, [2.5, 4.75])).toBe(true);
    expect(motifInside('stars', 10, [7.5, 4.75])).toBe(false);
    expect(motifInside('hearts', 10, [7.5, 14.25])).toBe(true);
    expect(motifInside('waves', 10, [5, 3])).toBe(true);
    expect(motifInside('waves', 10, [0, 3])).toBe(false);
    expect(motifInside('waves', 10, [-5, 3])).toBe(true);
  });

  it('sews shorter stitches inside the motif when it should show clearly', () => {
    const r = disc();
    const kinds = (strong: boolean) => {
      const m = remembered(r, sewObjects(r)[0])!.fill!;
      const q = sewAs(r, () => ({ ...m, pattern: 'tatami', deco: { emboss: 'diamonds', embossStrong: strong } }))!;
      return q.cmd.filter((c) => c === STITCH).length;
    };
    expect(kinds(true)).toBeGreaterThan(kinds(false) * 1.15);
  });
});

describe('open patterns', () => {
  for (const [name, fill] of [
    ['meander', meanderFill],
    ['maze', mazeFill],
  ] as const) {
    it(`sews the ${name} as closed lines that never cross, inside the shape`, () => {
      const res = fill(disk, open, [5, 15])!;
      expect(res).not.toBeNull();
      for (const q of allPoints(res.runs)) expect(sample(disk, disk.sdf, q[0], q[1])).toBeLessThan(0.15);
      // Every loop ends where it started: no thread across the pattern.
      for (const run of res.runs) {
        const a = run[0];
        const z = run[run.length - 1];
        expect(Math.hypot(a[0] - z[0], a[1] - z[1])).toBeLessThan(3);
        for (let i = 1; i < run.length; i++) {
          for (let j = i + 2; j < run.length; j++) {
            if (i === 1 && j === run.length - 1) continue;
            expect(cross(run[i - 1], run[i], run[j - 1], run[j])).toBe(false);
          }
        }
      }
    });
  }

  it('gives the same pattern for the same seed and another for another seed', () => {
    const a = meanderFill(square, open, [5, 5])!;
    const b = meanderFill(square, open, [5, 5])!;
    const c = meanderFill(square, { ...open, seed: 2 }, [5, 5])!;
    expect(b.runs).toEqual(a.runs);
    expect(c.runs).not.toEqual(a.runs);
  });

  it('sews grids and cross stitch inside the shape, every line there and back at most', () => {
    for (const res of [gridFill(disk, { ...open, size: 6 }, 'hex', [5, 15]), gridFill(disk, { ...open, size: 6 }, 'brick', [5, 15]), crossFill(disk, open, 'full', [5, 15])]) {
      expect(res).not.toBeNull();
      for (const q of allPoints(res!.runs)) expect(sample(disk, disk.sdf, q[0], q[1])).toBeLessThan(0.05);
      const uses = new Map<string, number>();
      for (const run of res!.runs) {
        for (let i = 1; i < run.length; i++) {
          const k = [run[i - 1], run[i]].map((q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`).sort().join('|');
          uses.set(k, (uses.get(k) ?? 0) + 1);
        }
      }
      expect(Math.max(...uses.values())).toBeLessThanOrEqual(2);
    }
  });

  it('crosses every whole cell of the cross stitch on both diagonals', () => {
    const res = crossFill(square, open, 'full', [5, 5])!;
    const [x0, y0, x1, y1] = regionBox(square);
    const inside = (x: number, y: number) => sample(square, square.sdf, x, y) < -0.1;
    let cells = 0;
    for (let y = Math.floor(y0 / 2.5) * 2.5; y < y1; y += 2.5) for (let x = Math.floor(x0 / 2.5) * 2.5; x < x1; x += 2.5) if (inside(x, y) && inside(x + 2.5, y) && inside(x, y + 2.5) && inside(x + 2.5, y + 2.5)) cells++;
    expect(cells).toBeGreaterThan(30);
    let diagonals = 0;
    const seen = new Set<string>();
    for (const run of res.runs) {
      for (let i = 1; i < run.length; i++) {
        const k = [run[i - 1], run[i]].map((q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`).sort().join('|');
        if (!seen.has(k)) diagonals++;
        seen.add(k);
      }
    }
    expect(diagonals).toBe(cells * 2);
  });
});

describe('fading rows', () => {
  it('never steps to the next row in one long stitch where the rows thin out', () => {
    const r = region((x, y) => ((x - 15) / 14) ** 2 + ((y - 15) / 7) ** 2 < 1);
    for (const fade of ['out', 'in'] as const) {
      for (const angle of [60, 110]) {
        const res = fillRegion(r, { spacing: 0.4, stitch: 4, angle, pull: 0.2, underlay: false, fade, tolerance: 0.15 } as never, [0, 0])!;
        for (const run of res.runs) for (let i = 1; i < run.length; i++) expect(Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1])).toBeLessThan(5);
      }
    }
  });

  const rows = (fade: 'out' | 'in') => {
    const res = fillRegion(square, { spacing: 0.4, stitch: 2.5, angle: 0, pull: 0, underlay: false, fade }, [5, 5])!;
    const half = [0, 0];
    for (const run of res.runs) for (let i = 1; i < run.length; i++) if (Math.abs(run[i][1] - run[i - 1][1]) < 1e-6) half[run[i][1] < 15 ? 0 : 1] += Math.abs(run[i][0] - run[i - 1][0]);
    return half;
  };

  it('thins out evenly, and two opposite fades add up to an even layer', () => {
    const out = rows('out');
    const inn = rows('in');
    // Density falls linearly: three quarters of the thread in the dense half.
    expect(out[0] / (out[0] + out[1])).toBeGreaterThan(0.65);
    expect(inn[1] / (inn[0] + inn[1])).toBeGreaterThan(0.65);
    // Together about as much thread in each half.
    expect((out[0] + inn[0]) / (out[1] + inn[1])).toBeCloseTo(1, 0);
  });
});

const options = digitizeDefaults(DEFAULT_PROFILE);
const ID = [1, 0, 0, 1, 0, 0] as const;
const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;
const red = { r: 200, g: 30, b: 30 };
const blue = { r: 30, g: 60, b: 200 };

function disc(): Pattern {
  return addShape(empty, { form: parsePath(ellipsePath(0, 0, 15, 15), [...ID]), kind: 'fill' }, red, null, options)!.pattern;
}

function sewAs(p: Pattern, s: (f: FillSettings) => FillSettings): Pattern | null {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  return takeOver(restitch(p, objs, [0], { kind: 'fill', s: s(remembered(p, objs[0])!.fill!) }, kinds, options.trimMm));
}

describe('decorative fills in the design', () => {
  it('sews every pattern and remembers it', () => {
    const p = disc();
    for (const pattern of [...DECO_PATTERNS, ...OPEN_PATTERNS]) {
      const q = sewAs(p, (f) => ({ ...f, pattern, deco: { seed: 3 } }));
      expect(q, pattern).not.toBeNull();
      const objs = sewObjects(q!);
      expect(objs, pattern).toHaveLength(1);
      expect(remembered(q!, objs[0])?.fill?.pattern).toBe(pattern);
    }
    const e = sewAs(p, (f) => ({ ...f, deco: { emboss: 'stars', embossSize: 12 } }))!;
    expect(remembered(e, sewObjects(e)[0])?.fill?.deco?.emboss).toBe('stars');
  });

  it('lets open patterns stay open: no density findings for them', () => {
    const p = disc();
    const q = sewAs(p, (f) => ({ ...f, pattern: 'maze', deco: {} }))!;
    const marks = openOnPurpose(q, sewObjects(q));
    expect(marks).not.toBeNull();
    expect(marks!.every((v, i) => v === 1 || q.cmd[i] !== STITCH)).toBe(true);
    expect(openOnPurpose(p, sewObjects(p))).toBeNull();
  });

  it('keeps the settings through saving and opening', () => {
    const p = disc();
    const q = sewAs(p, (f) => ({ ...f, pattern: 'rays', deco: { focus: [0.2, 0.7], seed: 4 } }))!;
    const stored = structuredClone(rememberedIn(q, sewObjects(q)));
    forgetAll();
    expect(restoreRemembered(stored)).toBeGreaterThan(0);
    expect(remembered(q, sewObjects(q)[0])?.fill?.deco).toEqual({ focus: [0.2, 0.7], seed: 4 });
    // Settings that make no sense are not taken.
    forgetAll();
    for (const e of stored) if (e.fill) (e.fill.deco as Record<string, unknown>).grid = 'triangles';
    restoreRemembered(stored);
    expect(remembered(q, sewObjects(q)[0])?.fill).toBeUndefined();
  });

  it('moves the start of the rays with the shape when it is mirrored', () => {
    const p = disc();
    const q = sewAs(p, (f) => ({ ...f, pattern: 'rays', deco: { focus: [0.2, 0.5] } }))!;
    const m = remembered(q, sewObjects(q)[0])!;
    const [minX, minY, maxX, maxY] = regionBox(m.region!);
    const back = transformRemembered(m, mirrorMatrix('x', { minX, minY, maxX, maxY }));
    const f = back.fill!.deco!.focus!;
    expect(f[0]).toBeCloseTo(0.8, 1);
    expect(f[1]).toBeCloseTo(0.5, 1);
  });

  it('blends a fill into a second color with an even total density', () => {
    const p = disc();
    const q = blendObject(p, 0, blue, options.trimMm)!;
    expect(q).not.toBeNull();
    expect(q.colors).toEqual([red, blue]);
    const objs = sewObjects(q);
    expect(objs).toHaveLength(2);
    const a = remembered(q, objs[0])!.fill!;
    const second = remembered(q, objs[1])!;
    const b = second.fill!;
    expect([a.pattern, a.deco?.fade]).toEqual(['gradient', 'out']);
    expect([b.pattern, b.deco?.fade, b.underlay]).toEqual(['gradient', 'in', false]);
    expect(q.cmd.filter((c) => c === COLOR_CHANGE)).toHaveLength(1);
    // Coupled as a border of its own thread: it knows its fill.
    expect(second.blendOf).toBe(a.deco!.blend!.link);
  });

  it('sews the border of a blend after its second thread, also in the fill thread', () => {
    const p = disc();
    const fill = remembered(p, sewObjects(p)[0])!.fill!;
    const bordered = sewAs(p, () => ({ ...fill, border: { type: 'satin', width: 2, length: 2.5, tolerance: 0.15 } }))!;
    expect(sewObjects(bordered)).toHaveLength(1);
    const q = blendObject(bordered, 0, blue, options.trimMm)!;
    const objs = sewObjects(q);
    expect(objs.map((o) => remembered(q, o)?.blendOf ? 'second' : remembered(q, o)?.outline ? 'border' : 'fill')).toEqual(['fill', 'second', 'border']);
    expect(q.colors).toEqual([red, blue, red]);
  });

  it('keeps the second thread of a blend with its fill', () => {
    const q = blendObject(disc(), 0, blue, options.trimMm)!;
    const link = remembered(q, sewObjects(q)[0])!.fill!.deco!.blend!.link;
    // The fill sewn tighter: the second thread follows.
    const fill = remembered(q, sewObjects(q)[0])!.fill!;
    const tighter = syncBorders(sewAs(q, () => ({ ...fill, spacing: fill.spacing * 0.8 }))!, options.trimMm);
    const objs = sewObjects(tighter);
    expect(objs).toHaveLength(2);
    expect(remembered(tighter, objs[1])!.fill!.spacing).toBeCloseTo(fill.spacing * 0.8);
    // Another pattern takes it out.
    const objsQ = sewObjects(q);
    const plain = syncBorders(takeOver(restitch(q, objsQ, [0], { kind: 'fill', s: { ...fill, pattern: 'tatami', deco: undefined } }, stitchKinds(q), options.trimMm))!, options.trimMm, new Set([link]));
    expect(sewObjects(plain)).toHaveLength(1);
    expect(plain.colors).toEqual([red]);
    // Deleting the fill deletes both.
    expect(sewObjects(deleteObjects(q, [0], options.trimMm)!)).toHaveLength(0);
    // Recoloring the second thread keeps it coupled, in the new thread.
    const green = { r: 0, g: 160, b: 60 };
    const g = recolorObjects(q, [1], green, options.trimMm)!;
    expect(remembered(g, sewObjects(g)[0])!.fill!.deco!.blend!.color).toEqual(green);
    expect(remembered(g, sewObjects(g)[1])!.blendOf).toBe(link);
  });
});
