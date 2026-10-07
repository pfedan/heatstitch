import { LOCK_MM, SATIN_SPLIT_MM, SATIN_UNDER_MIN } from '../material/rules';
import { fillRegion } from '../digitize/fill';
import { expandRegion } from '../digitize/region';
import { runStitch, TOLERANCE } from '../digitize/run';
import { underlayOf, type UnderlayKind } from '../digitize/satin';
import type { Pt } from '../digitize/skeleton';
import { columnOf, reversedRails, satinRuns, type Rails, type SatinSettings } from '../model/restitch';
import { JUMP, STITCH, TRIM } from '../model/pattern';
import { apply, type Form, type Mat } from '../shape/path';
import { rasterize } from '../shape/rasterize';
import type { Font, GlyphEl } from './font';
import { layout, type Layout, type Lettering } from './layout';

/**
 * Stitches for a lettering: every letter's elements as the font digitized them, sewn at the
 * height asked for. Satin is sewn anew along its rails and rungs (so its density stays right at
 * any size), running stitch along its path, fills in their outline.
 */

export interface Rec {
  x: number;
  y: number;
  cmd: number;
}

/** One continuous run of stitches and where in the text it belongs. */
interface Run {
  pts: Pt[];
  word: number;
  line: number;
  /** Index of its letter in the layout. */
  letter: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pairs = (a: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let k = 0; k + 1 < a.length; k += 2) out.push([a[k], a[k + 1]]);
  return out;
};

/** Underlay for a satin column of `width` (mm): the font's, less where the column is too narrow for it (see SATIN_UNDER_MIN). */
function underlayFor(kind: SatinEl['p']['u'], width: number): UnderlayKind | null {
  if (kind === 'none' || width < SATIN_UNDER_MIN) return null;
  // Up to 2 mm a walk along the middle is all that fits (Ink/Stitch: center walk 1 to 2 mm).
  if (width < 2 && (kind === 'zigzag' || kind === 'both' || kind === 'contour')) return 'center';
  return kind;
}
type SatinEl = Extract<GlyphEl, { k: 's' }>;

/** The runs of one element, in the design (mm). */
function sewElement(e: GlyphEl, m: Mat, scale: number, turn: number, l: Lettering, back: boolean): Pt[][] {
  const tf = (pts: Pt[]) => pts.map((q) => apply(m, q));
  if (e.k === 's') {
    let rails: Rails = { left: tf(pairs(e.l)), right: tf(pairs(e.r)), rungs: pairs(e.g).map(([a, b]) => [a * scale, b * scale] as [number, number]) };
    if (back) rails = reversedRails(rails);
    const width = columnOf(rails).width;
    const under = underlayFor(e.p.u, width);
    const s: SatinSettings = {
      spacing: Math.max(0.15, e.p.sp * l.density),
      edge: e.p.pc,
      edgeShare: e.p.ps,
      short: true,
      underlay: false,
      tolerance: TOLERANCE,
      split: e.p.sl && e.p.sl > 0 ? Math.max(3, e.p.sl) : SATIN_SPLIT_MM,
      type: e.p.e ? 'e' : 'satin',
    };
    const top = satinRuns([rails], s).filter((r) => r.length > 1);
    if (!top.length || !l.underlay || under === null) return top;
    // As the font is digitized: the underlay comes back to the start, the satin ends at the end
    // of its column, where the font goes on (its next element starts there).
    const col = columnOf(rails);
    const u = underlayOf(col, under, TOLERANCE);
    const home = u.atEnd ? runStitch(col.center.slice().reverse(), 2, TOLERANCE) : [];
    return [[...u.pts, ...home, ...top[0]], ...top.slice(1)];
  }
  if (e.k === 'r') {
    let path = tf(pairs(e.d));
    if (back) path = path.slice().reverse();
    if (path.length < 2) return [];
    const pts = e.p.m ? path : runStitch(path, Math.max(0.5, e.p.len), TOLERANCE);
    if (!e.p.tr) return [pts];
    const out: Pt[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) out.push(pts[i], pts[i - 1], pts[i]);
    return [out];
  }
  const form: Form = {
    paths: e.d.map((loop) => ({ closed: true, nodes: pairs(loop).map((q) => apply(m, q)).map((p) => ({ p, a: p, b: p, smooth: false })) })),
  };
  const r0 = rasterize(form);
  const r = r0 && expandRegion(r0, e.p.ex ?? 0);
  if (!r) return [];
  const first = form.paths[0].nodes[0].p;
  const res = fillRegion(
    r,
    {
      spacing: Math.max(0.15, e.p.sp * l.density),
      stitch: e.p.len,
      angle: (((e.p.a + turn) % 180) + 180) % 180,
      pull: 0,
      underlay: l.underlay && !!e.p.u,
      offset: e.p.o ?? 0.25,
      tolerance: TOLERANCE,
    },
    first,
  );
  return res?.runs.filter((run) => run.length > 1) ?? [];
}

/** Every run of the lettering in sewing order. */
export function letteringRuns(font: Font, l: Lettering, lay: Layout = layout(font, l)): Run[] {
  const out: Run[] = [];
  // Lines in turn; a line sewn back runs from its last letter to its first.
  const lines = new Map<number, typeof lay.letters>();
  for (const p of lay.letters) {
    if (!lines.has(p.line)) lines.set(p.line, []);
    lines.get(p.line)!.push(p);
  }
  const index = new Map(lay.letters.map((p, i) => [p, i]));
  for (const [, letters] of [...lines].sort((a, b) => a[0] - b[0])) {
    const order = letters[0]?.back ? letters.slice().reverse() : letters;
    for (const p of order) {
      if (!p.glyph) continue;
      const scale = Math.hypot(p.m[0], p.m[1]);
      const turn = (Math.atan2(p.m[1], p.m[0]) * 180) / Math.PI;
      const els = p.back ? p.glyph.e.slice().reverse() : p.glyph.e;
      for (const e of els) for (const pts of sewElement(e, p.m, scale, turn, l, p.back)) out.push({ pts, word: p.word, line: p.line, letter: index.get(p)! });
    }
  }
  return out;
}

/** Lock stitches along the start (or the end) of a run: the half-stitch lock (see LOCK_MM). */
function lock(run: Pt[], atEnd: boolean): Pt[] {
  const pts = atEnd ? run.slice().reverse() : run;
  const along = (d: number): Pt => {
    let left = d;
    for (let i = 1; i < pts.length; i++) {
      const s = dist(pts[i - 1], pts[i]);
      if (s >= left) {
        const t = left / s;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
      }
      left -= s;
    }
    return pts[pts.length - 1];
  };
  return [along(LOCK_MM / 2), along(LOCK_MM), along(LOCK_MM / 2), pts[0]];
}

export interface Sewn {
  /** Records: starts with a jump, ends with a trim (no color change, no end). */
  recs: Rec[];
  /** Number of the first stitch of each piece between trims, from the first stitch of `recs`. */
  starts: number[];
  /** Number of the first stitch of each letter, counted the same way. */
  letters: number[];
  stitches: number;
  layout: Layout;
}

/**
 * The records of a lettering. Inside a word, moves up to 1 mm are sewn, up to `trimMm` jumped,
 * longer ones trimmed (a joined script stays one piece); between words and lines the thread is
 * always trimmed.
 */
export function sewLettering(font: Font, l: Lettering, trimMm: number): Sewn {
  const lay = layout(font, l);
  const runs = letteringRuns(font, l, lay);
  const recs: Rec[] = [];
  const starts: number[] = [];
  const letters: number[] = [];
  let n = 0;
  let last: Pt | null = null;
  const put = (q: Pt, cmd: number) => {
    recs.push({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd });
    if (cmd === STITCH) n++;
    last = q;
  };
  const stitch = (q: Pt) => {
    if (last && dist(last, q) < 0.1) return;
    put(q, STITCH);
  };
  let prev: Run | null = null;
  for (const run of runs) {
    const start = run.pts[0];
    // A letter starts after the lock stitches that end the piece before it.
    const newLetter = !prev || prev.letter !== run.letter;
    const gap = prev ? dist(prev.pts[prev.pts.length - 1], start) : Infinity;
    const sameWord = prev && prev.line === run.line && prev.word === run.word;
    if (!prev || !sameWord || gap > trimMm) {
      if (prev) {
        for (const q of lock(prev.pts, true)) put(q, STITCH);
        recs.push({ x: recs[recs.length - 1].x, y: recs[recs.length - 1].y, cmd: TRIM });
      }
      if (newLetter) letters.push(n);
      put(start, JUMP);
      starts.push(n);
      put(start, STITCH);
      for (const q of lock(run.pts, false)) put(q, STITCH);
    } else if (gap <= 1) {
      if (newLetter) letters.push(n);
      stitch(start);
    } else {
      if (newLetter) letters.push(n);
      put(start, JUMP);
      put(start, STITCH);
    }
    for (let i = 1; i < run.pts.length; i++) stitch(run.pts[i]);
    prev = run;
  }
  if (prev) {
    for (const q of lock(prev.pts, true)) put(q, STITCH);
    recs.push({ x: recs[recs.length - 1].x, y: recs[recs.length - 1].y, cmd: TRIM });
  }
  return { recs, starts, letters, stitches: n, layout: lay };
}

