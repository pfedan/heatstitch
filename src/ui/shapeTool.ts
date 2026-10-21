import { simplifyMore } from '../shape/simplify';
import { joinEnd, joinOpenPaths, takeOutNodes, type Joined } from '../shape/join';
import { breakAtNodes, deleteNodesKeepingShape, mergeNodes, removeSegments, straightenSegments } from '../shape/nodeOps';
import { withCrossingNodes } from '../shape/ops';
import { bandGrip, draggedWidth } from '../shape/band';
import type { Pt } from '../digitize/skeleton';
import { bezier, cloneForm, endDirection, extendPath, insertNode, moveHandle, moveNodes, nearestOnForm, nodesOf, segment, segments, setSmooth, type Form, type NodeRef } from '../shape/path';

/** Pick radius around the pointer for nodes and handles, CSS pixels; curves a little more. */
const PICK_PX = 9;
const PICK_CURVE_PX = 7;
/** A double-click this close to the outline selects its loop (with Alt: puts a node there). */
const INSERT_PX = 14;
/** How much nearer (CSS pixels) another path must be than the hovered one to take over its preview: no flicker where paths cross. */
const PATH_KEEP_PX = 3;
/**
 * How long a click on a hollow dot waits before its new node is sewn: a second press on it within
 * this time is a double-click, which selects the loop instead (and puts no node in).
 */
export const DOUBLE_MS = 500;
/** New nodes to drag out: a hollow dot in the middle of each curve this long on screen (CSS pixels), and one this far beyond each end of a line. */
const GHOST_MIN_PX = 40;
const GHOST_END_PX = 28;

/**
 * A node, one of its handles (a: in, b: out), a curve at parameter t, the width grip of a satin
 * line, or a new node still to be dragged out: in the middle of curve `seg`, or beyond end `end` of a
 * line (0: its first node, 1: its last).
 */
export type ShapePick =
  | { path: number; i: number; part: 'p' | 'a' | 'b' }
  | { path: number; seg: number; t: number; part: 'curve' }
  | { part: 'width' }
  | { path: number; seg: number; part: 'mid' }
  | { path: number; end: 0 | 1; part: 'end' };

/** A new node to drag out, where it lies (world mm); `from`: the end node it goes on from. */
export type Ghost = ({ path: number; seg: number; part: 'mid' } | { path: number; end: 0 | 1; part: 'end' }) & { at: Pt; from?: Pt };

export interface ShapeView {
  form: Form;
  /** Whether node `i` of path `path` is selected. */
  isSelected(path: number, i: number): boolean;
  hover: ShapePick | null;
  /** The path a double-click would select (shown whole while the pointer is near it), or null. */
  hoverPath: number | null;
  /** Whether all nodes of path `path` are selected. */
  pathSelected(path: number): boolean;
  /** The form was changed and is not sewn yet (while dragging). */
  dirty: boolean;
  /** Width of the band (mm): a line covering an area, or an area's satin border; null when there is none. */
  band: number | null;
  /** How far the band lies outside an area's edge (mm): a border's offset, 0 for lines. */
  bandOffset: number;
  /** Whether the width grip is being dragged. */
  readonly bandDragging: boolean;
  /** New nodes to drag out at this zoom (pixels per mm). */
  ghosts(scale: number): Ghost[];
}

export interface ShapeHooks {
  /** A changed form, taken over as one undo step: the object is sewn anew in it. */
  change: (form: Form) => void;
  redraw: () => void;
  /** Says why something did not work. */
  say: (key: 'shape.minNodes') => void;
  /** A satin line given a new width (mm) with its grip. */
  width: (w: number) => void;
}

/**
 * `added`: a new node was put in on the press (its form and selection before, for cancel).
 * `collapse`: a press on a node of several selected; released without moving, only it stays selected.
 */
type Drag = { pick: ShapePick; from: Pt; start: Form; band: number | null; added?: { form: Form; sel: NodeRef[] }; collapse?: boolean; add?: boolean } | null;

/**
 * The outline of a fill on the canvas, as curves with nodes: nodes and their handles are dragged,
 * a curve dragged bends. Several nodes are selected with Shift+click, a frame (Shift+drag) or a
 * double-click on a loop (all its nodes, as in vector programs), and then move, go (Delete) or turn
 * round or corners (C) together; Alt+double-click puts a node on the outline. New nodes are dragged out of hollow dots (as in map editors and
 * QGIS's vertex tool): one in the middle of each curve, one beyond each end of a line. Every change ends in `change`; while dragging only the
 * outline moves. Coordinates are world millimetres.
 */
export class ShapeTool implements ShapeView {
  active = false;
  form: Form = { paths: [] };
  /** The selected nodes, in the order they were picked. */
  sel: NodeRef[] = [];
  hover: ShapePick | null = null;
  hoverPath: number | null = null;
  dirty = false;
  band: number | null = null;
  bandOffset = 0;
  private drag: Drag = null;
  private moved = false;
  /** A click on a hollow dot whose node is not sewn yet (see DOUBLE_MS): the form and selection before. */
  private pending: { timer: ReturnType<typeof setTimeout>; node: NodeRef; form: Form; sel: NodeRef[] } | null = null;

  constructor(private hooks: ShapeHooks) {}

  /** The one selected node; null when none or several are selected. */
  get selected(): NodeRef | null {
    return this.sel.length === 1 ? this.sel[0] : null;
  }

  set selected(s: NodeRef | null) {
    this.sel = s ? [s] : [];
  }

  isSelected(path: number, i: number): boolean {
    return this.sel.some((s) => s.path === path && s.i === i);
  }

  /** How many nodes are selected. */
  get selCount(): number {
    return this.sel.length;
  }

  /** Lets go of the selected nodes; false when none were. */
  clearSelection(): boolean {
    if (!this.sel.length) return false;
    this.sel = [];
    return true;
  }

  /** All nodes selected (Mod+A). */
  selectAll(): void {
    this.flush();
    this.sel = this.form.paths.flatMap((_, k) => nodesOf(this.form, k));
  }

  /**
   * The path under the pointer selected as a whole (double-click); with `add` (Shift) it joins the
   * selection, or leaves it when it is selected whole already. False when none is near.
   */
  selectLoopAt(x: number, y: number, scale: number, add = false): boolean {
    this.flush();
    const pick = this.pickAt(x, y, scale);
    const path = pick && 'path' in pick ? pick.path : nearLoop(this.form, x, y, INSERT_PX / scale);
    if (path === null) return false;
    this.selectPath(path, add);
    this.hooks.redraw();
    return true;
  }

  /** Path `path` selected as a whole; with `add` added to the selection, or taken out when it is in whole. */
  private selectPath(path: number, add: boolean): void {
    const all = nodesOf(this.form, path);
    if (!add) this.sel = all;
    else if (this.pathSelected(path)) this.sel = this.sel.filter((s) => s.path !== path);
    else this.sel = [...this.sel, ...all.filter((r) => !this.isSelected(r.path, r.i))];
  }

  /** Whether all nodes of path `path` are selected. */
  pathSelected(path: number): boolean {
    const n = this.form.paths[path]?.nodes.length ?? 0;
    return n > 0 && this.sel.filter((s) => s.path === path).length === n;
  }

  /** The selection grown to the whole paths of its nodes ("Ganzen Pfad wählen"); false when it was already. */
  selectWholePaths(): boolean {
    this.flush();
    const paths = [...new Set(this.sel.map((s) => s.path))];
    if (!paths.length || paths.every((k) => this.pathSelected(k))) return false;
    this.sel = paths.flatMap((k) => nodesOf(this.form, k));
    return true;
  }

  /** Paths with a selected node. */
  get selPaths(): number {
    return new Set(this.sel.map((s) => s.path)).size;
  }

  /** Whether some path has selected nodes but not all (the selection can grow to whole paths). */
  get partlySelected(): boolean {
    return [...new Set(this.sel.map((s) => s.path))].some((k) => !this.pathSelected(k));
  }

  /** The next node selected (Tab; back with `dir` -1), on into the next path after a path's last node. */
  step(dir: 1 | -1): boolean {
    this.flush();
    const all = this.form.paths.flatMap((_, k) => nodesOf(this.form, k));
    if (!all.length) return false;
    const last = this.sel[this.sel.length - 1];
    const at = last ? all.findIndex((r) => r.path === last.path && r.i === last.i) : -1;
    this.selected = all[at < 0 ? (dir > 0 ? 0 : all.length - 1) : (at + dir + all.length) % all.length];
    return true;
  }

  /** The nodes inside the frame (world mm) added to the selection (Shift+drag). */
  selectInRect(x0: number, y0: number, x1: number, y1: number): number {
    this.flush();
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    const inside = this.form.paths.flatMap((p, path) => p.nodes.flatMap((n, i) => (n.p[0] >= ax && n.p[0] <= bx && n.p[1] >= ay && n.p[1] <= by && !this.isSelected(path, i) ? [{ path, i }] : [])));
    this.sel = [...this.sel, ...inside];
    return inside.length;
  }

  /**
   * A node put in by a click on a hollow dot sewn now, before any other input is handled; on the
   * canvas not for a press on that node (the second press of a double-click, see down).
   */
  settle(at?: { x: number; y: number; scale: number }): void {
    const p = this.pending;
    if (!p) return;
    const h = at && this.pickAt(at.x, at.y, at.scale);
    if (h?.part === 'p' && h.path === p.node.path && h.i === p.node.i) return;
    this.flush();
  }

  /** A pending node's timer stopped; the form is being replaced or left. */
  private drop(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  /** A node put in by a click on a hollow dot sewn now, before anything else happens. */
  private flush(): void {
    const p = this.pending;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending = null;
    if (this.active) this.hooks.change(this.form);
  }

  /** The node of a clicked hollow dot dropped again (it was the first click of a double-click). */
  private unpend(): void {
    const p = this.pending;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending = null;
    this.form = p.form;
    this.sel = p.sel;
    this.dirty = false;
  }

  open(form: Form): void {
    this.drop();
    this.active = true;
    this.form = cloneForm(form);
    this.selected = null;
    this.hover = null;
    this.hoverPath = null;
    this.dirty = false;
    this.drag = null;
  }

  close(): void {
    this.drop();
    this.active = false;
    this.form = { paths: [] };
    this.selected = this.hover = null;
    this.hoverPath = null;
    this.drag = null;
    this.dirty = false;
    this.band = null;
    this.bandOffset = 0;
  }

  /** The form anew (after new stitches); the selected nodes stay while they are still there. */
  setForm(form: Form): void {
    this.drop();
    const same = form.paths.length === this.form.paths.length && form.paths.every((p, k) => p.nodes.length === this.form.paths[k].nodes.length);
    this.form = cloneForm(form);
    if (!same) this.selected = null;
    this.hover = null;
    this.hoverPath = null;
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

  /** Whether the width grip is being dragged. */
  get bandDragging(): boolean {
    return this.drag?.pick.part === 'width';
  }

  /**
   * New nodes to drag out: the middle of each curve long enough on screen to leave room beside its
   * nodes, and, on a line (not a satin's rails), a dot beyond each end. None while dragging.
   */
  ghosts(scale: number): Ghost[] {
    if (this.drag && this.moved) return [];
    const out: Ghost[] = [];
    this.form.paths.forEach((p, path) => {
      for (let seg = 0; seg < segments(p); seg++) {
        const c = segment(p, seg);
        if (Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]) * scale < GHOST_MIN_PX) continue;
        out.push({ path, seg, part: 'mid', at: bezier(c, 0.5) });
      }
      if (p.closed) return;
      for (const end of [0, 1] as const) {
        const dir = endDirection(p, end);
        if (!dir) continue;
        const from = p.nodes[end === 0 ? 0 : p.nodes.length - 1].p;
        const k = GHOST_END_PX / scale;
        out.push({ path, end, part: 'end', at: [from[0] + dir[0] * k, from[1] + dir[1] * k], from });
      }
    });
    return out;
  }

  /** What lies under the pointer: a shown handle, a node, the width grip, a new node, or a curve (in that order). */
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
    // After the nodes: on a narrow satin the grip lies close to the line and must not cover them.
    const grip = this.band !== null ? bandGrip(this.form, this.band, this.bandOffset) : null;
    if (grip && Math.hypot(grip.at[0] - x, grip.at[1] - y) < r) return { part: 'width' };
    for (const g of this.ghosts(scale)) {
      const d = Math.hypot(g.at[0] - x, g.at[1] - y);
      if (d < bd) {
        bd = d;
        best = g.part === 'mid' ? { path: g.path, seg: g.seg, part: 'mid' } : { path: g.path, end: g.end, part: 'end' };
      }
    }
    if (best) return best;
    const near = nearestOnForm(this.form, [x, y]);
    if (near && near.d < PICK_CURVE_PX / scale) return { path: near.path, seg: near.seg, t: near.t, part: 'curve' };
    return null;
  }

  /**
   * Starts dragging what is under the pointer; 'pan' when nothing is there. With `add` (Shift) a
   * node joins the selection or leaves it.
   */
  down(x: number, y: number, scale: number, add = false): 'move' | 'pan' {
    const p = this.pending;
    if (p) {
      const again = this.pickAt(x, y, scale);
      if (again?.part === 'p' && again.path === p.node.path && again.i === p.node.i) {
        // The second press of a double-click on a hollow dot: no new node, the loop is selected.
        // With Shift the selection stays as it was; the double-click event adds the loop.
        this.unpend();
        if (!add) this.sel = nodesOf(this.form, p.node.path);
        this.drag = null;
        this.hooks.redraw();
        return 'move';
      }
      this.flush();
    }
    const pick = this.pickAt(x, y, scale);
    if (!pick) {
      return 'pan';
    }
    if (pick.part === 'mid' || pick.part === 'end') {
      // A new node put in where the dot is, selected and dragged on from there; taken over on release.
      const ghost = this.ghosts(scale).find((g) => g.path === pick.path && (g.part === 'mid' ? pick.part === 'mid' && g.seg === pick.seg : pick.part === 'end' && g.end === pick.end));
      if (!ghost) return 'pan';
      const was = { form: this.form, sel: this.sel };
      const { form, node } = pick.part === 'mid' ? insertNode(this.form, pick.path, pick.seg, 0.5) : extendPath(this.form, pick.path, pick.end, ghost.at);
      this.form = form;
      this.selected = { path: pick.path, i: node };
      this.drag = { pick: { path: pick.path, i: node, part: 'p' }, from: [x, y], start: form, band: this.band, added: was };
      this.moved = false;
      this.dirty = true;
      this.hooks.redraw();
      return 'move';
    }
    let collapse = false;
    if (pick.part === 'p') {
      const has = this.isSelected(pick.path, pick.i);
      if (add && has) {
        this.sel = this.sel.filter((s) => s.path !== pick.path || s.i !== pick.i);
        this.hooks.redraw();
        return 'move';
      }
      if (add) this.sel = [...this.sel, { path: pick.path, i: pick.i }];
      else if (!has) this.selected = { path: pick.path, i: pick.i };
      else collapse = this.sel.length > 1;
    }
    this.drag = { pick, from: [x, y], start: this.form, band: this.band, collapse, add };
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
    if (k.part === 'width') {
      const g = d.band !== null ? bandGrip(d.start, d.band, this.bandOffset) : null;
      if (g) this.band = draggedWidth(g, [x, y]);
      this.hooks.redraw();
      return true;
    }
    if (k.part === 'p') {
      // A selected node takes the others along.
      this.form = moveNodes(d.start, this.isSelected(k.path, k.i) ? this.sel : [k], dx, dy);
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
    if (d.pick.part === 'width') {
      if (this.moved && this.band !== null && this.band !== d.band) this.hooks.width(this.band);
      else this.hooks.redraw();
      return;
    }
    if (d.added && !this.moved) {
      // A click on a hollow dot: the node shows now and is sewn a moment later, unless the click
      // was the first of a double-click.
      const k = d.pick as NodeRef;
      this.pending = { timer: setTimeout(() => this.flush(), DOUBLE_MS), node: { path: k.path, i: k.i }, form: d.added.form, sel: d.added.sel };
      this.hooks.redraw();
    } else if (this.moved || d.added) this.hooks.change(this.form);
    else if (d.pick.part === 'curve') {
      // A tap on a curve shows its path, as hovering does (on touch there is no hovering); with Shift
      // the selection stays, as the press may be the first of a Shift+double-click adding the path.
      if (!d.add) this.selected = null;
      this.hoverPath = d.pick.path;
      this.hooks.redraw();
    } else if (d.collapse && d.pick.part === 'p') {
      this.selected = { path: d.pick.path, i: d.pick.i };
      this.hooks.redraw();
    }
  }

  cancel(): void {
    if (this.drag) {
      this.form = this.drag.added?.form ?? this.drag.start;
      if (this.drag.added) this.sel = this.drag.added.sel;
      this.band = this.drag.band;
    }
    this.drag = null;
    this.dirty = false;
  }

  /** Whether a press is being dragged (to tell it from a click). */
  get dragging(): boolean {
    return !!this.drag && this.moved;
  }

  hoverAt(x: number, y: number, scale: number): boolean {
    const h = this.pickAt(x, y, scale);
    const key = (p: ShapePick | null) =>
      !p ? '' : p.part === 'width' ? 'w' : `${p.path}:${p.part === 'curve' ? `c${p.seg}` : p.part === 'mid' ? `m${p.seg}` : p.part === 'end' ? `e${p.end}` : `${p.i}${p.part}`}`;
    const path = this.drag ? this.hoverPath : this.pathNear(h, x, y, scale);
    if (key(h) === key(this.hover) && path === this.hoverPath) return false;
    this.hover = h;
    this.hoverPath = path;
    return true;
  }

  /**
   * The path a double-click at (x, y) would select: the one of the node, handle or curve under the
   * pointer, else the nearest within reach. The path shown already stays until another is clearly
   * nearer, so the preview does not flicker where paths cross or touch.
   */
  private pathNear(h: ShapePick | null, x: number, y: number, scale: number): number | null {
    if (h && h.part !== 'curve' && 'path' in h) return h.path;
    const near = nearestOnForm(this.form, [x, y]);
    if (!near || near.d > INSERT_PX / scale) return null;
    const was = this.hoverPath;
    if (was === null || was === near.path || !this.form.paths[was]) return near.path;
    const kept = nearestOnForm({ paths: [this.form.paths[was]] }, [x, y]);
    return kept && kept.d <= INSERT_PX / scale && kept.d - near.d < PATH_KEEP_PX / scale ? was : near.path;
  }

  /** Whether the pointer is close to the outline (a double-click there selects its loop). */
  near(x: number, y: number, scale: number): boolean {
    const n = nearestOnForm(this.form, [x, y]);
    return !!n && n.d <= INSERT_PX / scale;
  }

  /** A node where the pointer is on a curve (Alt+double-click); true when one was put in. */
  insertAt(x: number, y: number, scale: number): boolean {
    this.flush();
    const near = nearestOnForm(this.form, [x, y]);
    if (!near || near.d > INSERT_PX / scale) return false;
    const { form, node } = insertNode(this.form, near.path, near.seg, near.t);
    this.selected = { path: near.path, i: node };
    this.form = form;
    this.hooks.change(form);
    return true;
  }

  /** Removes the selected nodes; a path too small to keep goes as a whole (a hole, a piece). */
  deleteSelected(): boolean {
    this.flush();
    if (!this.sel.length) return false;
    const next = deleteNodesKeepingShape(this.form, this.sel);
    if (!next) {
      this.hooks.say('shape.minNodes');
      return true;
    }
    this.selected = null;
    this.form = next;
    this.hooks.change(next);
    return true;
  }

  /** The selected nodes round or corners (key C): all round unless they all are already. */
  toggleSmooth(): boolean {
    this.flush();
    const round = !this.selectedSmooth;
    if (!this.sel.length) return false;
    // Each made round from its neighbours as they are (setSmooth moves no node).
    for (const s of this.sel) this.form = setSmooth(this.form, s.path, s.i, round);
    this.hooks.change(this.form);
    return true;
  }

  /** Whether the path of the (first) selected node, else the first path, is closed. */
  get closed(): boolean {
    return !!this.form.paths[this.sel[0]?.path ?? 0]?.closed;
  }

  /**
   * The path of the (first) selected node, else the first path, closed: its ends joined by a straight
   * piece, one node when they lie on one spot. Opening goes with Auftrennen (breakSelected).
   */
  closePath(): boolean {
    this.flush();
    const k = this.sel[0]?.path ?? 0;
    const path = this.form.paths[k];
    if (!path || path.closed || path.nodes.length < 2) return false;
    const nodes = path.nodes.map((n) => ({ ...n }));
    if (nodes.length < 3 && Math.hypot(nodes[0].p[0] - nodes[1].p[0], nodes[0].p[1] - nodes[1].p[1]) < 0.05) return false;
    // Ends on the same spot are one node.
    const a = nodes[0];
    const b = nodes[nodes.length - 1];
    if (nodes.length > 2 && Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) < 0.05) {
      a.a = b.a;
      nodes.pop();
    }
    this.form = { ...this.form, paths: this.form.paths.map((p, j) => (j === k ? { closed: true, nodes } : p)) };
    this.selected = null;
    this.hooks.change(this.form);
    return true;
  }

  /** Open paths in the form (two or more can be joined). */
  get openPaths(): number {
    return this.form.paths.filter((p) => !p.closed && p.nodes.length >= 2).length;
  }

  /** The end of an open path the selected node is: 0 its first, 1 its last; null otherwise. */
  get selectedEnd(): 0 | 1 | null {
    const s = this.selected;
    const p = s && this.form.paths[s.path];
    if (!s || !p || p.closed || p.nodes.length < 2) return null;
    return s.i === 0 ? 0 : s.i === p.nodes.length - 1 ? 1 : null;
  }

  /** The ends of open paths among the selected nodes, as "path:0" (its first node) and "path:1" (its last). */
  get selectedEnds(): Set<string> {
    const ends = new Set<string>();
    for (const s of this.sel) {
      const p = this.form.paths[s.path];
      if (!p || p.closed || p.nodes.length < 2) continue;
      if (s.i === 0) ends.add(`${s.path}:0`);
      if (s.i === p.nodes.length - 1) ends.add(`${s.path}:1`);
    }
    return ends;
  }

  /**
   * Paths joined at their ends (Verbinden): the selected end with the nearest end of another open
   * path; with several nodes selected, the ends among them with each other, nearest first; else all
   * open paths into one, nearest ends first. Ends within 0.5 mm are one node, farther
   * ones get a straight piece. Null when nothing joins.
   */
  join(): Joined | null {
    this.flush();
    const s = this.selected;
    const end = this.selectedEnd;
    const ends = this.selectedEnds;
    const j = s && end !== null ? joinEnd(this.form, s.path, end) : this.sel.length > 1 ? (ends.size >= 2 ? joinOpenPaths(this.form, true, undefined, ends) : null) : joinOpenPaths(this.form, true);
    if (!j) return null;
    this.form = j.form;
    this.selected = null;
    this.hooks.change(this.form);
    return j;
  }

  /** Whether a selected node can cut its path (Auftrennen): any node of a closed path, an inner one of an open path. */
  get canBreak(): boolean {
    return this.sel.some((s) => {
      const p = this.form.paths[s.path];
      return !!p && (p.closed ? p.nodes.length >= 2 : s.i > 0 && s.i < p.nodes.length - 1);
    });
  }

  /** How many cuts Auftrennen would make at the selected nodes. */
  get breakCuts(): number {
    return breakAtNodes(this.form, this.sel)?.cuts ?? 0;
  }

  /** The paths cut at the selected nodes, the outline unchanged (see breakAtNodes); how many cuts. */
  breakSelected(): number {
    this.flush();
    const r = breakAtNodes(this.form, this.sel);
    if (!r) return 0;
    this.form = r.form;
    this.selected = null;
    this.hooks.change(this.form);
    return r.cuts;
  }

  /** Whether two selected nodes are neighbours on a path (the piece between them can go). */
  get canRemoveSegment(): boolean {
    return this.sel.length >= 2 && removeSegments(this.form, this.sel) !== null;
  }

  /** The pieces between selected neighbours taken away (Stück entfernen). */
  removeSegment(): boolean {
    this.flush();
    const f = removeSegments(this.form, this.sel);
    if (!f) return false;
    this.form = f;
    this.selected = null;
    this.hooks.change(this.form);
    return true;
  }

  /** Whether a curved piece lies between two selected neighbours (Stück gerade can do something). */
  get canStraighten(): boolean {
    return this.sel.length >= 2 && straightenSegments(this.form, this.sel) !== null;
  }

  /** The pieces between selected neighbours made straight (Stück gerade); the selection stays. */
  straighten(): boolean {
    this.flush();
    const f = straightenSegments(this.form, this.sel);
    if (!f) return false;
    this.form = f;
    this.hooks.change(this.form);
    return true;
  }

  /**
   * Auswahl umkehren (Inkscape "!"): within the paths that have selected nodes, the others selected
   * instead; with nothing selected, all. False when nothing changes.
   */
  invertSelection(): boolean {
    this.flush();
    if (!this.sel.length) {
      if (!this.count) return false;
      this.selectAll();
      return true;
    }
    const paths = [...new Set(this.sel.map((s) => s.path))].sort((a, b) => a - b);
    this.sel = paths.flatMap((k) => nodesOf(this.form, k).filter((r) => !this.isSelected(r.path, r.i)));
    return true;
  }

  /** The selected nodes laid together (Knoten zusammenlegen, see mergeNodes); false when they cannot be. */
  mergeSelected(): boolean {
    this.flush();
    const f = this.sel.length >= 2 ? mergeNodes(this.form, this.sel) : null;
    if (!f) return false;
    this.form = f;
    this.selected = null;
    this.hooks.change(this.form);
    return true;
  }

  /**
   * The selected nodes taken out as a form of their own, and what stays (see takeOutNodes); the
   * form is not changed here: the object and its new neighbour are sewn by the app. `whole`: an area.
   */
  takeOut(whole: boolean): { keep: Form; out: Form } | null {
    this.flush();
    return this.sel.length >= 2 ? takeOutNodes(this.form, this.sel, whole) : null;
  }

  /** A node wherever the paths cross, the outline unchanged; how many were put in. */
  crossingNodes(): number {
    this.flush();
    const r = withCrossingNodes(this.form);
    if (!r) return 0;
    this.form = r.form;
    this.selected = null;
    this.hooks.change(this.form);
    return r.added;
  }

  /** The selected nodes moved by (dx, dy) mm. */
  nudge(dx: number, dy: number): boolean {
    this.flush();
    if (!this.sel.length) return false;
    this.form = moveNodes(this.form, this.sel, dx, dy);
    this.hooks.change(this.form);
    return true;
  }

  /** Whether the selected nodes are all round; null when none is selected. */
  get selectedSmooth(): boolean | null {
    if (!this.sel.length) return null;
    return this.sel.every((s) => !!this.form.paths[s.path]?.nodes[s.i]?.smooth);
  }

  /**
   * The form with fewer nodes ("Vereinfachen"), each press a bit more; null when none can go. Take
   * it over with `commit`.
   */
  simplify(): { before: number; after: number } | null {
    this.flush();
    const s = simplifyMore(this.form);
    if (!s) return null;
    const before = this.count;
    this.form = s;
    this.selected = this.hover = null;
    return { before, after: this.count };
  }

  /** The form as it is now taken over (sewn anew). */
  commit(): void {
    this.hooks.change(this.form);
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

/** The path whose outline passes within `r` mm of (x, y), or null. */
function nearLoop(f: Form, x: number, y: number, r: number): number | null {
  const near = nearestOnForm(f, [x, y]);
  return near && near.d <= r ? near.path : null;
}
