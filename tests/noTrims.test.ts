import { describe, expect, it } from 'vitest';
import { fillRegion } from '../src/digitize/fill';
import { sewObjects } from '../src/model/objects';
import { parsePattern } from '../src/parsers';
import { rasterize } from '../src/shape/rasterize';
import { ellipsePath, parsePath } from '../src/shape/svgPath';
import { writePes } from '../src/writers/pes';
import { Writer, type Pt } from './helpers/designs';

const rows = (cx: number, cy: number, angle: number, spacing: number): Pt[] => {
  const r = rasterize(parsePath(ellipsePath(cx, cy, 8, 6), [1, 0, 0, 1, 0, 0]), 0.1)!;
  return fillRegion(r, { spacing, stitch: 3, angle, pull: 0, underlay: false }, [cx - 8, cy])!.runs.flat();
};

/** Two leaves and a tendril in one thread, sewn in one go without a trim, as many hobby designs are. */
function design(): Uint8Array {
  const w = new Writer();
  const a = rows(10, 10, 30, 0.4);
  const b = rows(40, 10, 120, 0.9);
  w.start(a[0]);
  for (const q of a.slice(1)) w.to(q);
  // Travel to the second leaf, then the leaf, then a tendril winding away from it.
  for (let x = a[a.length - 1][0] + 2.5; x < b[0][0]; x += 2.5) w.to([x, 18]);
  for (const q of b) w.to(q);
  for (let t = 0; t <= 6 * Math.PI; t += 0.3) w.to([60 + t * 1.2 * Math.cos(t), 30 + t * 1.2 * Math.sin(t)]);
  return writePes(w.b.build('ranke', 'pes', [{ r: 220, g: 230, b: 80 }]));
}

describe('a design without trims', () => {
  it('is read as its leaves and its tendril, not as one object', () => {
    const p = parsePattern(design(), 'ranke.pes');
    const objs = sewObjects(p);
    const kinds = objs.map((o) => o.kind);
    expect(kinds.filter((k) => k === 'fill')).toHaveLength(2);
    expect(kinds[kinds.length - 1]).toBe('run');
    expect(objs.length).toBeLessThanOrEqual(4);
  });
});
