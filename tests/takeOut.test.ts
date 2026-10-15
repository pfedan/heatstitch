import { describe, expect, it } from 'vitest';
import { sewObjects } from '../src/model/objects';
import { remembered } from '../src/model/restitch';
import { takeOutShape } from '../src/model/shapeOps';
import { takeOutNodes } from '../src/shape/join';
import { flatten, type Mat } from '../src/shape/path';
import { parsePath } from '../src/shape/svgPath';
import { Design, THREADS } from './helpers/demoProject';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const xs = (f: { paths: Parameters<typeof flatten>[0][] }) => f.paths.map((p) => p.nodes.length);
const ends = (f: { paths: Parameters<typeof flatten>[0][] }) =>
  f.paths.map((p) => {
    const pts = flatten(p);
    return [pts[0], pts[pts.length - 1]].map(([x, y]) => [Math.round(x), Math.round(y)]);
  });

describe('takeOutNodes (Als eigenes Objekt)', () => {
  it('cuts a line at the selected nodes: the run between them goes, the rest stays, meeting there', () => {
    const f = parsePath('M0 0 L10 0 L20 0 L30 0', ID);
    const r = takeOutNodes(f, [{ path: 0, i: 1 }, { path: 0, i: 2 }], false)!;
    expect(ends(r.out)).toEqual([[[10, 0], [20, 0]]]);
    expect(ends(r.keep)).toEqual([
      [[0, 0], [10, 0]],
      [[20, 0], [30, 0]],
    ]);
  });

  it('opens a closed path selected in part into what goes and one piece that stays', () => {
    const f = parsePath('M0 0 H10 V10 H0 Z', ID);
    const r = takeOutNodes(f, [{ path: 0, i: 1 }, { path: 0, i: 2 }], false)!;
    expect(ends(r.out)).toEqual([[[10, 0], [10, 10]]]);
    expect(r.keep.paths).toHaveLength(1);
    expect(r.keep.paths[0].closed).toBe(false);
    expect(ends(r.keep)).toEqual([[[10, 10], [10, 0]]]);
    expect(xs(r.keep)).toEqual([4]);
  });

  it('takes whole paths when all their nodes are selected, and whole loops of an area', () => {
    const f = parsePath('M0 0 L10 0 M0 5 L10 5 L20 5', ID);
    const r = takeOutNodes(f, [{ path: 1, i: 0 }, { path: 1, i: 1 }, { path: 1, i: 2 }], false)!;
    expect(r.out.paths).toEqual([f.paths[1]]);
    expect(r.keep.paths).toEqual([f.paths[0]]);
    const area = parsePath('M0 0 H40 V40 H0 Z M10 10 H20 V20 H10 Z', ID);
    const a = takeOutNodes(area, [{ path: 1, i: 0 }, { path: 1, i: 2 }], true)!;
    expect(a.out.paths).toEqual([area.paths[1]]);
    expect(a.keep.paths).toEqual([area.paths[0]]);
  });

  it('takes nothing out when nothing would stay, or no two selected nodes lie side by side', () => {
    const f = parsePath('M0 0 L10 0 L20 0', ID);
    expect(takeOutNodes(f, [0, 1, 2].map((i) => ({ path: 0, i })), false)).toBeNull();
    expect(takeOutNodes(f, [{ path: 0, i: 0 }, { path: 0, i: 2 }], false)).toBeNull();
  });
});

describe('takeOutShape', () => {
  it('makes the paths taken out an object of its own with the same stitch, sewn right after', () => {
    const d = new Design('Raus');
    d.line('M10 10 L50 10 M30 0 L30 40 M60 10 L80 10', THREADS.navy, { redwork: true });
    const o = sewObjects(d.p)[0];
    const form = remembered(d.p, o)!.geo!;
    const split = takeOutNodes(form, [{ path: 2, i: 0 }, { path: 2, i: 1 }], false)!;
    const r = takeOutShape(d.p, 0, split.keep, split.out, d.T)!;
    expect(r.part).toBe(1);
    const objs = sewObjects(r.pattern);
    expect(objs).toHaveLength(2);
    const [a, b] = objs.map((x) => remembered(r.pattern, x)!);
    expect(a.geo!.paths).toHaveLength(2);
    expect(b.geo!.paths).toHaveLength(1);
    expect(a.line).toMatchObject({ redwork: true });
    expect(b.line).toMatchObject({ redwork: true });
    expect(objs[1].color).toBe(objs[0].color);
    expect(objs[1].id).not.toBe(objs[0].id);
    // Its stitches lie on the path taken out.
    for (let i = objs[1].first; i <= objs[1].last; i++) expect(r.pattern.x[i] / 10).toBeGreaterThanOrEqual(59.9);
  });

  it('takes a loop of an area out as a fill of its own', () => {
    const d = new Design('Insel');
    d.fill('M0 0 H40 V30 H0 Z M50 0 H70 V30 H50 Z', THREADS.yellow, { angle: 30 });
    const form = remembered(d.p, sewObjects(d.p)[0])!.geo!;
    const split = takeOutNodes(form, [{ path: 1, i: 0 }, { path: 1, i: 1 }], true)!;
    const r = takeOutShape(d.p, 0, split.keep, split.out, d.T)!;
    const objs = sewObjects(r.pattern);
    expect(objs).toHaveLength(2);
    const [a, b] = objs.map((x) => remembered(r.pattern, x)!);
    expect(a.fill!.angle).toBe(30);
    expect(b.fill!.angle).toBe(30);
    expect(objs[0].maxX / 10).toBeLessThan(41);
    expect(objs[1].minX / 10).toBeGreaterThan(49);
  });
});

describe('Verbinden with nodes selected', () => {
  it('joins only the selected ends, leaving the other open paths as they are', async () => {
    const { joinOpenPaths } = await import('../src/shape/join');
    const f = parsePath('M0 0 L10 0 M11 0 L20 0 M40 0 L50 0 M51 0 L60 0', ID);
    const j = joinOpenPaths(f, true, undefined, new Set(['0:1', '1:0']))!;
    expect(j.form.paths).toHaveLength(3);
    expect(j.joints).toHaveLength(1);
    expect(ends(j.form)).toEqual([
      [[0, 0], [20, 0]],
      [[40, 0], [50, 0]],
      [[51, 0], [60, 0]],
    ]);
    expect(joinOpenPaths(f, true, undefined, new Set(['0:1']))).toBeNull();
  });
});

describe('Zusammenfassen of lines', () => {
  it('keeps the paths as they were and offers to join the ends that touch', async () => {
    const { combineLines, joinTouchingEnds } = await import('../src/model/shapeOps');
    const d = new Design('Herz');
    d.line('M0 0 L10 0 L10 10', THREADS.navy);
    d.line('M10.2 10 L0 10 L0 0.2', THREADS.navy);
    const c = combineLines(d.p, [0, 1], d.T)!;
    const geo = remembered(c.pattern, sewObjects(c.pattern)[c.index])!.geo!;
    expect(geo.paths).toHaveLength(2);
    expect(c.touching).toBe(2);
    const j = joinTouchingEnds(c.pattern, c.index, d.T)!;
    const joined = remembered(j.pattern, sewObjects(j.pattern)[j.index])!.geo!;
    expect(joined.paths).toHaveLength(1);
    expect(j.joined.closed).toBe(1);
  });
});
