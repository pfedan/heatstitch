import { components } from '../image/labels';
import { NONE, type Prepared } from '../image/prepare';
import { COLOR_CHANGE, END, JUMP, PatternBuilder, STITCH, TRIM, type Pattern, type ThreadColor } from '../model/pattern';
import { fabricOf, recommendedSpacing, type Profile } from '../validation/profiles';
import { fillRegion } from './fill';
import { flowFill } from './flow';
import { coverage, peakDensity } from './measure';
import { buildRegion, type Region } from './region';
import { runStitch } from './run';
import { column, pairs, satinStitches, underlay, type Column, type SatinParams } from './satin';
import { reverse, skeleton, type Branch, type Graph, type Pt } from './skeleton';

/**
 * From a prepared label map to a stitch pattern.
 *
 * Every connected region becomes one object: tatami fill, satin column network or running stitch,
 * chosen from the widths along its skeleton (the Goldman patent's thin/thick test): narrower than the
 * smallest satin is a line, a network of columns no wider than the satin limit is satin, anything
 * else is filled. Colors are sewn largest area first (backgrounds before details); fills before
 * satins and lines within a color; objects nearest first. Satin and line networks are walked depth
 * first, each branch out (underlay or the first pass of the line) and back (satin or the second
 * pass), so a whole network is sewn without a jump (as Ink/Stitch's auto-satin routes it).
 *
 * Between objects: up to 1 mm a plain stitch, up to the trim length a jump, beyond that a tie-off,
 * trim, jump and tie-in. Color changes trim and tie as well.
 */

export type Kind = 'fill' | 'satin' | 'run';

export interface DigitizeOptions {
  /** Fill row spacing between neighbouring rows (mm). */
  spacing: number;
  /** Satin spacing between penetrations on the same side (mm). */
  satinSpacing: number;
  /** Fill stitch length (mm). */
  stitch: number;
  /** Fill angle in degrees, or null to choose per region. */
  angle: number | null;
  /** Without a fixed angle: fill rows follow the image's structure and the shape's direction. */
  flow: boolean;
  /** Widest satin column (mm); wider regions are filled. */
  satinMax: number;
  /** Narrowest satin column (mm); narrower regions are sewn as running stitch. */
  satinMin: number;
  /** Pull compensation per side (mm). */
  pull: number;
  /** Objects sewn earlier reach this far under neighbours sewn later (mm). */
  overlap: number;
  underlay: boolean;
  /** Jumps longer than this are trimmed (mm). */
  trimMm: number;
}

/** Pull compensation per fabric (mm per side): Wilcom's table, more for stretchy and pile fabrics. */
const PULL: Record<string, number> = { woven: 0.2, cap: 0.2, knit: 0.35, terry: 0.4, light: 0.15, leather: 0.15 };

/** Defaults for the material: spacing from the profile, compensation from the fabric. */
export function digitizeDefaults(profile: Profile): DigitizeOptions {
  const [spacing] = recommendedSpacing(profile);
  const fabric = fabricOf(profile);
  return {
    spacing: round2(spacing),
    satinSpacing: round2(spacing),
    stitch: 4,
    angle: null,
    flow: true,
    satinMax: 7,
    satinMin: fabric.id === 'terry' ? 1.5 : 1,
    pull: PULL[fabric.id] ?? 0.2,
    overlap: 0.2,
    underlay: true,
    trimMm: 3,
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface DigitizedObject {
  kind: Kind;
  /** Palette index. */
  label: number;
  areaMm2: number;
  /** Fill angle (fills only; the mean direction for curved rows). */
  angle?: number;
  /** Fill rows curve with the image's direction. */
  curved?: boolean;
}

export interface Digitized {
  pattern: Pattern;
  objects: DigitizedObject[];
}

interface Obj {
  info: DigitizedObject;
  region: Region;
  graph: Graph | null;
  /** Points on the region for choosing the nearest next object. */
  probe: Pt[];
}

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

function percentile(v: number[], q: number): number {
  const s = v.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
}

/**
 * Fill, satin or running stitch, from the widths along the skeleton. Satin needs a stroke: no
 * wider than the satin limit, of even width (the Goldman patent's test: the widest point within
 * three standard deviations of the mean), long against its width, and with few branchings (at
 * least four widths of centerline per junction). Blotches with several short arms are filled;
 * as satin they would become stars of columns stacked in their middle.
 */
function classify(g: Graph, o: DigitizeOptions): Kind {
  const widths = g.branches.flatMap((b) => b.r.map((r) => 2 * r));
  if (!widths.length) return 'fill';
  const max = Math.max(...widths);
  if (max < o.satinMin) return 'run';
  const mean = widths.reduce((a, b) => a + b, 0) / widths.length;
  const sd = Math.sqrt(widths.reduce((a, w) => a + (w - mean) ** 2, 0) / widths.length);
  let length = 0;
  for (const b of g.branches) for (let i = 1; i < b.pts.length; i++) length += dist(b.pts[i - 1], b.pts[i]);
  const degree = new Array(g.nodes.length).fill(0);
  for (const b of g.branches) {
    degree[b.a]++;
    degree[b.b]++;
  }
  const junctions = degree.filter((d) => d >= 3).length;
  const narrow = percentile(widths, 0.95) <= o.satinMax && max <= o.satinMax * 1.3;
  const even = max <= mean + 3 * sd + 0.5;
  const stroke = length >= 2.5 * mean && junctions * 4 * mean <= length;
  return narrow && even && stroke ? 'satin' : 'fill';
}

/** Boundary pixels of the region (every few), to find the nearest object. */
function probes(r: Region): Pt[] {
  const out: Pt[] = [];
  let k = 0;
  for (let y = 1; y < r.h - 1; y++) {
    for (let x = 1; x < r.w - 1; x++) {
      const i = y * r.w + x;
      if (!r.mask[i] || (r.mask[i - 1] && r.mask[i + 1] && r.mask[i - r.w] && r.mask[i + r.w])) continue;
      if (k++ % 4 === 0) out.push([(x + r.x0 + 0.5) * r.pxMm, (y + r.y0 + 0.5) * r.pxMm]);
    }
  }
  return out;
}

const nearestProbe = (o: Obj, p: Pt) => Math.min(...o.probe.map((q) => dist(p, q)));

/**
 * Walks a skeleton graph depth first from the node nearest to `start`: each branch out with `out`
 * and, after everything beyond it, back with `back`. Returns one continuous run.
 */
function walk(g: Graph, start: Pt, out: (b: Branch, freeFrom: boolean, freeTo: boolean) => Pt[], back: (b: Branch, freeFrom: boolean, freeTo: boolean) => Pt[]): Pt[] {
  const degree = new Array(g.nodes.length).fill(0);
  for (const b of g.branches) {
    degree[b.a]++;
    degree[b.b]++;
  }
  const free = (n: number) => degree[n] === 1;
  let root = 0;
  let bd = Infinity;
  g.nodes.forEach((n, i) => {
    if (!degree[i]) return;
    // Ends are better starting points than junctions.
    const d = dist(n.p, start) - (free(i) ? 1 : 0);
    if (d < bd) {
      bd = d;
      root = i;
    }
  });
  const usedBranch = new Set<Branch>();
  const seen = new Set<number>();
  const pts: Pt[] = [];
  const append = (q: Pt[]) => {
    for (const p of q) if (!pts.length || dist(pts[pts.length - 1], p) > 0.05) pts.push(p);
  };
  const visit = (n: number) => {
    seen.add(n);
    for (const b of g.branches) {
      if (usedBranch.has(b) || (b.a !== n && b.b !== n)) continue;
      usedBranch.add(b);
      const dir = b.a === n ? b : reverse(b);
      const other = dir.b;
      append(out(dir, free(n), free(other)));
      if (!seen.has(other)) visit(other);
      append(back(dir, free(n), free(other)));
    }
  };
  visit(root);
  return pts;
}

/** Column of a branch with free ends extended, cached per direction-independent branch. */
function columns(r: Region): (b: Branch, freeFrom: boolean, freeTo: boolean) => Column {
  const cache = new Map<string, Column>();
  return (b, fa, fb) => {
    const key = `${b.pts[0]}|${b.pts[b.pts.length - 1]}|${fa}|${fb}`;
    let c = cache.get(key);
    if (!c) {
      c = column(r, b, fa, fb);
      cache.set(key, c);
    }
    return c;
  };
}

/** Satin columns overlap a junction they end at by this much once another column has covered it (mm). */
const JOIN_OVERLAP = 0.3;

function sewSatin(o: Obj, start: Pt, p: SatinParams, withUnderlay: boolean): Pt[][] {
  const col = columns(o.region);
  const g = o.graph!;
  // The first column to reach a junction covers it; the others stop at its edge.
  const covered = new Set<number>();
  const trim = (n: number) => (covered.has(n) ? Math.max(0, g.nodes[n].r - JOIN_OVERLAP) : 0);
  const run = walk(
    o.graph!,
    start,
    (b, fa, fb) => {
      const c = col(b, fa, fb);
      return withUnderlay ? underlay(c) : runStitch(c.center, 2.5);
    },
    (b, fa, fb) => {
      // Back from the far end: the same column reversed.
      const c = col(b, fa, fb);
      const rev: Column = { center: c.center.slice().reverse(), left: c.right.slice().reverse(), right: c.left.slice().reverse(), width: c.width };
      const ends = { from: g.nodes[b.b].p, fromTrim: fb ? 0 : trim(b.b), to: g.nodes[b.a].p, toTrim: fa ? 0 : trim(b.a) };
      if (!fb) covered.add(b.b);
      if (!fa) covered.add(b.a);
      return satinStitches(pairs(rev, p, ends), p);
    },
  );
  return run.length ? [run] : [];
}

/** Satin denser than this many times its nominal density somewhere is filled instead. */
const SATIN_PEAK = 2.4;
/** Satin that leaves more of its region bare than this share is filled instead. */
const SATIN_COVER = 0.95;

function sewRun(o: Obj, start: Pt): Pt[][] {
  const line = (b: Branch, fa: boolean, fb: boolean) => runStitch(column(o.region, b, fa, fb).center, 2);
  const run = walk(o.graph!, start, line, (b, fa, fb) => line(b, fa, fb).reverse());
  return run.length ? [run] : [];
}

export function digitize(prep: Prepared, o: DigitizeOptions, name = 'image'): Digitized {
  const { width: w, height: h, pxMm, labels, palette } = prep;
  const comps = components(labels, w, h);
  // Colors by sewn area, largest first.
  const area = new Array(palette.length).fill(0);
  for (const l of labels) if (l !== NONE) area[l]++;
  const order = palette.map((_, i) => i).filter((i) => area[i] > 0).sort((a, b) => area[b] - area[a]);
  const rank = new Array(palette.length).fill(-1);
  order.forEach((l, k) => (rank[l] = k));

  const byColor = new Map<number, Obj[]>();
  for (let c = 0; c < comps.label.length; c++) {
    const label = comps.label[c];
    if (label === NONE || comps.area[c] < 2) continue;
    const bbox = { minX: comps.minX[c], minY: comps.minY[c], maxX: comps.maxX[c], maxY: comps.maxY[c] };
    const region = buildRegion(comps.comp, labels, w, c, label, bbox, h, pxMm, o.overlap, (l) => l !== NONE && rank[l] > rank[label]);
    const graph = skeleton(region);
    const kind = classify(graph, o);
    const obj: Obj = { info: { kind, label, areaMm2: region.areaMm2 }, region, graph, probe: probes(region) };
    if (!obj.probe.length) continue;
    if (!byColor.has(label)) byColor.set(label, []);
    byColor.get(label)!.push(obj);
  }

  const satin: SatinParams = { spacing: o.satinSpacing, pull: o.pull, splitMm: Math.max(7, o.satinMax) };
  const blocks: { color: ThreadColor; runs: Pt[][] }[] = [];
  const objects: DigitizedObject[] = [];
  let pos: Pt = [0, 0];
  const angles: { obj: Obj; angle: number }[] = [];
  for (const label of order) {
    const objs = byColor.get(label);
    if (!objs?.length) continue;
    const runs: Pt[][] = [];
    const rankOf = (x: Obj) => (x.info.kind === 'fill' ? 0 : 1);
    const todo = objs.slice();
    while (todo.length) {
      // Fills first, then nearest.
      const minRank = Math.min(...todo.map(rankOf));
      let bi = -1;
      let bd = Infinity;
      todo.forEach((x, i) => {
        if (rankOf(x) !== minRank) return;
        const d = nearestProbe(x, pos);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      const obj = todo.splice(bi, 1)[0];
      let out: Pt[][] = [];
      if (obj.info.kind === 'satin') {
        out = sewSatin(obj, pos, satin, o.underlay);
        if (peakDensity(out) > (SATIN_PEAK * 2) / o.satinSpacing || coverage(obj.region, out) < SATIN_COVER) {
          obj.info.kind = 'fill';
          out = [];
        }
      }
      if (obj.info.kind === 'fill') {
        // Fill angles of touching regions sewn already, so neighbours differ.
        const near = angles.filter((a) => touches(a.obj.region, obj.region)).map((a) => a.angle);
        const fp = { spacing: o.spacing, stitch: o.stitch, angle: o.angle, pull: o.pull, underlay: o.underlay };
        const flow = o.flow && o.angle === null && prep.orient ? flowFill(obj.region, obj.graph, prep.orient, fp, pos) : null;
        const res = flow ?? fillRegion(obj.region, fp, pos, near);
        if (res) {
          out = res.runs;
          obj.info.angle = res.angle;
          if (flow?.curved) obj.info.curved = true;
          angles.push({ obj, angle: res.angle });
        } else if (obj.graph?.branches.length) {
          obj.info.kind = 'run';
        }
      }
      if (obj.info.kind === 'run' && obj.graph?.branches.length) out = sewRun(obj, pos);
      out = out.filter((r) => r.length > 1);
      if (!out.length) continue;
      runs.push(...out);
      objects.push(obj.info);
      const last = out[out.length - 1];
      pos = last[last.length - 1];
    }
    if (runs.length) blocks.push({ color: palette[label].thread, runs });
  }
  return { pattern: assemble(blocks, w * pxMm, h * pxMm, o.trimMm, name), objects };
}

/** Whether the windows of two regions overlap and their pixels touch. */
function touches(a: Region, b: Region): boolean {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x0 + a.w, b.x0 + b.w);
  const y1 = Math.min(a.y0 + a.h, b.y0 + b.h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!a.mask[(y - a.y0) * a.w + x - a.x0]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const bx = x + dx - b.x0;
        const by = y + dy - b.y0;
        if (bx >= 0 && by >= 0 && bx < b.w && by < b.h && b.mask[by * b.w + bx]) return true;
      }
    }
  }
  return false;
}

/** Lock stitch length (mm): half-stitch lock 0, 0.5, 1, 0.5, 0 along the path, as Ink/Stitch's default. */
const LOCK = 1;

/** Point `d` mm along the run from its start (or end, with `fromEnd`). */
function along(run: Pt[], d: number, fromEnd: boolean): Pt {
  const pts = fromEnd ? run.slice().reverse() : run;
  let left = d;
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    if (l >= left) {
      const t = left / l;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
    left -= l;
  }
  return pts[pts.length - 1];
}

/** Builds the records, centered on the design; coordinates in 0.1 mm. */
function assemble(blocks: { color: ThreadColor; runs: Pt[][] }[], wMm: number, hMm: number, trimMm: number, name: string): Pattern {
  const b = new PatternBuilder();
  const cx = wMm / 2;
  const cy = hMm / 2;
  let X = 0;
  let Y = 0;
  let last: Pt | null = null;
  const emit = (p: Pt, cmd: typeof STITCH | typeof JUMP) => {
    const nx = Math.round((p[0] - cx) * 10);
    const ny = Math.round((p[1] - cy) * 10);
    b.add(nx - X, ny - Y, cmd);
    X = nx;
    Y = ny;
    last = p;
  };
  const stitch = (p: Pt) => {
    if (last && dist(last, p) < 0.1) return;
    emit(p, STITCH);
  };
  const tieIn = (run: Pt[]) => {
    const p = run[0];
    for (const t of [0.5, 1, 0.5]) emit(along(run, LOCK * t, false), STITCH);
    emit(p, STITCH);
  };
  const tieOff = (run: Pt[]) => {
    const p = run[run.length - 1];
    for (const t of [0.5, 1, 0.5]) emit(along(run, LOCK * t, true), STITCH);
    emit(p, STITCH);
  };
  const colors: ThreadColor[] = [];
  let prev = null as Pt[] | null;
  blocks.forEach((block, bi) => {
    colors.push(block.color);
    block.runs.forEach((run, ri) => {
      const start = run[0];
      const gap = prev ? dist(prev[prev.length - 1], start) : Infinity;
      if (!prev || ri === 0) {
        if (prev) {
          tieOff(prev);
          b.mark(TRIM);
          if (bi > 0) b.mark(COLOR_CHANGE);
        }
        emit(start, JUMP);
        emit(start, STITCH);
        tieIn(run);
      } else if (gap <= 1) {
        stitch(start);
      } else if (gap <= trimMm) {
        emit(start, JUMP);
        emit(start, STITCH);
      } else {
        tieOff(prev);
        b.mark(TRIM);
        emit(start, JUMP);
        emit(start, STITCH);
        tieIn(run);
      }
      for (let i = 1; i < run.length; i++) stitch(run[i]);
      prev = run;
    });
  });
  if (prev) {
    tieOff(prev);
    b.mark(TRIM);
  }
  b.mark(END);
  return b.build(name, 'pes', colors.length ? colors : [{ r: 0, g: 0, b: 0 }]);
}
