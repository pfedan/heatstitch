import { describe, expect, it } from 'vitest';
import { ShapeTool } from '../src/ui/shapeTool';
import { endDirection, extendPath, type Form } from '../src/shape/path';
import { parsePath } from '../src/shape/svgPath';

const line = (): Form => parsePath('M0 0 L20 0 L20 10', [1, 0, 0, 1, 0, 0]);

/** A shape tool on `form` at `scale` px per mm, keeping what it takes over. */
function tool(form: Form) {
  const taken: Form[] = [];
  const t = new ShapeTool({ change: (f) => void taken.push(f), redraw: () => {}, say: () => {}, width: () => {} });
  t.open(form);
  return { t, taken };
}

describe('new nodes dragged out of hollow dots', () => {
  it('a line goes on from either end, straight out along its end', () => {
    const f = line();
    expect(endDirection(f.paths[0], 0)).toEqual([-1, 0]);
    expect(endDirection(f.paths[0], 1)).toEqual([0, 1]);
    const a = extendPath(f, 0, 0, [-5, 0]);
    expect(a.node).toBe(0);
    expect(a.form.paths[0].nodes.map((n) => n.p)).toEqual([[-5, 0], [0, 0], [20, 0], [20, 10]]);
    const b = extendPath(f, 0, 1, [20, 15]);
    expect(b.node).toBe(3);
    expect(b.form.paths[0].nodes[3]).toEqual({ p: [20, 15], a: [20, 15], b: [20, 15], smooth: false });
    // The form given stays as it was.
    expect(f.paths[0].nodes).toHaveLength(3);
  });

  it('shows a dot in the middle of each long enough curve and beyond the ends of an open line only', () => {
    const { t } = tool(line());
    const g = t.ghosts(4);
    expect(g.filter((x) => x.part === 'mid').map((x) => x.at)).toEqual([[10, 0], [20, 5]]);
    expect(g.filter((x) => x.part === 'end').map((x) => x.at)).toEqual([[-7, 0], [20, 17]]);
    // Zoomed out the 10 mm piece is too short on screen for a dot of its own.
    expect(t.ghosts(3).filter((x) => x.part === 'mid')).toHaveLength(1);
    const closed = tool(parsePath('M0 0 L20 0 L20 10 Z', [1, 0, 0, 1, 0, 0])).t;
    expect(closed.ghosts(4).some((x) => x.part === 'end')).toBe(false);
    // A satin's rails are not made longer.
    t.rails = true;
    expect(t.ghosts(4).some((x) => x.part === 'end')).toBe(false);
  });

  it('a dot pressed puts the node in, dragged it follows, released it is taken over as one step', () => {
    const { t, taken } = tool(line());
    expect(t.pickAt(-7, 0, 4)).toEqual({ path: 0, end: 0, part: 'end' });
    expect(t.down(-7, 0, 4)).toBe('move');
    expect(t.count).toBe(4);
    expect(t.selected).toEqual({ path: 0, i: 0 });
    t.dragTo(-9, 3);
    t.up();
    expect(taken).toHaveLength(1);
    expect(taken[0].paths[0].nodes[0].p).toEqual([-9, 3]);
  });

  it('a click on a middle dot is enough: the node stays where the dot was', () => {
    const { t, taken } = tool(line());
    t.down(10, 0, 4);
    t.up();
    expect(taken).toHaveLength(1);
    expect(taken[0].paths[0].nodes.map((n) => n.p)).toEqual([[0, 0], [10, 0], [20, 0], [20, 10]]);
  });

  it('cancelled, the new node goes again', () => {
    const { t, taken } = tool(line());
    t.down(20, 17, 4);
    t.dragTo(25, 20);
    t.cancel();
    expect(t.count).toBe(3);
    expect(t.selected).toBeNull();
    expect(taken).toHaveLength(0);
  });
});
