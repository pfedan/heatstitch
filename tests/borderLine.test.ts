import { describe, expect, it } from 'vitest';
import { digitizeDefaults, digitizeShapes, type ShapeInput } from '../src/digitize/digitize';
import { syncBorders } from '../src/model/border';
import { digitizedFile } from '../src/model/digitized';
import { deleteObjects } from '../src/model/shapeOps';
import { sewObjects } from '../src/model/objects';
import { STITCH, type Pattern } from '../src/model/pattern';
import { remember, remembered, rememberedIn, restoreRemembered, withLine, type BorderSettings } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import { writePattern } from '../src/writers';
import { fromStored, toStored } from '../src/storage/fileStore';
import { parsePath } from '../src/shape/svgPath';
import type { Mat } from '../src/shape/path';
import { DEFAULT_PROFILE } from '../src/validation/profiles';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const threads = [
  { r: 210, g: 40, b: 50 },
  { r: 30, g: 90, b: 180 },
  { r: 240, g: 200, b: 30 },
];
const options = digitizeDefaults(DEFAULT_PROFILE);

/** A 20 × 12 mm rectangle filled, with its stroke as border (running stitch), around the origin. */
function bordered(): Pattern {
  const d = 'M2 2 H22 V14 H2 Z';
  const shapes: ShapeInput[] = [
    { color: 0, kind: 'fill', form: parsePath(d, ID), element: 0 },
    { color: 0, kind: 'stroke', width: 0.5, form: parsePath(d, ID), element: 0 },
  ];
  return digitizedFile(digitizeShapes(shapes, threads, options, { w: 24, h: 16 }, false), 'r', options.trimMm).pattern;
}

/** `p` with the fill's border changed by `f`, synced as the app does. */
function withBorder(p: Pattern, f: (b: BorderSettings) => BorderSettings): Pattern {
  const objs = sewObjects(p);
  const k = objs.findIndex((o) => remembered(p, o)?.fill);
  const m = remembered(p, objs[k])!;
  remember(p, objs[k], withLine(m, f(m.line!)));
  return syncBorders(p, options.trimMm);
}

const view = (p: Pattern) => sewObjects(p).map((o) => ({ o, m: remembered(p, o)! }));
const points = (p: Pattern, first: number, last: number) => {
  const out: [number, number][] = [];
  for (let i = first; i <= last; i++) if (p.cmd[i] === STITCH) out.push([p.x[i] / 10, p.y[i] / 10]);
  return out;
};
/** How far a point lies outside the rectangle (mm; negative inside). */
const outside = ([x, y]: [number, number]) => {
  const dx = Math.max(-10 - x, x - 10);
  const dy = Math.max(-6 - y, y - 6);
  return dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
};

describe('a border can do what a line can', () => {
  it('sews its echo copies in its thread after it, at their gap from the edge', () => {
    const p = bordered();
    const before = view(p).find((x) => x.m.outline)!;
    const q = withBorder(p, (b) => ({ ...b, echo: { side: 'out', count: 2, gap: 2 } }));
    const now = view(q);
    expect(now).toHaveLength(2);
    const b = now.find((x) => x.m.outline)!;
    const pts = points(q, b.o.first, b.o.last);
    expect(pts.length).toBeGreaterThan(points(p, before.o.first, before.o.last).length * 2.5);
    // On the edge, 2 mm and 4 mm out.
    for (const d of [0, 2, 4]) expect(pts.filter((q) => Math.abs(outside(q) - d) < 0.3).length).toBeGreaterThan(20);
    expect(syncBorders(q, options.trimMm)).toBe(q);
  });

  it('puts copies in threads of their own into objects of their own after the border', () => {
    const q = withBorder(bordered(), (b) => ({ ...b, echo: { side: 'out', count: 2, gap: 2, colors: [null, threads[2]], link: 'e1' } }));
    const now = view(q);
    expect(now).toHaveLength(3);
    const copy = now.find((x) => x.m.echoOf)!;
    expect(copy.m.echoOf).toBe('e1:2');
    expect(copy.o.color).toMatchObject(threads[2]);
    expect(now.indexOf(copy)).toBeGreaterThan(now.findIndex((x) => x.m.outline));
    expect(points(q, copy.o.first, copy.o.last).every((q) => Math.abs(outside(q) - 4) < 0.3)).toBe(true);
    // The border sews its first copy only.
    const b = now.find((x) => x.m.outline)!;
    expect(points(q, b.o.first, b.o.last).some((q) => Math.abs(outside(q) - 4) < 0.2)).toBe(false);
    expect(syncBorders(q, options.trimMm)).toBe(q);
  });

  it('casts a shadow sewn before the fill', () => {
    const q = withBorder(bordered(), (b) => ({ ...b, shadow: { color: { r: 64, g: 64, b: 64 }, link: 's1', angle: 0, dist: 1 } }));
    const now = view(q);
    expect(now).toHaveLength(3);
    expect(now[0].m.shadowOf).toBe('s1');
    expect(now[1].m.fill).toBeTruthy();
    // The edge moved 1 mm to the right.
    const pts = points(q, now[0].o.first, now[0].o.last);
    expect(Math.max(...pts.map((q) => q[0]))).toBeCloseTo(11, 0);
    expect(syncBorders(q, options.trimMm)).toBe(q);
  });

  it('keeps all of it when stored and opened again', () => {
    const q = withBorder(bordered(), (b) => ({ ...b, echo: { side: 'both', count: 1, gap: 1.5, colors: [threads[1]], link: 'e2' }, shadow: { color: { r: 64, g: 64, b: 64 }, link: 's2', angle: 90, dist: 1.2 } }));
    const stored = structuredClone(rememberedIn(q, sewObjects(q)));
    const back = fromStored(parsePattern(writePattern(q, 'dst'), 'r.dst'), structuredClone(toStored(q)))!;
    restoreRemembered(back, stored);
    expect(syncBorders(back, options.trimMm)).toBe(back);
    expect(view(back).map((x) => [!!x.m.shadowOf, !!x.m.fill, !!x.m.outline, x.m.echoOf])).toEqual(view(q).map((x) => [!!x.m.shadowOf, !!x.m.fill, !!x.m.outline, x.m.echoOf]));
  });

  it('takes its parts away with them', () => {
    const q = withBorder(bordered(), (b) => ({ ...b, echo: { side: 'out', count: 1, gap: 2, colors: [threads[1]], link: 'e3' }, shadow: { color: { r: 64, g: 64, b: 64 }, link: 's3', angle: 0, dist: 1 } }));
    const r = withBorder(q, ({ echo: _e, shadow: _s, ...b }) => b);
    expect(view(r)).toHaveLength(2);
  });

  it('has a shadow or echo copy deleted on its own no more', () => {
    const q = withBorder(bordered(), (b) => ({ ...b, echo: { side: 'out', count: 1, gap: 2, colors: [threads[1]], link: 'e4' }, shadow: { color: { r: 64, g: 64, b: 64 }, link: 's4', angle: 0, dist: 1 } }));
    const shadow = view(q).findIndex((x) => x.m.shadowOf === 's4');
    const r = deleteObjects(q, [shadow], options.trimMm)!;
    const echo = view(r).findIndex((x) => x.m.echoOf);
    const s = deleteObjects(r, [echo], options.trimMm)!;
    const fill = view(s).find((x) => x.m.fill)!.m;
    expect(fill.line?.shadow).toBeUndefined();
    expect(fill.line?.echo?.colors).toEqual([null]);
    // Synced again, they do not come back.
    expect(view(syncBorders(s, options.trimMm)).map((x) => !!(x.m.shadowOf || x.m.echoOf))).toEqual([false, false]);
  });
});

describe('a frayed satin border', () => {
  /** How far each penetration of the border lies outside the rectangle, outer and inner rail apart. */
  const sides = (side?: 'left' | 'right') => {
    const q = withBorder(bordered(), (b) => ({ ...b, type: 'satin', width: 2, under: 'off', fringe: 0.8, ...(side ? { fringeSide: side } : {}) }));
    const b = view(q).find((x) => x.m.outline)!;
    // Along the straight sides, away from the corners.
    const d = points(q, b.o.first, b.o.last).filter(([x, y]) => Math.abs(x) < 8 || Math.abs(y) < 4).map(outside);
    const out = d.filter((v) => v > 0);
    const inn = d.filter((v) => v < 0);
    const spread = (l: number[]) => Math.max(...l) - Math.min(...l);
    return { out: spread(out), inn: spread(inn) };
  };

  it('frays outside, inside or both', () => {
    const plain = sides();
    expect(plain.out).toBeGreaterThan(0.4);
    expect(plain.inn).toBeGreaterThan(0.4);
    const out = sides('right');
    expect(out.out).toBeGreaterThan(0.4);
    expect(out.inn).toBeLessThan(0.3);
    const inn = sides('left');
    expect(inn.inn).toBeGreaterThan(0.4);
    expect(inn.out).toBeLessThan(0.3);
  });
});
