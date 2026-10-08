import { pointAt } from '../digitize/rungs';
import { sectionsOf } from '../model/restitch';
import type { Pt } from '../digitize/skeleton';
import { BADGE, type RungPick, type RungView } from '../ui/rungTool';
import type { Viewport } from './viewport';

const ACCENT = '#e0559e';

/** Cut lines in their own color, so they read apart from the rungs. */
const CUT = '#6fd3ff';

/** Rungs (and lines across a fill, guide lines, points). */
const RUNG = 'rgba(255, 214, 102, 0.95)';

const same = (a: RungPick | null, col: number, i: number, cut = false, free = false) => !!a && a.col === col && a.i === i && !!a.cut === cut && !!a.span === free;

/**
 * The rung tool on the canvas: the edges of the satin as thin lines, each rung as a line across
 * with a handle at both ends (dashed while they are only suggested from the stitches), the
 * selected one in the accent color; for a fill the lines drawn across it or the guide lines on it.
 */
export function drawRungOverlay(ctx: CanvasRenderingContext2D, vp: Viewport, view: RungView): void {
  const S = (p: Pt) => vp.toScreen(p[0], p[1]);
  ctx.save();
  ctx.lineCap = 'round';
  const path = (pts: Pt[]) => {
    ctx.beginPath();
    pts.forEach((p, k) => (k ? ctx.lineTo(...S(p)) : ctx.moveTo(...S(p))));
  };
  // Each section drawn ahead as it will be sewn: every third stitch line, thin and quiet.
  ctx.beginPath();
  for (const sec of view.previews)
    for (let k = 0; k < sec.length; k += 3) {
      ctx.moveTo(...S(sec[k][0]));
      ctx.lineTo(...S(sec[k][1]));
    }
  // A faint dark edge keeps them apart from the stitches under them, on light and dark thread.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // The satin's edges (its outline; see RungView.edges): dark under light, so they show on any thread color.
  for (const edge of view.edges) {
    path(edge);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  // A column with free rungs: the rails its sections are sewn along, where a cut line became an edge.
  for (const c of view.columns) {
    if (!c.spans.length) continue;
    ctx.setLineDash([5, 4]);
    for (const sec of sectionsOf({ left: c.left, right: c.right, rungs: c.rungs, cuts: c.cuts, spans: c.spans })) {
      for (const rail of [sec.left, sec.right]) {
        path(rail);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }
  const rung = (a: Pt, b: Pt, col: number, i: number, suggested: boolean, cut = false, label = '', free = false) => {
    const sel = same(view.selected, col, i, cut, free);
    const hov = same(view.hover, col, i, cut, free);
    const [ax, ay] = S(a);
    const [bx, by] = S(b);
    // Each kind keeps its color in every state (selected: an accent halo, hovered: wider), so a
    // cut line and a rung never look alike while one is picked or dragged.
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    if (sel) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 8;
      ctx.stroke();
    }
    ctx.setLineDash(suggested && !sel ? [4, 3] : []);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = sel || hov ? 5 : 4;
    ctx.stroke();
    ctx.strokeStyle = cut ? CUT : RUNG;
    ctx.lineWidth = sel || hov ? 2.75 : 2;
    ctx.stroke();
    ctx.setLineDash([]);
    if (label) {
      ctx.font = '600 11px system-ui, sans-serif';
      const tx = bx + 8;
      const ty = by + 4;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.strokeText(label, tx, ty);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, tx, ty);
    }
    for (const [end, x, y] of [[0, ax, ay], [1, bx, by]] as const) {
      const big = hov && view.hover?.end === end;
      const r = big ? 6.5 : 5;
      // Cut lines have square handles, rungs round ones: told apart without the color too.
      const handle = () => {
        ctx.beginPath();
        if (cut) ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
        else ctx.arc(x, y, r, 0, Math.PI * 2);
      };
      handle();
      ctx.fillStyle = cut ? CUT : '#ffd666';
      ctx.strokeStyle = sel ? ACCENT : 'rgba(0, 0, 0, 0.75)';
      ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.fill();
      ctx.stroke();
    }
  };
  view.columns.forEach((c, k) =>
    c.rungs.forEach((r, i) => {
      const sp = c.spacings.find(([x]) => Math.abs(x - r[0]) < 0.05);
      rung(pointAt(c.left, c.cl, r[0]), pointAt(c.right, c.cr, r[1]), k, i, !c.own, false, sp ? `${sp[1].toFixed(2)} mm` : '');
    }),
  );
  view.columns.forEach((c, k) => c.spans.forEach(([a, b], i) => rung(a, b, k, i, false, false, '', true)));
  view.columns.forEach((c, k) => c.cuts.forEach((r, i) => rung(pointAt(c.left, c.cl, r[0]), pointAt(c.right, c.cr, r[1]), k, i, false, true)));
  view.lines.forEach(([a, b], i) => rung(a, b, -1, i, false));
  view.cutLines.forEach(([a, b], i) => rung(a, b, -1, i, false, true));
  // Sections that cannot be sewn yet (a part no rung crosses, a hole still closed): outlined in red until fixed.
  view.problems.forEach((pr, k) => {
    path(pr.ring);
    ctx.closePath();
    ctx.strokeStyle = k === view.problemHover ? 'rgba(255, 90, 90, 0.9)' : 'rgba(255, 90, 90, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
  // Guide lines in the same colors.
  view.guides.forEach((g, i) => {
    const sel = same(view.selected, -1, i);
    const hov = same(view.hover, -1, i);
    path(g);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = sel || hov ? 5.5 : 4.5;
    ctx.stroke();
    ctx.strokeStyle = sel ? ACCENT : hov ? '#ffffff' : 'rgba(255, 214, 102, 0.95)';
    ctx.lineWidth = sel || hov ? 3 : 2.5;
    ctx.stroke();
  });
  // Points of rays, circles and swirls: a ring with a dot, easy to grab.
  view.points.forEach((p, i) => {
    const sel = same(view.selected, -1, i);
    const hov = same(view.hover, -1, i);
    const [x, y] = S(p);
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = sel ? ACCENT : hov ? '#ffffff' : 'rgba(255, 214, 102, 0.95)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  });
  if (view.sketch && view.sketch.length > 1) {
    ctx.setLineDash([6, 4]);
    path(view.sketch);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Chained columns and sections: their place in the order before where the satin starts, an arrow
  // the way it goes, scissors for a trim before it and the mirror for the rail it starts on (both
  // bright when set). A column on its own has no place in an order.
  for (const b of view.badges) {
    const [ax, ay] = S(b.at);
    const [dx, dy] = S([b.at[0] + b.dir[0], b.at[1] + b.dir[1]]);
    const l = Math.hypot(dx - ax, dy - ay) || 1;
    const d: Pt = [(dx - ax) / l, (dy - ay) / l];
    const n: Pt = [-d[1], d[0]];
    const spot = (along: number, across: number): Pt => [ax + d[0] * along + n[0] * across, ay + d[1] * along + n[1] * across];
    const hov = (what: string) => view.badgeHover?.col === b.col && view.badgeHover.step === b.step && view.badgeHover.what === what;
    const disc = (p: Pt, fill: string, ring: string) => {
      ctx.beginPath();
      ctx.arc(p[0], p[1], BADGE.r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = ring;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    const label = (p: Pt, text: string, color: string) => {
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.fillText(text, p[0], p[1] + 0.5);
    };
    if (!b.lone) {
      const num = spot(BADGE.number, 0);
      disc(num, hov('number') ? ACCENT : 'rgba(20, 20, 24, 0.9)', '#ffffff');
      label(num, String(b.n), '#ffffff');
    }
    // Mirrored: the satin starts on the other rail (bright when set).
    const mi = spot(BADGE.number, -BADGE.scissors);
    disc(mi, hov('mirror') ? ACCENT : b.mirror ? CUT : 'rgba(20, 20, 24, 0.9)', b.mirror ? '#ffffff' : 'rgba(255, 255, 255, 0.45)');
    label(mi, '⇄', b.mirror ? '#10141a' : 'rgba(255, 255, 255, 0.7)');
    // The arrow: a triangle pointing the way the satin goes.
    const tip = spot(BADGE.arrow + 6, 0);
    const back1 = spot(BADGE.arrow - 5, 5);
    const back2 = spot(BADGE.arrow - 5, -5);
    ctx.beginPath();
    ctx.moveTo(...tip);
    ctx.lineTo(...back1);
    ctx.lineTo(...back2);
    ctx.closePath();
    ctx.fillStyle = hov('arrow') ? ACCENT : '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    if (b.trim !== null) {
      const sc = spot(BADGE.number, BADGE.scissors);
      disc(sc, hov('scissors') ? ACCENT : b.trim ? CUT : 'rgba(20, 20, 24, 0.9)', b.trim ? '#ffffff' : 'rgba(255, 255, 255, 0.45)');
      label(sc, '✂', b.trim ? '#10141a' : 'rgba(255, 255, 255, 0.55)');
    }
  }
  if (view.draft) {
    const [a, b] = view.draft;
    // The line being drawn already in the color of its kind.
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(...S(a));
    ctx.lineTo(...S(b));
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = view.draftCut ? CUT : RUNG;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}
