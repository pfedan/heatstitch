import { describe, expect, it } from 'vitest';
import { digitizeDefaults, digitizeShapes, type ShapeInput } from '../src/digitize/digitize';
import { formFrom, storeForm, type Mat } from '../src/shape/path';
import { knockOut, rasterize, rasterizeStroke } from '../src/shape/rasterize';
import { ellipsePath, parsePath, pointsPath, rectPath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';

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
