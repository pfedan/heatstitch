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

/**
 * The edge of the area as closed lines (first point repeated at the end), long enough to sew;
 * `offset` mm outside it (inside when negative).
 */
export function borderLoops(r: Region, offset = 0): Pt[][] {
  const f = offset > 0 ? padded(r, offset + 0.5) : r;
  return outline(f, offset, f.sdfBase)
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

/**
 * The area's shape (as stored, not grown or shrunk) with a wider empty margin, so its field
 * reaches `mm` outside its edge.
 */
function padded(r: Region, mm: number): Region {
  const pad = Math.ceil(mm / r.pxMm) + 2;
  const w = r.w + 2 * pad;
  const h = r.h + 2 * pad;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) mask[(y + pad) * w + x + pad] = r.sdfBase[y * r.w + x] < 0 ? 1 : 0;
  const f = signedField(mask, w, h, r.pxMm);
  return { ...r, x0: r.x0 - pad, y0: r.y0 - pad, w, h, mask, sdf: f, sdfBase: f };
}

/**
 * Rails of a satin of width `w` centered on a closed line `level` mm outside the edge (inside
 * when negative). Each side reaches half the width along the normal, less where the band around
 * that line is narrower (inside a corner), so the rails do not fold over at corners.
 */
export function borderRails(r: Region, loop: Pt[], w: number, level = 0): { left: Pt[]; right: Pt[] } {
  const { left, right } = railsAlong(r, loop, w, level);
  return { left, right };
}

/** borderRails, with the points of the line they are centered on (one per rail point). */
function railsAlong(r: Region, loop: Pt[], w: number, level: number): { left: Pt[]; right: Pt[]; center: Pt[] } {
  const half = w / 2;
  const f = padded(r, half * 1.7 + 0.5 + Math.max(0, level));
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
      const v = Math.abs(sample(f, f.sdfBase, c[0] + d[0] * s, c[1] + d[1] * s) - level);
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
  return { left, right, center };
}

/**
 * Index ranges of a closed line's n points where `keep` holds, in order along it: [0, n] (the
 * whole line) when it holds everywhere; ranges may run past n (wrap around).
 */
function keptRanges(n: number, keep: (i: number) => boolean, closedLen: number): [number, number][] {
  const flags = Array.from({ length: n }, (_, i) => keep(i));
  if (flags.every(Boolean)) return [[0, closedLen]];
  if (!flags.some(Boolean)) return [];
  // From the first point dropped, so no piece runs over the line's start.
  const s0 = flags.indexOf(false);
  const out: [number, number][] = [];
  let from = -1;
  for (let k = 1; k <= n; k++) {
    const i = (s0 + k) % n;
    if (flags[i] && from < 0) from = s0 + k;
    if ((!flags[i] || k === n) && from >= 0) {
      out.push([from, s0 + k - (flags[i] ? 0 : 1)]);
      from = -1;
    }
  }
  return out;
}

/** Points i..j (inclusive, wrapping around the closed line's n distinct points). */
const span = <T>(pts: T[], n: number, a: number, b: number): T[] => Array.from({ length: b - a + 1 }, (_, k) => pts[(a + k) % n]);

const lengthOf = (l: Pt[]) => l.reduce((s, q, i) => (i ? s + dist(l[i - 1], q) : 0), 0);

/**
 * The parts of a closed edge line to sew where `keep` holds (checked every 0.2 mm): the whole
 * loop, closed, when it holds everywhere, else open lines.
 */
export function keptLines(loop: Pt[], keep: (q: Pt) => boolean): { line: Pt[]; closed: boolean }[] {
  const pts = resample(loop, 0.2);
  const n = pts.length - 1;
  return keptRanges(n, (i) => keep(pts[i]), n)
    .map(([a, b]) => (b - a === n ? { line: loop, closed: true } : { line: span(pts, n, a, b), closed: false }))
    .filter((l) => l.closed || lengthOf(l.line) >= MIN_LOOP);
}

/** borderRails cut where `keep` does not hold at the line they are centered on: one rails pair per piece. */
export function keptRails(r: Region, loop: Pt[], w: number, level: number, keep: (q: Pt) => boolean): { left: Pt[]; right: Pt[] }[] {
  const { left, right, center } = railsAlong(r, loop, w, level);
  const n = center.length - 1;
  return keptRanges(n, (i) => keep(center[i]), n)
    .map(([a, b]) => (b - a === n ? { left, right, len: Infinity } : { left: span(left, n, a, b), right: span(right, n, a, b), len: lengthOf(span(center, n, a, b)) }))
    .filter((c) => c.len >= MIN_LOOP)
    .map(({ left, right }) => ({ left, right }));
}

/** An open line smoothed by a moving average; the ends stay where they are. */
function smoothLine(pts: Pt[], k: number): Pt[] {
  const n = pts.length;
  if (n < 2 * k + 1) return pts;
  return pts.map((q, i) => {
    if (i === 0 || i === n - 1) return q;
    const r = Math.min(k, i, n - 1 - i);
    let x = 0;
    let y = 0;
    for (let j = -r; j <= r; j++) {
      x += pts[i + j][0];
      y += pts[i + j][1];
    }
    return [x / (2 * r + 1), y / (2 * r + 1)] as Pt;
  });
}

/**
 * Rails of a satin of width `w` centered on a line with no area around it (a drawn line): each
 * side half the width out along the normal. A closed line repeats its first point at the end.
 */
export function lineRails(line: Pt[], closed: boolean, w: number): { left: Pt[]; right: Pt[] } {
  const half = w / 2;
  const center = closed ? smoothLoop(resample(line, 0.2), 3) : smoothLine(resample(line, 0.2), 3);
  const n = center.length;
  const at = (i: number) => (closed ? center[((i % (n - 1)) + (n - 1)) % (n - 1)] : center[Math.max(0, Math.min(n - 1, i))]);
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = at(i - 3);
    const b = at(i + 3);
    const l = dist(a, b) || 1;
    const nn: Pt = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    left.push([center[i][0] + nn[0] * half, center[i][1] + nn[1] * half]);
    right.push([center[i][0] - nn[0] * half, center[i][1] - nn[1] * half]);
  }
  return { left, right };
}

/** Running or triple stitch along a line (closed or not). */
export function borderRun(loop: Pt[], triple: boolean, tol = TOLERANCE, len = BORDER_STITCH): Pt[] {
  const pts = runStitch(loop, len, tol);
  if (!triple) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) out.push(pts[i], pts[i - 1], pts[i]);
  return out;
}
