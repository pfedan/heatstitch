import { formatNumber } from '../i18n';
import type { Pt } from '../digitize/skeleton';
import { segment, segments, type Form } from '../shape/path';
import { corners, TURN_PX, type FrameView } from '../ui/frameTool';
import type { ShapePick, ShapeView } from '../ui/shapeTool';
import type { Viewport } from './viewport';
import type { AsideShape } from '../model/aside';
import { STITCH } from '../model/pattern';

const ACCENT = '#e0559e';

const isNode = (h: ShapePick | null, path: number, i: number, part: 'p' | 'a' | 'b') => !!h && h.part === part && h.path === path && h.i === i;

/**
 * A fill's outline as curves: the curves dark under light (amber while changed and not sewn yet),
 * nodes as squares (corners) or circles (round), the selected node in the accent color with its
 * handles.
 */
export function drawShapeOverlay(ctx: CanvasRenderingContext2D, vp: Viewport, view: ShapeView, handles: { path: number; i: number; part: 'a' | 'b' }[]): void {
  const S = (p: Pt) => vp.toScreen(p[0], p[1]);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const p of view.form.paths) {
    if (!p.nodes.length) continue;
    ctx.moveTo(...S(p.nodes[0].p));
    for (let k = 0; k < segments(p); k++) {
      const [, b, a, e] = segment(p, k);
      ctx.bezierCurveTo(...S(b), ...S(a), ...S(e));
    }
    if (p.closed) ctx.closePath();
  }
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.strokeStyle = view.dirty ? '#ffd666' : '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // The hovered curve a little thicker.
  const h = view.hover;
  if (h?.part === 'curve') {
    const p = view.form.paths[h.path];
    const [s, b, a, e] = segment(p, h.seg);
    ctx.beginPath();
    ctx.moveTo(...S(s));
    ctx.bezierCurveTo(...S(b), ...S(a), ...S(e));
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  // Handles: a thin line from the node, a small dot at the end.
  for (const hd of handles) {
    const n = view.form.paths[hd.path].nodes[hd.i];
    const [nx, ny] = S(n.p);
    const [hx, hy] = S(n[hd.part]);
    ctx.beginPath();
    ctx.moveTo(nx, ny);
    ctx.lineTo(hx, hy);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hx, hy, isNode(h, hd.path, hd.i, hd.part) ? 5.5 : 4, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();
  }
  view.form.paths.forEach((p, path) =>
    p.nodes.forEach((n, i) => {
      const [x, y] = S(n.p);
      const sel = view.selected?.path === path && view.selected.i === i;
      const r = sel || isNode(h, path, i, 'p') ? 5.5 : 4.5;
      ctx.beginPath();
      if (n.smooth) ctx.arc(x, y, r, 0, Math.PI * 2);
      else ctx.rect(x - r, y - r, 2 * r, 2 * r);
      ctx.fillStyle = sel ? ACCENT : '#ffffff';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    }),
  );
  ctx.restore();
}

/**
 * The frame around the selected object: dashed, with square handles on the corners (when it can
 * be scaled) and a round turn handle above it; while dragging, the frame as it will be and a
 * label with the new size, the turn or the distance moved.
 */
export function drawFrame(ctx: CanvasRenderingContext2D, vp: Viewport, f: FrameView, mapped: Pt[]): void {
  const S = (p: Pt) => vp.toScreen(p[0], p[1]);
  ctx.save();
  const pts = (f.dragging !== null ? mapped : corners(f.box)).map(S);
  ctx.beginPath();
  pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = f.hover === 'move' || f.dragging === 'move' ? ACCENT : '#ffffff';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.setLineDash([]);
  const handle = (x: number, y: number, round: boolean, on: boolean) => {
    const r = on ? 6 : 5;
    ctx.beginPath();
    if (round) ctx.arc(x, y, r, 0, Math.PI * 2);
    else ctx.rect(x - r, y - r, 2 * r, 2 * r);
    ctx.fillStyle = on ? ACCENT : '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  };
  if (f.canScale) pts.forEach(([x, y], k) => handle(x, y, false, f.hover === k || f.dragging === k));
  // The turn handle on a short stem above the middle of the top side.
  const [tx, ty] = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
  const len = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) || 1;
  // Upwards from the top side (perpendicular to it, away from the frame).
  const nx = (pts[1][1] - pts[0][1]) / len;
  const ny = -(pts[1][0] - pts[0][0]) / len;
  const hx = tx + nx * TURN_PX;
  const hy = ty + ny * TURN_PX;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(hx, hy);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  handle(hx, hy, true, f.hover === 'turn' || f.dragging === 'turn');
  if (f.dragging !== null) {
    const m = f.m;
    let text = '';
    if (f.dragging === 'move') text = `${formatNumber(m[4], 1)} / ${formatNumber(m[5], 1)} mm`;
    else if (f.dragging === 'turn') text = `${formatNumber(f.turn, 1)}°`;
    else {
      const w = (f.box.maxX - f.box.minX) * Math.abs(m[0]);
      const h = (f.box.maxY - f.box.minY) * Math.abs(m[3]);
      text = `${formatNumber(w, 1)} × ${formatNumber(h, 1)} mm`;
    }
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const lx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const ly = Math.max(...ys) + 18;
    ctx.font = '600 12px system-ui, sans-serif';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.beginPath();
    ctx.roundRect(lx - tw / 2 - 7, ly - 11, tw + 14, 22, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx, ly);
  }
  ctx.restore();
}

/**
 * A shape being drawn: its curves light over dark, the pen's nodes, the first one in the accent
 * color when a click there would close the area, and the size of a rectangle or ellipse.
 */
export function drawDrawing(ctx: CanvasRenderingContext2D, vp: Viewport, form: Form, o: { nodes: number; closing: boolean; size: [number, number] | null }): void {
  const S = (p: Pt) => vp.toScreen(p[0], p[1]);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const p of form.paths) {
    if (!p.nodes.length) continue;
    ctx.moveTo(...S(p.nodes[0].p));
    for (let k = 0; k < segments(p); k++) {
      const [, b, a, e] = segment(p, k);
      ctx.bezierCurveTo(...S(b), ...S(a), ...S(e));
    }
    if (p.closed) ctx.closePath();
  }
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (o.nodes) {
    // The pen's nodes (not the end that follows the pointer).
    (form.paths[0]?.nodes ?? []).slice(0, o.nodes).forEach((n, i) => {
      const [x, y] = S(n.p);
      const on = i === 0 && o.closing;
      const r = on ? 6 : 4;
      ctx.beginPath();
      if (n.smooth) ctx.arc(x, y, r, 0, Math.PI * 2);
      else ctx.rect(x - r, y - r, 2 * r, 2 * r);
      ctx.fillStyle = on ? ACCENT : '#ffffff';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    });
  }
  if (o.size) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of form.paths) for (const n of p.nodes) {
      const [x, y] = S(n.p);
      xs.push(x);
      ys.push(y);
    }
    const text = `${formatNumber(o.size[0], 1)} × ${formatNumber(o.size[1], 1)} mm`;
    const lx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const ly = Math.max(...ys) + 18;
    ctx.font = '600 12px system-ui, sans-serif';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.beginPath();
    ctx.roundRect(lx - tw / 2 - 7, ly - 11, tw + 14, 22, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx, ly);
  }
  ctx.restore();
}

/**
 * Shapes that are not sewn: switched off as a thin outline in their thread color, guides dashed
 * and light; the one hovered in the list in the accent color. Shapes known only by their stitches
 * show those, thin.
 */
export function drawAside(ctx: CanvasRenderingContext2D, vp: Viewport, list: AsideShape[], hover: number | null): void {
  const S = (p: Pt) => vp.toScreen(p[0], p[1]);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const a of list) {
    ctx.beginPath();
    if (a.form) {
      for (const p of a.form.paths) {
        if (!p.nodes.length) continue;
        ctx.moveTo(...S(p.nodes[0].p));
        for (let k = 0; k < segments(p); k++) {
          const [, b, c, e] = segment(p, k);
          ctx.bezierCurveTo(...S(b), ...S(c), ...S(e));
        }
        if (p.closed) ctx.closePath();
      }
    } else if (a.records) {
      let pen = false;
      for (const r of a.records) {
        if (r.cmd !== STITCH) {
          pen = false;
          continue;
        }
        const [x, y] = vp.toScreen(r.x / 10, r.y / 10);
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
      }
    }
    const on = a.id === hover;
    ctx.setLineDash(a.role === 'guide' ? [6, 4] : []);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = on ? 4 : 3;
    ctx.stroke();
    ctx.strokeStyle = on ? ACCENT : a.role === 'guide' ? 'rgba(235, 232, 240, 0.85)' : `rgba(${a.color.r}, ${a.color.g}, ${a.color.b}, 0.8)`;
    ctx.lineWidth = on ? 2 : 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

/** An object shown as its shape: a flat area of its thread color. */
export interface FlatArea {
  form: Form;
  color: { r: number; g: number; b: number };
  alpha: number;
}

/** Objects as flat areas of their thread color, in sewing order, with a thin darker edge. */
export function drawAreas(ctx: CanvasRenderingContext2D, vp: Viewport, areas: FlatArea[]): void {
  const S = (p: Pt) => vp.toScreen(p[0], p[1]);
  ctx.save();
  ctx.lineJoin = 'round';
  for (const a of areas) {
    if (a.alpha <= 0) continue;
    ctx.beginPath();
    for (const p of a.form.paths) {
      if (!p.nodes.length) continue;
      ctx.moveTo(...S(p.nodes[0].p));
      for (let k = 0; k < segments(p); k++) {
        const [, b, c, e] = segment(p, k);
        ctx.bezierCurveTo(...S(b), ...S(c), ...S(e));
      }
      ctx.closePath();
    }
    ctx.globalAlpha = a.alpha;
    ctx.fillStyle = `rgb(${a.color.r}, ${a.color.g}, ${a.color.b})`;
    ctx.fill(a.form.nonzero ? 'nonzero' : 'evenodd');
    ctx.strokeStyle = `rgb(${Math.round(a.color.r * 0.6)}, ${Math.round(a.color.g * 0.6)}, ${Math.round(a.color.b * 0.6)})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}
