import { describe, expect, it } from 'vitest';
import { COLOR_CHANGE, JUMP, STITCH, TRIM, type Pattern } from '../src/model/pattern';
import { parseDst } from '../src/parsers/dst';
import { parsePes } from '../src/parsers/pes';
import { parseSew } from '../src/parsers/sew';
import { sewColor } from '../src/parsers/sewPalette';
import { parseXxx } from '../src/parsers/xxx';
import { pecColor, pecIndexOf } from '../src/parsers/pecPalette';
import { splitMove } from '../src/writers/bytes';
import { writeDst } from '../src/writers/dst';
import { writePes } from '../src/writers/pes';
import { writeXxx, XXX_MAX_JUMP, XXX_MAX_STITCH } from '../src/writers/xxx';
import { encodeDst, encodePes, encodeSew, encodeXxx, type Op } from './helpers/encode';
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

describe('XXX writer', () => {
  // Within what the writer keeps to, so nothing needs splitting: 8 mm jumps, 12.3 mm stitches.
  const xxxOps: Op[] = [
    { type: 'jump', dx: 80, dy: -80 },
    { type: 'stitch', dx: 0, dy: 0 },
    { type: 'stitch', dx: 30, dy: 5 },
    { type: 'stitch', dx: -123, dy: 123 },
    { type: 'jump', dx: 50, dy: 0 },
    { type: 'stitch', dx: 10, dy: 10 },
    { type: 'trim' },
    { type: 'jump', dx: -80, dy: 40 },
    { type: 'jump', dx: 20, dy: 80 },
    { type: 'stitch', dx: 3, dy: 3 },
    { type: 'trim' },
    { type: 'color' },
    { type: 'jump', dx: 7, dy: -7 },
    { type: 'stitch', dx: -20, dy: 7 },
    { type: 'stitch', dx: 20, dy: 7 },
    { type: 'color' },
    { type: 'stitch', dx: 5, dy: 5 },
  ];
  const rgb: [number, number, number][] = [
    [10, 85, 163],
    [237, 23, 31],
    [112, 188, 31],
  ];

  /** The records of a written stream: [first byte, command or -1, dx, dy]. */
  const xxxRecords = (data: Uint8Array) => {
    const out: { lead: number; code: number; dx: number; dy: number }[] = [];
    const s8 = (v: number) => (v > 0x7f ? v - 0x100 : v);
    for (let i = 0x100; ; ) {
      const lead = data[i];
      if (lead === 0x7d || lead === 0x7e) throw new Error(`long record 0x${lead.toString(16)} at ${i}`);
      if (lead !== 0x7f) {
        out.push({ lead, code: -1, dx: s8(lead), dy: s8(data[i + 1]) });
        i += 2;
        continue;
      }
      if (data[i + 1] === 0x7f) return out;
      out.push({ lead, code: data[i + 1], dx: s8(data[i + 2]), dy: s8(data[i + 3]) });
      i += 4;
    }
  };

  it('round-trips a parsed XXX file record for record, with exact colors', () => {
    const p = parseXxx(encodeXxx(xxxOps, rgb));
    expect(count(p, TRIM)).toBe(2);
    expect(count(p, COLOR_CHANGE)).toBe(2);
    const q = parseXxx(writeXxx(p));
    expect(records(q)).toEqual(records(p));
    expect(q.colors.map((c) => [c.r, c.g, c.b])).toEqual(rgb);
    expect(writeXxx(q)).toEqual(writeXxx(p));
  });

  it('keeps jumps within 8 mm and stitches within 12.3 mm, without long records', () => {
    // A 30 mm stitch, a 50 mm jump after a cut, a long untrimmed jump and a 25 mm way after a color change.
    const p = new Shape().jump(40, 40).to(40, 40).to(70, 40).to(70, 41).trim().jump(20, 90).to(20, 91).jump(60, 91).to(61, 91).build();
    p.cmd = Uint8Array.from([...p.cmd, COLOR_CHANGE, STITCH]);
    p.x = Int32Array.from([...p.x, 610, 360]);
    p.y = Int32Array.from([...p.y, 910, 910]);
    const data = writeXxx(p);
    const recs = xxxRecords(data);
    for (const r of recs) {
      const max = r.code === 0x01 ? XXX_MAX_JUMP : XXX_MAX_STITCH;
      expect(Math.abs(r.dx), JSON.stringify(r)).toBeLessThanOrEqual(max);
      expect(Math.abs(r.dy), JSON.stringify(r)).toBeLessThanOrEqual(max);
    }
    expect(recs.some((r) => r.code === 0x01 && Math.max(Math.abs(r.dx), Math.abs(r.dy)) === XXX_MAX_JUMP)).toBe(true);
    const q = parseXxx(data);
    expect(count(q, TRIM)).toBe(1);
    expect(count(q, COLOR_CHANGE)).toBe(1);
    // Every meant penetration is there; long stitches only gain equal ones in between.
    const kept = new Set(stitches(q).map(String));
    expect(stitches(p).filter((s) => !kept.has(String(s)))).toEqual([]);
    expect(stitches(q).slice(1, 4)).toEqual([[500, 400], [600, 400], [700, 400]]); // the 30 mm stitch in three equal pieces
    // The way to the first stitch and after a cut is jumps, not stitches.
    expect(stitches(q)[0]).toEqual([400, 400]);
    expect(stitches(q).slice(-2)).toEqual([[610, 910], [360, 910]]);
    expect(stitches(q).filter(([, y]) => y > 410 && y < 900)).toEqual([]);
  });

  it('reads a 0x7D long stitch and splits it when writing', () => {
    const p = parseXxx(encodeXxx([{ type: 'stitch', dx: 0, dy: 0 }, { type: 'stitch', dx: 300, dy: -50 }], [[1, 2, 3]]));
    expect(stitches(p)).toEqual([[0, 0], [300, -50]]);
    const q = parseXxx(writeXxx(p));
    expect(stitches(q)).toEqual([[0, 0], [100, -17], [200, -33], [300, -50]]);
    expect(q.colors.map((c) => [c.r, c.g, c.b])).toEqual([[1, 2, 3]]);
  });

  it('writes the header and the color table where readers look', () => {
    const data = writeXxx(parseXxx(encodeXxx(xxxOps, rgb)));
    const view = new DataView(data.buffer);
    expect(view.getUint16(0x27, true)).toBe(3);
    const end = view.getUint32(0xfc, true);
    expect(Array.from(data.subarray(end, end + 4))).toEqual([0x7f, 0x7f, 0x02, 0x14]);
    expect(Array.from(data.subarray(end + 6, end + 10))).toEqual([0, 10, 85, 163]);
    expect(view.getUint32(0x17, true)).toBe(xxxRecords(data).length);
  });
});

describe('SEW reader', () => {
  const sewOps: Op[] = [
    { type: 'stitch', dx: 0, dy: 0 },
    { type: 'stitch', dx: 30, dy: 5 },
    { type: 'jump', dx: 100, dy: -40 },
    { type: 'stitch', dx: -127, dy: 127 },
    { type: 'color' },
    { type: 'jump', dx: 7, dy: -7 },
    { type: 'stitch', dx: -20, dy: 7 },
    { type: 'color' },
    { type: 'stitch', dx: 5, dy: 5 },
  ];

  it('reads stitches, jumps and color changes from 0x1D78', () => {
    const p = parseSew(encodeSew(sewOps, [12, 10, 6]), 'sun');
    expect(p.format).toBe('sew');
    expect(Array.from(p.cmd)).toEqual([STITCH, STITCH, JUMP, STITCH, COLOR_CHANGE, JUMP, STITCH, COLOR_CHANGE, STITCH]);
    expect(stitches(p)).toEqual([[0, 0], [30, 5], [3, 92], [-10, 92], [-5, 97]]);
    expect(count(p, TRIM)).toBe(0);
  });

  it('takes colors from the SEW table, not the JEF one, wrapping large indices', () => {
    const p = parseSew(encodeSew(sewOps, [12, 10, 6 + 79]));
    expect(p.colors.map((c) => [c.r, c.g, c.b])).toEqual([[0, 0, 240], [255, 0, 0], [64, 192, 48]]);
    expect(p.colors[0].name).toBe('Blue');
    expect(sewColor(0).name).toBe('Unknown');
  });

  it('gives every color block a color when the header lists fewer', () => {
    const p = parseSew(encodeSew(sewOps, [2]));
    expect(p.colors).toHaveLength(3);
    expect(p.colors.every((c) => c.name === 'White')).toBe(true);
  });

  it('refuses a file shorter than its header', () => {
    expect(() => parseSew(new Uint8Array(100))).toThrow(/SEW/);
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
});
