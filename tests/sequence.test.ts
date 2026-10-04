import { describe, expect, it } from 'vitest';
import { setTrims } from '../src/model/jumps';
import { COLOR_CHANGE, STITCH, TRIM, type Pattern } from '../src/model/pattern';
import {
  carriedJumps,
  colorBlocks,
  FILL,
  markers,
  recordOfStitch,
  SATIN,
  stitchKinds,
  stitchNumbers,
  transitions,
} from '../src/model/sequence';
import { parseDst } from '../src/parsers/dst';
import { writeDst } from '../src/writers/dst';
import { letterDesign } from './helpers/designs';
import { Shape } from './helpers/shapes';

/** Two running lines joined by an untrimmed 8 mm jump. */
const twoLines = () => new Shape().to(0, 0).to(3, 0).to(6, 0).jump(14, 0).to(14, 0).to(17, 0).to(20, 0).build();

const count = (p: Pattern, c: number) => p.cmd.reduce((n, v) => n + (v === c ? 1 : 0), 0);

describe('sequence analysis', () => {
  it('finds jumps between stitch runs with their length and trim state', () => {
    const t = transitions(twoLines());
    expect(t).toHaveLength(1);
    expect(t[0].lengthMm).toBeCloseTo(8);
    expect(t[0].trimmed).toBe(false);
    expect(t[0].tieOff + t[0].tieIn).toBe(0);
  });

  it('leaves color changes out of the transitions and counts blocks', () => {
    const s = new Shape().to(0, 0).to(5, 0);
    const p = s.build();
    const cmd = Uint8Array.from([...p.cmd, COLOR_CHANGE, STITCH, STITCH]);
    const x = Int32Array.from([...p.x, 50, 80, 120]);
    const y = Int32Array.from([...p.y, 0, 0, 0]);
    const q = { ...p, x, y, cmd, colors: [p.colors[0], { r: 255, g: 0, b: 0 }] };
    expect(transitions(q)).toHaveLength(0);
    const blocks = colorBlocks(q);
    expect(blocks.map((b) => b.stitches)).toEqual([2, 2]);
    expect(blocks[1].threadMm).toBeCloseTo(4);
    expect(markers(q).colorStarts).toEqual([0, 3]);
  });

  it('tells satin and fill stitches apart', () => {
    const p = new Shape().satin(0, 0, 10, 3, 0.4).fill(0, 10, 10, 10, 'h').build();
    const kinds = stitchKinds(p);
    const n = (k: number) => kinds.reduce((a, v) => a + (v === k ? 1 : 0), 0);
    expect(n(SATIN)).toBeGreaterThan(40);
    expect(n(FILL)).toBeGreaterThan(40);
  });

  it('draws only jumps without a trim as thread, from the last stitch to the next', () => {
    const p = twoLines();
    const c = carriedJumps(p, transitions(p));
    const t = transitions(p)[0];
    expect(c.from[t.to]).toBe(t.from);
    expect([...c.from].filter((v) => v >= 0)).toHaveLength(1);
    expect(c.jumps.reduce((n, v) => n + v, 0)).toBeGreaterThan(0);
    const cut = setTrims(p, transitions(p), true);
    expect([...carriedJumps(cut, transitions(cut)).from].every((v) => v < 0)).toBe(true);
  });

  it('maps stitch numbers to records', () => {
    const p = twoLines();
    const num = stitchNumbers(p);
    expect(num[num.length - 1]).toBe(6);
    expect(p.cmd[recordOfStitch(num, 4)]).toBe(STITCH);
    expect(recordOfStitch(num, 4)).toBe(4);
  });
});

describe('editing jumps', () => {
  it('cuts a jump with tie-off and tie-in, and detects them afterwards', () => {
    const p = setTrims(twoLines(), transitions(twoLines()), true);
    expect(count(p, TRIM)).toBe(1);
    const [t] = transitions(p);
    expect(t.trimmed).toBe(true);
    expect(t.tieOff).toBeGreaterThan(0);
    expect(t.tieIn).toBeGreaterThan(0);
    // Same start and end of the design; the ties stay within a millimetre.
    expect([p.x[t.from], p.y[t.from]]).toEqual([60, 0]);
    expect([p.x[t.to], p.y[t.to]]).toEqual([140, 0]);
    // Cutting again changes nothing.
    expect(setTrims(p, transitions(p), true)).toBe(p);
  });

  it('carries the thread again: the trim and the ties go away', () => {
    const orig = twoLines();
    const cut = setTrims(orig, transitions(orig), true);
    const back = setTrims(cut, transitions(cut), false);
    expect(Array.from(back.cmd)).toEqual(Array.from(orig.cmd));
    expect(Array.from(back.x)).toEqual(Array.from(orig.x));
    expect(transitions(back)[0].trimmed).toBe(false);
  });

  it('keeps cut jumps as trims through a DST round trip', () => {
    const p = setTrims(twoLines(), transitions(twoLines()), true);
    const q = parseDst(writeDst(p));
    expect(transitions(q).map((t) => t.trimmed)).toEqual([true]);
    const carried = setTrims(q, transitions(q), false);
    expect(transitions(parseDst(writeDst(carried))).map((t) => t.trimmed)).toEqual([false]);
  });

  it('only touches the chosen transitions of a real design', () => {
    const p = letterDesign();
    const all = transitions(p);
    expect(all.length).toBeGreaterThan(1);
    const long = all.filter((t) => t.lengthMm >= 3);
    const q = setTrims(p, long, true);
    const after = transitions(q);
    expect(after).toHaveLength(all.length);
    expect(after.filter((t) => t.lengthMm >= 3).every((t) => t.trimmed)).toBe(true);
    expect(colorBlocks(q).reduce((n, b) => n + b.stitches, 0)).toBeGreaterThanOrEqual(colorBlocks(p).reduce((n, b) => n + b.stitches, 0));
  });
});
