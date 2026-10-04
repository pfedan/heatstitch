import { describe, expect, it } from 'vitest';
import { fillRegion, pathLength } from '../src/digitize/fill';
import { contourField, fieldFill } from '../src/digitize/flow';
import { coverage } from '../src/digitize/measure';
import { buildRegion, type Region } from '../src/digitize/region';
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

  it('fills a disk with rings along the outline', () => {
    const f = contourField(disk);
    const res = fieldFill(disk, f.g, f, params, [5, 15], true, 3)!;
    expect(res).not.toBeNull();
    expect(res.curved).toBe(true);
    expect(coverage(disk, res.runs, 0.3)).toBeGreaterThan(0.95);
  });

  it('winds a spiral at the row spacing into round shapes only', () => {
    const res = spiralFill(disk, params, [5, 15])!;
    expect(res.runs).toHaveLength(1);
    expect(thread(res.runs) / disk.areaMm2).toBeCloseTo(1 / 0.4, 0);
    expect(coverage(disk, res.runs, 0.3)).toBeGreaterThan(0.95);
    expect(spiralFill(ell, params, [5, 5])).toBeNull();
  });
});
