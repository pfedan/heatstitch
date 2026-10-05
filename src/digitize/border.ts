import { outline, sample, signedField, type Region } from './region';
import { runStitch, TOLERANCE } from './run';
import type { Pt } from './skeleton';

/**
 * A border sewn around a fill on its edge (what Ink/Stitch sews for the stroke of a filled path,
 * and digitizing software calls an outline): a running stitch, a triple (bean) stitch or a satin
 * of a set width, centered on the edge, around the outside and every hole.
 */

export type BorderType = 'run' | 'triple' | 'satin';

/** Stitch length of a running or triple border (mm). */
export const BORDER_STITCH = 2.5;
/** Satin border width the panel starts with (mm). */
export const BORDER_WIDTH = 2;
/** Loops shorter than this are left without a border (mm). */
const MIN_LOOP = 1.5;

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The edge of the area as closed lines (first point repeated at the end), long enough to sew. */
export function borderLoops(r: Region): Pt[][] {
  return outline(r)
    .map((l) => l as Pt[])
    .filter((l) => {
      let s = 0;
      for (let i = 1; i < l.length; i++) s += dist(l[i - 1], l[i]);
      return s >= MIN_LOOP;
    });
}

/**
 * The loops in the order to sew them, starting near `from`: each starts at its point nearest the
 * needle, the next is the one nearest where the last ended (a closed loop ends where it starts).
 */
export function orderLoops(loops: Pt[][], from: Pt): Pt[][] {
  const todo = loops.slice();
  const out: Pt[][] = [];
  let at = from;
  while (todo.length) {
    let best = 0;
    let bestK = 0;
    let bestD = Infinity;
    todo.forEach((l, j) => {
      l.forEach((q, k) => {
        const d = dist(q, at);
        if (d < bestD) {
          bestD = d;
          best = j;
          bestK = k;
        }
      });
    });
    const l = todo.splice(best, 1)[0];
    const open = l.slice(0, -1);
    const k = bestK % open.length;
    const loop = [...open.slice(k), ...open.slice(0, k), open[k]];
    out.push(loop);
    at = loop[0];
  }
  return out;
}

/** Evenly spaced points along a line, `step` apart (both ends kept). */
function resample(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = dist(a, b);
    let t = step - carry;
    while (t <= l) {
      out.push([a[0] + ((b[0] - a[0]) * t) / l, a[1] + ((b[1] - a[1]) * t) / l]);
      t += step;
    }
    carry = l - (t - step);
  }
  if (dist(out[out.length - 1], pts[pts.length - 1]) > step * 0.3) out.push(pts[pts.length - 1]);
  else out[out.length - 1] = pts[pts.length - 1];
  return out;
}

/** A closed line smoothed by a moving average (the pixel steps of a traced edge go). */
function smoothLoop(pts: Pt[], k: number): Pt[] {
  const open = pts.slice(0, -1);
  const n = open.length;
  if (n < 2 * k + 1) return pts;
  const out = open.map((_, i) => {
    let x = 0;
    let y = 0;
    for (let j = -k; j <= k; j++) {
      const q = open[(i + j + n) % n];
      x += q[0];
      y += q[1];
    }
    return [x / (2 * k + 1), y / (2 * k + 1)] as Pt;
  });
  out.push(out[0]);
  return out;
}

/** The area with a wider empty margin, so its field reaches `mm` outside its edge. */
function padded(r: Region, mm: number): Region {
  const pad = Math.ceil(mm / r.pxMm) + 2;
  const w = r.w + 2 * pad;
  const h = r.h + 2 * pad;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) mask[(y + pad) * w + x + pad] = r.mask[y * r.w + x];
  const f = signedField(mask, w, h, r.pxMm);
  return { ...r, x0: r.x0 - pad, y0: r.y0 - pad, w, h, mask, sdf: f, sdfBase: f };
}

/**
 * Rails of a satin of width `w` centered on a closed edge line. Each side reaches half the width
 * along the normal, less where the band around the edge is narrower (inside a corner), so the
 * rails do not fold over at corners.
 */
export function borderRails(r: Region, loop: Pt[], w: number): { left: Pt[]; right: Pt[] } {
  const half = w / 2;
  const f = padded(r, half * 1.7 + 0.5);
  const center = smoothLoop(resample(loop, 0.2), 3);
  const n = center.length - 1;
  const open = center.slice(0, -1);
  const tangent = (i: number): Pt => {
    const a = open[(i - 3 + n) % n];
    const b = open[(i + 3) % n];
    const l = dist(a, b) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  // Distance from the edge along +-normal until the band |d| <= half is left.
  const reach = (c: Pt, d: Pt): number => {
    const step = 0.05;
    for (let s = step; s <= half * 1.6; s += step) {
      const v = Math.abs(sample(f, f.sdfBase, c[0] + d[0] * s, c[1] + d[1] * s));
      if (v >= half) return s;
    }
    return half;
  };
  const L: number[] = [];
  const R: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = tangent(i);
    const nn: Pt = [-t[1], t[0]];
    L.push(Math.min(half, reach(open[i], nn)));
    R.push(Math.min(half, reach(open[i], [-nn[0], -nn[1]])));
  }
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    const t = tangent(k);
    const nn: Pt = [-t[1], t[0]];
    left.push([open[k][0] + nn[0] * L[k], open[k][1] + nn[1] * L[k]]);
    right.push([open[k][0] - nn[0] * R[k], open[k][1] - nn[1] * R[k]]);
  }
  return { left, right };
}

/** Running or triple stitch along a closed line. */
export function borderRun(loop: Pt[], triple: boolean, tol = TOLERANCE): Pt[] {
  const pts = runStitch(loop, BORDER_STITCH, tol);
  if (!triple) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) out.push(pts[i], pts[i - 1], pts[i]);
  return out;
}
