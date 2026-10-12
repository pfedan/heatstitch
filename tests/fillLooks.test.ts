import { describe, expect, it } from 'vitest';
import { crossFill, FIGURES, gridFill, mazeFill, meanderFill, motifCrossings, motifFill, TEXTURES, texturePoints } from '../src/digitize/deco';
import { digitizeDefaults } from '../src/digitize/digitize';
import { fillRegion } from '../src/digitize/fill';
import { buildRegion, sample, type Region } from '../src/digitize/region';
import type { Pt } from '../src/digitize/skeleton';
import { addShape } from '../src/model/addShape';
import { takeOver } from '../src/model/knockout';
import { sewObjects } from '../src/model/objects';
import { remembered, restitch, roughenRuns, ROUGH_LONG, type FillSettings } from '../src/model/restitch';
import { STITCH, type Pattern } from '../src/model/pattern';
import { stitchKinds } from '../src/model/sequence';
import { parsePath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';

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

const square = region((x, y) => x > 5 && x < 35 && y > 5 && y < 35);
const disk = region((x, y) => Math.hypot(x - 20, y - 20) < 14);
const base = { spacing: 0.4, stitch: 4, angle: 90, pull: 0, underlay: false };
const lengths = (runs: Pt[][]) => runs.flatMap((r) => r.slice(1).map((q, i) => Math.hypot(q[0] - r[i][0], q[1] - r[i][1])));
const count = (runs: Pt[][]) => runs.reduce((n, r) => n + r.length, 0);

describe('textures', () => {
  it('keep every stitch between a third and 1.4 stitch lengths inside the row', () => {
    for (const t of TEXTURES) {
      for (const v of [0, 1.3, 5.9, 17.2]) {
        const pts = texturePoints(t, 12, 4, v, 0, 30, 0.6);
        const all = [0, ...pts, 30];
        for (let i = 1; i < all.length; i++) {
          expect(all[i] - all[i - 1], `${t} at v ${v}`).toBeGreaterThanOrEqual(i === 1 || i === all.length - 1 ? 0.6 - 1e-9 : 4 * 0.3 - 1e-9);
          expect(all[i] - all[i - 1], `${t} at v ${v}`).toBeLessThanOrEqual(4 * 1.4 + 1e-9);
        }
      }
    }
  });

  it('shift the needle points from row to row, so they line up into the texture', () => {
    // Zigzag: from v = 0 to a quarter of the size the points move by half the size along the row.
    const a = texturePoints('zigzag', 12, 4, 0, 0, 30, 0.6);
    const b = texturePoints('zigzag', 12, 4, 3, 0, 30, 0.6);
    const shift = (((b[0] - a[0]) % 4) + 4) % 4;
    expect(shift).toBeCloseTo(3 % 4, 6);
  });

  it('sew the same thread as plain tatami, in about as many stitches', () => {
    const plain = fillRegion(square, base, [5, 5])!;
    for (const t of TEXTURES) {
      const r = fillRegion(square, { ...base, texture: { kind: t, size: 12 } }, [5, 5])!;
      // The same rows: the same thread; a row may have a needle point more or less at its ends.
      const thread = (runs: Pt[][]) => lengths(runs).reduce((x, l) => x + l, 0);
      expect(Math.abs(thread(r.runs) - thread(plain.runs)) / thread(plain.runs), t).toBeLessThan(0.02);
      expect(Math.abs(count(r.runs) - count(plain.runs)) / count(plain.runs), t).toBeLessThan(0.08);
      expect(Math.max(...lengths(r.runs)), t).toBeLessThanOrEqual(4 * 1.4 + 0.01);
    }
  });
});

describe('irregular fills', () => {
  it('move needle points along their rows, the same each time, ends and density kept', () => {
    const plain = fillRegion(square, base, [5, 5])!;
    const a = structuredClone(plain.runs);
    const b = structuredClone(plain.runs);
    roughenRuns(a, 0, 1, 7, 4 * ROUGH_LONG);
    roughenRuns(b, 0, 1, 7, 4 * ROUGH_LONG);
    expect(a).toEqual(b);
    expect(count(a)).toBe(count(plain.runs));
    let moved = 0;
    a.forEach((run, i) =>
      run.forEach((q, j) => {
        const p = plain.runs[i][j];
        // Rows run up and down (90 degrees): a point moves along y only.
        expect(Math.abs(q[0] - p[0])).toBeLessThan(0.05);
        if (Math.abs(q[1] - p[1]) > 0.1) moved++;
      }),
    );
    expect(moved).toBeGreaterThan(count(a) / 3);
    const ls = lengths(a).filter((l) => l > 1);
    expect(Math.max(...ls)).toBeLessThanOrEqual(4 * ROUGH_LONG + 1e-6);
    expect(Math.min(...lengths(a))).toBeGreaterThan(0.39);
    // Row ends stay where they were: the outline is the same.
    const ends = (runs: Pt[][]) => runs.map((r) => [r[0], r[r.length - 1]]);
    expect(ends(a)).toEqual(ends(plain.runs));
  });

  it('keep the underlay as it is', () => {
    const plain = fillRegion(square, { ...base, underlay: true }, [5, 5])!;
    const a = structuredClone(plain.runs);
    roughenRuns(a, plain.under!, 1, 3, 4 * ROUGH_LONG);
    expect(a.flat().slice(0, plain.under)).toEqual(plain.runs.flat().slice(0, plain.under));
  });
});

describe('motif fill', () => {
  it('sews every figure in one go inside the area', () => {
    for (const f of FIGURES) {
      const res = motifFill(disk, { size: 8, stitch: 2.5, seed: 1, triple: false }, f, [6, 20])!;
      expect(res.runs.length, f).toBe(1);
      for (const q of res.runs[0]) expect(sample(disk, disk.sdf, q[0], q[1]), f).toBeLessThan(0.05);
      // Figures inside: the run reaches every row of figures (7.2 mm apart).
      const rows = new Set(res.runs[0].map((q) => Math.round(q[1] / 7.2)));
      expect(rows.size, f).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('turned patterns', () => {
  const open = { size: 6, stitch: 2.5, seed: 1, triple: false };
  // The two directions most thread runs in (degrees, 0 to 175 in steps of 5): the lattice lines,
  // not the line along the edge, which runs every way.
  const dirs = (runs: Pt[][]) => {
    const along = new Map<number, number>();
    for (const r of runs)
      for (let i = 1; i < r.length; i++) {
        const dx = r[i][0] - r[i - 1][0];
        const dy = r[i][1] - r[i - 1][1];
        const k = (Math.round((((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 180) / 5) * 5) % 180;
        along.set(k, (along.get(k) ?? 0) + Math.hypot(dx, dy));
      }
    return [...along].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k]) => k).sort((x, y) => x - y);
  };

  it('turn a grid, its lines with it, and keep it inside the area', () => {
    const up = gridFill(disk, open, 'brick', [6, 20])!;
    const turned = gridFill(disk, { ...open, angle: 30 }, 'brick', [6, 20])!;
    expect(dirs(up.runs)).toEqual([0, 90]);
    expect(dirs(turned.runs)).toEqual([30, 120]);
    for (const q of turned.runs.flat()) expect(sample(disk, disk.sdf, q[0], q[1])).toBeLessThan(0.05);
  });

  it('leave every needle point where it was at 0 degrees', () => {
    expect(gridFill(disk, { ...open, angle: 0 }, 'hex', [6, 20])).toEqual(gridFill(disk, open, 'hex', [6, 20]));
    expect(crossFill(disk, { ...open, angle: 0 }, 'full', [6, 20])).toEqual(crossFill(disk, open, 'full', [6, 20]));
  });

  it('turn cross stitch and motifs, still one run inside the area', () => {
    const cr = crossFill(square, { ...open, size: 2.5, angle: 20 }, 'full', [6, 6])!;
    // Upright the diagonals run at 45 and 135 degrees.
    expect(dirs(cr.runs)).toEqual([65, 155]);
    for (const f of FIGURES) {
      const res = motifFill(disk, { ...open, size: 8, angle: 135 }, f, [6, 20])!;
      expect(res.runs.length, f).toBe(1);
      for (const q of res.runs[0]) expect(sample(disk, disk.sdf, q[0], q[1]), f).toBeLessThan(0.05);
    }
  });

  it('turn a maze and a meander, inside the area, and leave them as they were at 0 degrees', () => {
    const p = { ...open, size: 2.5 };
    expect(dirs(mazeFill(disk, p, [6, 20])!.runs)).toEqual([0, 90]);
    expect(dirs(mazeFill(disk, { ...p, angle: 30 }, [6, 20])!.runs)).toEqual([30, 120]);
    expect(mazeFill(disk, { ...p, angle: 0 }, [6, 20])).toEqual(mazeFill(disk, p, [6, 20]));
    expect(meanderFill(disk, { ...p, angle: 0 }, [6, 20])).toEqual(meanderFill(disk, p, [6, 20]));
    for (const res of [mazeFill(disk, { ...p, angle: 30 }, [6, 20])!, meanderFill(disk, { ...p, angle: 75 }, [6, 20])!])
      for (const q of res.runs.flat()) expect(sample(disk, disk.sdf, q[0], q[1])).toBeLessThan(0.05);
  });

  it('turn an embossed motif: a row crosses it as the row turned back crosses the upright one', () => {
    const a = (30 * Math.PI) / 180;
    // The row along x turned by -30 degrees about the origin, against the motif turned by 30.
    const back = { o: [5 * Math.sin(a), 5 * Math.cos(a)] as Pt, e: [Math.cos(a), -Math.sin(a)] as Pt };
    const upright = motifCrossings('hearts', 8, back, 0, 40);
    const turned = motifCrossings('hearts', 8, { o: [0, 5], e: [1, 0] }, 0, 40, 30);
    expect(turned.length).toBe(upright.length);
    turned.forEach((u, i) => expect(u).toBeCloseTo(upright[i], 6));
  });
});

const options = digitizeDefaults(DEFAULT_PROFILE);
const ID = [1, 0, 0, 1, 0, 0] as const;
const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;

function sewAs(p: Pattern, s: (f: FillSettings) => FillSettings): Pattern {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  return takeOver(restitch(p, objs, [0], { kind: 'fill', s: s(remembered(p, objs[0])!.fill!) }, kinds, options.trimMm))!;
}

describe('in the design', () => {
  const square30 = () => addShape(empty, { form: parsePath('M0 0 L30 0 L30 30 L0 30 Z', [...ID]), kind: 'fill' }, { r: 200, g: 30, b: 30 }, null, options)!.pattern;
  const stitches = (p: Pattern) => p.cmd.filter((c) => c === STITCH).length;

  it('remembers textures, irregular rows and figures with the fill', () => {
    const p = square30();
    const cases: [string, (f: FillSettings) => FillSettings][] = [
      ['texture', (f) => ({ ...f, pattern: 'tatami', deco: { texture: 'herringbone', textureSize: 9 } })],
      ['rough', (f) => ({ ...f, pattern: 'contour', rough: 0.6, roughSeed: 42 })],
      ['motifs', (f) => ({ ...f, pattern: 'motifs', deco: { figure: 'flowers', angle: 20 } })],
      ['emboss', (f) => ({ ...f, pattern: 'tatami', deco: { emboss: 'stars', embossAngle: 45 } })],
    ];
    for (const [name, s] of cases) {
      const q = sewAs(p, s);
      const m = remembered(q, sewObjects(q)[0])!;
      expect(m.fill, name).toMatchObject(s(remembered(p, sewObjects(p)[0])!.fill!));
      // Sewn again from what it remembers, the stitches are the same.
      expect(stitches(sewAs(q, (f) => f)), name).toBe(stitches(q));
    }
  });

  it('a texture changes where the needle points lie, not how many there are', () => {
    const p = square30();
    const plain = sewAs(p, (f) => ({ ...f, pattern: 'tatami', angle: 0 }));
    const zig = sewAs(p, (f) => ({ ...f, pattern: 'tatami', angle: 0, deco: { texture: 'zigzag' } }));
    expect(Math.abs(stitches(zig) - stitches(plain)) / stitches(plain)).toBeLessThan(0.05);
    expect(Array.from(zig.x)).not.toEqual(Array.from(plain.x));
  });
});
