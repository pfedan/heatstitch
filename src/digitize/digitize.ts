import { distanceToSeeds } from '../image/edt';
import { components, type Components } from '../image/labels';
import { NONE, type Prepared } from '../image/prepare';
import { COLOR_CHANGE, END, JUMP, PatternBuilder, STITCH, TRIM, type Pattern, type ThreadColor } from '../model/pattern';
import { fabricOf, recommendedSpacing, type Profile } from '../validation/profiles';
import { fillRegion } from './fill';
import { flowFill } from './flow';
import { coverage, peakDensity } from './measure';
import { buildRegion, type Region } from './region';
import { runStitch, TOLERANCE } from './run';
import { column, pairs, satinStitches, underlay, type Column, type SatinParams } from './satin';
import { reverse, skeleton, type Branch, type Graph, type Pt } from './skeleton';
import type { FillSettings } from '../model/restitch';
import type { Orientation } from '../image/orientation';
import { transformForm, type Form } from '../shape/path';
import { knockOut, rasterize, rasterizeStroke, sharedArea, unionOf } from '../shape/rasterize';

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
  /**
   * Largest distance of a stitch from the line or edge it follows (mm): running stitches and
   * curved rows get shorter stitches where a curve is tighter.
   */
  tolerance: number;
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
    satinMin: 1,
    pull: PULL[fabric.id] ?? 0.2,
    overlap: 0.2,
    underlay: true,
    trimMm: 3,
    tolerance: TOLERANCE,
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
  /** Fills: the exact area (in pattern coordinates, grown by the pull compensation) and how it was filled. */
  shape?: KeptShape;
  /** Shapes of a vector file: the whole shape as curves (pattern coordinates), also where others cover it. */
  form?: Form;
  /** The parts later shapes cover are left out of the stitches (computed from `form`). */
  knockout?: boolean;
}

/** An area as pixels, in pattern coordinates (0.1 mm records / 10), and the fill it was sewn with. */
export interface KeptShape {
  x0: number;
  y0: number;
  w: number;
  h: number;
  pxMm: number;
  mask: Uint8Array;
  areaMm2: number;
  fill: FillSettings;
}

export interface Digitized {
  pattern: Pattern;
  objects: DigitizedObject[];
  /** Number of the first stitch of each object (counting stitch records from 0), in sewing order. */
  starts: number[];
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

function sewSatin(o: Obj, start: Pt, p: SatinParams, withUnderlay: boolean, tol: number): Pt[][] {
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
      return withUnderlay ? underlay(c, tol) : runStitch(c.center, 2.5, tol);
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

/** Widest satin column (mm) when an area is turned into satin. */
export const SATIN_MAX = 7;

/**
 * Satin for an area, as the Image mode would sew it: null when the area is no stroke (wider than
 * `satinMax`, uneven, or short and branched), or when satin would pile up (more than `peak` times
 * its density somewhere) or leave it bare.
 */
export function satinForArea(r: Region, start: Pt, p: SatinParams, underlay: boolean, tol: number, satinMax = SATIN_MAX, peak = SATIN_PEAK): Pt[][] | null {
  const graph = isStroke(r, satinMax);
  if (!graph) return null;
  const obj: Obj = { info: { kind: 'satin', label: r.label, areaMm2: r.areaMm2 }, region: r, graph, probe: [] };
  const out = sewSatin(obj, start, p, underlay, tol).filter((run) => run.length > 1);
  if (!out.length || peakDensity(out) > (peak * 2) / p.spacing || coverage(r, out) < SATIN_COVER) return null;
  return out;
}

/** The skeleton of an area that can be sewn as satin, or null. */
export function isStroke(r: Region, satinMax = SATIN_MAX): Graph | null {
  const graph = skeleton(r);
  return classify(graph, { satinMax, satinMin: 0 } as DigitizeOptions) === 'satin' ? graph : null;
}

function sewRun(o: Obj, start: Pt, tol: number): Pt[][] {
  const line = (b: Branch, fa: boolean, fb: boolean) => runStitch(column(o.region, b, fa, fb).center, 2, tol);
  const run = walk(o.graph!, start, line, (b, fa, fb) => line(b, fa, fb).reverse());
  return run.length ? [run] : [];
}

/**
 * Stitches for one object starting near `pos`: satin that would pile up or leave its region bare is
 * filled instead, a region too thin to fill becomes running stitch. Fills note their angle in
 * `angles`, so touching fills sewn later run another way. Runs of fewer than two points are left out.
 */
function sewOne(obj: Obj, pos: Pt, o: DigitizeOptions, satin: SatinParams, angles: { obj: Obj; angle: number }[], orient?: Orientation): Pt[][] {
  let out: Pt[][] = [];
  if (obj.info.kind === 'satin') {
    out = sewSatin(obj, pos, satin, o.underlay, o.tolerance);
    if (peakDensity(out) > (SATIN_PEAK * 2) / o.satinSpacing || coverage(obj.region, out) < SATIN_COVER) {
      obj.info.kind = 'fill';
      out = [];
    }
  }
  if (obj.info.kind === 'fill') {
    // Fill angles of touching regions sewn already, so neighbours differ.
    const near = angles.filter((a) => touches(a.obj.region, obj.region)).map((a) => a.angle);
    const fp = { spacing: o.spacing, stitch: o.stitch, angle: o.angle, pull: o.pull, underlay: o.underlay, tolerance: o.tolerance };
    const flow = o.flow && o.angle === null && orient ? flowFill(obj.region, obj.graph, orient, fp, pos) : null;
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
  if (obj.info.kind === 'run' && obj.graph?.branches.length) out = sewRun(obj, pos, o.tolerance);
  return out.filter((r) => r.length > 1);
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

  const bridged = bridge(labels, comps, w, h, pxMm, rank);
  const byColor = new Map<number, Obj[]>();
  for (let c = 0; c < comps.label.length; c++) {
    const label = comps.label[c];
    if (label === NONE || comps.area[c] < 2 || bridged.into.has(c)) continue;
    const merged = bridged.boxes.get(c);
    const bbox = merged ?? { minX: comps.minX[c], minY: comps.minY[c], maxX: comps.maxX[c], maxY: comps.maxY[c] };
    const map = merged ? bridged.comp : comps.comp;
    const region = buildRegion(map, labels, w, c, label, bbox, h, pxMm, o.overlap, (l) => l !== NONE && rank[l] > rank[label]);
    const graph = skeleton(region);
    const kind = classify(graph, o);
    const obj: Obj = { info: { kind, label, areaMm2: region.areaMm2 }, region, graph, probe: probes(region) };
    if (!obj.probe.length) continue;
    if (!byColor.has(label)) byColor.set(label, []);
    byColor.get(label)!.push(obj);
  }

  const satin: SatinParams = { spacing: o.satinSpacing, pull: o.pull, splitMm: Math.max(7, o.satinMax) };
  const blocks: Block[] = [];
  const objects: DigitizedObject[] = [];
  let pos: Pt = [0, 0];
  const angles: { obj: Obj; angle: number }[] = [];
  for (const label of order) {
    const objs = byColor.get(label);
    if (!objs?.length) continue;
    const runs: Pt[][] = [];
    const owners: number[] = [];
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
      const out = sewOne(obj, pos, o, satin, angles, prep.orient);
      if (!out.length) continue;
      if (obj.info.kind === 'fill') obj.info.shape = keep(obj, o, w, h);
      runs.push(...out);
      for (const _ of out) owners.push(objects.length);
      objects.push(obj.info);
      const last = out[out.length - 1];
      pos = last[last.length - 1];
    }
    if (runs.length) blocks.push({ color: palette[label].thread, runs, owners });
  }
  const starts: number[] = [];
  return { pattern: assemble(blocks, Math.floor(w / 2) * pxMm, Math.floor(h / 2) * pxMm, o.trimMm, name, starts), objects, starts };
}

/**
 * The area a fill was sewn in, moved to pattern coordinates (the design is centered on a whole
 * pixel, see assemble): the region grown under later colors, and by the pull compensation, so
 * rows that end at its edge reach as far as they did.
 */
/** The kept shape of a fill; the region's pixels are shifted by half the image (0 for regions in pattern coordinates). */
function keep(obj: Obj, o: DigitizeOptions, imgW: number, imgH: number): KeptShape {
  const r = obj.region;
  const mask = Uint8Array.from(r.sdf, (d) => (d < o.pull ? 1 : 0));
  let area = 0;
  for (const m of mask) area += m;
  const spacing = o.spacing;
  return {
    x0: r.x0 - Math.floor(imgW / 2),
    y0: r.y0 - Math.floor(imgH / 2),
    w: r.w,
    h: r.h,
    pxMm: r.pxMm,
    mask,
    areaMm2: area * r.pxMm * r.pxMm,
    fill: {
      pattern: obj.info.curved ? 'follow' : 'tatami',
      spacing,
      spacingEnd: Math.min(1.2, round2(spacing * 2.5)),
      offset: 0.25,
      angle: Math.round(((((obj.info.angle ?? 0) % 180) + 180) % 180)) % 180,
      stitch: o.stitch,
      underlay: o.underlay,
      edge: 0,
      tolerance: o.tolerance,
    },
  };
}

/** Pieces of one color apart by no more than this, with only later colors between them, are one area (mm). */
const BRIDGE = 2.5;

interface Bridged {
  /** Components per pixel, with merged pieces and the pixels between them under the first piece. */
  comp: Int32Array;
  /** Pieces merged into another one. */
  into: Set<number>;
  /** Bounding boxes of the merged areas, by their first piece. */
  boxes: Map<number, { minX: number; minY: number; maxX: number; maxY: number }>;
}

/**
 * Pieces of one color that a narrow detail sewn later (a line, a stripe) cuts apart are filled as
 * one area, under the detail: the rows go on underneath it, and the detail is sewn on top, as
 * digitizers do. Only gaps up to BRIDGE wide that are all later colors are bridged (a closing of
 * the color's pixels), never background or colors sewn before.
 */
function bridge(labels: Uint8Array, comps: Components, w: number, h: number, pxMm: number, rank: number[]): Bridged {
  const out: Bridged = { comp: comps.comp, into: new Set(), boxes: new Map() };
  const byLabel = new Map<number, number[]>();
  comps.label.forEach((l, c) => {
    if (l === NONE || comps.area[c] < 2) return;
    if (!byLabel.has(l)) byLabel.set(l, []);
    byLabel.get(l)!.push(c);
  });
  const r = BRIDGE / 2 / pxMm;
  const pad = Math.ceil(r) + 2;
  for (const [label, cs] of byLabel) {
    if (cs.length < 2) continue;
    const x0 = Math.max(0, Math.min(...cs.map((c) => comps.minX[c])) - pad);
    const y0 = Math.max(0, Math.min(...cs.map((c) => comps.minY[c])) - pad);
    const x1 = Math.min(w - 1, Math.max(...cs.map((c) => comps.maxX[c])) + pad);
    const y1 = Math.min(h - 1, Math.max(...cs.map((c) => comps.maxY[c])) + pad);
    const W = x1 - x0 + 1;
    const H = y1 - y0 + 1;
    const own = new Uint8Array(W * H);
    const member = new Set(cs);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (member.has(comps.comp[(y + y0) * w + x + x0])) own[y * W + x] = 1;
    const near = distanceToSeeds(own, W, H);
    const notNear = Uint8Array.from(near, (d) => (d > r ? 1 : 0));
    const far = distanceToSeeds(notNear, W, H, true);
    // In the closing of the color, between its pieces, and a color sewn later.
    const between = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const l = labels[(y + y0) * w + x + x0];
        if (!own[i] && near[i] <= r && far[i] > r && l !== NONE && rank[l] > rank[label]) between[i] = 1;
      }
    }
    // Which pieces the pixels between connect.
    const parent = new Int32Array(W * H).map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    };
    const inSet = (i: number) => own[i] || between[i];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!inSet(i)) continue;
        if (x > 0 && inSet(i - 1)) parent[find(i)] = find(i - 1);
        if (y > 0 && inSet(i - W)) parent[find(i)] = find(i - W);
      }
    }
    const pieces = new Map<number, Set<number>>();
    for (let i = 0; i < W * H; i++) {
      if (!own[i]) continue;
      const root = find(i);
      if (!pieces.has(root)) pieces.set(root, new Set());
      pieces.get(root)!.add(comps.comp[(Math.floor(i / W) + y0) * w + (i % W) + x0]);
    }
    for (const [root, set] of pieces) {
      if (set.size < 2) continue;
      if (out.comp === comps.comp) out.comp = comps.comp.slice();
      const first = Math.min(...set);
      const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (let i = 0; i < W * H; i++) {
        if (!inSet(i) || find(i) !== root) continue;
        const x = (i % W) + x0;
        const y = Math.floor(i / W) + y0;
        out.comp[y * w + x] = first;
        box.minX = Math.min(box.minX, x);
        box.minY = Math.min(box.minY, y);
        box.maxX = Math.max(box.maxX, x);
        box.maxY = Math.max(box.maxY, y);
      }
      for (const c of set) if (c !== first) out.into.add(c);
      out.boxes.set(first, box);
    }
  }
  return out;
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

/** The runs of one thread, and the object each of them belongs to. */
interface Block {
  color: ThreadColor;
  runs: Pt[][];
  owners: number[];
}

/**
 * Builds the records with (cx, cy) mm of the image as their origin; coordinates in 0.1 mm.
 * `starts` gets the number of the first stitch of each object.
 */
function assemble(blocks: Block[], cx: number, cy: number, trimMm: number, name: string, starts: number[]): Pattern {
  const b = new PatternBuilder();
  let X = 0;
  let Y = 0;
  let last: Pt | null = null;
  let sewn = 0;
  const emit = (p: Pt, cmd: typeof STITCH | typeof JUMP) => {
    const nx = Math.round((p[0] - cx) * 10);
    const ny = Math.round((p[1] - cy) * 10);
    b.add(nx - X, ny - Y, cmd);
    if (cmd === STITCH) sewn++;
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
  let owner = -1;
  blocks.forEach((block, bi) => {
    colors.push(block.color);
    block.runs.forEach((run, ri) => {
      const start = run[0];
      // Where a new object begins: right before its first stitch.
      const mark = () => {
        if (block.owners[ri] === owner) return;
        owner = block.owners[ri];
        starts.push(sewn);
      };
      const gap = prev ? dist(prev[prev.length - 1], start) : Infinity;
      if (!prev || ri === 0) {
        if (prev) {
          tieOff(prev);
          b.mark(TRIM);
          if (bi > 0) b.mark(COLOR_CHANGE);
        }
        emit(start, JUMP);
        mark();
        emit(start, STITCH);
        tieIn(run);
      } else if (gap <= 1) {
        mark();
        stitch(start);
      } else if (gap <= trimMm) {
        emit(start, JUMP);
        mark();
        emit(start, STITCH);
      } else {
        tieOff(prev);
        b.mark(TRIM);
        emit(start, JUMP);
        mark();
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

/** A painted part of a vector file (see svg.ts): a fill area or a line of a width, in mm from the top left. */
export interface ShapeInput {
  color: number;
  kind: 'fill' | 'stroke';
  form: Form;
  width?: number;
}

/** Shapes smaller than this (mm²) are left out, as specks. */
const SPECK_MM2 = 0.3;

/**
 * Stitches for the shapes of a vector file, one object per shape, sewn in the order they are
 * painted. Each shape stays whole: where a later shape covers it, it is sewn underneath as well,
 * unless `knockout` leaves those parts out (reaching `overlap` under the shape on top, so no fabric
 * shows between). A shape joins an earlier color block of its thread when no shape painted in
 * between touches it, which saves color changes without changing what lies on top.
 */
/** Where the middle of a design of `sizeMm` lands in pattern coordinates: at 0, on the pixel grid. */
export function shapesOrigin(sizeMm: { w: number; h: number }, pxMm = 0.1): [number, number] {
  return [Math.round(sizeMm.w / 2 / pxMm) * pxMm, Math.round(sizeMm.h / 2 / pxMm) * pxMm];
}

export function digitizeShapes(shapes: ShapeInput[], threads: ThreadColor[], o: DigitizeOptions, sizeMm: { w: number; h: number }, knockout: boolean, name = 'image', pxMm = 0.1): Digitized {
  // Pattern coordinates: the middle of the design at 0, on the pixel grid.
  const [cx, cy] = shapesOrigin(sizeMm, pxMm);
  const items: { sh: ShapeInput; form: Form; whole: Region }[] = [];
  for (const sh of shapes) {
    const form = transformForm(sh.form, [1, 0, 0, 1, -cx, -cy]);
    const whole = sh.kind === 'fill' ? rasterize(form, pxMm) : rasterizeStroke(form, sh.width ?? 0.4, pxMm);
    if (!whole) continue;
    // Lines of one color painted one after the other that touch are one network (a star of strokes).
    const prev = items[items.length - 1];
    if (prev && sh.kind === 'stroke' && prev.sh.kind === 'stroke' && prev.sh.color === sh.color && sharedArea(prev.whole, whole) > 0) {
      prev.whole = unionOf([prev.whole, whole])!;
      continue;
    }
    items.push({ sh, form, whole });
  }
  for (let k = items.length - 1; k >= 0; k--) if (items[k].whole.areaMm2 < SPECK_MM2) items.splice(k, 1);
  const satin: SatinParams = { spacing: o.satinSpacing, pull: o.pull, splitMm: Math.max(7, o.satinMax) };
  // Blocks of one thread, each a list of item indices.
  const blocks: { color: number; items: number[] }[] = [];
  const overlaps = (a: number, b: number) => sharedArea(items[a].whole, items[b].whole) > 0;
  items.forEach((it, k) => {
    let target = blocks.length - 1;
    if (target < 0 || blocks[target].color !== it.sh.color) {
      target = -1;
      for (let b = blocks.length - 1; b >= 0; b--) {
        if (blocks[b].color === it.sh.color) {
          target = b;
          break;
        }
        if (blocks[b].items.some((j) => overlaps(j, k))) break;
      }
    }
    if (target < 0) blocks.push({ color: it.sh.color, items: [k] });
    else blocks[target].items.push(k);
  });
  // Sewn order of the items, for what lies on top.
  const sewnAt = new Map<number, number>();
  let n = 0;
  for (const b of blocks) for (const k of b.items) sewnAt.set(k, n++);

  const out: Block[] = [];
  const objects: DigitizedObject[] = [];
  const angles: { obj: Obj; angle: number }[] = [];
  let pos: Pt = [0, 0];
  for (const b of blocks) {
    const runs: Pt[][] = [];
    const owners: number[] = [];
    for (const k of b.items) {
      const it = items[k];
      let region = it.whole;
      const isFill = it.sh.kind === 'fill';
      if (knockout && isFill) {
        const covers = items.filter((x, j) => x.sh.kind === 'fill' && sewnAt.get(j)! > sewnAt.get(k)!).map((x) => x.whole);
        const left = knockOut(region, covers, o.overlap);
        if (!left || left.areaMm2 < SPECK_MM2) continue;
        region = left;
      }
      const graph = skeleton(region);
      const obj: Obj = { info: { kind: classify(graph, o), label: it.sh.color, areaMm2: region.areaMm2 }, region, graph, probe: [] };
      const sewn = sewOne(obj, pos, o, satin, angles);
      if (!sewn.length) continue;
      if (obj.info.kind === 'fill') {
        obj.info.shape = keep(obj, o, 0, 0);
        if (isFill) {
          obj.info.form = it.form;
          obj.info.knockout = knockout;
        }
      }
      runs.push(...sewn);
      for (const _ of sewn) owners.push(objects.length);
      objects.push(obj.info);
      const last = sewn[sewn.length - 1];
      pos = last[last.length - 1];
    }
    if (runs.length) out.push({ color: threads[b.color], runs, owners });
  }
  const starts: number[] = [];
  return { pattern: assemble(out, 0, 0, o.trimMm, name, starts), objects, starts };
}
