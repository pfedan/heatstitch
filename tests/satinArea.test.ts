import { describe, expect, it } from 'vitest';
import { sewObjects } from '../src/model/objects';
import { satinOutline } from '../src/model/geo';
import { analyze } from '../src/model/restitch';
import { FILL, RUNNING, SATIN, stitchKinds } from '../src/model/sequence';
import { formArea } from '../src/shape/path';
import { parsePattern } from '../src/parsers';
import { writePes } from '../src/writers/pes';
import { Writer, type Pt } from './helpers/designs';

/** A bent satin column 4 mm wide, sewn over an underlay of long stitches back and forth, as bought designs often have it. */
function column(): Uint8Array {
  const w = new Writer();
  const at = (t: number, side: number): Pt => {
    const a = t / 30;
    const r = 30 + side * 2;
    return [10 + r * Math.sin(a), 40 - r * Math.cos(a)];
  };
  w.start(at(0, 0));
  // Underlay: long stitches along the column and back, four times side by side, as rows of fill would be.
  for (const [side, from, to] of [[-0.15, 0, 30], [0, 30, 0], [0.15, 0, 30], [0.3, 30, 0]]) {
    const step = from < to ? 4 : -4;
    for (let t = from; step > 0 ? t <= to : t >= to; t += step) w.to(at(t, side));
  }
  // The satin back over it, 0.4 mm apart.
  for (let t = 30, s = -1; t >= 0; t -= 0.2, s = -s) w.to(at(t, s));
  return writePes(w.b.build('satin', 'pes', [{ r: 100, g: 30, b: 140 }]));
}

describe('a satin over an underlay back and forth', () => {
  it('is satin all along, with rails, and shows as an area', () => {
    const p = parsePattern(column(), 'satin.pes');
    const kinds = stitchKinds(p);
    // The stitch reader takes such underlay for rows of fill in some files (in the hummingbird
    // from elsewhere it does): so here.
    const first = kinds.indexOf(SATIN);
    for (let i = 1; i < first; i++) if (kinds[i] === RUNNING) kinds[i] = FILL;
    const objs = sewObjects(p, kinds);
    expect(objs).toHaveLength(1);
    const o = objs[0];
    expect(o.kind).toBe('satin');
    expect(analyze(p, o, kinds).parts.map((pt) => pt.kind)).not.toContain('fill');
    // One closed outline around its one column: 30 mm long, 4 mm wide.
    const area = satinOutline(p, o, kinds);
    expect(area?.paths).toHaveLength(1);
    expect(area!.paths[0].closed).toBe(true);
    expect(area).not.toBeNull();
    expect(formArea(area!)).toBeGreaterThan(120 * 0.85);
    expect(formArea(area!)).toBeLessThan(120 * 1.15);
  });
});
