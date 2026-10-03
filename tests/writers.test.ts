import { describe, expect, it } from 'vitest';
import { COLOR_CHANGE, JUMP, STITCH, TRIM, type Pattern } from '../src/model/pattern';
import { parsePattern } from '../src/parsers';
import { parseDst } from '../src/parsers/dst';
import { parsePes } from '../src/parsers/pes';
import { pecColor, pecIndexOf } from '../src/parsers/pecPalette';
import { splitMove } from '../src/writers/bytes';
import { writeDst } from '../src/writers/dst';
import { outputFileName } from '../src/writers';
import { writePes } from '../src/writers/pes';
import { encodeDst, encodePes, type Op } from './helpers/encode';
import { Shape } from './helpers/shapes';

const records = (p: Pattern) => ({ x: Array.from(p.x), y: Array.from(p.y), cmd: Array.from(p.cmd) });

/** Positions of STITCH records, the part of a design that must survive any conversion. */
const stitches = (p: Pattern) => {
  const out: [number, number][] = [];
  for (let i = 0; i < p.cmd.length; i++) if (p.cmd[i] === STITCH) out.push([p.x[i], p.y[i]]);
  return out;
};
const count = (p: Pattern, c: number) => p.cmd.filter((v) => v === c).length;

const mixed: Op[] = [
  { type: 'stitch', dx: 0, dy: 0 },
  { type: 'stitch', dx: 30, dy: 5 },
  { type: 'stitch', dx: -30, dy: 5 },
  { type: 'jump', dx: 50, dy: 0 },
  { type: 'stitch', dx: 10, dy: 10 },
  { type: 'stitch', dx: 121, dy: -121 },
  { type: 'trim' },
  { type: 'jump', dx: 100, dy: 40 },
  { type: 'stitch', dx: 3, dy: 3 },
  { type: 'color' },
  { type: 'stitch', dx: -20, dy: 7 },
  { type: 'stitch', dx: 20, dy: 7 },
  { type: 'trim' },
  { type: 'color' },
  { type: 'stitch', dx: 5, dy: 5 },
];

describe('splitMove', () => {
  it('splits into the fewest equal pieces within range', () => {
    expect(splitMove(0, 0, 121)).toEqual([[0, 0]]);
    expect(splitMove(121, -121, 121)).toEqual([[121, -121]]);
    const pieces = splitMove(300, -50, 121);
    expect(pieces).toHaveLength(3);
    expect(pieces.reduce((a, [x]) => a + x, 0)).toBe(300);
    expect(pieces.reduce((a, [, y]) => a + y, 0)).toBe(-50);
    expect(pieces.every(([x, y]) => Math.abs(x) <= 121 && Math.abs(y) <= 121)).toBe(true);
  });
});

describe('DST writer', () => {
  it('round-trips a parsed DST file record for record', () => {
    const p = parseDst(encodeDst(mixed, 'MIXED'));
    const q = parseDst(writeDst(p));
    expect(q.name).toBe('MIXED');
    expect(records(q)).toEqual(records(p));
    expect(q.colors).toHaveLength(p.colors.length);
  });

  it('does not grow trims on repeated saves', () => {
    const once = writeDst(parseDst(encodeDst(mixed)));
    const twice = writeDst(parseDst(once));
    const thrice = writeDst(parseDst(twice));
    expect(twice).toEqual(once);
    expect(thrice).toEqual(once);
    expect(count(parseDst(once), TRIM)).toBe(2);
  });

  it('pads a trim that has fewer than 3 jumps after it', () => {
    const p = new Shape().to(0, 0).to(1, 0).trim().to(2, 0).build();
    const q = parseDst(writeDst(p));
    expect(count(q, TRIM)).toBe(1);
    expect(stitches(q)).toEqual(stitches(p));
  });

  it('splits long stitches into jumps and one stitch, keeping the penetrations', () => {
    const p = new Shape().to(0, 0).to(30, 0).to(30, 1).build(); // a 30 mm stitch
    const q = parseDst(writeDst(p));
    expect(stitches(q)).toEqual(stitches(p));
    expect(count(q, TRIM)).toBe(0);
  });

  it('keeps long untrimmed jumps from turning into trims when they fit in fewer records', () => {
    const p = new Shape().to(0, 0).jump(5, 0).jump(10, 0).jump(15, 0).to(16, 0).build();
    const q = parseDst(writeDst(p));
    expect(count(q, TRIM)).toBe(0);
    expect(stitches(q)).toEqual(stitches(p));
  });

  it('writes a header the reader and other tools understand', () => {
    const data = writeDst(parseDst(encodeDst(mixed, 'HEAD')));
    const head = new TextDecoder('latin1').decode(data.subarray(0, 512));
    expect(head.startsWith('LA:HEAD            \r')).toBe(true);
    expect(head).toMatch(/ST: +\d+\r/);
    expect(head).toMatch(/CO: +2\r/);
    expect(head).toMatch(/\+X: +\d+\r-X: +\d+\r\+Y: +\d+\r-Y: +\d+\r/);
    expect(data[data.length - 1]).toBe(0xf3);
    expect((data.length - 512) % 3).toBe(0);
  });
});

describe('PES writer', () => {
  const pesOps: Op[] = [
    { type: 'stitch', dx: 5, dy: -5 },
    { type: 'stitch', dx: 300, dy: 0 },
    { type: 'jump', dx: -20, dy: 40 },
    { type: 'stitch', dx: 0, dy: 1 },
    { type: 'stitch', dx: -64, dy: 63 },
    { type: 'color' },
    { type: 'trim' },
    { type: 'jump', dx: 1000, dy: -1000 },
    { type: 'stitch', dx: 10, dy: 10 },
    { type: 'color' },
    { type: 'stitch', dx: 1, dy: 1 },
  ];

  it('round-trips a parsed PES file record for record, keeping palette slots', () => {
    // 20 is "Black", which has the same RGB as slot 0; the slot must survive.
    const p = parsePes(encodePes(pesOps, [5, 20, 29], 'PESTEST'));
    const q = parsePes(writePes(p));
    expect(q.name).toBe('PESTEST');
    expect(records(q)).toEqual(records(p));
    expect(q.colors.map((c) => c.pecIndex)).toEqual([5, 20, 29]);
    expect(writePes(q)).toEqual(writePes(p));
  });

  it('flags only real trims, not every jump', () => {
    const p = parsePes(encodePes(pesOps, [5, 20, 29]));
    const q = parsePes(writePes(p));
    expect(count(q, TRIM)).toBe(1);
    expect(count(q, JUMP)).toBe(2);
  });

  it('turns a trim without a following jump into a zero trimmed jump', () => {
    const p = new Shape().to(0, 0).to(1, 0).trim().to(2, 0).build();
    const q = parsePes(writePes(p));
    expect(Array.from(q.cmd)).toEqual([STITCH, STITCH, TRIM, JUMP, STITCH]);
    expect(stitches(q)).toEqual(stitches(p));
  });

  it('splits moves beyond the 12-bit range', () => {
    const p = new Shape().to(0, 0).jump(300, 0).to(300, 1).to(0, 1).build(); // 300 mm moves
    const q = parsePes(writePes(p));
    expect(stitches(q)).toEqual(stitches(p));
  });

  it('writes the PEC length so the thumbnails can be found', () => {
    const p = parsePes(encodePes(pesOps, [5, 20, 29]));
    const data = writePes(p);
    const view = new DataView(data.buffer);
    const pec = view.getUint32(8, true);
    const len = data[pec + 514] | (data[pec + 515] << 8) | (data[pec + 516] << 16);
    // Three color blocks: four 48 x 38 icons of 228 bytes follow the stitch block.
    expect(pec + 512 + len + 4 * 228).toBe(data.length);
    expect(data[pec + 512 + len - 1]).toBe(0xff);
    // Some readers stop only at FF 00, so the first icon row must be blank.
    expect(data[pec + 512 + len]).toBe(0x00);
  });

  it('maps colors without a palette slot to the nearest PEC thread', () => {
    expect(pecIndexOf({ r: 236, g: 20, b: 30 })).toBe(5); // red
    expect(pecIndexOf({ r: 0, g: 0, b: 0 })).toBe(20); // black, not "unknown"
    expect(pecIndexOf(pecColor(13))).toBe(13);
  });
});

describe('conversions', () => {
  it('DST to PES to DST keeps stitches, trims and color changes', () => {
    const p = parseDst(encodeDst(mixed));
    const viaPes = parsePes(writePes(p));
    expect(records(viaPes)).toEqual(records(p));
    const back = parseDst(writeDst(viaPes));
    expect(records(back)).toEqual(records(p));
  });

  it('PES to DST keeps the stitches, trims and color changes', () => {
    const p = parsePes(encodePes(mixed, [5, 13, 2]));
    const q = parseDst(writeDst(p));
    expect(stitches(q)).toEqual(stitches(p));
    expect(count(q, TRIM)).toBe(count(p, TRIM));
    expect(count(q, COLOR_CHANGE)).toBe(count(p, COLOR_CHANGE));
  });

  it('writes files the format sniffer accepts', () => {
    const p = new Shape().fill(0, 0, 10, 10, 'h').build();
    expect(parsePattern(writePes(p), 'x.pes').format).toBe('pes');
    expect(stitches(parsePattern(writeDst(p), 'x.dst'))).toEqual(stitches(p));
  });

  it('names corrected files', () => {
    expect(outputFileName('Katze.PES', 'dst', true)).toBe('Katze-corrected.dst');
    expect(outputFileName('a.b.dst', 'pes', false)).toBe('a.b.pes');
  });
});
