import { describe, expect, it } from 'vitest';
import { autoCorrect, DEFAULT_CORRECTION } from '../src/correct/auto';
import { pullBackFills } from '../src/correct/pullback';
import { respaceFills, respaceSatins } from '../src/correct/respace';
import { shortenSatinCurves } from '../src/correct/satinShort';
import { satinColumns, ZIGZAG_MIN } from '../src/correct/structure';
import { COLOR_CHANGE, patternStats, STITCH, type Pattern } from '../src/model/pattern';
import { acknowledgementOf, liveAcknowledgements, openWorst, settledBy, type Acknowledgement } from '../src/validation/acks';
import type { Profile } from '../src/validation/profiles';
import { satinMask } from '../src/validation/satin';
import { measurePattern } from '../src/validation/measure';
import { CAUTION, classify, CRITICAL, SAFE } from '../src/validation/validate';
import type { Zone } from '../src/validation/zones';
import { letterDesign } from './helpers/designs';
import { Shape } from './helpers/shapes';

/** Correct caution zones too (the default only corrects critical ones). */
const FULL = { ...DEFAULT_CORRECTION, goal: 'caution' as const };
const WOVEN: Profile = { fabric: 'woven', thread: '40' };
const KNIT: Profile = { fabric: 'knit', thread: '40' };
const thread = (p: Pattern) => patternStats(p).threadLength;
const stitches = (p: Pattern) => p.cmd.filter((c) => c === STITCH).length;
/** Thread of the first color block (the fill of the letter design). */
const firstBlockThread = (p: Pattern) => {
  let s = 0;
  for (let i = 1; i < p.cmd.length && p.cmd[i] !== COLOR_CHANGE; i++) {
    if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH) s += Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]);
  }
  return s;
};
/** Satin around a quarter circle: inner radius r0, outer r1 (mm), `step` mm between outer penetrations. */
const arcSatin = (r0: number, r1: number, step: number) => {
  const s = new Shape().trim().jump(r1 + 10, 10).to(r1 + 10, 10);
  const n = Math.round((r1 * Math.PI) / 2 / step);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    const r = i % 2 ? r0 : r1;
    s.to(10 + r * Math.cos(a), 10 + r * Math.sin(a));
  }
  return s.build();
};
const zone = (minX: number, minY: number, maxX: number, maxY: number, level = CAUTION): Zone => ({
  level: level as Zone['level'],
  reasons: ['density'],
  cells: 1,
  areaMm2: (maxX - minX) * (maxY - minY),
  maxDensity: 8,
  maxHoles: 0,
  maxShorts: 0,
  satinShare: 0,
  bbox: { minX, minY, maxX, maxY },
});

describe('pulling fills back under a border', () => {
  it('shortens fill rows that reach far under the satin border', () => {
    const p = letterDesign({ overlap: 1 });
    const r = pullBackFills(p, { wanted: () => true });
    expect(r.moved).toBeGreaterThan(50);
    expect(firstBlockThread(r.pattern)).toBeLessThan(firstBlockThread(p) * 0.97);
    // The border is untouched, so the outline of the design stays the same.
    expect(r.pattern.bounds).toEqual(p.bounds);
  });

  it('leaves fills that end just under the border alone', () => {
    const p = letterDesign({ overlap: 0.1 });
    expect(pullBackFills(p, { wanted: () => true }).moved).toBe(0);
  });
});

describe('short stitches in satin curves', () => {
  it('shortens every second stitch on the crowded inner side only', () => {
    const p = arcSatin(2, 6, 0.4);
    const r = shortenSatinCurves(p, { wanted: () => true });
    expect(r.moved).toBeGreaterThan(3);
    for (let i = 0; i < p.cmd.length; i++) {
      if (r.pattern.x[i] === p.x[i] && r.pattern.y[i] === p.y[i]) continue;
      // Only inner penetrations move, and they move outwards into the column.
      const r0 = Math.hypot(p.x[i] - 100, p.y[i] - 100);
      const r1 = Math.hypot(r.pattern.x[i] - 100, r.pattern.y[i] - 100);
      expect(r0).toBeLessThan(25);
      expect(r1).toBeGreaterThan(r0);
    }
  });

  it('leaves a straight satin alone', () => {
    const p = new Shape().satin(0, 0, 20, 4, 0.4).build();
    expect(shortenSatinCurves(p, { wanted: () => true }).moved).toBe(0);
  });
});

describe('re-spacing', () => {
  it('rebuilds a dense fill at an even, wider spacing and keeps its outline', () => {
    const p = new Shape().fillAt(20, 20, 10, 0.3, 0.3).build();
    const r = respaceFills(p, { needAt: () => 0.25, maxSpacing: 6 });
    expect(r.sweeps).toBe(1);
    expect(r.rows).toBeGreaterThan(10);
    expect(thread(r.pattern) / thread(p)).toBeLessThan(0.85);
    expect(thread(r.pattern) / thread(p)).toBeGreaterThan(0.65);
    const b = r.pattern.bounds;
    for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) expect(Math.abs(b[k] - p.bounds[k])).toBeLessThanOrEqual(3);
  });

  it('never spaces rows wider than the material allows', () => {
    const p = new Shape().fillAt(20, 20, 10, 0.3, 0.4).build();
    expect(respaceFills(p, { needAt: () => 0.5, maxSpacing: 4.5 }).rows).toBeLessThanOrEqual(6);
  });

  it('opens up a dense satin evenly; every stitch still crosses the column', () => {
    const p = new Shape().satin(0, 0, 20, 4, 0.2).build();
    const r = respaceSatins(p, { needAt: () => 0.4, maxSpacing: 4.5 }, satinColumns(p, undefined, satinMask(p, ZIGZAG_MIN)));
    expect(stitches(r.pattern)).toBeLessThan(stitches(p) * 0.75);
    const q = r.pattern;
    for (let i = 1; i < q.cmd.length; i++) {
      if (q.cmd[i] === STITCH && q.cmd[i - 1] === STITCH) expect(Math.abs(q.y[i] - q.y[i - 1])).toBe(40);
    }
  });
});

describe('correction focus', () => {
  const column = () => {
    const s = new Shape().trim().jump(0, 0).to(0, 0);
    for (let i = 1; i * 0.1 <= 20; i++) s.to(i * 0.1, i % 2 ? 0.7 : 0);
    return s.build();
  };

  it('leaves short-stitch clusters alone with the thread focus and clears them with the hole focus', () => {
    const p = column();
    const thread = autoCorrect(p, KNIT, { ...DEFAULT_CORRECTION, focus: 'thread' });
    expect(thread.report.after.worst).toBe(CRITICAL);
    const holes = autoCorrect(p, KNIT, { ...DEFAULT_CORRECTION, focus: 'holes' });
    expect(holes.report.after.worst).toBe(SAFE);
  });

  it('does not touch thread density with the hole focus on woven fabric', () => {
    const s = new Shape();
    for (let i = 0; i < 4; i++) s.fillAt(20, 20, 10, i * 0.8 + 0.2);
    const p = s.build();
    const r = autoCorrect(p, WOVEN, { ...DEFAULT_CORRECTION, focus: 'holes' });
    expect(r.report.respaced).toBe(0);
    expect(r.report.after.worst).toBe(CRITICAL);
  });
});

describe('acknowledged findings', () => {
  it('leaves zones the user acknowledged as they are', () => {
    const s = new Shape();
    for (let i = 0; i < 4; i++) s.fillAt(20, 20, 10, i * 0.8 + 0.2);
    const p = s.build();
    const zones = classify(measurePattern(p), WOVEN).zones;
    const acks: Acknowledgement[] = zones.map((z) => ({ bbox: z.bbox, reason: 'manual' }));
    const r = autoCorrect(p, WOVEN, { ...DEFAULT_CORRECTION, acks });
    expect(r.pattern).toBe(p);
    expect(r.report.manual).toBe(0);
    expect(r.report.acknowledged).toBe(zones.length);
  });

  it('matches zones that moved a little after an edit', () => {
    const acks: Acknowledgement[] = [{ bbox: { minX: 10, minY: 10, maxX: 12, maxY: 12 }, reason: 'manual' }];
    expect(acknowledgementOf(zone(10.5, 10.5, 13, 13), acks)).toBe(acks[0]);
    expect(acknowledgementOf(zone(20, 20, 22, 22), acks)).toBeUndefined();
    // A zone that grew around the acknowledged spot is open again.
    expect(acknowledgementOf(zone(4, 4, 24, 24), acks)).toBeUndefined();
  });

  it('do not count towards the verdict and expire with their zone', () => {
    const zones = [zone(10, 10, 12, 12, CRITICAL), zone(30, 30, 31, 31, CAUTION)];
    const acks: Acknowledgement[] = [{ bbox: zones[0].bbox, reason: 'manual' }, { bbox: { minX: 50, minY: 50, maxX: 51, maxY: 51 }, reason: 'manual' }];
    expect(openWorst(zones, [])).toBe(CRITICAL);
    expect(openWorst(zones, acks)).toBe(CAUTION);
    expect(liveAcknowledgements(zones, acks)).toEqual([acks[0]]);
  });
});

describe('findings that are normal in practice', () => {
  const column = () => {
    const s = new Shape().trim().jump(0, 0).to(0, 0);
    for (let i = 1; i * 0.1 <= 20; i++) s.to(i * 0.1, i % 2 ? 0.7 : 0);
    return s.build();
  };

  it('count short-stitch clusters on stable fabric as normal, on knits as critical', () => {
    const woven = classify(measurePattern(column()), WOVEN);
    expect(woven.worst).toBe(CAUTION);
    expect(woven.zones.every((z) => z.practice === 'shortsStable' || z.practice === 'smallSpot')).toBe(true);
    expect(openWorst(woven.zones, [])).toBe(SAFE);
    const knit = classify(measurePattern(column()), KNIT);
    expect(knit.worst).toBe(CRITICAL);
    expect(knit.zones.some((z) => !z.practice)).toBe(true);
  });

  it('accept the patch where two satin columns cross, but not a large stack', () => {
    const cross = new Shape().satin(0, 10, 20, 4, 0.3);
    // A second column across the first one.
    cross.trim().jump(8, 0).to(8, 0);
    for (let i = 1; i * 0.15 <= 24; i++) cross.to(i % 2 ? 12 : 8, i * 0.15);
    const v = classify(measurePattern(cross.build()), WOVEN);
    const flagged = v.zones.filter((z) => z.level === CRITICAL);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((z) => z.practice === 'satinJoin')).toBe(true);

    // Two dense columns on top of each other along their length.
    const stacked = new Shape().satin(0, 10, 20, 4, 0.3).satin(0, 10, 20, 4, 0.3).build();
    const long = classify(measurePattern(stacked), WOVEN).zones.filter((z) => z.level === CRITICAL);
    expect(long.length).toBeGreaterThan(0);
    expect(long.every((z) => !z.practice)).toBe(true);

    const s = new Shape();
    for (let i = 0; i < 4; i++) s.fillAt(20, 20, 10, i * 0.8 + 0.2);
    const fills = classify(measurePattern(s.build()), WOVEN);
    expect(fills.zones.find((z) => z.level === CRITICAL)?.practice).toBeUndefined();
  });

  it('can be counted again from the list', () => {
    const z = { ...zone(10, 10, 11, 11), practice: 'smallSpot' as const };
    expect(settledBy(z, [])).toBe('practice');
    expect(settledBy(z, [{ bbox: z.bbox, reason: 'reopened' }])).toBeUndefined();
    expect(settledBy(z, [{ bbox: z.bbox, reason: 'manual' }])).toBe('manual');
    expect(openWorst([z], [{ bbox: z.bbox, reason: 'reopened' }])).toBe(CAUTION);
  });

  it('are left alone by the correction', () => {
    const p = column();
    const r = autoCorrect(p, WOVEN, FULL);
    expect(r.pattern).toBe(p);
    expect(r.report.practice).toBeGreaterThan(0);
  });
});
