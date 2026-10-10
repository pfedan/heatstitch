import { describe, expect, it } from 'vitest';
import { digitizeDefaults, digitizeShapes, type ShapeInput } from '../src/digitize/digitize';
import { formFrom, storeForm, type Mat } from '../src/shape/path';
import { knockOut, rasterize, rasterizeStroke } from '../src/shape/rasterize';
import { ellipsePath, parsePath, pointsPath, rectPath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { syncBorders } from '../src/model/border';
import { digitizedFile } from '../src/model/digitized';
import { sewObjects } from '../src/model/objects';
import { sameColor } from '../src/model/recolor';
import { remembered, rememberedIn, restoreRemembered } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const threads = [
  { r: 210, g: 40, b: 50 },
  { r: 30, g: 90, b: 180 },
  { r: 240, g: 200, b: 30 },
];

describe('SVG geometry as forms', () => {
  it('reads a circle as four round nodes', () => {
    const f = parsePath(ellipsePath(10, 10, 5, 5), ID);
    expect(f.paths).toHaveLength(1);
    expect(f.paths[0].closed).toBe(true);
    expect(f.paths[0].nodes).toHaveLength(4);
    expect(f.paths[0].nodes.every((n) => n.smooth)).toBe(true);
    const r = rasterize(f)!;
    expect(r.areaMm2).toBeCloseTo(Math.PI * 25, 0);
  });

  it('reads all path commands, relative ones and arcs', () => {
    // A 10 mm square drawn with H, v, l and z, and a half disc by an arc.
    const sq = parsePath('M0 0 H10 v10 l-10 0 z', ID);
    expect(sq.paths[0].nodes).toHaveLength(4);
    expect(rasterize(sq)!.areaMm2).toBeCloseTo(100, 0);
    const half = parsePath('M0 0 A5 5 0 0 1 10 0 Z', ID);
    expect(rasterize(half)!.areaMm2).toBeCloseTo((Math.PI * 25) / 2, 0);
    // Arc flags without separators, smooth curves and quadratic ones parse too.
    expect(parsePath('M0 0a5 5 0 0110 0z', ID).paths).toHaveLength(1);
    expect(parsePath('M0 0 C1 2 3 4 5 5 S9 8 10 10 Q12 12 14 10 T18 10', ID).paths[0].nodes).toHaveLength(5);
  });

  it('maps by the matrix and builds rectangles and polygons', () => {
    const scaled = parsePath(rectPath(0, 0, 10, 5, 0, 0), [2, 0, 0, 2, 1, 1]);
    expect(rasterize(scaled)!.areaMm2).toBeCloseTo(200, 0);
    const rounded = rasterize(parsePath(rectPath(0, 0, 10, 10, 2, 2), ID))!;
    expect(rounded.areaMm2).toBeCloseTo(100 - (4 - Math.PI) * 4, 0);
    expect(rasterize(parsePath(pointsPath('0,0 10,0 0,10', true), ID))!.areaMm2).toBeCloseTo(50, 0);
  });

  it('fills by the nonzero rule when asked: paths the same way add up', () => {
    const d = 'M0 0 H10 V10 H0 Z M2 2 H8 V8 H2 Z';
    expect(rasterize(parsePath(d, ID))!.areaMm2).toBeCloseTo(64, 0);
    expect(rasterize({ ...parsePath(d, ID), nonzero: true })!.areaMm2).toBeCloseTo(100, 0);
    // Stored and read back with the rule.
    const back = formFrom(storeForm({ ...parsePath(d, ID), nonzero: true }))!;
    expect(back.nonzero).toBe(true);
  });

  it('draws lines as areas of their width', () => {
    const r = rasterizeStroke(parsePath('M0 0 L20 0', ID), 2)!;
    // 20 × 2 and two round ends.
    expect(r.areaMm2).toBeCloseTo(40 + Math.PI, 0);
  });

  it('leaves out what lies on top, still reaching under it', () => {
    const below = rasterize(parsePath(rectPath(0, 0, 20, 20, 0, 0), ID))!;
    const top = rasterize(parsePath(rectPath(10, 0, 20, 20, 0, 0), ID))!;
    const left = knockOut(below, [top], 0.2)!;
    // 10 × 20 left, and 0.2 mm under the one on top.
    expect(left.areaMm2).toBeGreaterThan(200);
    expect(left.areaMm2).toBeLessThan(210);
    expect(knockOut(below, [], 0.2)).toBe(below);
  });
});

describe('digitizeShapes', () => {
  const options = digitizeDefaults(DEFAULT_PROFILE);
  // The overlapping circles: three discs and a small one on top.
  const circles: ShapeInput[] = [
    { color: 0, kind: 'fill', form: parsePath(ellipsePath(13, 13, 11, 11), ID) },
    { color: 1, kind: 'fill', form: parsePath(ellipsePath(25, 13, 11, 11), ID) },
    { color: 2, kind: 'fill', form: parsePath(ellipsePath(19, 23.4, 11, 11), ID) },
  ];

  it('sews every shape whole by default, with its curves', () => {
    const d = digitizeShapes(circles, threads, options, { w: 38, h: 36 }, false);
    expect(d.objects).toHaveLength(3);
    for (const o of d.objects) {
      expect(o.kind).toBe('fill');
      expect(o.form?.paths[0].nodes).toHaveLength(4);
      expect(o.knockout).toBe(false);
      // The whole disc, also where the next one covers it.
      expect(o.shape!.areaMm2).toBeGreaterThan(Math.PI * 121 * 0.97);
    }
  });

  it('leaves out what later shapes cover when asked', () => {
    const whole = digitizeShapes(circles, threads, options, { w: 38, h: 36 }, false);
    const cut = digitizeShapes(circles, threads, options, { w: 38, h: 36 }, true);
    expect(cut.objects[0].shape!.areaMm2).toBeLessThan(whole.objects[0].shape!.areaMm2 * 0.8);
    // The one on top stays whole.
    expect(cut.objects[2].shape!.areaMm2).toBeCloseTo(whole.objects[2].shape!.areaMm2, 0);
    expect(cut.objects[0].knockout).toBe(true);
  });

  it('keeps one block per thread where nothing in between overlaps', () => {
    const dots: ShapeInput[] = [
      { color: 0, kind: 'fill', form: parsePath(ellipsePath(5, 5, 3, 3), ID) },
      { color: 1, kind: 'fill', form: parsePath(ellipsePath(20, 5, 3, 3), ID) },
      { color: 0, kind: 'fill', form: parsePath(ellipsePath(35, 5, 3, 3), ID) },
    ];
    const d = digitizeShapes(dots, threads, options, { w: 40, h: 10 }, false);
    expect(d.pattern.colors).toHaveLength(2);
    // With the middle one over both, the order stays as painted.
    dots[1] = { color: 1, kind: 'fill', form: parsePath(rectPath(0, 0, 40, 10, 0, 0), ID) };
    expect(digitizeShapes(dots, threads, options, { w: 40, h: 10 }, false).pattern.colors).toHaveLength(3);
  });

  it('joins touching lines of one color into one network', () => {
    const star: ShapeInput[] = [0, 72, 144, 216, 288].map((deg) => {
      const a = (deg * Math.PI) / 180;
      return { color: 0, kind: 'stroke', width: 3, form: parsePath(`M20 20 L${20 + 15 * Math.sin(a)} ${20 - 15 * Math.cos(a)}`, ID) };
    });
    const d = digitizeShapes(star, threads, options, { w: 40, h: 40 }, false);
    expect(d.objects).toHaveLength(1);
  });
});

describe('a filled shape with a stroke', () => {
  const options = digitizeDefaults(DEFAULT_PROFILE);
  const leaf = (fill: number, stroke: number, width: number, d = 'M2 2 H22 V14 H2 Z'): ShapeInput[] => [
    { color: fill, kind: 'fill', form: parsePath(d, ID), element: 0 },
    { color: stroke, kind: 'stroke', width, form: parsePath(d, ID), element: 0 },
  ];
  const sewn = (shapes: ShapeInput[]) => {
    const d = digitizeShapes(shapes, threads, options, { w: 24, h: 16 }, false);
    const f = digitizedFile(d, 'leaf', options.trimMm);
    return { d, ...f, objs: sewObjects(f.pattern), mem: sewObjects(f.pattern).map((o) => remembered(f.pattern, o)) };
  };

  it('in the same thread is one object: a fill with its stroke as border', () => {
    const { d, objs, mem, pattern } = sewn(leaf(0, 0, 0.5));
    expect(d.objects).toHaveLength(1);
    expect(mem[0]!.fill).toBeTruthy();
    expect(mem[0]!.line?.type).toBe('run');
    expect(mem[0]!.line?.color).toBeUndefined();
    // Sewn right after the fill, as its border, in the same thread.
    expect(objs).toHaveLength(2);
    expect(mem[1]!.outline).toBe(mem[0]!.line!.link);
    expect(pattern.colors).toHaveLength(1);
  });

  it('in another thread is a fill with a border in that thread; a wide stroke is satin', () => {
    const { objs, mem, pattern } = sewn(leaf(0, 1, 2));
    expect(mem[0]!.line?.type).toBe('satin');
    expect(mem[0]!.line?.width).toBe(2);
    expect(mem[0]!.line!.color).toBeTruthy();
    expect(objs).toHaveLength(2);
    expect(mem[1]!.outline).toBe(mem[0]!.line!.link);
    expect(sameColor(objs[1].color, mem[0]!.line!.color)).toBe(true);
    expect(sameColor(objs[0].color, objs[1].color)).toBe(false);
    expect(pattern.colors).toHaveLength(2);
  });

  it('stays as it is when stored and opened again', () => {
    const { data, pattern } = sewn(leaf(0, 1, 0.5));
    const stored = structuredClone(rememberedIn(pattern, sewObjects(pattern)));
    expect(syncBorders(pattern, options.trimMm)).toBe(pattern);
    // Opened from the file as the app adds it: every object knows what it is.
    const back = parsePattern(data, 'leaf.pes');
    expect(restoreRemembered(back, stored)).toBe(sewObjects(pattern).length);
    const kinds = (p: typeof back) => sewObjects(p).map((o) => (remembered(p, o)?.fill ? 'fill' : remembered(p, o)?.outline ? 'border' : '?'));
    expect(kinds(back)).toEqual(['fill', 'border']);
    expect(syncBorders(back, options.trimMm)).toBe(back);
  });

  it('with an open path keeps the stroke a line of its own', () => {
    const d = digitizeShapes(leaf(0, 0, 0.5, 'M2 2 H22 V14 H2 Z M5 8 L19 8'), threads, options, { w: 24, h: 16 }, false);
    expect(d.objects).toHaveLength(2);
    expect(d.objects[0].border).toBeUndefined();
    expect(d.objects[1].path).toBeTruthy();
  });
});
