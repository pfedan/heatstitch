import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOUBLE_MS, ShapeTool } from '../src/ui/shapeTool';
import { moveNodes, nodesOf, removeNodes, type Form } from '../src/shape/path';
import { parsePath } from '../src/shape/svgPath';

const ID: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
/** A square with a square hole: two loops. */
const ring = (): Form => parsePath('M0 0 L40 0 L40 40 L0 40 Z M10 10 L30 10 L30 30 L10 30 Z', ID);

function tool(form: Form) {
  const taken: Form[] = [];
  const said: string[] = [];
  const t = new ShapeTool({ change: (f) => void taken.push(f), redraw: () => {}, say: (k) => void said.push(k), width: () => {} });
  t.open(form);
  return { t, taken, said };
}

afterEach(() => vi.useRealTimers());

describe('several nodes of an outline', () => {
  it('removeNodes drops a loop left too short as a whole and keeps the rest', () => {
    const f = ring();
    const hole = removeNodes(f, nodesOf(f, 1))!;
    expect(hole.paths).toHaveLength(1);
    expect(hole.paths[0].nodes).toHaveLength(4);
    // Two nodes of the hole: two left, too few for an area.
    expect(removeNodes(f, [{ path: 1, i: 0 }, { path: 1, i: 2 }])!.paths).toHaveLength(1);
    expect(removeNodes(f, [{ path: 0, i: 1 }])!.paths[0].nodes).toHaveLength(3);
    // Nothing left: no form.
    expect(removeNodes(f, [...nodesOf(f, 0), ...nodesOf(f, 1)])).toBeNull();
    // The form given stays as it was.
    expect(f.paths[1].nodes).toHaveLength(4);
  });

  it('moveNodes moves the nodes with their handles, the others stay', () => {
    const f = ring();
    const g = moveNodes(f, nodesOf(f, 1), 2, -1);
    expect(g.paths[1].nodes.map((n) => n.p)).toEqual([[12, 9], [32, 9], [32, 29], [12, 29]]);
    expect(g.paths[1].nodes.every((n) => n.a[0] === n.p[0] && n.b[1] === n.p[1])).toBe(true);
    expect(g.paths[0]).toEqual(f.paths[0]);
  });

  it('a double-click on a loop selects all its nodes, on its line or on a node', () => {
    const { t } = tool(ring());
    // On the line of the hole, beside its nodes and dots.
    expect(t.selectLoopAt(14, 10.3, 4)).toBe(true);
    expect(t.sel).toEqual(nodesOf(t.form, 1));
    expect(t.selected).toBeNull();
    expect(t.selectLoopAt(40, 40, 4)).toBe(true);
    expect(t.sel).toEqual(nodesOf(t.form, 0));
    // Far from both loops: nothing.
    expect(t.selectLoopAt(20, 20, 4)).toBe(false);
  });

  it('a double-click on a hollow dot selects the loop and puts no node in', () => {
    vi.useFakeTimers();
    const { t, taken } = tool(ring());
    // The middle of the top of the hole is a dot: the first click puts a node in, not sewn yet.
    t.down(20, 10, 4);
    t.up();
    expect(t.count).toBe(9);
    // The second press on it: the node goes again, the loop is selected.
    expect(t.down(20, 10, 4)).toBe('move');
    t.up();
    expect(t.count).toBe(8);
    expect(t.sel).toEqual(nodesOf(t.form, 1));
    // Then the browser's double-click event: the same loop.
    t.selectLoopAt(20, 10, 4);
    expect(t.sel).toEqual(nodesOf(t.form, 1));
    vi.advanceTimersByTime(DOUBLE_MS * 2);
    expect(taken).toHaveLength(0);
  });

  it('a click on a dot followed by another action sews the node first, as a step of its own', () => {
    vi.useFakeTimers();
    const { t, taken } = tool(ring());
    t.down(20, 10, 4);
    t.up();
    t.nudge(1, 0);
    expect(taken).toHaveLength(2);
    expect(taken[0].paths[1].nodes).toHaveLength(5);
    expect(taken[1].paths[1].nodes[1].p).toEqual([21, 10]);
  });

  it('a selected loop moves as a whole when one of its nodes is dragged', () => {
    const { t, taken } = tool(ring());
    t.selectLoopAt(14, 10.3, 4);
    t.down(30, 30, 4);
    t.dragTo(33, 34);
    t.up();
    expect(taken).toHaveLength(1);
    expect(taken[0].paths[1].nodes.map((n) => n.p)).toEqual([[13, 14], [33, 14], [33, 34], [13, 34]]);
    expect(taken[0].paths[0].nodes.map((n) => n.p)).toEqual(ring().paths[0].nodes.map((n) => n.p));
    // The loop stays selected.
    expect(t.selCount).toBe(4);
  });

  it('a click on a node of several selected keeps only it', () => {
    const { t } = tool(ring());
    t.selectLoopAt(14, 10.3, 4);
    t.down(30, 30, 4);
    t.up();
    expect(t.selected).toEqual({ path: 1, i: 2 });
  });

  it('Shift+click adds a node and takes it away again', () => {
    const { t } = tool(ring());
    t.down(0, 0, 4);
    t.up();
    t.down(40, 0, 4, true);
    t.up();
    expect(t.sel).toEqual([{ path: 0, i: 0 }, { path: 0, i: 1 }]);
    t.down(0, 0, 4, true);
    t.up();
    expect(t.sel).toEqual([{ path: 0, i: 1 }]);
  });

  it('a frame adds the nodes inside it', () => {
    const { t } = tool(ring());
    t.selected = { path: 0, i: 0 };
    expect(t.selectInRect(45, 45, -5, 25)).toBe(4);
    expect(t.sel).toEqual([{ path: 0, i: 0 }, { path: 0, i: 2 }, { path: 0, i: 3 }, { path: 1, i: 2 }, { path: 1, i: 3 }]);
  });

  it('Delete on a selected hole takes the hole away in one step', () => {
    const { t, taken } = tool(ring());
    t.selectLoopAt(14, 10.3, 4);
    expect(t.deleteSelected()).toBe(true);
    expect(taken).toHaveLength(1);
    expect(taken[0].paths).toHaveLength(1);
    expect(t.selCount).toBe(0);
  });

  it('Delete on every node says why and changes nothing', () => {
    const { t, taken, said } = tool(ring());
    t.selectAll();
    expect(t.selCount).toBe(8);
    t.deleteSelected();
    expect(taken).toHaveLength(0);
    expect(said).toEqual(['shape.minNodes']);
  });

  it('C makes the selected nodes round together, then corners again', () => {
    const { t, taken } = tool(ring());
    t.selectLoopAt(14, 10.3, 4);
    expect(t.selectedSmooth).toBe(false);
    t.toggleSmooth();
    expect(taken[0].paths[1].nodes.every((n) => n.smooth)).toBe(true);
    expect(taken[0].paths[0].nodes.some((n) => n.smooth)).toBe(false);
    expect(t.selectedSmooth).toBe(true);
    t.toggleSmooth();
    expect(taken[1].paths[1].nodes.some((n) => n.smooth)).toBe(false);
  });

  it('the arrow keys move all selected nodes', () => {
    const { t, taken } = tool(ring());
    t.selectLoopAt(14, 10.3, 4);
    t.nudge(0.5, 0);
    expect(taken[0].paths[1].nodes[0].p).toEqual([10.5, 10]);
    expect(taken[0].paths[0].nodes[0].p).toEqual([0, 0]);
  });
});

describe('a clicked hollow dot waiting for a second click', () => {
  it('is sewn by other input first, but not by a press on its own node', () => {
    vi.useFakeTimers();
    const { t, taken } = tool(ring());
    t.down(20, 10, 4);
    t.up();
    t.settle({ x: 20, y: 10, scale: 4 });
    expect(taken).toHaveLength(0);
    t.settle({ x: 0, y: 0, scale: 4 });
    expect(taken).toHaveLength(1);
    expect(taken[0].paths[1].nodes).toHaveLength(5);
    vi.advanceTimersByTime(DOUBLE_MS * 2);
    expect(taken).toHaveLength(1);
  });

  it('is dropped when another outline opens', () => {
    vi.useFakeTimers();
    const { t, taken } = tool(ring());
    t.down(20, 10, 4);
    t.up();
    t.open(ring());
    vi.advanceTimersByTime(DOUBLE_MS * 2);
    expect(taken).toHaveLength(0);
    expect(t.count).toBe(8);
  });
});
