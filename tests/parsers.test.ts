import { describe, expect, it } from 'vitest';
import { COLOR_CHANGE, JUMP, STITCH, TRIM, patternStats } from '../src/model/pattern';
import { parseDst } from '../src/parsers/dst';
import { parsePattern } from '../src/parsers';
import { parsePes } from '../src/parsers/pes';
import { encodeDst, encodePes, type Op } from './helpers/encode';

const square: Op[] = [
  { type: 'stitch', dx: 0, dy: 0 },
  { type: 'stitch', dx: 100, dy: 0 },
  { type: 'stitch', dx: 0, dy: 100 },
  { type: 'stitch', dx: -100, dy: 0 },
  { type: 'stitch', dx: 0, dy: -100 },
];

describe('DST', () => {
  it('decodes every delta in range', () => {
    const ops: Op[] = [];
    for (let dx = -121; dx <= 121; dx += 7) for (let dy = -121; dy <= 121; dy += 11) ops.push({ type: 'stitch', dx, dy });
    const p = parseDst(encodeDst(ops));
    expect(p.cmd.length).toBe(ops.length);
    for (let i = 1; i < ops.length; i++) expect([p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]]).toEqual([ops[i].dx, ops[i].dy]);
  });

  it('parses a square with label and inverted y', () => {
    const p = parseDst(encodeDst(square, 'SQUARE'));
    expect(p.name).toBe('SQUARE');
    expect(Array.from(p.cmd)).toEqual([STITCH, STITCH, STITCH, STITCH, STITCH]);
    expect(Array.from(p.x)).toEqual([0, 100, 100, 0, 0]);
    expect(Array.from(p.y)).toEqual([0, 0, 100, 100, 0]);
    expect(p.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(patternStats(p).threadLength).toBeCloseTo(40);
  });

  it('turns runs of 3 jumps into a trim, keeps single jumps, reads color changes', () => {
    const p = parseDst(
      encodeDst([
        { type: 'stitch', dx: 10 },
        { type: 'jump', dx: 50 },
        { type: 'stitch', dx: 10 },
        { type: 'trim' },
        { type: 'color' },
        { type: 'stitch', dx: 10 },
      ]),
    );
    expect(Array.from(p.cmd)).toEqual([STITCH, JUMP, STITCH, TRIM, JUMP, JUMP, JUMP, COLOR_CHANGE, STITCH]);
    expect(p.colors).toHaveLength(2);
    expect(p.x[p.x.length - 1]).toBe(80);
  });
});

describe('PES', () => {
  it('parses short and long deltas, jumps, trims and colors', () => {
    const data = encodePes(
      [
        { type: 'stitch', dx: 5, dy: -5 },
        { type: 'stitch', dx: 300, dy: 0 },
        { type: 'jump', dx: -20, dy: 40 },
        { type: 'stitch', dx: 0, dy: 1 },
        { type: 'color' },
        { type: 'trim' },
        { type: 'jump', dx: 1000, dy: -1000 },
        { type: 'stitch', dx: -64, dy: 63 },
      ],
      [5, 13],
      'PESTEST',
    );
    const p = parsePes(data);
    expect(p.name).toBe('PESTEST');
    expect(p.colors.map((c) => c.name)).toEqual(['Red', 'Yellow']);
    expect(Array.from(p.cmd)).toEqual([STITCH, STITCH, JUMP, STITCH, COLOR_CHANGE, TRIM, JUMP, STITCH]);
    expect(Array.from(p.x)).toEqual([5, 305, 285, 285, 285, 285, 1285, 1221]);
    expect(Array.from(p.y)).toEqual([-5, -5, 35, 36, 36, 36, -964, -901]);
  });

  it('dispatches by signature and extension', () => {
    expect(parsePattern(encodePes(square, [1]), 'a.pes').format).toBe('pes');
    expect(parsePattern(encodeDst(square), 'a.DST').format).toBe('dst');
    expect(() => parsePattern(new Uint8Array(10), 'a.jef')).toThrow();
  });
});
