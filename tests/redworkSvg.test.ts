import { describe, expect, it } from 'vitest';
import { digitizeDefaults, digitizeShapes, type ShapeInput } from '../src/digitize/digitize';
import { Preparer } from '../src/image/prepare';
import { redworkShapes } from '../src/image/redwork';
import type { SvgShape } from '../src/image/svg';
import { isRedwork } from '../src/model/along';
import { loadOps } from '../src/shape/ops';
import { clipLines, flatten, type Mat } from '../src/shape/path';
import { rasterize } from '../src/shape/rasterize';
import { parsePath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const threads = [
  { r: 20, g: 20, b: 20 },
  { r: 200, g: 40, b: 50 },
];
const options = digitizeDefaults(DEFAULT_PROFILE);
const line = (d: string, width: number, color = 0): ShapeInput => ({ color, kind: 'stroke', width, form: parsePath(d, ID) });

describe('redwork from the lines of an SVG', () => {
  // A small line drawing: two strokes painted apart, with a filled area painted between them, in
  // widths that would otherwise be sewn as running stitch, satin and an area.
  const drawing: ShapeInput[] = [
    line('M2 10 L38 10', 0.3),
    { color: 1, kind: 'fill', form: parsePath('M24 4 H34 V16 H24 Z', ID) },
    line('M20 2 L20 18', 2),
    line('M4 4 L12 16', 9),
  ];

  it('sews all lines of a color as one line, each path there and back, whatever their width', () => {
    const d = digitizeShapes(drawing, threads, { ...options, redwork: true }, { w: 40, h: 20 }, false);
    const lines = d.objects.filter((o) => o.line);
    expect(lines).toHaveLength(1);
    expect(lines[0].line).toMatchObject({ type: 'run', redwork: true });
    expect(isRedwork(lines[0].line!)).toBe(true);
    expect(lines[0].path!.paths).toHaveLength(3);
    // The lines lie on top of the area painted before the last of them.
    expect(d.objects.map((o) => o.kind)).toEqual(['fill', 'run']);
  });

  it('with bean stitch on top when asked', () => {
    const d = digitizeShapes(drawing, threads, { ...options, redwork: true, redworkBean: true }, { w: 40, h: 20 }, false);
    expect(d.objects.find((o) => o.line)!.line).toMatchObject({ type: 'triple', redwork: true });
  });

  it('without redwork keeps the lines apart by their width, as before', () => {
    const d = digitizeShapes(drawing, threads, options, { w: 40, h: 20 }, false);
    expect(d.objects.filter((o) => o.line).length).toBeGreaterThan(1);
  });

  it('never takes a line of the drawing as the border of a fill', () => {
    const square = 'M5 5 H35 V25 H5 Z';
    const shapes: ShapeInput[] = [
      { color: 0, kind: 'fill', form: parsePath(square, ID), element: 0 },
      { color: 0, kind: 'stroke', width: 0.3, form: parsePath(square, ID), element: 0 },
    ];
    const d = digitizeShapes(shapes, threads, { ...options, redwork: true }, { w: 40, h: 30 }, false);
    expect(d.objects).toHaveLength(2);
    expect(d.objects[0].border).toBeUndefined();
  });
});

describe('clipLines', () => {
  const box = { minX: 10, minY: 0, maxX: 30, maxY: 20 };

  it('keeps a path inside as it is', () => {
    const f = parsePath('M12 5 C15 2 25 8 28 5', ID);
    expect(clipLines(f, box)).toEqual(f);
  });

  it('cuts a line at the sides of the box, on its curve', () => {
    const f = parsePath('M0 10 C10 0 30 20 40 10', ID);
    const cut = clipLines(f, box);
    expect(cut.paths).toHaveLength(1);
    const pts = flatten(cut.paths[0]);
    expect(pts[0][0]).toBeCloseTo(10, 6);
    expect(pts[pts.length - 1][0]).toBeCloseTo(30, 6);
    // The part kept lies exactly on the curve: its middle is the curve's middle.
    const mid = flatten(f.paths[0], 0.01).reduce((b, q) => (Math.abs(q[0] - 20) < Math.abs(b[0] - 20) ? q : b));
    const kept = pts.reduce((b, q) => (Math.abs(q[0] - 20) < Math.abs(b[0] - 20) ? q : b));
    expect(kept[1]).toBeCloseTo(mid[1], 1);
  });

  it('opens a closed path that leaves the box, in one piece where it runs on past its start', () => {
    // A square from 20,5 whose right side lies outside: the rest is one open line over three sides,
    // also where it runs on past its start.
    for (const d of ['M20 5 H40 V15 H20 Z', 'M40 5 H20 V15 H40 Z']) {
      const cut = clipLines(parsePath(d, ID), box);
      expect(cut.paths).toHaveLength(1);
      expect(cut.paths[0].closed).toBe(false);
      const pts = flatten(cut.paths[0]);
      expect(pts[0][0]).toBeCloseTo(30, 6);
      expect(pts[pts.length - 1][0]).toBeCloseTo(30, 6);
      expect(pts.length).toBe(4);
    }
  });

  it('leaves out a path wholly outside', () => {
    expect(clipLines(parsePath('M0 30 L40 30', ID), box).paths).toHaveLength(0);
  });
});

describe('redworkShapes', () => {
  const svg: SvgShape[] = [
    { color: 0, kind: 'fill', form: parsePath('M0 0 H40 V20 H0 Z', ID) },
    { color: 1, kind: 'stroke', width: 0.3, form: parsePath('M2 10 L38 10', ID) },
    { color: 2, kind: 'stroke', width: 0.3, form: parsePath('M20 2 L20 18', ID) },
    { color: 3, kind: 'fill', form: parsePath('M30 2 H38 V8 H30 Z', ID) },
  ];
  const palette = [threads[0], threads[1]].map((thread) => ({ thread, lab: [0, 0, 0] as [number, number, number], source: [0, 0, 0] as [number, number, number], deltaE: 0, areaMm2: 1, sew: true }));

  it('takes the thread each color got and leaves out what is not sewn and the background', () => {
    // Color 2 was merged into color 1 (palette 0); color 3 is not sewn (palette 1, switched off).
    const prepared = { palette: [palette[0], { ...palette[1], sew: false }], ofSource: [-1, 0, 0, 1] };
    const { shapes, threads: got } = redworkShapes(svg, prepared, { minX: 0, minY: 0, maxX: 40, maxY: 20 }, true, 0);
    expect(got).toEqual([threads[0], threads[1]]);
    expect(shapes.map((s) => [s.kind, s.color])).toEqual([
      ['stroke', 0],
      ['stroke', 0],
    ]);
  });

  it('keeps only the part cut out, in mm from its top left', async () => {
    await loadOps();
    const prepared = { palette, ofSource: [0, 0, 0, 1] };
    const { shapes } = redworkShapes(svg, prepared, { minX: 10, minY: 0, maxX: 34, maxY: 20 }, false);
    const across = shapes[1];
    expect(across.kind).toBe('stroke');
    const pts = flatten(across.form.paths[0]);
    expect(pts[0][0]).toBeCloseTo(0, 6);
    expect(pts[pts.length - 1][0]).toBeCloseTo(24, 6);
    // The small square is cut to the part of it inside: 4 mm of its 8.
    expect(rasterize(shapes[3].form)!.areaMm2).toBeCloseTo(24, 0);
  });
});

describe('Preparer of a vector image', () => {
  it('tells which palette entry each exact color went to, merged ones included', () => {
    const w = 20;
    const h = 10;
    const labels = new Uint8Array(w * h);
    for (let i = 0; i < labels.length; i++) labels[i] = (i % w) < 7 ? 0 : (i % w) < 14 ? 1 : 2;
    const colors: [number, number, number][] = [
      [250, 250, 250],
      [200, 30, 40],
      [30, 40, 200],
    ];
    const img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    const prep = new Preparer(img);
    const o = { widthMm: 2, maxColors: 8, smooth: 0, minAreaMm2: 0.5, background: false, threads: false };
    const p = prep.run(o, [{ from: colors[2], merge: colors[1] }], [], { width: w, height: h, labels, colors });
    expect(p.ofSource).toHaveLength(3);
    expect(p.ofSource![2]).toBe(p.ofSource![1]);
    expect(p.palette[p.ofSource![1]].source).toEqual(colors[1]);
  });
});
