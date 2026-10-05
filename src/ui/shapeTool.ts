import type { Pt } from '../digitize/skeleton';
import { cloneForm, insertNode, moveHandle, moveNode, nearestOnForm, removeNode, segment, segments, setSmooth, type Form } from '../shape/path';

/** Pick radius around the pointer for nodes and handles, CSS pixels; curves a little more. */
const PICK_PX = 9;
const PICK_CURVE_PX = 7;
/** A double-click this close to the outline puts a node there. */
const INSERT_PX = 14;

/** A node, one of its handles (a: in, b: out), or a curve at parameter t. */
export type ShapePick = { path: number; i: number; part: 'p' | 'a' | 'b' } | { path: number; seg: number; t: number; part: 'curve' };

export interface ShapeView {
  form: Form;
  selected: { path: number; i: number } | null;
  hover: ShapePick | null;
  /** The form was changed and is not sewn yet (while dragging). */
  dirty: boolean;
}

export interface ShapeHooks {
  /** A changed form, taken over as one undo step: the object is sewn anew in it. */
  change: (form: Form) => void;
  redraw: () => void;
  /** Says why something did not work. */
  say: (key: 'shape.minNodes') => void;
}

type Drag = { pick: ShapePick; from: Pt; start: Form } | null;

/**
 * The outline of a fill on the canvas, as curves with nodes: nodes and their handles are dragged,
 * a curve dragged bends, a double-click on it puts a node there, Delete removes the selected node
 * and C makes it round or a corner. Every change ends in `change`; while dragging only the
 * outline moves. Coordinates are world millimetres.
 */
export class ShapeTool implements ShapeView {
  active = false;
  form: Form = { paths: [] };
  selected: { path: number; i: number } | null = null;
  hover: ShapePick | null = null;
  dirty = false;
  private drag: Drag = null;
  private moved = false;

  constructor(private hooks: ShapeHooks) {}

  open(form: Form): void {
    this.active = true;
    this.form = cloneForm(form);
    this.selected = null;
    this.hover = null;
    this.dirty = false;
    this.drag = null;
  }

  close(): void {
    this.active = false;
    this.form = { paths: [] };
    this.selected = this.hover = null;
    this.drag = null;
    this.dirty = false;
  }

  /** The form anew (after new stitches); the selected node stays while it is still there. */
  setForm(form: Form): void {
    const same = form.paths.length === this.form.paths.length && form.paths.every((p, k) => p.nodes.length === this.form.paths[k].nodes.length);
    this.form = cloneForm(form);
    if (!same) this.selected = null;
    this.hover = null;
    this.dirty = false;
  }

  /** Handles shown (and picked): both of the selected node, and the ones of its neighbours facing it. */
  handles(): { path: number; i: number; part: 'a' | 'b' }[] {
    const s = this.selected;
    if (!s) return [];
    const p = this.form.paths[s.path];
    if (!p) return [];
    const n = p.nodes.length;
    const out: { path: number; i: number; part: 'a' | 'b' }[] = [];
    const has = (i: number, part: 'a' | 'b') => {
      const nd = p.nodes[i];
      return Math.hypot(nd[part][0] - nd.p[0], nd[part][1] - nd.p[1]) > 1e-6;
    };
    if (p.closed || s.i > 0) {
      if (has(s.i, 'a')) out.push({ path: s.path, i: s.i, part: 'a' });
      const prev = (s.i - 1 + n) % n;
      if (has(prev, 'b')) out.push({ path: s.path, i: prev, part: 'b' });
    }
    if (p.closed || s.i < n - 1) {
      if (has(s.i, 'b')) out.push({ path: s.path, i: s.i, part: 'b' });
      const next = (s.i + 1) % n;
      if (has(next, 'a')) out.push({ path: s.path, i: next, part: 'a' });
    }
    return out;
  }

  /** What lies under the pointer: a shown handle, a node, or a curve. */
  pickAt(x: number, y: number, scale: number): ShapePick | null {
    const r = PICK_PX / scale;
    let best: ShapePick | null = null;
    let bd = r;
    for (const h of this.handles()) {
      const q = this.form.paths[h.path].nodes[h.i][h.part];
      const d = Math.hypot(q[0] - x, q[1] - y);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    if (best) return best;
    this.form.paths.forEach((p, path) =>
      p.nodes.forEach((n, i) => {
        const d = Math.hypot(n.p[0] - x, n.p[1] - y);
        if (d < bd) {
          bd = d;
          best = { path, i, part: 'p' };
        }
      }),
    );
    if (best) return best;
    const near = nearestOnForm(this.form, [x, y]);
    if (near && near.d < PICK_CURVE_PX / scale) return { path: near.path, seg: near.seg, t: near.t, part: 'curve' };
    return null;
  }

  /** Starts dragging what is under the pointer; 'pan' when nothing is there. */
  down(x: number, y: number, scale: number): 'move' | 'pan' {
    const pick = this.pickAt(x, y, scale);
    if (!pick) {
      return 'pan';
    }
    if (pick.part === 'p') this.selected = { path: pick.path, i: pick.i };
    this.drag = { pick, from: [x, y], start: this.form };
    this.moved = false;
    this.hooks.redraw();
    return 'move';
  }

  dragTo(x: number, y: number): boolean {
    const d = this.drag;
    if (!d) return false;
    const dx = x - d.from[0];
    const dy = y - d.from[1];
    if (!this.moved && Math.hypot(dx, dy) < 1e-6) return true;
    this.moved = true;
    const k = d.pick;
    if (k.part === 'p') {
      const n = d.start.paths[k.path].nodes[k.i];
      this.form = moveNode(d.start, k.path, k.i, [n.p[0] + dx, n.p[1] + dy]);
    } else if (k.part === 'a' || k.part === 'b') {
      const q = d.start.paths[k.path].nodes[k.i][k.part];
      this.form = moveHandle(d.start, k.path, k.i, k.part, [q[0] + dx, q[1] + dy]);
    } else if (k.part === 'curve') {
      this.form = bend(d.start, k.path, k.seg, k.t, dx, dy);
    }
    this.dirty = true;
    this.hooks.redraw();
    return true;
  }

  /** Ends a drag: a changed form is taken over. */
  up(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (this.moved) this.hooks.change(this.form);
    else if (d.pick.part === 'curve') {
      this.selected = null;
      this.hooks.redraw();
    }
  }

  cancel(): void {
    if (this.drag) this.form = this.drag.start;
    this.drag = null;
    this.dirty = false;
  }

  /** Whether a press is being dragged (to tell it from a click). */
  get dragging(): boolean {
    return !!this.drag && this.moved;
  }

  hoverAt(x: number, y: number, scale: number): boolean {
    const h = this.pickAt(x, y, scale);
    const key = (p: ShapePick | null) => (p ? `${p.path}:${p.part === 'curve' ? `c${p.seg}` : `${p.i}${p.part}`}` : '');
    if (key(h) === key(this.hover)) return false;
    this.hover = h;
    return true;
  }

  /** Whether the pointer is close to the outline (a double-click there puts in a node). */
  near(x: number, y: number, scale: number): boolean {
    const n = nearestOnForm(this.form, [x, y]);
    return !!n && n.d <= INSERT_PX / scale;
  }

  /** A node where the pointer is on a curve (double-click); true when one was put in. */
  insertAt(x: number, y: number, scale: number): boolean {
    const near = nearestOnForm(this.form, [x, y]);
    if (!near || near.d > INSERT_PX / scale) return false;
    const { form, node } = insertNode(this.form, near.path, near.seg, near.t);
    this.selected = { path: near.path, i: node };
    this.form = form;
    this.hooks.change(form);
    return true;
  }

  /** Removes the selected node; a path too small to keep goes as a whole (a hole, a piece). */
  deleteSelected(): boolean {
    const s = this.selected;
    if (!s) return false;
    const next = removeNode(this.form, s.path, s.i);
    if (!next) {
      this.hooks.say('shape.minNodes');
      return true;
    }
    this.selected = null;
    this.form = next;
    this.hooks.change(next);
    return true;
  }

  /** The selected node round or a corner (key C). */
  toggleSmooth(): boolean {
    const s = this.selected;
    if (!s) return false;
    const n = this.form.paths[s.path].nodes[s.i];
    this.form = setSmooth(this.form, s.path, s.i, !n.smooth);
    this.hooks.change(this.form);
    return true;
  }

  /** Whether the path of the selected node (else the first one) is closed. */
  get closed(): boolean {
    return !!this.form.paths[this.selected?.path ?? 0]?.closed;
  }

  /**
   * A line closed (its ends joined by a straight piece) or opened: after the selected node, else
   * where it was closed. Lines only; for areas the outline stays closed.
   */
  toggleClosed(): boolean {
    const k = this.selected?.path ?? 0;
    const path = this.form.paths[k];
    if (!path || path.nodes.length < 2) return false;
    let nodes = path.nodes.map((n) => ({ ...n }));
    if (path.closed) {
      // Opened after the selected node: the piece from it to the next one goes.
      const i = this.selected ? this.selected.i : nodes.length - 1;
      nodes = [...nodes.slice(i + 1), ...nodes.slice(0, i + 1)];
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      first.a = first.p;
      last.b = last.p;
      first.smooth = last.smooth = false;
    } else {
      if (nodes.length < 3 && Math.hypot(nodes[0].p[0] - nodes[1].p[0], nodes[0].p[1] - nodes[1].p[1]) < 0.05) return false;
      // Ends on the same spot are one node.
      const a = nodes[0];
      const b = nodes[nodes.length - 1];
      if (nodes.length > 2 && Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) < 0.05) {
        a.a = b.a;
        nodes.pop();
      }
    }
    this.form = { paths: this.form.paths.map((p, j) => (j === k ? { closed: !path.closed, nodes } : p)) };
    this.selected = null;
    this.hooks.change(this.form);
    return true;
  }

  /** The selected node moved by (dx, dy) mm. */
  nudge(dx: number, dy: number): boolean {
    const s = this.selected;
    if (!s) return false;
    const n = this.form.paths[s.path].nodes[s.i];
    this.form = moveNode(this.form, s.path, s.i, [n.p[0] + dx, n.p[1] + dy]);
    this.hooks.change(this.form);
    return true;
  }

  /** Whether the selected node is round. */
  get selectedSmooth(): boolean | null {
    const s = this.selected;
    return s ? (this.form.paths[s.path]?.nodes[s.i]?.smooth ?? null) : null;
  }

  /** Nodes in the form. */
  get count(): number {
    return this.form.paths.reduce((a, p) => a + p.nodes.length, 0);
  }

  /** Curves in the form (for drawing). */
  get curves(): number {
    return this.form.paths.reduce((a, p) => a + segments(p), 0);
  }
}

/**
 * Curve `seg` bent so that its point at `t` moves by (dx, dy): both of its handles move, the
 * nearer one more (as dragging a curve in vector programs does).
 */
export function bend(f: Form, path: number, seg: number, t: number, dx: number, dy: number): Form {
  const g = cloneForm(f);
  const p = g.paths[path];
  const s = p.nodes[seg];
  const e = p.nodes[(seg + 1) % p.nodes.length];
  const u = Math.max(0.1, Math.min(0.9, t));
  // The point at u moves by 3u(1-u)((1-u)·w1 + u·w2) with w1 = (1-u)·k, w2 = u·k.
  const k = 1 / (3 * u * (1 - u) * ((1 - u) * (1 - u) + u * u));
  const w1 = (1 - u) * k;
  const w2 = u * k;
  const [, b, a] = segment(p, seg);
  s.b = [b[0] + dx * w1, b[1] + dy * w1];
  e.a = [a[0] + dx * w2, a[1] + dy * w2];
  // A round node stays round: its other handle turns along.
  for (const [n, h, other] of [
    [s, 'b', 'a'],
    [e, 'a', 'b'],
  ] as const) {
    if (!n.smooth) continue;
    const len = Math.hypot(n[other][0] - n.p[0], n[other][1] - n.p[1]);
    const vx = n[h][0] - n.p[0];
    const vy = n[h][1] - n.p[1];
    const d = Math.hypot(vx, vy);
    if (len > 1e-9 && d > 1e-9) n[other] = [n.p[0] - (vx / d) * len, n.p[1] - (vy / d) * len];
  }
  return g;
}
