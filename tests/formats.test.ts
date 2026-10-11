import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLOR_CHANGE, STITCH, TRIM, type Pattern } from '../src/model/pattern';
import { parsePattern, SUPPORTED_EXTENSIONS } from '../src/parsers';
import { jefColor } from '../src/parsers/jefPalette';
import { cleanName, OUTPUT_FORMATS, writePattern, type OutputFormat } from '../src/writers';
import { writeJef } from '../src/writers/jef';
import { Shape } from './helpers/shapes';

const fixture = (f: string) => new Uint8Array(readFileSync(new URL(`./fixtures/pyembroidery/${f}`, import.meta.url)));
const example = (f: string) =>
  parsePattern(new Uint8Array(readFileSync(new URL(`../public/examples/${f}`, import.meta.url))), f.split('/').pop()!);
const expected = JSON.parse(new TextDecoder().decode(fixture('expected.json'))) as {
  stitches: [number, number][];
  files: Record<string, { trims: number; colorChanges: number; colors: [number, number, number][] }>;
};

const stitches = (p: Pattern) => {
  const out: [number, number][] = [];
  for (let i = 0; i < p.cmd.length; i++) if (p.cmd[i] === STITCH) out.push([p.x[i], p.y[i]]);
  return out;
};
/** Stitch positions relative to the first, for readers that place the design differently. */
const relative = (s: [number, number][]) => s.map(([x, y]) => [x - s[0][0], y - s[0][1]]);
const count = (p: Pattern, c: number) => p.cmd.filter((v) => v === c).length;
const rgb = (p: Pattern) => p.colors.map((c) => [c.r, c.g, c.b]);

describe('readers agree with pyembroidery', () => {
  it.each([
    ['sun.jef', 'jef'],
    ['sun.exp', 'exp'],
    ['sun.vp3', 'vp3'],
    ['sun.xxx', 'xxx'],
    ['sun.sew', 'sew'],
  ])('%s: same stitches, trims and color changes', (file, format) => {
    const p = parsePattern(fixture(file), file);
    const e = expected.files[file];
    expect(p.format).toBe(format);
    expect(stitches(p)).toEqual(expected.stitches);
    expect(count(p, TRIM)).toBe(e.trims);
    expect(count(p, COLOR_CHANGE)).toBe(e.colorChanges);
  });

  // heatstitch places PEC designs at their first stitch, pyembroidery at the hoop origin.
  it.each([
    ['sun.pec', 'pec'],
    ['sun-v6.pes', 'pes'],
  ])('%s: same stitches (shifted), trims and color changes', (file, format) => {
    const p = parsePattern(fixture(file), file);
    const e = expected.files[file];
    expect(p.format).toBe(format);
    expect(relative(stitches(p))).toEqual(relative(expected.stitches));
    expect(count(p, TRIM)).toBe(e.trims);
    expect(count(p, COLOR_CHANGE)).toBe(e.colorChanges);
  });

  it('a PES that starts sewing at the origin: the first record sits where Brother puts its opening move', () => {
    // pyembroidery 1.5.1 writes records from byte 528 on; here the first is a 2-byte stitch.
    const p = parsePattern(fixture('origin-start.pes'), 'origin-start.pes');
    expect(stitches(p)).toEqual([[0, 0], [20, 0], [20, 20], [0, 20], [0, 0], [10, 10], [200, 100], [230, 100], [230, 130]]);
    expect(count(p, TRIM)).toBe(1);
  });

  it('reads JEF colors from the Janome palette', () => {
    expect(rgb(parsePattern(fixture('sun.jef'), 'sun.jef'))).toEqual(expected.files['sun.jef'].colors);
  });

  it('reads exact XXX colors and SEW colors from the Janome SEW table', () => {
    for (const file of ['sun.xxx', 'sun.sew']) expect(rgb(parsePattern(fixture(file), file)), file).toEqual(expected.files[file].colors);
  });

  it('reads real thread colors with name, brand and catalog number from VP3 and the PES header', () => {
    for (const file of ['sun.vp3', 'sun-v6.pes']) {
      const p = parsePattern(fixture(file), file);
      expect(rgb(p)).toEqual(expected.files[file].colors);
      expect(p.colors[0]).toMatchObject({ name: 'Royal Blue', brand: 'Madeira', catalog: '1076' });
    }
  });

  it('keeps the PEC slot of PES header colors for saving', () => {
    const p = parsePattern(fixture('sun-v6.pes'), 'sun-v6.pes');
    expect(p.colors.every((c) => typeof c.pecIndex === 'number' && c.pecIndex > 0)).toBe(true);
  });

  it('accepts every format in the file picker list', () => {
    expect(SUPPORTED_EXTENSIONS).toEqual(['.dst', '.pes', '.pec', '.jef', '.exp', '.vp3', '.xxx', '.sew']);
  });
});

describe('writers', () => {
  const designs = ['demos/sun.dst', 'demos/confetti.pes', 'demos/letters.pes', 'cat-60mm.pes'];

  it.each(designs)('%s: every format reads back with the same stitches and colors blocks', (file) => {
    const p = example(file);
    for (const format of OUTPUT_FORMATS) {
      const q = parsePattern(writePattern(p, format), `out.${format}`);
      expect(q.format, format).toBe(format);
      expect(count(q, COLOR_CHANGE), format).toBe(count(p, COLOR_CHANGE));
      expect(q.colors, format).toHaveLength(p.colors.length);
      // JEF and XXX split stitches longer than 12.7 and 12.3 mm into equal stitches.
      if (format !== 'jef' && format !== 'xxx') expect(stitches(q), format).toEqual(stitches(p));
      else {
        const kept = new Set(stitches(q).map(String));
        expect(stitches(p).filter((s) => !kept.has(String(s))), format).toEqual([]);
      }
    }
  });

  it('keeps every cut where the format can store it', () => {
    const p = example('demos/confetti.pes');
    const cuts = count(p, TRIM);
    for (const format of ['pes', 'pec', 'exp', 'xxx'] as OutputFormat[]) {
      expect(count(parsePattern(writePattern(p, format), `out.${format}`), TRIM), format).toBe(cuts);
    }
  });

  it('VP3 keeps exact colors with name, brand and catalog number', () => {
    const p = parsePattern(fixture('sun.vp3'), 'sun.vp3');
    const q = parsePattern(writePattern(p, 'vp3'), 'out.vp3');
    expect(q.colors).toEqual(p.colors);
  });

  it('XXX keeps the exact colors of every block', () => {
    const p = parsePattern(fixture('sun.vp3'), 'sun.vp3');
    const q = parsePattern(writePattern(p, 'xxx'), 'out.xxx');
    expect(rgb(q)).toEqual(rgb(p));
  });

  it('offers SEW for opening only, not for saving', () => {
    expect(SUPPORTED_EXTENSIONS).toContain('.sew');
    expect(OUTPUT_FORMATS).not.toContain('sew' as OutputFormat);
    expect(OUTPUT_FORMATS).toContain('xxx');
  });

  it('VP3 never starts a color block at x or y exactly 0', () => {
    // pyembroidery, and Ink/Stitch with it, would skip the move to such a start.
    const p = new Shape().to(0, 0).to(1, 0).to(1, 1).build();
    const q = parsePattern(writePattern(p, 'vp3'), 'out.vp3');
    expect(stitches(q)).toEqual(stitches(p));
  });

  it('JEF: a cut before a long move survives, long stitches become equal stitches', () => {
    const p = new Shape().to(0, 0).to(1, 0).trim().jump(20, 0).to(20, 1).to(40, 1).build();
    const q = parsePattern(writeJef(p), 'out.jef');
    expect(count(q, TRIM)).toBe(1);
    const s = stitches(q);
    expect(s.slice(0, 3)).toEqual(stitches(p).slice(0, 3));
    expect(s[s.length - 1]).toEqual([400, 10]);
    expect(s.length).toBe(stitches(p).length + 1); // 20 mm in two stitches
  });

  it('JEF: a cut before a short move survives as three zero-length jumps', () => {
    // 3 mm and 0.5 mm after the cut: too short for a cut by jump length.
    for (const to of [8, 5.5]) {
      const p = new Shape().to(0, 0).to(5, 0).trim().jump(to, 0).to(to, 1).to(12, 1).build();
      const data = writeJef(p);
      const q = parsePattern(data, 'out.jef');
      expect(count(q, TRIM), `${to}`).toBe(1);
      expect(stitches(q)).toEqual(stitches(p));
      const zeroJumps = [...data.subarray(new DataView(data.buffer).getUint32(0, true))].join(',').split('128,2,0,0').length - 1;
      expect(zeroJumps).toBe(3);
    }
  });

  it('JEF: a jump of no length is not written, it would read as a cut', () => {
    const p = new Shape().to(0, 0).to(5, 0).jump(5, 0).to(6, 0).build();
    expect(count(parsePattern(writeJef(p), 'out.jef'), TRIM)).toBe(0);
  });

  it('JEF: different colors get different Janome threads, even when not neighbors', () => {
    const p = example('demos/sun.dst');
    const black = jefColor(1);
    p.colors = [black, jefColor(2), { ...black, r: black.r + 3 }];
    const q = parsePattern(writeJef(p), 'out.jef');
    expect(q.colors[0]).toEqual(black);
    expect(q.colors[2]).not.toEqual(q.colors[0]);
  });

  it('JEF: the way to the first stitch is jumps, not a stitch from the middle', () => {
    const p = new Shape().to(0, 30).to(1, 30).build();
    const q = parsePattern(writeJef(p), 'out.jef');
    expect(stitches(q)).toEqual(stitches(p));
  });

  it('JEF: neighboring colors that round to the same Janome thread stay apart', () => {
    const p = example('demos/sun.dst');
    const black = jefColor(1);
    p.colors = [black, { ...black, r: black.r + 3 }, jefColor(2)];
    const q = parsePattern(writeJef(p), 'out.jef');
    expect(q.colors[0]).not.toEqual(q.colors[1]);
  });

  it('JEF header: offset, color count and hoop', () => {
    const data = writeJef(example('demos/sun.dst'), new Date(2026, 9, 5, 12, 0, 0));
    const view = new DataView(data.buffer);
    expect(view.getUint32(0, true)).toBe(0x74 + 3 * 8);
    expect(new TextDecoder().decode(data.subarray(8, 22))).toBe('20261005120000');
    expect(view.getInt32(24, true)).toBe(3);
    expect(Array.from(data.subarray(data.length - 2))).toEqual([0x80, 0x10]);
  });

  it('bare PEC files start with their signature', () => {
    const data = writePattern(example('demos/sun.dst'), 'pec');
    expect(new TextDecoder().decode(data.subarray(0, 11))).toBe('#PEC0001LA:');
  });

  it('cleans a typed name for the file system', () => {
    expect(cleanName('  Sonne: für/Oma?.pes ')).toBe('Sonne fürOma');
    expect(cleanName('a.b.jef')).toBe('a.b');
    expect(cleanName('<>')).toBe('');
  });
});
