import { describe, expect, it } from 'vitest';
import { gaussianBlur } from '../src/density/blur';
import { addSegment, computeDensity } from '../src/density/grid';
import { patternStats } from '../src/model/pattern';
import { parseDst } from '../src/parsers/dst';
import { encodeDst, type Op } from './helpers/encode';

const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);

/** Satin-like zigzag: 40 stitches between y=0 and y=50 (0.1 mm), stepping 4 in x. */
function zigzag(): Op[] {
  const ops: Op[] = [{ type: 'stitch', dx: 0, dy: 0 }];
  for (let i = 0; i < 40; i++) ops.push({ type: 'stitch', dx: 4, dy: i % 2 ? -50 : 50 });
  return ops;
}

describe('addSegment', () => {
  it('splits a horizontal segment exactly between cells', () => {
    const d = new Float32Array(4);
    addSegment(d, 4, 1, 0.5, 0.5, 3.5, 0.5, 3);
    expect(Array.from(d)).toEqual([0.5, 1, 1, 0.5]);
  });

  it('conserves length for diagonal segments', () => {
    const d = new Float32Array(100);
    addSegment(d, 10, 10, 0.3, 0.7, 8.9, 6.2, 7);
    expect(sum(d)).toBeCloseTo(7, 5);
  });
});

describe('computeDensity', () => {
  const p = parseDst(encodeDst(zigzag()));
  const total = patternStats(p).threadLength;

  for (const cellMm of [0.5, 1, 2.5]) {
    for (const blurMm of [0, 1.5]) {
      it(`conserves thread length (cell ${cellMm}, blur ${blurMm})`, () => {
        const g = computeDensity(p, { metric: 'thread', cellMm, blurMm, includeJumps: false });
        expect(sum(g.data) * cellMm * cellMm).toBeCloseTo(total, 2);
      });
      it(`conserves penetration count (cell ${cellMm}, blur ${blurMm})`, () => {
        const g = computeDensity(p, { metric: 'penetrations', cellMm, blurMm, includeJumps: false });
        expect(sum(g.data) * cellMm * cellMm).toBeCloseTo(41, 2);
      });
    }
  }

  it('counts untrimmed jumps only when enabled, never trimmed ones', () => {
    const ops: Op[] = [
      { type: 'stitch', dx: 0 },
      { type: 'stitch', dx: 10 },
      { type: 'jump', dx: 50 },
      { type: 'stitch', dx: 0 },
      { type: 'trim' },
      { type: 'jump', dx: 50 },
      { type: 'stitch', dx: 0 },
    ];
    const q = parseDst(encodeDst(ops));
    const len = (includeJumps: boolean) =>
      sum(computeDensity(q, { metric: 'thread', cellMm: 1, blurMm: 0, includeJumps }).data);
    expect(len(false)).toBeCloseTo(1, 5);
    expect(len(true)).toBeCloseTo(6, 5);
  });

  it('applies a segment filter by end record index', () => {
    const g = computeDensity(p, { metric: 'thread', cellMm: 1, blurMm: 0, includeJumps: false }, (end) => end <= 10);
    const tenSegments = Math.hypot(0.4, 5) * 10;
    expect(sum(g.data)).toBeCloseTo(tenSegments, 3);
  });
});

describe('gaussianBlur', () => {
  it('preserves the sum away from the edges', () => {
    const d = new Float32Array(30 * 30);
    d[15 * 30 + 15] = 10;
    d[14 * 30 + 12] = 3;
    const out = gaussianBlur(d, 30, 30, 2);
    expect(sum(out)).toBeCloseTo(13, 4);
    expect(out[15 * 30 + 15]).toBeLessThan(10);
  });
});
