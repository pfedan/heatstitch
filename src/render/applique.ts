import { appliquePieces, type Piece } from '../model/applique';
import type { Pattern } from '../model/pattern';
import { segment, segments, type Form } from '../shape/path';
import { drawFabricIn } from './fabricGl';
import type { Viewport } from './viewport';

/**
 * The pieces of fabric of appliqués, under the threads. A piece lies there from the stop to lay it
 * on: first as laid on (a rectangle cut with room around the shape, a little crooked), from the
 * stop to cut it on trimmed to its outline. In the realistic view it is the fabric chosen for it
 * (the same procedural surface as the ground), else a flat area in its color.
 */

interface Shown extends Piece {
  /** The piece as laid on, before it is cut (mm). */
  rough: Form;
  /** Bounding box of the rough piece (mm). */
  box: [number, number, number, number];
}

const cache = new WeakMap<Pattern, Shown[]>();

/** Room the fabric is cut with around the shape before it is laid on (mm). */
const ROOM = 6;

function piecesOf(p: Pattern): Shown[] {
  let list = cache.get(p);
  if (list) return list;
  list = appliquePieces(p).map((x) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const path of x.form.paths) {
      for (const n of path.nodes) {
        for (const q of [n.p, n.a, n.b]) {
          minX = Math.min(minX, q[0]);
          minY = Math.min(minY, q[1]);
          maxX = Math.max(maxX, q[0]);
          maxY = Math.max(maxY, q[1]);
        }
      }
    }
    // Cut by hand: the corners a little off square (always the same for a piece).
    const j = (k: number) => Math.sin(x.first * 12.9898 + k * 78.233) * 1.2;
    const c: [number, number][] = [
      [minX - ROOM + j(1), minY - ROOM + j(2)],
      [maxX + ROOM + j(3), minY - ROOM + j(4)],
      [maxX + ROOM + j(5), maxY + ROOM + j(6)],
      [minX - ROOM + j(7), maxY + ROOM + j(8)],
    ];
    const rough: Form = { paths: [{ closed: true, nodes: c.map((p) => ({ p, a: p, b: p, smooth: false })) }] };
    return { ...x, rough, box: [minX - ROOM - 2, minY - ROOM - 2, maxX + ROOM + 2, maxY + ROOM + 2] as [number, number, number, number] };
  });
  cache.set(p, list);
  return list;
}

/** Whether `p` has pieces of fabric to show. */
export const hasPieces = (p: Pattern): boolean => piecesOf(p).length > 0;

function trace(ctx: CanvasRenderingContext2D, vp: Viewport, form: Form): void {
  const S = (q: readonly [number, number] | number[]) => vp.toScreen(q[0], q[1]);
  ctx.beginPath();
  for (const path of form.paths) {
    if (!path.nodes.length) continue;
    ctx.moveTo(...S(path.nodes[0].p));
    for (let k = 0; k < segments(path); k++) {
      const [, b, c, e] = segment(path, k);
      ctx.bezierCurveTo(...S(b), ...S(c), ...S(e));
    }
    ctx.closePath();
  }
}

/**
 * Draws the pieces of `p` that are laid on by record `limit` (all of them, cut, at the end), each
 * as faint as the first stitch of its appliqué (`alpha`, hidden colors 0) times `opacity`.
 * `fabric`: drawn as cloth (realistic view with the fabric look), else flat.
 */
export function drawPieces(ctx: CanvasRenderingContext2D, vp: Viewport, p: Pattern, limit: number, alpha: Float32Array | null, opacity: number, fabric: boolean): void {
  const list = piecesOf(p);
  if (!list.length) return;
  for (const x of list) {
    const a = opacity * (alpha ? alpha[x.first] : 1);
    if (a <= 0 || limit < x.place) continue;
    const form = limit >= x.trim ? x.form : x.rough;
    const { r, g, b } = x.color;
    ctx.save();
    ctx.globalAlpha = a;
    trace(ctx, vp, form);
    // The cloth lies on the ground: a soft shadow along its edge shows its thickness.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = Math.max(1, Math.min(6, vp.scale * 0.5));
    ctx.shadowOffsetY = Math.max(0.5, Math.min(2, vp.scale * 0.15));
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fill('evenodd');
    ctx.shadowColor = 'transparent';
    if (fabric) {
      ctx.clip('evenodd');
      const [x0, y0] = vp.toScreen(x.box[0], x.box[1]);
      const [x1, y1] = vp.toScreen(x.box[2], x.box[3]);
      drawFabricIn(ctx, vp, x.fabric, [r, g, b], [x0, y0, x1, y1]);
    } else {
      ctx.strokeStyle = `rgb(${Math.round(r * 0.6)}, ${Math.round(g * 0.6)}, ${Math.round(b * 0.6)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }
}

let hidden: { p: Pattern; from: Float32Array; key: string; a: Float32Array } | null = null;

/**
 * `alpha` with the placement lines of the pieces laid on by `limit` left out: they lie under the
 * fabric (the realistic view). The same array when nothing is under a piece.
 */
export function underPieces(p: Pattern, alpha: Float32Array, limit: number): Float32Array {
  const list = piecesOf(p).filter((x) => limit >= x.place);
  if (!list.length) return alpha;
  const key = list.map((x) => x.first).join();
  if (hidden?.p === p && hidden.from === alpha && hidden.key === key) return hidden.a;
  const a = alpha.slice();
  for (const x of list) a.fill(0, x.first, x.place + 1);
  hidden = { p, from: alpha, key, a };
  return a;
}
