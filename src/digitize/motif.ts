import { runStitch } from './run';
import type { Pt } from './skeleton';

/**
 * Motif stitch: a small figure repeated along a line, sewn as one running stitch (what Brother and
 * Ink/Stitch call a motif or pattern line). The figures follow the line's curve; their size is the
 * width across the line, their period the distance from one to the next along it, stretched a
 * little so a whole number of them fits the line.
 */

export type LineMotif = 'waves' | 'scallops' | 'hearts' | 'chain' | HandStitch;
/** Machine imitations of classic hand embroidery stitches (see handStitches). */
export type HandStitch = 'stem' | 'feather' | 'cretan' | 'chevron';
export const HAND_STITCHES: HandStitch[] = ['stem', 'feather', 'cretan', 'chevron'];
export const LINE_MOTIFS: LineMotif[] = ['waves', 'scallops', 'hearts', 'chain', ...HAND_STITCHES];
export const isHandStitch = (m: LineMotif | undefined): m is HandStitch => !!m && (HAND_STITCHES as string[]).includes(m);

/**
 * Distance from one figure to the next (mm) when none is set. A stem stitch: from one stitch to the
 * next (each is twice as long); the others: from a point on one side to the next on the other.
 */
export const MOTIF_PERIOD: Record<LineMotif, number> = { waves: 5, scallops: 4, hearts: 8, chain: 2.2, stem: 2, feather: 3, cretan: 3, chevron: 3 };

/** Size of a motif across the line the panel starts with (mm). */
export const MOTIF_WIDTH = 3;
/** Size of a hand stitch across the line when it is picked (mm): a stem stitch is a narrow cord. */
export const HAND_WIDTH: Record<HandStitch, number> = { stem: 1, feather: 5, cretan: 5, chevron: 4 };
/** How often each stitch of a hand stitch is sewn when nothing is set: thick like embroidery floss. */
export const HAND_LAYERS = 3;

/**
 * The largest size a motif takes with figures `period` mm apart: hearts stay apart (no wider than
 * 90 % of the period; a heart is 32 parts wide for 22 from notch to tip), the others take any size.
 */
export const motifMaxSize = (motif: LineMotif, period: number): number => (motif === 'hearts' ? ((period * 0.9) / 32) * 22 : Infinity);

/** Motifs with a side: they stand on the line and reach out to one side of it. */
export const SIDED_MOTIFS: LineMotif[] = ['scallops', 'hearts'];

/** Steps of the fine path a motif is drawn as before it gets its needle points (mm). */
const FINE = 0.1;
/** Shortest stitch of a motif (mm): the figures are small, the needle needs room. */
const MIN_STITCH = 0.6;
/** Longest stitch of a motif (mm), and how close its stitches keep to the figure: small figures need short stitches to stay round. */
export const MOTIF_STITCH = 1.2;
const MOTIF_TOLERANCE = 0.05;

/** A line by arc length: the point at `s` mm and the unit normal there (to the right on screen, y down). */
function frame(line: Pt[], closed: boolean) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = cum[cum.length - 1];
  const point = (s: number): Pt => {
    s = closed && total > 0 ? ((s % total) + total) % total : Math.max(0, Math.min(total, s));
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const t = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
    return [line[lo][0] + (line[hi][0] - line[lo][0]) * t, line[lo][1] + (line[hi][1] - line[lo][1]) * t];
  };
  // The normal from the line a little before and after, so a node does not kink the figures.
  const normal = (s: number): Pt => {
    const a = point(closed ? s - 0.5 : Math.max(0, s - 0.5));
    const b = point(closed ? s + 0.5 : Math.min(total, s + 0.5));
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  };
  /** The point `off` mm out along the normal at `s`. */
  const at = (s: number, off = 0): Pt => {
    const p = point(s);
    if (!off) return p;
    const n = normal(s);
    return [p[0] + n[0] * off, p[1] + n[1] * off];
  };
  return { total, at, point, normal };
}

/**
 * The needle points of `motif` along `line` (closed: first point repeated at the end): `width` mm
 * across, one figure every `period` mm, on the side `side` (1: the normal's, -1: the other).
 * `shift`: the figures start this share of a period later (0 to 1; an open line then begins and
 * ends with part of a figure).
 */
export function motifStitches(line: Pt[], closed: boolean, motif: LineMotif, width: number, period: number, side: 1 | -1 = 1, shift = 0, stitch = MOTIF_STITCH, layers = HAND_LAYERS): Pt[] {
  const f = frame(line, closed);
  if (f.total < 0.5) return [];
  if (isHandStitch(motif)) return handStitches(f, line, closed, motif, width, period, side, shift, layers);
  const count = Math.max(1, Math.round(f.total / Math.max(0.5, period)));
  const d = f.total / count;
  const o = (((shift % 1) + 1) % 1) * d;
  const fine: Pt[] = [];
  const run = (a: number, b: number) => {
    for (let s = a; s < b; s += FINE) fine.push(f.at(s));
    fine.push(f.at(b));
  };
  /** A figure that is an offset from the line, sampled finely along it. */
  const along = (off: (s: number) => number) => {
    const n = Math.ceil(f.total / FINE);
    for (let i = 0; i <= n; i++) {
      const s = (f.total * i) / n;
      fine.push(f.at(s, off(s)));
    }
  };
  if (motif === 'waves') along((s) => (width / 2) * Math.sin((2 * Math.PI * (s - o)) / d));
  else if (motif === 'scallops' && o > 0) along((s) => width * side * Math.abs(Math.sin((Math.PI * (s - o)) / d)));
  else if (motif === 'scallops') {
    const h = width * side;
    for (let k = 0; k < count; k++) {
      const steps = Math.max(8, Math.ceil(d / FINE));
      for (let i = k ? 1 : 0; i <= steps; i++) {
        const t = i / steps;
        fine.push(f.at(k * d + t * d, h * Math.sin(Math.PI * t)));
      }
    }
  } else if (motif === 'hearts') {
    // A heart on the line every period, hanging from it; a running stitch between them.
    const size = Math.min(width, motifMaxSize('hearts', d));
    let s = 0;
    // Shifted on an open line: the hearts that still hang on it.
    for (let k = closed || !o ? 0 : -1; k < count; k++) {
      const at = o + k * d + d / 2;
      if (!closed && (at < 0 || at > f.total)) continue;
      run(s, at);
      fine.push(...heart(f, at, size, side));
      s = at;
    }
    run(s, f.total);
  } else {
    // Chain stitch look: a teardrop loop forward from each point, the next starting inside it.
    const link = d * 1.35;
    for (let k = closed || !o ? 0 : -1; k < count; k++) {
      const s0 = o + k * d;
      const steps = Math.max(12, Math.ceil((2 * link) / FINE));
      for (let i = 0; i <= steps; i++) {
        const t = (2 * Math.PI * i) / steps;
        const u = (1 - Math.cos(t)) / 2;
        fine.push(f.at(Math.min(s0 + u * link, closed ? s0 + u * link : f.total), (Math.sin(t) * width * (0.5 + 0.5 * u)) / 2));
      }
      run(s0, Math.min(f.total, s0 + d));
    }
  }
  const pts = runStitch(fine, Math.max(MIN_STITCH, stitch), MOTIF_TOLERANCE);
  return dropShort(pts);
}

/** Longest stitch of a hand stitch (mm): longer arms are split, the same holes in every pass. */
export const HAND_STITCH_MAX = 4.5;
/** A line turns at least this much at one point (degrees) to count as a corner the figures start afresh at. */
const CORNER = 50;

/**
 * Where `line` turns sharply: arc lengths of its corners. The line is flattened finely (0.1 mm), so a
 * smooth curve turns by a few degrees from point to point and only a corner node by much.
 */
function corners(line: Pt[], closed: boolean): number[] {
  const n = line.length - (closed ? 1 : 0);
  const out: number[] = [];
  let s = 0;
  const cos = Math.cos((CORNER * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    if (i > 0) s += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    if (!closed && (i === 0 || i === n - 1)) continue;
    const a = line[(i - 1 + n) % n];
    const b = line[i];
    const c = line[(i + 1) % n];
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-6 || lv < 1e-6) continue;
    if ((ux * vx + uy * vy) / (lu * lv) < cos && (!out.length || s - out[out.length - 1] > 1)) out.push(s);
  }
  return out;
}

/** How far a straight stitch of a hand stitch may lie from the curve it follows (mm). */
const HAND_BOW = 0.5;

/**
 * Whether a straight stitch from the line `span` steps of `d` long, at any of the `m` steps from
 * `s0`, lies further than HAND_BOW from the line in its middle (the sagitta of a chord, L^2 / 8R).
 */
function bows(f: ReturnType<typeof frame>, s0: number, d: number, m: number, span: number, ring: boolean): boolean {
  for (let k = 0; k + (ring ? 0 : span) <= m - (ring ? 1 : 0); k++) {
    const a = f.at(s0 + k * d);
    const b = f.at(s0 + (k + span) * d);
    const c = f.at(s0 + (k + span / 2) * d);
    if (Math.hypot((a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]) > HAND_BOW) return true;
  }
  return false;
}

/**
 * Hand stitches as a machine sews them: each stitch of the hand stitch a straight stitch sewn
 * `layers` times over the same two holes, so it lies thick like stranded floss (the bean or triple
 * run of machine embroidery; Wilcom's Stemstitch builds its cord the same way, from strokes,
 * spacing and overlap). The figures after the hand stitches as stitch dictionaries draw them (e.g.
 * the TRC Leiden stitch pages); the idea of bundled straight stitches after stitch_generator (MIT,
 * collection/stitch_effects/decorative_stitches.py), written anew here:
 * - stem: slanted stitches, each twice as long as the step, every one half over the last: a cord.
 * - feather: V's opening backwards, alternately left and right, the bottom of one the top of the next.
 * - cretan: a zigzag near the middle, from each of its points a straight stitch out to the side.
 * - chevron: a zigzag with a short bar along the line at each point, the diagonals meeting its middle.
 * The line is cut at its corners and each piece gets a whole number of figures, so none is cut off
 * at a corner or an end; a closed line without corners an even number, so left and right alternate
 * all round. In tight curves the figures get closer, so no straight stitch strays from the curve
 * (stem stitch by hand is worked with shorter stitches around curves).
 */
function handStitches(f: ReturnType<typeof frame>, line: Pt[], closed: boolean, motif: HandStitch, width: number, period: number, side: 1 | -1, shift: number, layers: number): Pt[] {
  const n = Math.max(1, Math.round(layers));
  const w = width * side;
  const out: Pt[] = [];
  /** A straight stitch to `p`, split into equal parts where it is long (the same holes both ways). */
  const go = (p: Pt) => {
    const q = out[out.length - 1];
    if (!q) return void out.push(p);
    const l = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (l < 1e-6) return;
    const k = Math.ceil(l / HAND_STITCH_MAX - 1e-9);
    for (let i = 1; i <= k; i++) out.push([q[0] + ((p[0] - q[0]) * i) / k, q[1] + ((p[1] - q[1]) * i) / k]);
  };
  /** From `a` (where the needle is) to `b` and back, `times` stitches in all: ends at b when odd. */
  const bundle = (a: Pt, b: Pt, times: number) => {
    for (let i = 1; i <= times; i++) go(i % 2 ? b : a);
  };
  // Feather arms, Cretan spurs and chevron bars go out and back: an even number, one less than
  // asked (two at least), since the hub they leave from takes the stitches of both sides.
  const odd = n % 2 ? n : n + 1;
  const even = Math.max(2, n % 2 ? n - 1 : n);
  const cs = corners(line, closed);
  const ring = closed && !cs.length;
  // Pieces between corners; a closed line with corners starts at its first one.
  const pieces: [number, number][] = [];
  if (ring) pieces.push([0, f.total]);
  else {
    const cuts = closed ? [...cs, cs[0] + f.total] : [0, ...cs, f.total];
    for (let i = 1; i < cuts.length; i++) if (cuts[i] - cuts[i - 1] > 1e-6) pieces.push([cuts[i - 1], cuts[i]]);
  }
  for (const [s0, s1] of pieces) {
    const len = s1 - s0;
    let m = Math.max(1, Math.round(len / Math.max(0.5, period)));
    const step = ring && motif !== 'stem' ? 2 : 1;
    if (step === 2) m = Math.max(2, 2 * Math.round(m / 2));
    const lead = (k: number) => (ring ? (((shift % 1) + 1) % 1) * (len / k) : 0);
    // Shorter stitches in tight curves, as by hand: more figures until no stitch bows from the line.
    while (m + step <= len / 0.8 && bows(f, s0 + lead(m), len / m, m, motif === 'stem' && m > 1 ? 2 : 1, ring)) m += step;
    const d = len / m;
    const o = lead(m);
    const at = (u: number, v: number): Pt => f.at(s0 + o + u, v);
    if (motif === 'stem') {
      // Stitch k from (k d, -w/2) to ((k + 2) d, w/2): each one half over the one before.
      const k1 = ring ? m : Math.max(1, m - 1);
      const span = ring || m > 1 ? 2 * d : len;
      let fromStart = true;
      for (let k = 0; k < k1; k++) {
        const a = at(k * d, -w / 2);
        const b = at(k * d + span, w / 2);
        go(fromStart ? a : b);
        bundle(fromStart ? a : b, fromStart ? b : a, n);
        if (n % 2) fromStart = !fromStart;
      }
    } else if (motif === 'feather') {
      // Bottoms B_j a sixth of the width out, alternately; each V's outer arm back to the side.
      const sg = (j: number) => (j % 2 ? -1 : 1);
      const bAt = (j: number) => at(j * d, (sg(j) * w) / 6);
      go(bAt(0));
      for (let j = 1; j <= m; j++) {
        bundle(bAt(j - 1), bAt(j), odd);
        bundle(bAt(j), at((j - 1) * d, (sg(j) * w) / 2), even);
      }
    } else if (motif === 'cretan') {
      // A zigzag between points a sixth of the width out, alternately; from each a straight
      // stitch out to the side (the thread held under the needle pulls the hand stitch so).
      const sg = (j: number) => (j % 2 ? -1 : 1);
      const inner = (j: number) => at(j * d, (sg(j) * w) / 6);
      const spur = (j: number) => bundle(inner(j), at(j * d, (sg(j) * w) / 2), even);
      go(inner(0));
      if (!ring) spur(0);
      for (let j = 1; j <= m; j++) {
        bundle(inner(j - 1), inner(j), odd);
        spur(j);
      }
    } else {
      // Points a half step in from the ends, so the bars end on them; each bar d long.
      const sg = (j: number) => (j % 2 ? -1 : 1);
      const off = ring ? 0 : d / 2;
      const mid = (j: number) => at(off + j * d, (sg(j) * w) / 2);
      const bar = (j: number) => {
        const c = mid(j);
        const e = at(off + j * d + d / 2, (sg(j) * w) / 2);
        const b = at(off + j * d - d / 2, (sg(j) * w) / 2);
        for (let i = 0; i < even / 2; i++) {
          bundle(c, e, 2);
          bundle(c, b, 2);
        }
      };
      go(mid(0));
      bar(0);
      for (let j = 1; j < m + (ring ? 1 : 0); j++) {
        bundle(mid(j - 1), mid(j), odd);
        if (j < m) bar(j);
      }
    }
  }
  return out;
}

/**
 * A heart hanging from the line at `s` by the notch between its lobes, its tip `size` mm out to the
 * side (upright below a line drawn left to right), drawn around once from the notch. Its lobes reach a
 * third of that over the line.
 */
function heart(f: ReturnType<typeof frame>, s: number, size: number, side: 1 | -1): Pt[] {
  const o = f.point(s);
  const n = f.normal(s);
  const tdir: Pt = [n[1], -n[0]];
  const out: Pt[] = [];
  // The classic heart curve: notch at t = 0 (y 5), tip at t = pi (y -17), lobes up to y 12, 32 wide.
  for (let i = 0; i <= 60; i++) {
    const t = (2 * Math.PI * i) / 60;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    const a = (x / 22) * size;
    const b = ((5 - y) / 22) * size * side;
    out.push([o[0] + tdir[0] * a + n[0] * b, o[1] + tdir[1] * a + n[1] * b]);
  }
  return out;
}

/** Needle points without stitches shorter than MIN_STITCH (the ends stay). */
function dropShort(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const q = out[out.length - 1];
    if (Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1]) >= MIN_STITCH) out.push(pts[i]);
  }
  const last = pts[pts.length - 1];
  if (out.length > 1 && Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) < MIN_STITCH) out.pop();
  out.push(last);
  return out;
}
