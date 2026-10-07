import { describe, expect, it } from 'vitest';
import { digitize, digitizeDefaults, type Digitized, type DigitizeOptions } from '../src/digitize/digitize';
import { buildRegion } from '../src/digitize/region';
import { acrossGraph, areaKey, areaPixels, groupAreas, groupsByColor, letterOf, readAreas } from '../src/digitize/smart';
import { components } from '../src/image/labels';
import { DEFAULT_PREPARE, Preparer, type Prepared } from '../src/image/prepare';
import { normalizeImage } from '../src/settings';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { BLUE, raster, WHITE, YELLOW, type Rgba } from './helpers/images';

const BROWN: Rgba = [150, 100, 60, 255];
const DARK: Rgba = [128, 84, 48, 255];

/**
 * 60 x 30 mm at 0.1 mm: a calm blue square, two small yellow dots, and a brown area with fine
 * diagonal strands (fur) whose two shades are one thread.
 */
function picture(): Prepared {
  const img = raster(600, 300, (x, y) => {
    if (x >= 20 && x < 170 && y >= 20 && y < 170) return BLUE;
    if (Math.hypot(x - 250, y - 80) < 16 || Math.hypot(x - 250, y - 220) < 16) return YELLOW;
    if (x >= 300 && x < 560 && y >= 40 && y < 260) return Math.floor((x + y) / 4) % 2 ? BROWN : DARK;
    return WHITE;
  });
  return new Preparer(img).run({ ...DEFAULT_PREPARE, widthMm: 60, maxColors: 4 });
}

const options = (o: Partial<DigitizeOptions> = {}): DigitizeOptions => ({ ...digitizeDefaults(DEFAULT_PROFILE), flow: false, smart: true, ...o });
/** The areas sewn in the thread nearest to color `c`. */
const byColor = (d: Digitized, p: Prepared, c: Rgba) => {
  const far = (k: number) => {
    const t = p.palette[k].thread;
    return Math.abs(t.r - c[0]) + Math.abs(t.g - c[1]) + Math.abs(t.b - c[2]);
  };
  const near = p.palette.map((_, k) => k).sort((a, b) => far(a) - far(b))[0];
  return d.areas!.filter((a) => a.label === near);
};

describe('Smart', () => {
  const prep = picture();

  it('gives each area the technique that suits it', () => {
    const d = digitize(prep, options());
    expect(byColor(d, prep, BLUE).map((a) => [a.reason, a.technique])).toEqual([['calm', 'flat']]);
    expect(byColor(d, prep, YELLOW).map((a) => [a.reason, a.technique])).toEqual([['round', 'satin'], ['round', 'satin']]);
    expect(byColor(d, prep, BROWN).map((a) => [a.reason, a.technique])).toEqual([['structure', 'dynamic']]);
    // Letters in sewing order, one per group.
    expect(d.areas!.map((a) => a.letter)).toEqual(['A', 'B', 'C', 'C']);
    // The yellow dot is one satin object.
    const dot = d.objects.find((o) => o.area === byColor(d, prep, YELLOW)[0].key)!;
    expect(dot.kind).toBe('satin');
  });

  it('sews an area as set by hand, also back to what Smart chooses', () => {
    const first = digitize(prep, options());
    const dot = byColor(first, prep, YELLOW)[0];
    const fur = byColor(first, prep, BROWN)[0];
    const d = digitize(prep, options({ areas: { [dot.key]: 'flat', [fur.key]: 'flat' } }));
    // Only that dot: the other one of its group stays satin, and both keep their names.
    expect(byColor(d, prep, YELLOW).map((a) => [a.name, a.technique, a.fixed])).toEqual([
      ['C1', 'flat', true],
      ['C2', 'satin', false],
    ]);
    expect(byColor(first, prep, YELLOW).map((a) => a.name)).toEqual(['C1', 'C2']);
    expect(byColor(d, prep, YELLOW)[0]).toMatchObject({ key: dot.key, technique: 'flat', auto: 'satin', fixed: true });
    expect(byColor(d, prep, BROWN)[0]).toMatchObject({ technique: 'flat', auto: 'dynamic', fixed: true });
    expect(d.objects.find((o) => o.area === dot.key)!.kind).toBe('fill');
    expect(d.objects.find((o) => o.area === fur.key)!.curved).toBeFalsy();
    // Flat and Dynamisch do not know the areas: all as the style says.
    expect(digitize(prep, options({ smart: false })).areas).toEqual([]);
  });

  it('lists alike areas of one color as one group, set by hand for all, some or none', () => {
    const areas = [
      { key: 'a', letter: 'A', name: 'A1', label: 0, areaMm2: 4, at: [0, 0] as [number, number], technique: 'satin' as const, auto: 'satin' as const, reason: 'round' as const, fixed: false },
      { key: 'b', letter: 'A', name: 'A2', label: 0, areaMm2: 5, at: [0, 0] as [number, number], technique: 'satin' as const, auto: 'satin' as const, reason: 'round' as const, fixed: false },
      { key: 'c', letter: 'B', name: 'B', label: 1, areaMm2: 50, at: [0, 0] as [number, number], technique: 'flat' as const, auto: 'flat' as const, reason: 'calm' as const, fixed: false },
    ];
    const g = groupAreas(areas, { a: 'flat' });
    expect(g.map((x) => [x.letter, x.keys, x.areaMm2, x.fixed])).toEqual([
      ['A', ['a', 'b'], 9, 'mixed'],
      ['B', ['c'], 50, null],
    ]);
    expect(groupAreas(areas, { a: 'flat', b: 'flat' })[0].fixed).toBe('flat');
  });

  it('lists the groups under their thread color, colors as sewn', () => {
    const g = (letter: string, label: number) => ({ letter, label, reason: 'calm' as const, keys: [letter], areaMm2: 1, auto: 'flat' as const, fixed: null });
    expect(groupsByColor([g('A', 2), g('B', 2), g('C', 0), g('D', 1), g('E', 1)]).map((c) => [c.label, c.groups.map((x) => x.letter)])).toEqual([
      [2, ['A', 'B']],
      [0, ['C']],
      [1, ['D', 'E']],
    ]);
  });

  it('finds the pixels of an area: its pieces in its box, not a dot inside that is an area of its own', () => {
    // A ring of color 1 cut in two by color 2, with a dot of color 1 in the middle.
    const w = 9;
    const rows = ['111121111', '100020001', '100111001', '100111001', '100020001', '111121111'];
    const labels = Uint8Array.from(rows.join(''), (c) => Number(c));
    const comps = components(labels, w, rows.length);
    const ring = areaKey(1, 0, 0, 8, 5);
    const dot = areaKey(1, 3, 2, 5, 3);
    const px = areaPixels(comps, w, rows.length, [{ key: ring }, { key: dot }], [ring]);
    const at = (x: number, y: number) => px[y * w + x];
    expect([at(0, 0), at(8, 5), at(4, 0), at(4, 2), at(1, 1)]).toEqual([1, 1, 0, 0, 0]);
    expect(areaPixels(comps, w, rows.length, [{ key: ring }, { key: dot }], [dot]).reduce((a, b) => a + b, 0)).toBe(6);
  });

  it('names groups A to Z, then AA', () => {
    expect([0, 25, 26, 27, 701, 702].map(letterOf)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });

  it('sews satin across only small round areas', () => {
    const dot = raster(200, 200, (x, y) => (Math.hypot(x - 100, y - 100) < 20 ? YELLOW : WHITE));
    const big = raster(400, 400, (x, y) => (Math.hypot(x - 200, y - 200) < 100 ? YELLOW : WHITE));
    const region = (img: ReturnType<typeof raster>, mm: number) => {
      const p = new Preparer(img).run({ ...DEFAULT_PREPARE, widthMm: mm, maxColors: 2 });
      const label = p.labels[Math.floor(p.height / 2) * p.width + Math.floor(p.width / 2)];
      const comp = Int32Array.from(p.labels, (l) => (l === label ? 0 : -1));
      return buildRegion(comp, p.labels, p.width, 0, label, { minX: 0, minY: 0, maxX: p.width - 1, maxY: p.height - 1 }, p.height, p.pxMm, 0, () => false);
    };
    expect(acrossGraph(region(dot, 20), 7)?.branches).toHaveLength(1);
    expect(acrossGraph(region(big, 40), 7)).toBeNull();
  });

  it('keeps only known techniques when read, and Smart as a style', () => {
    expect(readAreas({ a: 'flat', b: 'bogus', c: 3 })).toEqual({ a: 'flat' });
    expect(readAreas(null)).toEqual({});
    expect(normalizeImage({ style: 'smart' }).style).toBe('smart');
  });
});
