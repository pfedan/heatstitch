import { formatNumber, t } from '../i18n';
import type { Pt } from '../digitize/skeleton';
import { segment, segments, type Form } from '../shape/path';
import { corners, TURN_PX, type FrameView } from '../ui/frameTool';
import type { ShapePick, ShapeView } from '../ui/shapeTool';
import type { Viewport } from './viewport';
import type { AsideShape } from '../model/aside';
import { STITCH } from '../model/pattern';
import { bandEdges, bandGrip } from '../shape/band';

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
  // A satin line: the edges of its band, dashed.
  if (view.band !== null) {
    ctx.beginPath();
    for (const edge of bandEdges(view.form, view.band, view.bandOffset)) edge.forEach((q, k) => (k ? ctx.lineTo(...S(q)) : ctx.moveTo(...S(q))));
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = view.bandDragging ? '#ffd666' : 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }
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
  drawGhosts(ctx, vp, view, h);
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
  if (view.band !== null) drawWidthGrip(ctx, vp, view, h?.part === 'width');
  ctx.restore();
}

/**
 * New nodes to drag out: small hollow dots in the middle of the curves, and beyond each end of a
 * line a dot with a plus, joined to its end by a dashed stub. The hovered one in the accent color.
 */
function drawGhosts(ctx: CanvasRenderingContext2D, vp: Viewport, view: ShapeView, h: ShapePick | null): void {
  for (const g of view.ghosts(vp.scale)) {
    const [x, y] = vp.toScreen(g.at[0], g.at[1]);
    const on = !!h && h.part === g.part && h.path === g.path && (h.part === 'mid' ? g.part === 'mid' && h.seg === g.seg : h.part === 'end' && g.part === 'end' && h.end === g.end);
    if (g.part === 'end' && g.from) {
      const [fx, fy] = vp.toScreen(g.from[0], g.from[1]);
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(x, y);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.strokeStyle = on ? ACCENT : 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const r = g.part === 'end' ? (on ? 7.5 : 6.5) : on ? 5.5 : 4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = on ? ACCENT : 'rgba(255, 255, 255, 0.85)';
    ctx.strokeStyle = on ? 'rgba(0, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();
    if (g.part !== 'end') continue;
    ctx.beginPath();
    ctx.moveTo(x - 3, y);
    ctx.lineTo(x + 3, y);
    ctx.moveTo(x, y - 3);
    ctx.lineTo(x, y + 3);
    ctx.strokeStyle = on ? '#ffffff' : 'rgba(0, 0, 0, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

/** The round grip on the band's edge, from the middle of the line; its width in mm while hovered or dragged. */
function drawWidthGrip(ctx: CanvasRenderingContext2D, vp: Viewport, view: ShapeView, hover: boolean): void {
  const g = view.band !== null ? bandGrip(view.form, view.band, view.bandOffset) : null;
  if (!g || view.band === null) return;
  const [mx, my] = vp.toScreen(g.mid[0], g.mid[1]);
  const [x, y] = vp.toScreen(g.at[0], g.at[1]);
  const on = hover || view.bandDragging;
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(x, y);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, on ? 6.5 : 5.5, 0, Math.PI * 2);
  ctx.fillStyle = on ? ACCENT : '#ffffff';
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  if (!on) return;
  ctx.font = '600 12px system-ui, sans-serif';
  const text = `${formatNumber(view.band, 1)} mm`;
  const tw = ctx.measureText(text).width;
  const lx = x + 12;
  const ly = y - 12;
  ctx.fillStyle = 'rgba(20, 20, 24, 0.85)';
  ctx.beginPath();
  ctx.roundRect(lx - 6, ly - 13, tw + 12, 20, 5);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, lx, ly + 1);
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
  // The distance grip of a contour: a diamond on it (where the pointer is while it is dragged).
  if (f.gap) {
    const [gx, gy] = S(f.gapDrag ?? f.gap.at);
    const on = f.hover === 'gap' || f.dragging === 'gap';
    const r = on ? 7.5 : 6.5;
    ctx.beginPath();
    ctx.moveTo(gx, gy - r);
    ctx.lineTo(gx + r, gy);
    ctx.lineTo(gx, gy + r);
    ctx.lineTo(gx - r, gy);
    ctx.closePath();
    ctx.fillStyle = on ? ACCENT : '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }
  // What the move hangs on: a thin line in the accent color across the stage.
  if (f.dragging === 'move' && (f.snapped.x !== null || f.snapped.y !== null)) {
    ctx.beginPath();
    if (f.snapped.x !== null) {
      const [x] = S([f.snapped.x, 0]);
      ctx.moveTo(x, -1e4);
      ctx.lineTo(x, 1e4);
    }
    if (f.snapped.y !== null) {
      const [, y] = S([0, f.snapped.y]);
      ctx.moveTo(-1e4, y);
      ctx.lineTo(1e4, y);
    }
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  if (f.dragging !== null) {
    const m = f.m;
    let text = '';
    if (f.dragging === 'move') text = `${formatNumber(m[4], 1)} / ${formatNumber(m[5], 1)} mm`;
    else if (f.dragging === 'turn') text = `${formatNumber(f.turn, 1)}°`;
    else if (f.dragging === 'gap') text = `${t('object.contour.gap')} ${formatNumber(f.gapValue, 1)} mm`;
    else {
      const w = (f.box.maxX - f.box.minX) * Math.abs(m[0]);
      const h = (f.box.maxY - f.box.minY) * Math.abs(m[3]);
      text = `${formatNumber(w, 1)} × ${formatNumber(h, 1)} mm`;
    }
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    // The distance by the grip itself (it moves in and out, the frame stays).
    const grip = f.dragging === 'gap' && f.gapDrag ? S(f.gapDrag) : null;
    const lx = grip ? grip[0] : (Math.min(...xs) + Math.max(...xs)) / 2;
    const ly = grip ? grip[1] - 24 : Math.max(...ys) + 18;
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
  /** A drawn line: its curves drawn this wide (mm) instead of filled. */
  stroke?: number;
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
      if (p.closed || a.stroke === undefined) ctx.closePath();
    }
    ctx.globalAlpha = a.alpha;
    if (a.stroke !== undefined) {
      // A line: a band of its width with the same darker edge as the areas (drawn under it).
      const w = a.stroke * vp.scale;
      ctx.lineCap = 'butt';
      ctx.strokeStyle = `rgb(${Math.round(a.color.r * 0.6)}, ${Math.round(a.color.g * 0.6)}, ${Math.round(a.color.b * 0.6)})`;
      ctx.lineWidth = w + 2;
      ctx.stroke();
      ctx.strokeStyle = `rgb(${a.color.r}, ${a.color.g}, ${a.color.b})`;
      ctx.lineWidth = Math.max(1, w);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = `rgb(${a.color.r}, ${a.color.g}, ${a.color.b})`;
    ctx.fill(a.form.nonzero ? 'nonzero' : 'evenodd');
    ctx.strokeStyle = `rgb(${Math.round(a.color.r * 0.6)}, ${Math.round(a.color.g * 0.6)}, ${Math.round(a.color.b * 0.6)})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}
