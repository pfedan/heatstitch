import { describe, expect, it } from 'vitest';
import { autoCorrect, DEFAULT_CORRECTION } from '../src/correct/auto';
import { nudgePenetrations, sameHoleStitches } from '../src/correct/nudge';
import { mergeShortStitches, removeZeroLength } from '../src/correct/shorts';
import { thinSweeps, turningPoints } from '../src/correct/thin';
import { moveRecords, removeStitches, tidy } from '../src/model/edit';
import { COLOR_CHANGE, JUMP, patternStats, STITCH, TRIM, type Pattern } from '../src/model/pattern';
import { parseDst } from '../src/parsers/dst';
import { parsePes } from '../src/parsers/pes';
import type { Profile } from '../src/validation/profiles';
import { CAUTION, classify, CRITICAL, SAFE } from '../src/validation/validate';
import { writeDst } from '../src/writers/dst';
import { writePes } from '../src/writers/pes';
import { Shape } from './helpers/shapes';

const WOVEN: Profile = { fabric: 'woven', thread: '40' };
const LEATHER: Profile = { fabric: 'leather', thread: '40' };
const thread = (p: Pattern) => patternStats(p).threadLength;
const stitchCount = (p: Pattern) => p.cmd.filter((c) => c === STITCH).length;
const layers = (n: number, s = new Shape()) => {
  for (let i = 0; i < n; i++) s.fillAt(20, 20, 10, i * 0.8 + 0.2);
  return s;
};
/** Zigzag column along x, `width` mm wide, advancing `step` mm per stitch. */
const zigzag = (length: number, width: number, step: number, s = new Shape()) => {
  s.trim().jump(0, 0).to(0, 0);
  for (let i = 1; i * step <= length; i++) s.to(i * step, i % 2 ? width : 0);
  return s;
};

describe('model edits', () => {
  it('removes stitches and keeps the command structure', () => {
    const p = new Shape().to(0, 0).to(1, 0).to(2, 0).trim().jump(5, 0).to(5, 0).to(6, 0).build();
    const q = removeStitches(p, Uint8Array.from([0, 1, 0, 0, 0, 0, 0]));
    expect(Array.from(q.cmd)).toEqual([STITCH, STITCH, TRIM, JUMP, STITCH, STITCH]);
    expect(thread(q)).toBeCloseTo(thread(p));
  });

  it('drops color blocks that lost all their stitches', () => {
    const s = new Shape().to(0, 0).to(1, 0);
    const p0 = s.build();
    const cmd = [...p0.cmd, COLOR_CHANGE, STITCH, COLOR_CHANGE, STITCH];
    const p: Pattern = {
      ...p0,
      x: Int32Array.from([0, 10, 10, 20, 20, 30]),
      y: new Int32Array(6),
      cmd: Uint8Array.from(cmd),
      colors: [{ r: 1, g: 0, b: 0 }, { r: 2, g: 0, b: 0 }, { r: 3, g: 0, b: 0 }],
    };
    const q = removeStitches(p, Uint8Array.from([0, 0, 0, 1, 0, 0]));
    expect(Array.from(q.cmd)).toEqual([STITCH, STITCH, COLOR_CHANGE, STITCH]);
    expect(q.colors.map((c) => c.r)).toEqual([1, 3]);
    expect(tidy(q)).toEqual(q);
  });

  it('moves stitches and keeps zero-movement records on their predecessor', () => {
    const p = new Shape().to(0, 0).to(1, 0).trim().jump(3, 0).build();
    const q = moveRecords(p, [1], 0, 5);
    expect([q.x[1], q.y[1]]).toEqual([10, 5]);
    expect([q.x[2], q.y[2]]).toEqual([10, 5]); // the trim follows
    expect(q.bounds.maxY).toBe(5);
  });
});

describe('thinning', () => {
  it('finds the zigzag turning points of a satin', () => {
    const p = new Shape().satin(0, 0, 10, 4, 0.4).build();
    const s = p.cmd.indexOf(STITCH);
    expect(turningPoints(p, s, p.cmd.length - 1)).toHaveLength(stitchCount(p));
  });

  it('halves a satin evenly with a need of 0.5', () => {
    const p = new Shape().satin(0, 0, 20, 4, 0.4).build();
    const r = thinSweeps(p, { needAt: () => 0.5 });
    expect(thread(r.pattern) / thread(p)).toBeGreaterThan(0.45);
    expect(thread(r.pattern) / thread(p)).toBeLessThan(0.55);
    // Still a column: every stitch crosses it, none runs along an edge.
    const q = r.pattern;
    for (let i = 1; i < q.cmd.length; i++) {
      if (q.cmd[i] === STITCH && q.cmd[i - 1] === STITCH) expect(Math.abs(q.y[i] - q.y[i - 1])).toBe(40);
    }
  });

  it('removes fill rows in pairs and keeps the outline', () => {
    const p = new Shape().fillAt(20, 20, 10, 0.3).build();
    const r = thinSweeps(p, { needAt: () => 0.5 });
    expect(r.cycles).toBeGreaterThan(5);
    expect(thread(r.pattern) / thread(p)).toBeLessThan(0.6);
    expect(r.pattern.bounds).toEqual(p.bounds);
    // No new stitch is longer than the longest original one.
    const longest = (q: Pattern) => {
      let m = 0;
      for (let i = 1; i < q.cmd.length; i++) if (q.cmd[i] === STITCH && q.cmd[i - 1] === STITCH) m = Math.max(m, Math.hypot(q.x[i] - q.x[i - 1], q.y[i] - q.y[i - 1]));
      return m;
    };
    expect(longest(r.pattern)).toBeLessThanOrEqual(longest(p) + 1);
  });

  it('leaves running stitches, areas without need and protected stitches alone', () => {
    const run = new Shape().to(0, 0).to(5, 0).to(5, 5).to(0, 5).to(0, 0).to(5, 0).build();
    expect(thinSweeps(run, { needAt: () => 0.5 }).removed).toBe(0);
    const sat = new Shape().satin(0, 0, 20, 4, 0.4).build();
    expect(thinSweeps(sat, { needAt: () => 0 }).removed).toBe(0);
    expect(thinSweeps(sat, { needAt: () => 0.5, protect: new Uint8Array(sat.cmd.length).fill(1) }).removed).toBe(0);
  });

  it('thins only the part of a satin that needs it', () => {
    const p = new Shape().satin(0, 0, 20, 4, 0.4).build();
    const r = thinSweeps(p, { needAt: (i) => (p.x[i] < 100 ? 0.5 : 0) });
    const q = r.pattern;
    const right = (s: Pattern) => s.cmd.filter((c, i) => c === STITCH && s.x[i] > 110).length;
    expect(right(q)).toBe(right(p));
    expect(r.removed).toBeGreaterThan(10);
  });
});

describe('short stitches', () => {
  it('removes zero-length stitches without changing the thread', () => {
    const p = new Shape().to(0, 0).to(1, 0).to(1, 0).to(1, 0).to(2, 0).build();
    const r = removeZeroLength(p);
    expect(r.removed).toBe(2);
    expect(stitchCount(r.pattern)).toBe(3);
    expect(thread(r.pattern)).toBeCloseTo(thread(p));
  });

  it('merges a tight run of short stitches but keeps its shape', () => {
    const s = new Shape().trim().jump(0, 0).to(0, 0);
    for (let i = 1; i <= 60; i++) {
      const a = (i / 60) * Math.PI;
      s.to(5 - 5 * Math.cos(a), 5 * Math.sin(a)); // half circle, 0.26 mm stitches
    }
    const p = s.build();
    const r = mergeShortStitches(p, () => true);
    expect(r.removed).toBeGreaterThan(30);
    const q = r.pattern;
    for (let i = 0; i < q.cmd.length; i++) {
      if (q.cmd[i] !== STITCH) continue;
      expect(Math.abs(Math.hypot(q.x[i] - 50, q.y[i]) - 50)).toBeLessThanOrEqual(1);
    }
  });

  it('leaves a narrow zigzag to thinning', () => {
    const p = zigzag(10, 0.7, 0.1).build();
    expect(mergeShortStitches(p, () => true).removed).toBe(0);
  });
});

describe('nudging', () => {
  it('separates stitches of two layers that share holes', () => {
    const s = new Shape();
    s.trim().jump(0, 0);
    for (let i = 0; i <= 10; i++) s.to(i, 0);
    s.trim().jump(0, 3);
    for (let i = 0; i <= 10; i++) s.to(i, i % 2 ? 3 : 0); // touches the first row at every second point
    const p = s.build();
    const same = sameHoleStitches(p);
    expect(same.some((v) => v)).toBe(true);
    const r = nudgePenetrations(p, { movable: (i) => same[i] === 1, radius: 4, maxShift: 3 });
    expect(sameHoleStitches(r.pattern).some((v) => v)).toBe(false);
    for (let i = 0; i < p.cmd.length; i++) {
      expect(Math.hypot(r.pattern.x[i] - p.x[i], r.pattern.y[i] - p.y[i])).toBeLessThanOrEqual(3);
    }
  });
});

describe('automatic correction', () => {
  it('clears critical density from four stacked fills', () => {
    const p = layers(4).build();
    const r = autoCorrect(p, WOVEN, DEFAULT_CORRECTION);
    expect(r.report.before.worst).toBe(CRITICAL);
    expect(r.report.after.worst).toBeLessThan(CRITICAL);
    expect(r.report.after.cautionCells).toBeLessThan(r.report.before.criticalCells / 2);
    expect(r.report.threadAfter).toBeLessThan(r.report.threadBefore * 0.75);
  });

  it('clears a short-stitch cluster in a narrow zigzag column', () => {
    const p = zigzag(20, 0.7, 0.1).build();
    const r = autoCorrect(p, WOVEN, DEFAULT_CORRECTION);
    expect(r.report.before.worst).toBe(CRITICAL);
    expect(r.report.after.worst).toBe(SAFE);
  });

  it('with goal "critical" leaves caution areas untouched', () => {
    const p = layers(3).build();
    const r = autoCorrect(p, WOVEN, { ...DEFAULT_CORRECTION, goal: 'critical', nudge: false });
    expect(r.report.before.worst).toBe(CAUTION);
    expect(r.report.thinned).toBe(0);
  });

  it('only touches the given region', () => {
    const s = new Shape();
    for (const cx of [20, 60]) for (let i = 0; i < 4; i++) s.fillAt(cx, 20, 10, i * 0.8 + 0.2);
    const p = s.build();
    const r = autoCorrect(p, WOVEN, { ...DEFAULT_CORRECTION, region: { minX: 5, minY: 5, maxX: 35, maxY: 35 } });
    const v = classify(r.measurement, WOVEN);
    const critical = v.zones.filter((z) => z.level === CRITICAL);
    expect(critical.length).toBeGreaterThan(0);
    expect(critical.every((z) => z.bbox.minX > 40)).toBe(true);
    const right = (q: Pattern) => q.cmd.filter((c, i) => c === STITCH && q.x[i] > 400).length;
    expect(right(r.pattern)).toBe(right(p));
  });

  it('relieves perforation on leather by thinning a dense satin', () => {
    const p = new Shape().satin(0, 0, 20, 4, 0.2).build(); // holes every 0.2 mm on each edge
    const r = autoCorrect(p, LEATHER, DEFAULT_CORRECTION);
    expect(r.report.before.worst).toBeGreaterThan(SAFE);
    expect(r.report.after.worst).toBe(SAFE);
  });

  it('writes corrected designs that read back unchanged', () => {
    const p = autoCorrect(layers(4).build(), WOVEN, DEFAULT_CORRECTION).pattern;
    const pts = (q: Pattern) => Array.from(q.cmd).flatMap((c, i) => (c === STITCH ? [q.x[i], q.y[i]] : []));
    expect(pts(parseDst(writeDst(p)))).toEqual(pts(p));
    expect(pts(parsePes(writePes(p)))).toEqual(pts(p));
  });
});
