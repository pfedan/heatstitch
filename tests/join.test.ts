import { beforeAll, describe, expect, it } from 'vitest';
import { joinEnd, joinOpenPaths, splitPathAt } from '../src/shape/join';
import { loadOps, withCrossingNodes } from '../src/shape/ops';
import { bezier, segment, segments, type Form, type Mat, type Node, type Path } from '../src/shape/path';
import { parsePath } from '../src/shape/svgPath';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const line = (d: string): Path => ({ ...parsePath(d, ID).paths[0], closed: false });
const count = (f: Form) => f.paths.reduce((a, p) => a + p.nodes.length, 0);
/** Points along a form's curves. */
const along = (f: Form, per = 4) => f.paths.flatMap((p) => Array.from({ length: segments(p) }, (_, k) => Array.from({ length: per }, (_, i) => bezier(segment(p, k), i / per))).flat());
const near = (pts: [number, number][], q: [number, number]) => Math.min(...pts.map((p) => Math.hypot(p[0] - q[0], p[1] - q[1])));

beforeAll(loadOps);

describe('joining paths', () => {
  // A heart in two halves, as SVG files bring it: the ends 0.3 mm apart at the bottom, touching at the top.
  const left = line('M 20 34 C 8 24 0 16 0 9 C 0 3 4 0 9 0 C 14 0 18 4 20 8');
  const right = line('M 20 8 C 22 4 26 0 31 0 C 36 0 40 3 40 9 C 40 16 32 24 20.3 34');

  it('joins touching ends into one node and closes a chain whose ends meet', () => {
    const j = joinOpenPaths({ paths: [left, right] }, false)!;
    expect(j.form.paths).toHaveLength(1);
    expect(j.form.paths[0].closed).toBe(true);
    expect(j.closed).toBe(1);
    // One joint at the top; the bottom ends meet and close the chain.
    expect(j.joints).toEqual([{ gap: 0, bridged: false }]);
    expect(count(j.form)).toBe(count({ paths: [left, right] }) - 2);
    // The curves are where they were (the meeting node moved by half the gap at most).
    for (const q of along({ paths: [left, right] })) expect(near(along(j.form, 200), q)).toBeLessThan(0.6);
  });

  it('only joins ends that touch, unless asked to bridge every gap', () => {
    const a = line('M 0 0 L 10 0');
    const b = line('M 13 0 L 20 0');
    const c = line('M 20.2 0 L 30 0');
    expect(joinOpenPaths({ paths: [a, b] }, false)).toBeNull();
    const touch = joinOpenPaths({ paths: [a, b, c] }, false)!;
    expect(touch.form.paths).toHaveLength(2);
    const all = joinOpenPaths({ paths: [a, b, c] }, true)!;
    expect(all.form.paths).toHaveLength(1);
    expect(all.joints.map((x) => x.bridged).sort()).toEqual([false, true]);
    // The bridge is a straight piece from 10 to 13.
    const nodes = all.form.paths[0].nodes;
    const k = nodes.findIndex((n) => n.p[0] === 10);
    expect(nodes[k].b).toEqual(nodes[k].p);
    expect(nodes[k + 1].p).toEqual([13, 0]);
  });

  it('turns paths round to meet end to end, nearest ends first', () => {
    const a = line('M 0 0 L 10 0');
    const b = line('M 20 0 L 10 0');
    const j = joinOpenPaths({ paths: [a, b] }, false)!;
    expect(j.form.paths[0].nodes.map((n: Node) => n.p[0])).toEqual([0, 10, 20]);
  });

  it('leaves closed paths and paths without a partner as they were', () => {
    const ring = { ...parsePath('M 50 0 L 60 0 L 60 10 Z', ID).paths[0] };
    const lone = line('M 100 0 L 110 0');
    const j = joinOpenPaths({ paths: [ring, left, right, lone] }, false)!;
    expect(j.form.paths).toHaveLength(3);
    expect(j.form.paths[0]).toBe(ring);
    expect(j.form.paths[2]).toBe(lone);
  });

  it('joins the end of one path to the nearest end of another', () => {
    const a = line('M 0 0 L 10 0');
    const b = line('M 30 0 L 40 0');
    const c = line('M 12 5 L 12 20');
    const j = joinEnd({ paths: [a, b, c] }, 0, 1)!;
    expect(j.form.paths).toHaveLength(2);
    expect(j.joints[0].bridged).toBe(true);
    expect(j.joints[0].gap).toBeCloseTo(Math.hypot(2, 5), 9);
    expect(joinEnd({ paths: [a] }, 0, 1)).toBeNull();
  });

  it('splits an open path at a node', () => {
    const a = line('M 0 0 L 10 0 L 20 0');
    const s = splitPathAt({ paths: [a] }, 0, 1)!;
    expect(s.paths.map((p) => p.nodes.map((n) => n.p[0]))).toEqual([
      [0, 10],
      [10, 20],
    ]);
    expect(splitPathAt({ paths: [a] }, 0, 0)).toBeNull();
  });
});

describe('nodes at crossings', () => {
  it('puts a node where two paths cross, on both, the curves unchanged', () => {
    const f: Form = { paths: [line('M 0 0 C 10 10 20 10 30 0'), line('M 15 -5 L 15 20')] };
    const r = withCrossingNodes(f)!;
    expect(r.added).toBe(2);
    expect(count(r.form)).toBe(count(f) + 2);
    const hit = r.form.paths[0].nodes[1].p;
    expect(hit[0]).toBeCloseTo(15, 6);
    expect(r.form.paths[1].nodes[1].p[0]).toBeCloseTo(15, 6);
    expect(r.form.paths[1].nodes[1].p[1]).toBeCloseTo(hit[1], 6);
    for (const q of along(f)) expect(near(along(r.form, 400), q)).toBeLessThan(0.05);
  });

  it('finds a path crossing itself, and nothing where paths only touch', () => {
    const loop = line('M 0 0 L 20 20 L 20 0 L 0 20');
    const r = withCrossingNodes({ paths: [loop] })!;
    expect(r.added).toBe(2);
    expect(withCrossingNodes({ paths: [line('M 0 0 L 10 0'), line('M 10 0 L 10 10')] })).toBeNull();
  });
});
