import type { Pt } from '../digitize/skeleton';
import type { NewShape } from '../model/addShape';
import type { Form, Node } from '../shape/path';
import { ellipsePath, parsePath, rectPath } from '../shape/svgPath';
import { fitCubic } from '../shape/vectorize';

export type DrawKind = 'rect' | 'ellipse' | 'pen' | 'free';

/** A click this close to the first node closes the pen's path (CSS pixels). */
const CLOSE_PX = 10;
/** Freehand lines are smoothed to stay within this of the points drawn (mm). */
const FREE_TOLERANCE = 0.3;
/** Shapes smaller than this on both sides (mm) are taken as a slip and not drawn. */
const MIN_SIZE = 1;

export interface DrawHooks {
  /** A shape is drawn: sew it. */
  done: (shape: NewShape) => void;
  redraw: () => void;
}

const ID = [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number];
const corner = (p: Pt): Node => ({ p, a: p, b: p, smooth: false });

/**
 * Drawing new shapes on the canvas: a rectangle or ellipse by dragging (Shift: square or circle,
 * Alt: from the middle), the pen (click: corner, drag: round node, click on the first node: a
 * closed area, double-click or Enter: an open line) and freehand lines, smoothed on release.
 * Coordinates are world millimetres.
 */
export class DrawTool {
  kind: DrawKind | null = null;
  /** The shape as drawn so far, for the overlay. */
  preview: Form | null = null;
  /** Width and height of the rectangle or ellipse being dragged (mm). */
  size: [number, number] | null = null;
  /** The pen's first node is under the pointer: a click closes the area. */
  closing = false;
  /** Options of the tool bar, as if Shift (a square or circle) or Alt (from the middle) were held. */
  square = false;
  fromCenter = false;
  /** Nodes of the pen. */
  private nodes: Node[] = [];
  private from: Pt | null = null;
  private free: Pt[] = [];
  private dragging = false;
  /** The pointer, for the pen's next segment. */
  private cursor: Pt | null = null;
  /** The pen set a node with this press (dropped again when it turns into a pinch). */
  private added = false;

  constructor(private hooks: DrawHooks) {}

  get active(): boolean {
    return this.kind !== null;
  }

  start(kind: DrawKind | null): void {
    this.cancel();
    this.kind = kind;
  }

  /** Drops what is being drawn; the tool stays. */
  cancel(): void {
    this.nodes = [];
    this.free = [];
    this.from = null;
    this.dragging = false;
    this.added = false;
    this.cursor = null;
    this.preview = null;
    this.size = null;
    this.closing = false;
  }

  /** A second finger came: the press was for zooming, not drawing. */
  abortPress(): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.kind === 'pen') {
      if (this.added) this.nodes.pop();
      this.added = false;
      return this.update();
    }
    this.from = null;
    this.free = [];
    this.preview = null;
  }

  /** Takes back the pen's last node; false when there is none. */
  removeLast(): boolean {
    if (this.kind !== 'pen' || !this.nodes.length) return false;
    this.nodes.pop();
    this.update();
    return true;
  }

  /** The pointer moved without a press: the pen shows where the next segment would go. */
  hoverAt(x: number, y: number, scale: number): boolean {
    if (this.kind !== 'pen' || this.dragging || !this.nodes.length) return false;
    this.closing = this.closesAt(x, y, scale);
    this.cursor = this.closing ? this.nodes[0].p : [x, y];
    this.update();
    return true;
  }

  /** Whether a press at (x, y) would close the pen's path. */
  closesAt(x: number, y: number, scale: number): boolean {
    const first = this.nodes[0];
    return this.kind === 'pen' && !!first && this.nodes.length >= 3 && Math.hypot(first.p[0] - x, first.p[1] - y) * scale < CLOSE_PX;
  }

  /** Number of nodes the pen has set. */
  get count(): number {
    return this.nodes.length;
  }

  /** Whether the pen has nodes set (Esc drops them first, before leaving the tool). */
  get busy(): boolean {
    return this.nodes.length > 0 || this.from !== null;
  }

  down(x: number, y: number, scale: number): void {
    if (!this.kind) return;
    this.dragging = true;
    if (this.kind === 'pen') {
      if (this.closesAt(x, y, scale)) {
        this.dragging = false;
        return this.finish(true);
      }
      this.nodes.push(corner([x, y]));
      this.added = true;
      this.cursor = null;
      this.update();
      return;
    }
    this.from = [x, y];
    this.free = [[x, y]];
  }

  dragTo(x: number, y: number, shift: boolean, alt: boolean): boolean {
    if (!this.kind || !this.dragging) return false;
    if (this.kind === 'pen') {
      // Dragging away from a new node makes it round, its handles along the drag.
      const n = this.nodes[this.nodes.length - 1];
      if (!n) return true;
      const dx = x - n.p[0];
      const dy = y - n.p[1];
      if (Math.hypot(dx, dy) < 0.3) return true;
      n.b = [n.p[0] + dx, n.p[1] + dy];
      n.a = [n.p[0] - dx, n.p[1] - dy];
      n.smooth = true;
      this.update();
      return true;
    }
    if (!this.from) return true;
    if (this.kind === 'free') {
      const last = this.free[this.free.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) > 0.2) this.free.push([x, y]);
      this.preview = { paths: [{ closed: false, nodes: this.free.map(corner) }] };
      this.hooks.redraw();
      return true;
    }
    this.preview = this.box(x, y, shift || this.square, alt || this.fromCenter);
    this.hooks.redraw();
    return true;
  }

  up(x: number, y: number, shift: boolean, alt: boolean): void {
    if (!this.kind || !this.dragging) return;
    this.dragging = false;
    this.added = false;
    if (this.kind === 'pen') return;
    const from = this.from;
    this.from = null;
    if (!from) return;
    if (this.kind === 'free') {
      const pts = this.free;
      this.free = [];
      this.preview = null;
      const line = smoothLine(pts);
      if (line) this.hooks.done({ form: line, kind: 'stroke', width: 0.4 });
      return this.hooks.redraw();
    }
    const form = this.box(x, y, shift || this.square, alt || this.fromCenter, from);
    this.preview = null;
    this.size = null;
    if (form) this.hooks.done({ form, kind: 'fill' });
    this.hooks.redraw();
  }

  /** Ends the pen: a closed area, or an open line (double-click, Enter). */
  finish(closed = false): void {
    if (this.kind !== 'pen') return;
    // A double-click sets one node too many on the same spot.
    const nodes = this.nodes.filter((n, i, all) => i === 0 || Math.hypot(n.p[0] - all[i - 1].p[0], n.p[1] - all[i - 1].p[1]) > 0.05);
    this.nodes = [];
    this.cursor = null;
    this.closing = false;
    this.preview = null;
    if (nodes.length >= (closed ? 3 : 2)) this.hooks.done({ form: { paths: [{ closed, nodes }] }, kind: closed ? 'fill' : 'stroke', width: 0.4 });
    this.hooks.redraw();
  }

  private update(): void {
    const nodes = this.nodes.map((n) => ({ ...n }));
    if (this.cursor && nodes.length) nodes.push(corner(this.cursor));
    this.preview = nodes.length ? { paths: [{ closed: false, nodes }] } : null;
    this.hooks.redraw();
  }

  /** The rectangle or ellipse from `from` to (x, y). */
  private box(x: number, y: number, shift: boolean, alt: boolean, from = this.from): Form | null {
    if (!from) return null;
    let dx = x - from[0];
    let dy = y - from[1];
    if (shift) {
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * s;
      dy = Math.sign(dy || 1) * s;
    }
    const [x0, x1] = alt ? [from[0] - dx, from[0] + dx] : [from[0], from[0] + dx];
    const [y0, y1] = alt ? [from[1] - dy, from[1] + dy] : [from[1], from[1] + dy];
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    this.size = [w, h];
    if (w < MIN_SIZE && h < MIN_SIZE) return null;
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const d = this.kind === 'ellipse' ? ellipsePath(left + w / 2, top + h / 2, w / 2, h / 2) : rectPath(left, top, w, h, 0, 0);
    const f = parsePath(d, ID);
    return f.paths.length ? f : null;
  }
}

/** Points drawn by hand as a smooth open line, or null when it is too short. */
export function smoothLine(pts: Pt[]): Form | null {
  if (pts.length < 2) return null;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (len < MIN_SIZE) return null;
  const unit = (a: Pt, b: Pt): [number, number] => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const k = Math.min(3, pts.length - 1);
  const curves = fitCubic(pts, unit(pts[0], pts[k]), unit(pts[pts.length - 1], pts[pts.length - 1 - k]), FREE_TOLERANCE);
  const nodes: Node[] = [];
  for (const [p0, c1, c2, p3] of curves) {
    if (!nodes.length) nodes.push({ p: p0, a: p0, b: c1, smooth: false });
    else nodes[nodes.length - 1].b = c1;
    nodes.push({ p: p3, a: c2, b: p3, smooth: true });
  }
  nodes[nodes.length - 1].smooth = false;
  return { paths: [{ closed: false, nodes }] };
}
