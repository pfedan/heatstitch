import { describe, expect, it } from 'vitest';
import { breakAtNodes, deleteNodesKeepingShape, mergeNodes, removeSegments } from '../src/shape/nodeOps';
import { formParts } from '../src/shape/parts';
import { flatten, formArea, nearestOnForm, type Form, type Mat } from '../src/shape/path';
import { parsePath } from '../src/shape/svgPath';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const ends = (f: Form) =>
  f.paths.map((p) => {
    const pts = flatten(p);
    return [pts[0], pts[pts.length - 1]].map(([x, y]) => [Math.round(x), Math.round(y)]);
  });
/** Largest distance from points of `a` to the outline of `b` (mm). */
const deviation = (a: Form, b: Form) => Math.max(...a.paths.flatMap((p) => flatten(p, 0.05).map((q) => nearestOnForm(b, q)!.d)));

describe('breakAtNodes (Auftrennen)', () => {
  it('opens a closed path at one node, the outline unchanged', () => {
    const f = parsePath('M0 0 H10 V10 H0 Z', ID);
    const r = breakAtNodes(f, [{ path: 0, i: 2 }])!;
    expect(r.form.paths).toHaveLength(1);
    expect(r.form.paths[0].closed).toBe(false);
    expect(ends(r.form)).toEqual([[[10, 10], [10, 10]]]);
    expect(deviation(f, r.form)).toBeLessThan(1e-6);
  });

  it('cuts a closed path at k nodes into k pieces and an open one at k inner nodes into k + 1', () => {
    const sq = parsePath('M0 0 H10 V10 H0 Z', ID);
    expect(breakAtNodes(sq, [{ path: 0, i: 0 }, { path: 0, i: 2 }])!.form.paths).toHaveLength(2);
    const line = parsePath('M0 0 L10 0 L20 0 L30 0 L40 0', ID);
    const r = breakAtNodes(line, [{ path: 0, i: 1 }, { path: 0, i: 3 }])!;
    expect(ends(r.form)).toEqual([
      [[0, 0], [10, 0]],
      [[10, 0], [30, 0]],
      [[30, 0], [40, 0]],
    ]);
  });

  it('does not cut at the ends of an open path', () => {
    expect(breakAtNodes(parsePath('M0 0 L10 0 L20 0', ID), [{ path: 0, i: 0 }, { path: 0, i: 2 }])).toBeNull();
  });
});

describe('removeSegments (Stück entfernen)', () => {
  it('takes the piece between two neighbouring nodes out of a closed path', () => {
    const f = parsePath('M0 0 H10 V10 H0 Z', ID);
    const r = removeSegments(f, [{ path: 0, i: 1 }, { path: 0, i: 2 }])!;
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0].closed).toBe(false);
    expect(ends(r)).toEqual([[[10, 10], [10, 0]]]);
  });

  it('splits an open path where a piece in its middle goes', () => {
    const r = removeSegments(parsePath('M0 0 L10 0 L20 0 L30 0', ID), [{ path: 0, i: 1 }, { path: 0, i: 2 }])!;
    expect(ends(r)).toEqual([
      [[0, 0], [10, 0]],
      [[20, 0], [30, 0]],
    ]);
  });
});

describe('deleteNodesKeepingShape (Entf)', () => {
  it('keeps a circle round when a node goes', () => {
    // A circle of four quarter curves; one node gone, the rest is fitted with one curve.
    const f = parsePath('M10 0 C10 5.523 5.523 10 0 10 C-5.523 10 -10 5.523 -10 0 C-10 -5.523 -5.523 -10 0 -10 C5.523 -10 10 -5.523 10 0 Z', ID);
    const r = deleteNodesKeepingShape(f, [{ path: 0, i: 1 }])!;
    expect(r.paths[0].nodes).toHaveLength(3);
    // One cubic over half a circle stays within a few hundredths of the radius.
    expect(deviation(r, f)).toBeLessThan(0.3);
    expect(deviation(f, r)).toBeLessThan(0.3);
  });

  it('makes a straight piece where only straight pieces were', () => {
    const r = deleteNodesKeepingShape(parsePath('M0 0 L10 0 L10 10 L0 10 Z', ID), [{ path: 0, i: 1 }])!;
    const [a, b] = r.paths[0].nodes;
    expect(a.b).toEqual(a.p);
    expect(b.a).toEqual(b.p);
  });

  it('shortens an open path at its ends and drops a path left too short', () => {
    const f = parsePath('M0 0 L10 0 L20 0 M0 5 L10 5', ID);
    const r = deleteNodesKeepingShape(f, [{ path: 0, i: 0 }, { path: 1, i: 1 }])!;
    expect(ends(r)).toEqual([[[10, 0], [20, 0]]]);
  });
});

describe('mergeNodes (Knoten zusammenlegen)', () => {
  it('lays neighbouring selected nodes into one at their middle', () => {
    const r = mergeNodes(parsePath('M0 0 L10 0 L12 0 L20 0', ID), [{ path: 0, i: 1 }, { path: 0, i: 2 }])!;
    expect(r.paths[0].nodes.map((n) => n.p)).toEqual([[0, 0], [11, 0], [20, 0]]);
  });

  it('joins two ends of two lines into one node, however far apart', () => {
    const r = mergeNodes(parsePath('M0 0 L10 0 M12 1 L20 0', ID), [{ path: 0, i: 1 }, { path: 1, i: 0 }])!;
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0].nodes[1].p).toEqual([11, 0.5]);
  });

  it('closes a line whose two ends are selected', () => {
    const r = mergeNodes(parsePath('M0 0 L10 0 L10 10 L1 1', ID), [{ path: 0, i: 0 }, { path: 0, i: 3 }])!;
    expect(r.paths[0].closed).toBe(true);
    expect(r.paths[0].nodes).toHaveLength(3);
  });

  it('does nothing for nodes that are neither neighbours nor ends', () => {
    expect(mergeNodes(parsePath('M0 0 L10 0 L20 0 L30 0 L40 0', ID), [{ path: 0, i: 1 }, { path: 0, i: 3 }])).toBeNull();
  });
});

describe('formParts (In Teile trennen)', () => {
  it('keeps each island of an area with its own hole; an island in a hole is a part of its own', () => {
    const f = parsePath('M0 0 H30 V30 H0 Z M5 5 H25 V25 H5 Z M10 10 H20 V20 H10 Z M40 0 H50 V10 H40 Z', ID);
    const parts = formParts(f, true);
    expect(parts.map((p) => p.paths.length)).toEqual([2, 1, 1]);
    expect(parts.reduce((s, p) => s + formArea(p), 0)).toBeCloseTo(formArea(f), 6);
  });

  it('keeps loops that cross together', () => {
    const f = parsePath('M0 0 H10 V10 H0 Z M5 5 H15 V15 H5 Z M40 0 H50 V10 H40 Z', ID);
    expect(formParts(f, true).map((p) => p.paths.length)).toEqual([2, 1]);
  });

  it('keeps an inner loop of a nonzero area that runs the same way with its outer one as filled, not a hole', () => {
    const f: Form = { ...parsePath('M0 0 H30 V30 H0 Z M10 10 H20 V20 H10 Z', ID), nonzero: true };
    // Same direction: the inner loop adds up, it is not a hole, so it is a part of its own.
    expect(formParts(f, true)).toHaveLength(2);
  });

  it('groups lines that touch, cross or end on another, also through others', () => {
    // A T (an end on the middle of another), a cross, a line 0.3 mm away, and one far off.
    const f = parsePath('M0 0 L10 0 M5 0 L5 10 M3 8 L7 8 M7.3 8 L9 8 M30 0 L40 0', ID);
    expect(formParts(f, false).map((p) => p.paths.length)).toEqual([4, 1]);
  });

  it('keeps lines 2.5 mm apart apart', () => {
    expect(formParts(parsePath('M0 0 L10 0 M0 2.5 L10 2.5', ID), false)).toHaveLength(2);
  });
});
