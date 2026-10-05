import { signedField, type Region } from '../digitize/region';
import { distanceInside } from '../image/edt';
import { bounds, flatten, type Form } from './path';

/** Empty pixels around the area (as for regions built from images). */
const MARGIN = 6;

/**
 * The area of a form as pixels of `pxMm` (even-odd: paths inside others are holes; or nonzero for
 * forms marked so), with the fields the fills are made from. Only closed paths count. Null when it
 * covers no pixel.
 */
export function rasterize(f: Form, pxMm = 0.1): Region | null {
  const closed = { paths: f.paths.filter((p) => p.closed && p.nodes.length >= 2) };
  const b = bounds(closed);
  if (!b) return null;
  const x0 = Math.floor(b.minX / pxMm) - MARGIN;
  const y0 = Math.floor(b.minY / pxMm) - MARGIN;
  const w = Math.ceil(b.maxX / pxMm) + MARGIN - x0;
  const h = Math.ceil(b.maxY / pxMm) + MARGIN - y0;
  const mask = new Uint8Array(w * h);
  // Edges in pixel units, then one scanline through the pixel centers per row.
  const edges: [number, number, number, number][] = [];
  const nonzero = !!f.nonzero;
  for (const p of closed.paths) {
    const pts = flatten(p, pxMm / 2).map(([x, y]) => [x / pxMm - x0 - 0.5, y / pxMm - y0 - 0.5]);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (a[1] !== c[1]) edges.push([a[0], a[1], c[0], c[1]]);
    }
  }
  let area = 0;
  const xs: [number, number][] = [];
  const span = (y: number, a: number, b: number) => {
    const from = Math.max(0, Math.ceil(a));
    const to = Math.min(w - 1, Math.ceil(b) - 1);
    for (let x = from; x <= to; x++) {
      if (!mask[y * w + x]) area++;
      mask[y * w + x] = 1;
    }
  };
  for (let y = 0; y < h; y++) {
    xs.length = 0;
    for (const [ax, ay, cx, cy] of edges) {
      // Half-open in y, so a vertex shared by two edges counts once.
      if ((ay <= y && cy > y) || (cy <= y && ay > y)) xs.push([ax + ((y - ay) / (cy - ay)) * (cx - ax), cy > ay ? 1 : -1]);
    }
    xs.sort((m, n) => m[0] - n[0]);
    if (!nonzero) {
      for (let k = 0; k + 1 < xs.length; k += 2) span(y, xs[k][0], xs[k + 1][0]);
      continue;
    }
    let wind = 0;
    for (let k = 0; k + 1 < xs.length; k++) {
      wind += xs[k][1];
      if (wind !== 0) span(y, xs[k][0], xs[k + 1][0]);
    }
  }
  return regionOf(mask, x0, y0, w, h, pxMm, area);
}

/** A region from a mask in its window (world pixel x0, y0), with its fields; null when empty. */
export function regionOf(mask: Uint8Array, x0: number, y0: number, w: number, h: number, pxMm: number, area?: number): Region | null {
  if (area === undefined) {
    area = 0;
    for (const m of mask) area += m;
  }
  if (!area) return null;
  const sdf = signedField(mask, w, h, pxMm);
  return { label: 0, x0, y0, w, h, pxMm, mask, inside: distanceInside(mask, w, h), sdf, sdfBase: sdf, areaMm2: area * pxMm * pxMm };
}

/** How the ends of an open line are drawn: cut off square at the end, or round. */
export type LineCap = 'flat' | 'round';

/**
 * A line of the form drawn `width` mm wide (round corners; round ends, or flat with `cap`), as an
 * area: the strokes of SVG shapes. Open and closed paths count.
 */
export function rasterizeStroke(f: Form, width: number, pxMm = 0.1, cap: LineCap = 'round'): Region | null {
  const b = bounds(f);
  if (!b || !(width > 0)) return null;
  const r = width / 2 / pxMm;
  const x0 = Math.floor(b.minX / pxMm - r) - MARGIN;
  const y0 = Math.floor(b.minY / pxMm - r) - MARGIN;
  const w = Math.ceil(b.maxX / pxMm + r) + MARGIN - x0;
  const h = Math.ceil(b.maxY / pxMm + r) + MARGIN - y0;
  const mask = new Uint8Array(w * h);
  const r2 = r * r;
  for (const p of f.paths) {
    const pts = flatten(p, pxMm / 2).map(([x, y]) => [x / pxMm - x0 - 0.5, y / pxMm - y0 - 0.5]);
    if (p.closed && pts.length > 1) pts.push(pts[0]);
    if (pts.length === 1) pts.push(pts[0]);
    // Flat ends: nothing beyond the first and the last point of an open line.
    const flat = cap === 'flat' && !p.closed && pts.length > 1;
    // Each end is cut square to the line's direction there (taken over a stretch as long as the
    // half width, since the flattened line is made of tiny steps), close to that end only, so a
    // line that turns back on itself is not cut elsewhere.
    const cut = flat ? [endCut(pts, r), endCut(pts.slice().reverse(), r)] : [];
    const kept = (x: number, y: number) =>
      cut.every(([sx, sy, ux, uy]) => (x - sx) * ux + (y - sy) * uy >= 0 || (x - sx) ** 2 + (y - sy) ** 2 > 4 * r2);
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const minX = Math.max(0, Math.floor(Math.min(ax, bx) - r));
      const maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r));
      const minY = Math.max(0, Math.floor(Math.min(ay, by) - r));
      const maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
          const ex = ax + t * dx - x;
          const ey = ay + t * dy - y;
          if (ex * ex + ey * ey <= r2 && (!flat || kept(x, y))) mask[y * w + x] = 1;
        }
      }
    }
  }
  return regionOf(mask, x0, y0, w, h, pxMm);
}

/** Start point of a polyline and its unit direction there, measured over about `len`. */
function endCut(pts: number[][], len: number): [number, number, number, number] {
  const [sx, sy] = pts[0];
  let q = pts[pts.length - 1];
  for (const p of pts) if ((p[0] - sx) ** 2 + (p[1] - sy) ** 2 >= len * len) {
    q = p;
    break;
  }
  const d = Math.hypot(q[0] - sx, q[1] - sy) || 1;
  return [sx, sy, (q[0] - sx) / d, (q[1] - sy) / d];
}

/**
 * `base` without what `covers` hide: a pixel goes when it lies deeper than `overlap` mm inside one
 * of them, so the area sewn first still reaches that far under the ones on top. Null when nothing
 * is left; `base` itself when nothing is hidden.
 */
export function knockOut(base: Region, covers: Region[], overlap: number): Region | null {
  const px = base.pxMm;
  const mask = base.mask.slice();
  let changed = false;
  for (const c of covers) {
    if (c.pxMm !== px) continue;
    // Overlap of the windows, in base pixels.
    const fx = Math.max(0, c.x0 - base.x0);
    const tx = Math.min(base.w, c.x0 + c.w - base.x0);
    const fy = Math.max(0, c.y0 - base.y0);
    const ty = Math.min(base.h, c.y0 + c.h - base.y0);
    for (let y = fy; y < ty; y++) {
      for (let x = fx; x < tx; x++) {
        const i = y * base.w + x;
        if (!mask[i]) continue;
        const d = c.sdfBase[(y + base.y0 - c.y0) * c.w + (x + base.x0 - c.x0)];
        if (d < -overlap) {
          mask[i] = 0;
          changed = true;
        }
      }
    }
  }
  if (!changed) return base;
  return regionOf(mask, base.x0, base.y0, base.w, base.h, px);
}

/** Pixels two regions share (of the same pixel size), in mm². */
export function sharedArea(a: Region, b: Region): number {
  if (a.pxMm !== b.pxMm) return 0;
  const fx = Math.max(a.x0, b.x0);
  const tx = Math.min(a.x0 + a.w, b.x0 + b.w);
  const fy = Math.max(a.y0, b.y0);
  const ty = Math.min(a.y0 + a.h, b.y0 + b.h);
  let n = 0;
  for (let y = fy; y < ty; y++) for (let x = fx; x < tx; x++) if (a.mask[(y - a.y0) * a.w + x - a.x0] && b.mask[(y - b.y0) * b.w + x - b.x0]) n++;
  return n * a.pxMm * a.pxMm;
}

/** Regions of the same pixel size as one. */
export function unionOf(rs: Region[]): Region | null {
  if (rs.length <= 1) return rs[0] ?? null;
  const px = rs[0].pxMm;
  const x0 = Math.min(...rs.map((r) => r.x0));
  const y0 = Math.min(...rs.map((r) => r.y0));
  const w = Math.max(...rs.map((r) => r.x0 + r.w)) - x0;
  const h = Math.max(...rs.map((r) => r.y0 + r.h)) - y0;
  const mask = new Uint8Array(w * h);
  for (const r of rs) {
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (r.mask[y * r.w + x]) mask[(y + r.y0 - y0) * w + x + r.x0 - x0] = 1;
  }
  return regionOf(mask, x0, y0, w, h, px);
}
