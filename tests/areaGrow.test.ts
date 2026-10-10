import { describe, expect, it } from 'vitest';
import { sameRegion } from '../src/model/border';
import { fillArea } from '../src/model/geo';
import { setKnockout } from '../src/model/knockout';
import { sewObjects } from '../src/model/objects';
import { reshapeFill } from '../src/model/reshape';
import { remembered, type Remembered } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import type { Pattern } from '../src/model/pattern';
import { Design, THREADS } from './helpers/demoProject';

/**
 * A drawn fill is sewn on its form grown by the pull compensation of the fabric (FillSettings.areaGrow).
 * Leaving out what lies on top and reshaping rastered the bare form and lost it; and a border in a
 * thread of its own stayed on the area the fill had before leaving out.
 */
const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}H${x + w}V${y + h}H${x}Z`;

/** A 60 × 40 mm fill with a square sewn on top of it, on knit (0.35 mm pull compensation). */
function design(border = false): { d: Design; big: number } {
  const d = new Design('Zug', { fabric: 'knit', thread: '40' });
  const big = d.fill(rect(10, 10, 60, 40), THREADS.yellow, { angle: 90 });
  if (border) d.border(big, 'satin', 3, THREADS.navy);
  d.fill(rect(30, 20, 10, 10), THREADS.navy, { angle: 0 });
  return { d, big };
}

/** Leftmost and rightmost stitch of object `index` (mm). */
function span(p: Pattern, index: number): [number, number] {
  const o = sewObjects(p)[index];
  let a = Infinity;
  let b = -Infinity;
  for (let i = o.first; i <= o.last; i++) {
    a = Math.min(a, p.x[i]);
    b = Math.max(b, p.x[i]);
  }
  return [a / 10, b / 10];
}

const memoryOf = (p: Pattern, index: number): Remembered => remembered(p, sewObjects(p)[index])!;

describe('the pull compensation of a drawn fill', () => {
  it('is kept with the fill and gives its area', () => {
    const { d, big } = design();
    const m = memoryOf(d.p, big);
    expect(m.fill!.areaGrow).toBeGreaterThan(0.3);
    expect(sameRegion(fillArea(m), m.region)).toBe(true);
    expect(m.region!.areaMm2).toBeGreaterThan(2400 + 0.3 * 200);
  });

  it('stays when the fill leaves out what lies on top, and when that is turned off again', () => {
    const { d, big } = design();
    const before = span(d.p, big);
    const on = setKnockout(d.p, [big], true, d.T)!;
    // The outer edge is where it was; only the square on top is left out.
    expect(span(on.pattern, big)[0]).toBeCloseTo(before[0], 1);
    expect(span(on.pattern, big)[1]).toBeCloseTo(before[1], 1);
    expect(memoryOf(on.pattern, big).region!.areaMm2).toBeGreaterThan(2400 - 100 + 0.3 * 200);
    const off = setKnockout(on.pattern, [big], false, d.T)!;
    expect(sameRegion(memoryOf(off.pattern, big).region, memoryOf(d.p, big).region)).toBe(true);
  });

  it('stays when the form is edited', () => {
    const { d, big } = design();
    const objs = sewObjects(d.p);
    const m = memoryOf(d.p, big);
    const r = reshapeFill(d.p, objs, objs[big], stitchKinds(d.p), m.geo!, d.T)!;
    expect(sameRegion(r.memory[0].region, m.region)).toBe(true);
  });
});

describe('a border in a thread of its own', () => {
  it('follows its fill when the fill starts leaving out, in the same step', () => {
    const { d, big } = design(true);
    const on = setKnockout(d.p, [big], true, d.T)!;
    const objs = sewObjects(on.pattern);
    const fill = remembered(on.pattern, objs[big])!;
    const border = objs.map((o) => remembered(on.pattern, o)).find((m) => m?.outline === fill.line!.link)!;
    expect(sameRegion(border.region, fill.region)).toBe(true);
  });
});
