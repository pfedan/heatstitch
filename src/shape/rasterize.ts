import { signedField, type Region } from '../digitize/region';
import { distanceInside } from '../image/edt';
import { bounds, flatten, type Form } from './path';

/** Empty pixels around the area (as for regions built from images). */
const MARGIN = 6;

/**
 * The area of a form as pixels of `pxMm` (even-odd: paths inside others are holes), with the
 * fields the fills are made from. Only closed paths count. Null when it covers no pixel.
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
  for (const p of closed.paths) {
    const pts = flatten(p, pxMm / 2).map(([x, y]) => [x / pxMm - x0 - 0.5, y / pxMm - y0 - 0.5]);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (a[1] !== c[1]) edges.push([a[0], a[1], c[0], c[1]]);
    }
  }
  let area = 0;
  const xs: number[] = [];
  for (let y = 0; y < h; y++) {
    xs.length = 0;
    for (const [ax, ay, cx, cy] of edges) {
      // Half-open in y, so a vertex shared by two edges counts once.
      if ((ay <= y && cy > y) || (cy <= y && ay > y)) xs.push(ax + ((y - ay) / (cy - ay)) * (cx - ax));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k]));
      const to = Math.min(w - 1, Math.ceil(xs[k + 1]) - 1);
      for (let x = from; x <= to; x++) {
        mask[y * w + x] = 1;
        area++;
      }
    }
  }
  if (!area) return null;
  const sdf = signedField(mask, w, h, pxMm);
  return { label: 0, x0, y0, w, h, pxMm, mask, inside: distanceInside(mask, w, h), sdf, sdfBase: sdf, areaMm2: area * pxMm * pxMm };
}
