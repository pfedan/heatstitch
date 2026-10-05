import { pointAt } from '../digitize/rungs';
import type { Pt } from '../digitize/skeleton';
import type { RungPick, RungView } from '../ui/rungTool';
import type { Viewport } from './viewport';

const ACCENT = '#e0559e';

const same = (a: RungPick | null, col: number, i: number) => !!a && a.col === col && a.i === i;

/**
 * The rung tool on the canvas: the rails of the satin as thin lines, each rung as a line across
 * with a handle at both ends (dashed while they are only suggested from the stitches), the
 * selected one in the accent color; for a fill the lines drawn across it.
 */
export function drawRungOverlay(ctx: CanvasRenderingContext2D, vp: Viewport, view: RungView): void {
  const S = (p: Pt) => vp.toScreen(p[0], p[1]);
  ctx.save();
  ctx.lineCap = 'round';
  const path = (pts: Pt[]) => {
    ctx.beginPath();
    pts.forEach((p, k) => (k ? ctx.lineTo(...S(p)) : ctx.moveTo(...S(p))));
  };
  // Rails: dark under light, so they show on any thread color.
  for (const c of view.columns) {
    for (const rail of [c.left, c.right]) {
      path(rail);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
  const rung = (a: Pt, b: Pt, col: number, i: number, suggested: boolean) => {
    const sel = same(view.selected, col, i);
    const hov = same(view.hover, col, i);
    const [ax, ay] = S(a);
    const [bx, by] = S(b);
    ctx.setLineDash(suggested && !sel ? [4, 3] : []);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = sel || hov ? 5 : 4;
    ctx.stroke();
    ctx.strokeStyle = sel ? ACCENT : hov ? '#ffffff' : 'rgba(255, 214, 102, 0.95)';
    ctx.lineWidth = sel || hov ? 2.5 : 2;
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [end, x, y] of [[0, ax, ay], [1, bx, by]] as const) {
      const big = hov && view.hover?.end === end;
      ctx.beginPath();
      ctx.arc(x, y, big ? 6.5 : 5, 0, Math.PI * 2);
      ctx.fillStyle = sel ? ACCENT : '#ffd666';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    }
  };
  view.columns.forEach((c, k) => c.rungs.forEach((r, i) => rung(pointAt(c.left, c.cl, r[0]), pointAt(c.right, c.cr, r[1]), k, i, !c.own)));
  view.lines.forEach(([a, b], i) => rung(a, b, -1, i, false));
  if (view.draft) {
    const [a, b] = view.draft;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(...S(a));
    ctx.lineTo(...S(b));
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}
