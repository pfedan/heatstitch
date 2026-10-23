import { describe, expect, it } from 'vitest';
import { coveredPart, overlapsIn, setKnockout } from '../src/model/knockout';
import { sewObjects } from '../src/model/objects';
import { remembered } from '../src/model/restitch';
import { sharedArea } from '../src/shape/rasterize';
import { Design, THREADS } from './helpers/demoProject';

/**
 * The overlap card marks on the canvas where a fill is sewn twice: the part leaving out would take
 * away, exactly (the preview of "Aussparen").
 */
const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}H${x + w}V${y + h}H${x}Z`;

function design(): { d: Design; big: number; top: number } {
  const d = new Design('Doppelt', { fabric: 'woven', thread: '40' });
  const big = d.fill(rect(10, 10, 60, 40), THREADS.yellow, { angle: 90 });
  const top = d.fill(rect(30, 20, 10, 10), THREADS.navy, { angle: 0 });
  return { d, big, top };
}

describe('the part of a fill sewn twice', () => {
  it('is what lies under the fill on top, less the overlap kept under it', () => {
    const { d, big, top } = design();
    const objs = sewObjects(d.p);
    expect(overlapsIn(d.p, objs)).toEqual([big]);
    const part = coveredPart(d.p, objs, objs[big])!;
    // 10 × 10 mm on top, the fill below still reaches 0.2 mm under it on each side.
    expect(part.areaMm2).toBeGreaterThan(9.4 * 9.4);
    expect(part.areaMm2).toBeLessThan(10 * 10);
    expect(coveredPart(d.p, objs, objs[top])).toBeNull();
  });

  it('is exactly what leaving out takes away', () => {
    const { d, big } = design();
    const objs = sewObjects(d.p);
    const part = coveredPart(d.p, objs, objs[big])!;
    const before = remembered(d.p, objs[big])!.region!;
    const on = setKnockout(d.p, [big], true, d.T)!.pattern;
    const after = remembered(on, sewObjects(on)[big])!.region!;
    expect(before.areaMm2 - after.areaMm2).toBeCloseTo(part.areaMm2, 1);
    expect(sharedArea(part, after)).toBe(0);
    // Once left out, the card has nothing more to mark.
    expect(overlapsIn(on)).toEqual([]);
  });
});
