import { describe, expect, it } from 'vitest';
import { fillRegion, pathLength, underlayArea } from '../src/digitize/fill';
import { contourField, contourFill, fieldFill, guideField } from '../src/digitize/flow';
import { coverage } from '../src/digitize/measure';
import { buildRegion, expandRegion, outline, sample, type Region } from '../src/digitize/region';
import { spiralFill } from '../src/digitize/spiral';
import type { Pt } from '../src/digitize/skeleton';

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
const ell = region((x, y) => x > 3 && x < 27 && y > 3 && y < 27 && !(x > 9 && y < 21));

const thread = (runs: Pt[][]) => runs.reduce((a, r) => a + pathLength(r), 0);
const params = { spacing: 0.4, stitch: 2.5, angle: 0, pull: 0, underlay: false };

describe('fill patterns', () => {
  it('opens a gradient evenly across the shape', () => {
    const res = fillRegion(square, { ...params, spacingEnd: 1.2 }, [5, 5])!;
    const ys = new Set<number>();
    for (const run of res.runs) {
      for (let i = 1; i < run.length; i++) if (Math.abs(run[i][1] - run[i - 1][1]) < 1e-6 && Math.abs(run[i][0] - run[i - 1][0]) > 1) ys.add(Math.round(run[i][1] * 100) / 100);
    }
    const rows = [...ys].sort((a, b) => a - b);
    const gaps = rows.slice(1).map((y, i) => y - rows[i]);
    expect(gaps[0]).toBeCloseTo(0.4, 1);
    expect(gaps[gaps.length - 1]).toBeGreaterThan(1);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1] - 0.02);
  });

  it('keeps the tatami rows as they were without a gradient', () => {
    const a = fillRegion(square, params, [5, 5])!;
    const b = fillRegion(square, { ...params, offset: 0.25, spacingEnd: 0.4 }, [5, 5])!;
    expect(b.runs).toEqual(a.runs);
  });

  it('shifts the needle points by the chosen offset', () => {
    const at = (offset: number) => {
      const res = fillRegion(square, { ...params, stitch: 3, offset }, [5, 5])!;
      // Needle points inside the rows, by row.
      const byRow = new Map<number, number[]>();
      for (const run of res.runs) for (const [x, y] of run) if (x > 8 && x < 22) byRow.set(Math.round(y * 100), [...(byRow.get(Math.round(y * 100)) ?? []), x]);
      return [...byRow.entries()].sort((p, q) => p[0] - q[0]).map(([, xs]) => xs.sort((p, q) => p - q));
    };
    const brick = at(0.5);
    // Every second row has its needle points in the same places.
    expect(brick[2][0]).toBeCloseTo(brick[0][0], 5);
    expect(Math.abs(brick[1][0] - brick[0][0]) % 3).toBeCloseTo(1.5, 5);
  });

  it('sews contour rings evenly spaced, also in a corner', () => {
    for (const r of [disk, ell]) {
      const res = contourFill(r, { ...params, spacing: 0.5 }, [5, 15])!;
      expect(res).not.toBeNull();
      expect(coverage(r, res.runs, 0.3)).toBeGreaterThan(0.95);
      // Every needle point lies on a ring: its distance to the edge is a whole number of spacings.
      let off = 0;
      let n = 0;
      for (const run of res.runs) {
        for (const [x, y] of run) {
          const ix = Math.floor(x / PX - r.x0);
          const iy = Math.floor(y / PX - r.y0);
          const d = -r.sdf[iy * r.w + ix] - 0.25;
          if (d < 0.5 || !Number.isFinite(d)) continue;
          n++;
          const m = Math.abs(d / 0.5 - Math.round(d / 0.5));
          if (m > 0.3) off++;
        }
      }
      expect(n).toBeGreaterThan(100);
      expect(off).toBeLessThan(n * 0.1);
    }
  });

  it('keeps the underlay further inside by a share of the width', () => {
    // How far the underlay's needle points keep from the edge of the disk, most of them (the
    // travel from the start on the edge left aside).
    const edgeOf = (share?: number, underSpacing?: number) => {
      const res = fillRegion(disk, { ...params, underlay: true, underInset: 0.4, underInsetShare: share, underSpacing }, [5, 15])!;
      const d = res.runs
        .flat()
        .slice(0, res.under!)
        .map(([x, y]) => 10 - Math.hypot(x - 15, y - 15))
        .sort((a, b) => a - b);
      expect(d.length).toBeGreaterThan(20);
      return d[Math.floor(d.length * 0.1)];
    };
    expect(edgeOf()).toBeGreaterThan(0.3);
    // 10 % of the 20 mm wide disk: 2 mm in place of 0.4.
    expect(edgeOf(0.1)).toBeGreaterThan(edgeOf() + 1.2);
    // Its own spacing changes the rows, not how far they keep inside.
    expect(edgeOf(0.1, 2.5)).toBeGreaterThan(edgeOf() + 1.2);
  });

  it('keeps the underlay inset by width in one piece, also when large', () => {
    // Pieces of an area (4-connected pixels).
    const pieces = (a: Region) => {
      const seen = new Uint8Array(a.w * a.h);
      let n = 0;
      for (let i = 0; i < seen.length; i++) {
        if (seen[i] || a.sdf[i] >= 0) continue;
        n++;
        const stack = [i];
        seen[i] = 1;
        while (stack.length) {
          const j = stack.pop()!;
          for (const k of [j - 1, j + 1, j - a.w, j + a.w]) {
            if (k < 0 || k >= seen.length || seen[k] || a.sdf[k] >= 0) continue;
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
      return n;
    };
    for (const share of [0.1, 0.2, 0.3]) {
      const a = underlayArea(square, 0, share)!;
      expect(pieces(a)).toBe(1);
      // The middle of a side keeps away from the edge by about the share of the 20 mm width.
      expect(sample(a, a.sdf, 15, 5 + 20 * share - 1)).toBeGreaterThan(0);
      expect(sample(a, a.sdf, 15, 5 + 20 * share + 1)).toBeLessThan(0);
    }
  });

  it('spaces the underlay rows as set', () => {
    const count = (underSpacing?: number) => fillRegion(disk, { ...params, underlay: true, underSpacing }, [5, 15])!.under!;
    expect(count(0.8)).toBeGreaterThan(count(2.5) * 1.5);
  });

  it('fills a disk with rings along the outline', () => {
    const f = contourField(disk);
    const res = fieldFill(disk, f.g, f, params, [5, 15], true, 3)!;
    expect(res).not.toBeNull();
    expect(res.curved).toBe(true);
    expect(coverage(disk, res.runs, 0.3)).toBeGreaterThan(0.95);
  });

  it('winds a spiral at the row spacing, also into a corner', () => {
    for (const r of [disk, ell]) {
      const res = spiralFill(r, params, [5, 15])!;
      expect(res.runs).toHaveLength(1);
      expect(thread(res.runs) / r.areaMm2).toBeCloseTo(1 / 0.4, 0);
      expect(coverage(r, res.runs, 0.3)).toBeGreaterThan(0.95);
    }
  });

  it('outlines a region as one closed line along its edge', () => {
    const lines = outline(disk);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line[0]).toEqual(line[line.length - 1]);
    expect(Math.abs(pathLength(line) / (2 * Math.PI * 10) - 1)).toBeLessThan(0.02);
  });
});

describe('guided fill, underlay and end', () => {
  /** Directions of the long stitches inside the middle of the square (degrees, 0 to 180). */
  const angles = (runs: Pt[][], inside: (p: Pt) => boolean) => {
    const out: number[] = [];
    for (const run of runs) {
      for (let i = 1; i < run.length; i++) {
        const [a, b] = [run[i - 1], run[i]];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1 || !inside([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) continue;
        out.push(((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 180) % 180);
      }
    }
    return out;
  };

  it('lays curved rows along one guide line', () => {
    // An arc: rows near it run along it, not straight across.
    const arc: Pt[] = Array.from({ length: 21 }, (_, i) => {
      const t = Math.PI * (0.15 + (0.7 * i) / 20);
      return [15 - 14 * Math.cos(t), 26 - 14 * Math.sin(t)];
    });
    const f = guideField(square, [arc]);
    const res = fieldFill(square, f.g, f, params, [5, 5], false, 3)!;
    expect(res.curved).toBe(true);
    expect(coverage(square, res.runs, 0.3)).toBeGreaterThan(0.95);
    // Left of the middle the arc rises, right of it it falls.
    const left = angles(res.runs, ([x, y]) => x > 7 && x < 11 && y > 14 && y < 18);
    const right = angles(res.runs, ([x, y]) => x > 19 && x < 23 && y > 14 && y < 18);
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(left)).toBeGreaterThan(110);
    expect(mean(right)).toBeLessThan(70);
  });

  it('lets curved rows get further apart evenly across the shape (gradient)', () => {
    // Rows bowed like a bowl, as on a bird's belly: 0.35 mm apart on the side where they start, 1 mm on the far side.
    const bowl: Pt[] = Array.from({ length: 21 }, (_, i) => {
      const t = Math.PI * (0.15 + (0.7 * i) / 20);
      return [15 - 14 * Math.cos(t), 4 + 14 * Math.sin(t)];
    });
    const f = guideField(square, [bowl]);
    const res = fieldFill(square, f.g, f, { ...params, spacing: 0.35, spacingEnd: 1 }, [5, 5], false, 3)!;
    expect(res.curved).toBe(true);
    // Where the rows cross the middle of the square (they run nearly across it there).
    const ys: number[] = [];
    for (const run of res.runs) {
      for (let i = 1; i < run.length; i++) {
        const [a, b] = [run[i - 1], run[i]];
        if ((a[0] - 15) * (b[0] - 15) > 0 || a[0] === b[0] || Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0])) continue;
        ys.push(a[1] + ((b[1] - a[1]) * (15 - a[0])) / (b[0] - a[0]));
      }
    }
    ys.sort((a, b) => a - b);
    const gaps = ys.slice(1).map((y, i) => ({ y: (y + ys[i]) / 2, d: y - ys[i] }));
    const median = (lo: number, hi: number) => {
      const d = gaps.filter((g) => g.y > lo && g.y < hi).map((g) => g.d).sort((a, b) => a - b);
      return d[Math.floor(d.length / 2)];
    };
    expect(median(5, 8)).toBeGreaterThan(0.3);
    expect(median(5, 8)).toBeLessThan(0.45);
    expect(median(12, 15)).toBeGreaterThan(median(5, 8) + 0.05);
    expect(median(20, 24)).toBeGreaterThan(0.8);
    expect(median(20, 24)).toBeLessThan(1.15);
    // Without a gradient the rows stay as they were.
    const plain = fieldFill(square, f.g, f, { ...params, spacing: 0.35 }, [5, 5], false, 3)!;
    expect(fieldFill(square, f.g, f, { ...params, spacing: 0.35, spacingEnd: 0.35 }, [5, 5], false, 3)!.runs).toEqual(plain.runs);
  });

  it('turns rows from one guide line to the next', () => {
    const f = guideField(square, [
      [
        [6, 6],
        [24, 6],
      ],
      [
        [6, 10],
        [6, 24],
      ],
    ]);
    const res = fieldFill(square, f.g, f, params, [5, 5], false, 3)!;
    expect(res.curved).toBe(true);
    const top = angles(res.runs, ([x, y]) => x > 16 && x < 23 && y > 6 && y < 8);
    const side = angles(res.runs, ([x, y]) => x > 6 && x < 8 && y > 16 && y < 23);
    const near = (a: number[], deg: number) => a.filter((v) => Math.min(Math.abs(v - deg), 180 - Math.abs(v - deg)) < 20).length / a.length;
    expect(near(top, 0)).toBeGreaterThan(0.8);
    expect(near(side, 90)).toBeGreaterThan(0.8);
  });

  it('sews a crossing underlay in two layers and keeps it inside the inset', () => {
    const one = fillRegion(square, { ...params, underlay: true }, [5, 5])!;
    const cross = fillRegion(square, { ...params, underlay: true, underCross: true }, [5, 5])!;
    expect(thread(cross.runs)).toBeGreaterThan(thread(one.runs) + 200);
    const deep = fillRegion(square, { ...params, underlay: true, underInset: 1.5, stitch: 7 }, [5, 5])!;
    const loose = fillRegion(square, { ...params, underlay: true, stitch: 7 }, [5, 5])!;
    expect(thread(deep.runs)).toBeLessThan(thread(loose.runs));
  });

  it('grows and shrinks an area on all sides', () => {
    // The 20 mm square: 2 mm more on each side gives about 24 × 24 mm, 2 mm less 16 × 16 mm.
    const big = expandRegion(square, 2)!;
    const small = expandRegion(square, -2)!;
    expect(big.areaMm2).toBeGreaterThan(560);
    expect(big.areaMm2).toBeLessThan(580);
    expect(small.areaMm2).toBeGreaterThan(250);
    expect(small.areaMm2).toBeLessThan(262);
    expect(expandRegion(square, -11)).toBeNull();
    const rowsOf = (r: Region) => fillRegion(r, params, [5, 5])!.runs.flat();
    const ys = (pts: Pt[]) => [Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[1]))];
    const [lo, hi] = ys(rowsOf(big));
    expect(lo).toBeLessThan(3.4);
    expect(hi).toBeGreaterThan(26.6);
  });

  it('ends near the next object when that shortens the way', () => {
    const end: Pt = [26, 26];
    const plain = fillRegion(ell, params, [4, 4])!;
    const aimed = fillRegion(ell, { ...params, end }, [4, 4])!;
    const last = (runs: Pt[][]) => runs[runs.length - 1][runs[runs.length - 1].length - 1];
    const d = (p: Pt) => Math.hypot(p[0] - end[0], p[1] - end[1]);
    expect(d(last(aimed.runs))).toBeLessThanOrEqual(d(last(plain.runs)));
    expect(d(last(aimed.runs))).toBeLessThan(6);
    expect(coverage(ell, aimed.runs, 0.3)).toBeGreaterThan(0.95);
  });
});
