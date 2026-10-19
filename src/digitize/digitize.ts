import { core } from '../wasm/core';
import { NONE, type Prepared } from '../image/prepare';
import { computeBounds, type Pattern, type ThreadColor } from '../model/pattern';
import { fabricOf, fabricPull, recommendedSpacing, satinSpacing, type Profile } from '../validation/profiles';
import { fillRegion, linesOf } from './fill';
import { flowFill } from './flow';
import { coverage, peakDensity } from './measure';
import { fromCore, maskHash, regionIn, regionWindow, sameMask, type Region } from './region';
import { TOLERANCE } from './run';
import type { SatinParams } from './satin';
import type { SatinCorner, SatinEnd } from './satinJoins';
import { skeleton, type Graph, type Pt } from './skeleton';
import { bestChain, satinRuns, type BorderSettings, type FillSettings, type Rails, type SatinSettings } from '../model/restitch';
import { cutPieces, stripsOfAreas } from './rungs';
import { easePiles, SATIN_PEAK } from './satinEase';
import { areaLoops, classify as shapeClass, offersSections, suggestSatin, type SatinSuggestion, type ShapeClass } from './satinSuggest';
import type { Orientation } from '../image/orientation';
import { transformForm, type Form } from '../shape/path';
import { lineClassOf, lineStitchFor, lineStitches, redworkHelps } from '../model/line';
import { strokeForm, type StrokeCap, type StrokeJoin } from '../shape/ops';
import type { PathStitch } from '../model/along';
import { knockOut, rasterize, rasterizeStroke, sharedArea, unionOf } from '../shape/rasterize';
import { acrossGraph, areaKey, boxOf, groupOf, letterOf, structure, STRUCTURE, STRUCTURE_MIN_MM2, type AreaInfo, type Reason, type Technique } from './smart';

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
 *
 * The analysis and planning run in the Rust core (core/src/digitize/picture.rs): per image the
 * sewing order and the bridged pieces, per area its region, skeleton and kind, the satin and line
 * networks, and the records of the design. Choosing techniques, satin in sections and the memo
 * stay here with the model they depend on.
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
  /** Pull compensation of satin (the fabric's value, see satinOf), measured with a test swatch; `pull` when not set. */
  satinPull?: number;
  /** Objects sewn earlier reach this far under neighbours sewn later (mm). */
  overlap: number;
  underlay: boolean;
  /** Fills with an underlay get two crossing layers (stretchy and pile fabric); one layer when not set. */
  underCross?: boolean;
  /** Satin stitches longer than this are split (mm): where the fabric would let them snag. */
  splitMm?: number;
  /** Gap rows where sections of a fill meet (see FillParams.gapRows), by the fabric; none when not set. */
  gapRows?: number;
  /** Jumps longer than this are trimmed (mm). */
  trimMm: number;
  /**
   * Largest distance of a stitch from the line or edge it follows (mm): running stitches and
   * curved rows get shorter stitches where a curve is tighter.
   */
  tolerance: number;
  /** Smart: each area gets the technique that suits it (see smart.ts); else all follow `flow`. */
  smart?: boolean;
  /** Techniques set by hand, by area (AreaInfo.key). */
  areas?: Record<string, Technique>;
  /**
   * Redwork (vector files only, see digitizeShapes): the lines of a color, whatever their width and
   * wherever they are painted, are one line in running stitch, each path there and back.
   */
  redwork?: boolean;
  /** Redwork with the way back as a bean stitch (each stitch three times), for a bolder line. */
  redworkBean?: boolean;
}

/** Fills smaller than this (mm²) are sewn without underlay; from LARGE_FILL_MM2 crossing layers where the fabric asks for them. */
export const SMALL_FILL_MM2 = 40;
const LARGE_FILL_MM2 = 100;

/** The underlay a fill of this size gets: none when small, crossing layers when large on stretchy fabric. */
export function fillUnder(o: Pick<DigitizeOptions, 'underlay' | 'underCross'>, areaMm2: number): { underlay: boolean; underCross?: boolean } {
  if (!o.underlay || areaMm2 < SMALL_FILL_MM2) return { underlay: false };
  return o.underCross && areaMm2 >= LARGE_FILL_MM2 ? { underlay: true, underCross: true } : { underlay: true };
}

/** Gap rows of the options as fill settings: left out when none, as in fills made before them. */
export const gapOf = (o: Pick<DigitizeOptions, 'gapRows'>): { gapRows?: number } => (o.gapRows ? { gapRows: o.gapRows } : {});

/**
 * Pull compensation "by fabric" for an object here (see the stitch card): a fill's edges grow with
 * its size (longer rows pull in more), a satin gets half fixed and half by its width.
 */
export function pullFor(profile: Profile, kind: 'fill' | 'satin', areaMm2 = 400): { edge: number; edgeShare?: number } {
  const pull = fabricPull(profile, kind);
  if (kind === 'satin') return { edge: round2(pull / 2), edgeShare: Math.round((pull / 2 / PULL_WIDTH) * 1000) / 1000 };
  const k = Math.min(1.5, Math.max(0.75, Math.sqrt(areaMm2) / 20));
  return { edge: round2(Math.round((pull * k) / 0.05) * 0.05) };
}

/** Width at which a satin gets the fabric's whole pull compensation; narrower less, wider more. */
const PULL_WIDTH = 4;

/**
 * Satin needle points for the options: compensation by the fabric, half of it fixed and half
 * growing with the width (wide columns pull in more), split where stitches would snag.
 */
const satinOf = (o: DigitizeOptions): SatinParams => ({
  spacing: o.satinSpacing,
  pull: (o.satinPull ?? o.pull) / 2,
  pullShare: (o.satinPull ?? o.pull) / 2 / PULL_WIDTH,
  splitMm: Math.min(Math.max(7, o.satinMax), o.splitMm ?? Infinity),
});

/** Defaults for the material: spacing from the profile, compensation from the fabric. */
export function digitizeDefaults(profile: Profile): DigitizeOptions {
  const [spacing] = recommendedSpacing(profile);
  const fabric = fabricOf(profile);
  return {
    spacing: round2(spacing),
    satinSpacing: round2(satinSpacing(profile)),
    stitch: 4,
    angle: null,
    flow: true,
    satinMax: 7,
    satinMin: 1,
    pull: fabricPull(profile, 'fill'),
    ...(profile.own?.satin ? { satinPull: profile.own.satin.pull } : {}),
    overlap: 0.2,
    underlay: true,
    underCross: fabric.pull === 'high',
    splitMm: fabric.longMm,
    gapRows: fabric.gapRows,
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
  /** A line, sewn along these curves (see model/line.ts), and how. */
  path?: Form;
  line?: PathStitch;
  /** A fill of a vector file with the stroke of its shape: that stroke as its border (sewn by syncBorders). */
  border?: BorderSettings;
  /** The area of the image it was sewn for (AreaInfo.key). */
  area?: string;
  /**
   * A satin in sections (see satinSuggest): its columns (pattern coordinates), how they are sewn,
   * and the area they were cut from, so the satin tool can move their lines later.
   */
  columns?: Rails[];
  satin?: SatinSettings;
  satinShape?: Omit<KeptShape, 'fill'>;
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
  /** How far the area reaches beyond the shape it was made from (mm): the pull compensation. */
  grow?: number;
}

export interface Digitized {
  pattern: Pattern;
  objects: DigitizedObject[];
  /** Number of the first stitch of each object (counting stitch records from 0), in sewing order. */
  starts: number[];
  /** The areas of the image by group and place (see AreaInfo.name), and how each was sewn (images only). */
  areas?: AreaInfo[];
}

interface Obj {
  info: DigitizedObject;
  region: Region;
  graph: Graph | null;
  /** Points on the region for choosing the nearest next object. */
  probe: Float64Array;
  /** Cut lines and lines across for satin in sections, found when Smart looked at the area. */
  plan?: SatinSuggestion | null;
  /** Rows follow the image (else as the options say). */
  flow?: boolean;
  /** The area as Smart sees it: its key, what it would choose and why, and whether it was set by hand. */
  smart?: { key: string; auto: Technique | 'run'; reason: Reason; fixed: boolean; offers: Technique[] };
  /** Sewn as a satin in sections (see satinSuggest). */
  sections?: boolean;
}

/** Distance from `p` to the object's nearest probe (probes as a flat x, y list). */
function nearestProbe(o: Obj, p: Pt): number {
  let best = Infinity;
  for (let i = 0; i < o.probe.length; i += 2) best = Math.min(best, Math.hypot(p[0] - o.probe[i], p[1] - o.probe[i + 1]));
  return best;
}

/** Runs the core returned (see fill.ts linesOf), its object freed. */
function runsOf(o: { takePts(): Float64Array; takeLens(): Uint32Array; free(): void }): Pt[][] {
  const runs = linesOf(o.takePts(), o.takeLens());
  o.free();
  return runs;
}

/**
 * The region of component `c` (see buildRegion), with its skeleton, what it is sewn as (fill, satin
 * or running stitch, see classify in core/src/digitize/picture.rs) and points on its edge.
 */
function findArea(
  compMap: Int32Array,
  labels: Uint8Array,
  imgW: number,
  c: number,
  label: number,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  imgH: number,
  pxMm: number,
  o: DigitizeOptions,
  growInto: (label: number) => boolean,
): { region: Region; graph: Graph; kind: Kind; probe: Float64Array } {
  const { map, near, cw, ch, cx0, cy0, into } = regionWindow(compMap, labels, imgW, bbox, imgH, pxMm, o.overlap, growInto);
  const f = core().findArea(map, near, cw, ch, c, label, bbox.minX - cx0, bbox.minY - cy0, bbox.maxX - cx0, bbox.maxY - cy0, pxMm, o.overlap, into, cx0, cy0, o.satinMin, o.satinMax);
  const out = { region: fromCore(f.takeRegion()!, label, pxMm), graph: f.graph as Graph, kind: f.kind as Kind, probe: f.takeProbe() };
  f.free();
  return out;
}

/** The skeleton of a region and what it is sewn as, as findArea finds it. */
function classifyArea(r: Region, o: Pick<DigitizeOptions, 'satinMin' | 'satinMax'>): { graph: Graph; kind: Kind } {
  return core().classifyArea(regionIn(r), o.satinMin, o.satinMax) as { graph: Graph; kind: Kind };
}

/**
 * A satin network along its skeleton, sewn by the core without a jump: each branch out as underlay
 * (or along its middle), back as satin. `ok` when it neither piles up beyond `limit` (thread per
 * mm²) nor leaves its region bare.
 */
function sewSatin(r: Region, g: Graph, start: Pt, p: SatinParams, withUnderlay: boolean, tol: number, stretch = false, limit?: number): { runs: Pt[][]; ok: boolean } {
  const s = core().sewSatinNetwork(regionIn(r), g, start[0], start[1], p, withUnderlay, tol, stretch, limit);
  const ok = s.ok;
  return { runs: runsOf(s), ok };
}

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
  const out = core().satinForArea(regionIn(r), start[0], start[1], p, underlay, tol, satinMax, peak);
  return out ? runsOf(out) : null;
}

/** The skeleton of an area that can be sewn as satin, or null. */
export function isStroke(r: Region, satinMax = SATIN_MAX): Graph | null {
  return core().isStroke(regionIn(r), satinMax) as Graph | null;
}

/**
 * Whether area `r` can be sewn as satin in one go: a stroke (see isStroke), or an area whose
 * suggested columns cover it whole (arms along its axis, a ring, a frame; see suggestSatin).
 * Remembered for the last few areas by their pixels: the stitch panel asks again for the same
 * area after each change of its stitches.
 */
export function strokeLike(r: Region, satinMax = SATIN_MAX): boolean {
  const key = `${satinMax} ${r.x0} ${r.y0} ${r.w} ${r.h} ${r.pxMm} ${maskHash(r.mask)}`;
  const hit = strokes.find((c) => c.key === key && sameMask(c.mask, r.mask));
  if (hit) return hit.stroke;
  const stroke = !!isStroke(r, satinMax) || wholeSatin(r);
  strokes.push({ key, mask: r.mask.slice(), stroke });
  if (strokes.length > 16) strokes.shift();
  return stroke;
}
const strokes: { key: string; mask: Uint8Array; stroke: boolean }[] = [];

/** Whether the satin suggested for area `r` covers it whole, so that one click can sew it. */
function wholeSatin(r: Region): boolean {
  const s = suggestSatin(r);
  return !!s && s.kind !== 'wide' && s.ok;
}

/** A line network in running stitch along its skeleton, each branch there and back (in the core). */
function sewRun(o: Obj, start: Pt, tol: number): Pt[][] {
  return runsOf(core().sewRunNetwork(regionIn(o.region), o.graph!, start[0], start[1], tol));
}

/** Satin that neither piles up nor leaves its region bare. */
const satinOk = (runs: Pt[][], r: Region, o: DigitizeOptions, skip?: (x: number, y: number) => boolean) =>
  peakDensity(runs, skip) <= (SATIN_PEAK * 2) / o.satinSpacing && coverage(r, runs) >= SATIN_COVER;

/** Distance from q to the segment from a to b. */
function toSegment(q: Pt, a: Pt, b: Pt): number {
  const v: Pt = [b[0] - a[0], b[1] - a[1]];
  const l2 = v[0] * v[0] + v[1] * v[1];
  const t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * v[0] + (q[1] - a[1]) * v[1]) / l2)) : 0;
  return Math.hypot(q[0] - a[0] - v[0] * t, q[1] - a[1] - v[1] * t);
}

/**
 * Stitches for one object starting near `pos`: satin that would pile up or leave its region bare is
 * filled instead, a region too thin to fill becomes running stitch. Fills note their angle in
 * `angles`, so touching fills sewn later run another way. Runs of fewer than two points are left out.
 */
/**
 * The satin settings the image's satins are sewn with, as an object keeps them. Their pull
 * compensation is the fabric's (see satinOf), so it follows the fabric (edgeAuto), as on a satin
 * made in the stitch card; with it come the shortened free ends (see pushEnds).
 */
function satinSettings(o: DigitizeOptions, p: SatinParams): SatinSettings {
  return { spacing: p.spacing, edge: round2(p.pull), edgeShare: Math.round((p.pullShare ?? 0) * 1000) / 1000, edgeAuto: true, short: true, underlay: o.underlay, ...(o.underCross ? { underCross: true } : {}), tolerance: o.tolerance, ...(Number.isFinite(p.splitMm) ? { split: p.splitMm } : {}) };
}

/**
 * A satin in sections (Satin in Abschnitten): the area cut into columns at its junctions with lines
 * across where it bends, as "Vorschlagen" in the satin tool does, sewn as one chain each piece of
 * area in the order that hides the ways between the columns best. Remembers the columns, so the
 * satin tool can change them later. Nothing when the area makes no columns.
 */
function sewSections(obj: Obj, o: DigitizeOptions, p: SatinParams, graph?: Graph): Pt[][] {
  const r = obj.region;
  // The plan Smart made when it chose the area (see choose), unless asked for another centerline.
  const plan = !graph && obj.plan !== undefined ? obj.plan : suggestSatin(r, graph ?? obj.graph ?? undefined, o.satinMax);
  if (!graph) obj.plan = plan;
  if (!plan?.ok) return [];
  const { outsides, holes } = areaLoops(r);
  const made = stripsOfAreas(outsides, plan.lines, plan.cuts, holes);
  if (made.bad || made.hole >= 0) return [];
  const s = satinSettings(o, p);
  let columns: Rails[] = made.areas.flatMap((strips, a) => strips.map((x) => ({ ...x, chain: a })));
  const chains = new Map<number, Rails[]>();
  for (const c of columns) chains.set(c.chain!, [...(chains.get(c.chain!) ?? []), c]);
  columns = [...chains.values()].flatMap((g) => (g.length > 1 ? bestChain(g, s) : g));
  const runs = satinRuns(columns, s);
  if (!runs.length) return [];
  obj.info.columns = columns.map((c, k) => (k ? c : { ...c, split: { outlines: outsides, holes, cuts: plan.cuts } }));
  obj.info.satin = s;
  return runs;
}

/** Spots of a satin in sections eased at most (see easePiles), each a round of the satin's check. */
const EASE_SPOTS = 3;

/** What sewing an object depended on besides the object and the options (see Sewn). */
interface Used {
  /** Where the needle came from. */
  pos?: boolean;
  /** Fill angles of touching objects sewn before. */
  near?: number[];
}

function sewOne(obj: Obj, pos: Pt, o: DigitizeOptions, satin: SatinParams, angles: { obj: Obj; angle: number }[], orient?: Orientation, used: Used = {}): Pt[][] {
  let out: Pt[][] = [];
  // As columns cut at the junctions (see satinSuggest), when they hold: where two columns meet
  // at a cut line they overlap a little on purpose (not counted).
  // Plans tried in turn when one piles up: shapes as columns where they fit, not fans; then
  // crossings sewn through, not as thick places.
  const retries: [boolean, boolean][] = [
    [true, true],
    [false, false],
  ];
  let eased = 0;
  // Plans sewn already (as JSON): another try that comes back to one of them would only pile up the same way.
  const tried = new Set<string>();
  const sections = (graph?: Graph): Pt[][] => {
    const runs = sewSections(obj, o, satin, graph);
    if (!graph && obj.plan) tried.add(JSON.stringify(obj.plan));
    const cuts = obj.info.columns?.[0]?.split?.cuts ?? [];
    const seam = (x: number, y: number) => cuts.some((c) => cutPieces(c).some(([a, b]) => toSegment([x, y], a, b) < 0.9));
    if (runs.length && satinOk(runs, obj.region, o, seam)) return runs;
    // Piled up somewhere: cut through the spot, as long as that eases it (a few spots at most).
    if (runs.length && !graph && obj.plan?.ok && eased < EASE_SPOTS) {
      eased++;
      const plan = easePiles(obj.region, obj.plan, satinSettings(o, satin), o.satinMax, (SATIN_PEAK * 2) / o.satinSpacing, runs);
      if (plan !== obj.plan) {
        obj.plan = { ...obj.plan, ...plan };
        return sections();
      }
      eased = EASE_SPOTS;
    }
    while (!graph && obj.plan?.ok && retries.length) {
      const [columns, crossings] = retries.shift()!;
      const plan = suggestSatin(obj.region, obj.graph ?? undefined, o.satinMax, columns, crossings);
      if (plan?.ok && !tried.has(JSON.stringify(plan))) {
        obj.plan = plan;
        eased = 0;
        return sections();
      }
    }
    delete obj.info.columns;
    delete obj.info.satin;
    delete obj.info.satinShape;
    return [];
  };
  if (obj.sections) {
    out = sections();
    // Not made into columns, or the satin would not hold: as a satin along its middle.
    if (!out.length) obj.sections = false;
  }
  if (obj.info.kind === 'satin' && !obj.sections) {
    used.pos = true;
    const sewn = sewSatin(obj.region, obj.graph!, pos, satin, o.underlay, o.tolerance, !!o.underCross, (SATIN_PEAK * 2) / o.satinSpacing);
    out = sewn.runs;
    if (!sewn.ok) {
      // A stroke too wide or too bent for one satin along its middle: in columns, else filled.
      const g = skeleton(obj.region);
      out = shapeClass(g) === 'strokes' ? sections(g) : [];
      if (out.length) obj.sections = true;
      else obj.info.kind = 'fill';
    }
  }
  if (obj.info.kind === 'fill') {
    // Fill angles of touching regions sewn already, so neighbours differ.
    const near = angles.filter((a) => touches(a.obj.region, obj.region)).map((a) => a.angle);
    used.pos = true;
    used.near = near;
    const fp = { spacing: o.spacing, stitch: o.stitch, angle: o.angle, pull: o.pull, ...fillUnder(o, obj.region.areaMm2), tolerance: o.tolerance, ...gapOf(o) };
    const flow = (obj.flow ?? o.flow) && o.angle === null && orient ? flowFill(obj.region, obj.graph, orient, fp, pos) : null;
    const res = flow ?? fillRegion(obj.region, { ...fp, angle: o.angle ?? null }, pos, near);
    if (res) {
      out = res.runs;
      obj.info.angle = res.angle;
      if (flow?.curved) obj.info.curved = true;
      angles.push({ obj, angle: res.angle });
    } else if (obj.graph?.branches.length) {
      obj.info.kind = 'run';
    }
  }
  if (obj.info.kind === 'run' && obj.graph?.branches.length) {
    used.pos = true;
    out = sewRun(obj, pos, o.tolerance);
  }
  return out.filter((r) => r.length > 1);
}

/** An area as found in the image, before its technique is chosen (see Memo). */
interface Found {
  region: Region;
  graph: Graph;
  kind: Kind;
  probe: Float64Array;
  /** Smart's look at it, once asked for (see choose). */
  look?: Look;
  /** Lines across it along its whole length, once set to satin by hand (see choose). */
  long?: Graph | null;
  run: number;
}

/** An object as sewn, and what that depended on besides the object and the options (see Used). */
interface Sewn {
  out: Pt[][];
  pos?: Pt;
  near?: number[];
  /** The object after sewing: what became of it, and the plan it was sewn by. */
  info: DigitizedObject;
  plan?: SatinSuggestion | null;
  sections?: boolean;
  /** The fill angle it passed on to touching objects sewn after it. */
  angle?: number;
  run: number;
}

/**
 * What digitize keeps of one prepared image for the next run on it: the colors' order, the areas
 * as found and as Smart looked at them, and each object as sewn. When the technique of one area
 * changes, only that area is sewn anew, and after it only the objects whose start (the needle's
 * last place) or whose touching fill angles moved with it. The result is exactly the same as
 * sewn from scratch: an object is taken from here only when everything it was sewn from is the same.
 */
interface Memo {
  comps: Comps;
  order: number[];
  rank: number[];
  bridged: Bridged;
  found: Map<string, Found>;
  sewn: Map<string, Sewn>;
  run: number;
}

/** The connected components of the labels: per pixel, and per component its label, pixel count and box. */
interface Comps {
  comp: Int32Array;
  label: Uint16Array;
  area: Uint32Array;
  /** Min x, min y, max x, max y of each. */
  box: Uint32Array;
}

/** Pieces of one color bridged into one area (see bridge in core/src/digitize/picture.rs). */
interface Bridged {
  /** Components per pixel, with merged pieces and the pixels between them under the first piece. */
  comp: Int32Array;
  /** Pieces merged into another one. */
  into: Set<number>;
  /** Bounding boxes of the merged areas, by their first piece. */
  boxes: Map<number, { minX: number; minY: number; maxX: number; maxY: number }>;
}

const memos = new WeakMap<Prepared, Memo>();
/** Runs an entry is kept unused: going back and forth (undo, redo) finds it still there. */
const KEEP_RUNS = 3;

function memoOf(prep: Prepared): Memo {
  let m = memos.get(prep);
  if (!m) {
    const { width: w, height: h, pxMm, labels, palette } = prep;
    // Components, sewing order and bridged pieces in one call to the core.
    const a = core().analyzeImage(labels, w, h, pxMm, palette.length);
    const comps: Comps = { comp: a.takeComp(), label: a.takeLabel(), area: a.takeArea(), box: a.takeBoxes() };
    const order = Array.from(a.takeOrder());
    const merged = a.takeBridgedComp();
    const into = new Set(a.takeInto());
    const flat = a.takeMerged();
    a.free();
    const boxes = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
    for (let k = 0; k < flat.length; k += 5) boxes.set(flat[k], { minX: flat[k + 1], minY: flat[k + 2], maxX: flat[k + 3], maxY: flat[k + 4] });
    const rank = new Array(palette.length).fill(-1);
    order.forEach((l, k) => (rank[l] = k));
    m = { comps, order, rank, bridged: { comp: merged.length ? merged : comps.comp, into, boxes }, found: new Map(), sewn: new Map(), run: 0 };
    memos.set(prep, m);
  }
  return m;
}

const samePt = (p: Pt, q: Pt) => p[0] === q[0] && p[1] === q[1];
const sameNums = (a: number[], b: number[]) => a.length === b.length && a.every((v, k) => v === b[k]);

export function digitize(prep: Prepared, o: DigitizeOptions, name = 'image'): Digitized {
  const { width: w, height: h, pxMm, labels, palette } = prep;
  const memo = memoOf(prep);
  const run = ++memo.run;
  const { comps, order, rank, bridged } = memo;
  const satin = satinOf(o);
  // Areas are found by the overlap and the satin widths; objects sewn by all options but the techniques set by hand.
  const findKey = `${o.overlap}|${o.satinMin}|${o.satinMax}`;
  const sewKey = JSON.stringify({ ...o, areas: undefined });

  const byColor = new Map<number, Obj[]>();
  const memoKey = new Map<Obj, string>();
  for (let c = 0; c < comps.label.length; c++) {
    const label = comps.label[c];
    if (label === NONE || comps.area[c] < 2 || bridged.into.has(c)) continue;
    const merged = bridged.boxes.get(c);
    const bbox = merged ?? { minX: comps.box[4 * c], minY: comps.box[4 * c + 1], maxX: comps.box[4 * c + 2], maxY: comps.box[4 * c + 3] };
    let found = memo.found.get(`${c}|${findKey}`);
    if (!found) {
      const map = merged ? bridged.comp : comps.comp;
      found = { ...findArea(map, labels, w, c, label, bbox, h, pxMm, o, (l) => l !== NONE && rank[l] > rank[label]), run };
      memo.found.set(`${c}|${findKey}`, found);
    }
    found.run = run;
    const { region, graph, kind, probe } = found;
    const obj: Obj = { info: { kind, label, areaMm2: region.areaMm2 }, region, graph, probe };
    const key = areaKey(label, bbox.minX, bbox.minY, bbox.maxX, bbox.maxY);
    obj.info.area = key;
    if (!obj.probe.length) continue;
    if (!byColor.has(label)) byColor.set(label, []);
    choose(obj, key, o, found, prep.orient);
    memoKey.set(obj, `${c}|${o.areas?.[key] ?? ''}|${sewKey}`);
    byColor.get(label)!.push(obj);
  }

  const blocks: Block[] = [];
  const objects: DigitizedObject[] = [];
  let pos: Pt = [0, 0];
  const angles: { obj: Obj; angle: number }[] = [];
  const areas: AreaInfo[] = [];
  /** An object sewn from where the needle is, or as sewn before when that is all the same. */
  const sew = (obj: Obj): Pt[][] => {
    const key = memoKey.get(obj)!;
    const was = memo.sewn.get(key);
    const near = () => angles.filter((a) => touches(a.obj.region, obj.region)).map((a) => a.angle);
    if (was && (!was.pos || samePt(was.pos, pos)) && (!was.near || sameNums(was.near, near()))) {
      was.run = run;
      obj.info = { ...was.info };
      obj.plan = was.plan;
      obj.sections = was.sections;
      if (was.angle !== undefined) angles.push({ obj, angle: was.angle });
      return was.out;
    }
    const used: Used = {};
    const n = angles.length;
    const out = sewOne(obj, pos, o, satin, angles, prep.orient, used);
    memo.sewn.set(key, {
      out,
      ...(used.pos ? { pos } : {}),
      ...(used.near ? { near: used.near } : {}),
      info: { ...obj.info },
      plan: obj.plan,
      sections: obj.sections,
      ...(angles.length > n ? { angle: angles[n].angle } : {}),
      run,
    });
    return out;
  };
  for (const label of order) {
    const objs = byColor.get(label);
    if (!objs?.length) continue;
    const runs: Pt[][] = [];
    const owners: number[] = [];
    const rankOf = (x: Obj) => (x.info.kind === 'fill' ? 0 : 1);
    const place = (obj: Obj) => {
      const out = sew(obj);
      if (!out.length) return;
      if (obj.info.kind === 'fill') obj.info.shape = keep(obj, o, w, h);
      if (obj.sections && obj.info.columns) keepSections(obj, w, h);
      // A satin along its middle keeps its area too: the satin tool cuts and suggests on it. And
      // how it was sewn, so a change sews it as dense as before (not as read from its stitches).
      else if (obj.info.kind === 'satin') {
        keepSatinArea(obj, w, h);
        obj.info.satin = satinSettings(o, satin);
      }
      runs.push(...out);
      for (const _ of out) owners.push(objects.length);
      objects.push(obj.info);
      if (obj.smart) areas.push(areaInfo(obj, o));
      const last = out[out.length - 1];
      pos = last[last.length - 1];
    };
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
      place(obj);
    }
    if (runs.length) blocks.push({ color: palette[label].thread, runs, owners });
  }
  const starts: number[] = [];
  // Areas of one color that Smart sees alike are one group, with one letter; each area of a group
  // of several is numbered (C1, C2, …), so it can be set on its own. Letters go by color (as sewn)
  // and kind, numbers by place (top to bottom): neither changes when a technique is changed.
  const groups = new Map<string, AreaInfo[]>();
  for (const a of areas) groups.set(groupOf(a), [...(groups.get(groupOf(a)) ?? []), a]);
  const kinds: Reason[] = ['calm', 'structure', 'round', 'stroke', 'line', 'shape'];
  const sorted = [...groups.values()].sort((x, y) => rank[x[0].label] - rank[y[0].label] || kinds.indexOf(x[0].reason) - kinds.indexOf(y[0].reason));
  sorted.forEach((g, k) => {
    const place = (a: AreaInfo) => boxOf(a.key) ?? { minX: 0, minY: 0 };
    g.sort((a, b) => place(a).minY - place(b).minY || place(a).minX - place(b).minX);
    g.forEach((a, n) => {
      a.letter = letterOf(k);
      a.name = g.length > 1 ? `${a.letter}${n + 1}` : a.letter;
    });
  });
  // Listed by letter, then number.
  areas.sort((a, b) => sorted.indexOf(groups.get(groupOf(a))!) - sorted.indexOf(groups.get(groupOf(b))!) || groups.get(groupOf(a))!.indexOf(a) - groups.get(groupOf(b))!.indexOf(b));
  for (const m of [memo.found, memo.sewn] as Map<string, { run: number }>[]) for (const [k, v] of m) if (v.run <= run - KEEP_RUNS) m.delete(k);
  return { pattern: assemble(blocks, Math.floor(w / 2) * pxMm, Math.floor(h / 2) * pxMm, o.trimMm, name, starts), objects, starts, areas };
}

/**
 * The technique of an area: set by hand, else Smart's choice (with the Smart style), else as the
 * style says for all. Smart keeps strokes and lines as they are found; a small round area becomes
 * satin across; a shape a digitizer cuts into satin columns (a star, a frame, a leaf: see
 * satinSuggest) becomes satin in sections; a fill follows the image where it has clear structure
 * of its own, else gets straight rows.
 */
function choose(obj: Obj, key: string, o: DigitizeOptions, found: Found, orient?: Orientation): void {
  const fixed = o.areas?.[key];
  if (!o.smart && !fixed) return;
  const r = obj.region;
  const { auto, reason, offers, sections, plan, across } = (found.look ??= look(obj, o, orient));
  obj.plan = plan;
  obj.smart = { key, auto, reason, fixed: !!fixed, offers };
  let t = fixed ?? (o.smart ? auto : undefined);
  if (t === 'sections' && !sections) t = 'satin';
  if (!t || t === 'run') return;
  if (t === 'sections') {
    obj.info.kind = 'satin';
    obj.sections = true;
    obj.flow = false;
    return;
  }
  if (t === 'satin') {
    if (obj.info.kind !== 'fill') return;
    // Across, else along its centerline; filled when the satin would not hold (sewOne).
    obj.info.kind = 'satin';
    if (!across && found.long === undefined) found.long = acrossGraph(r, o.satinMax, o.satinMax, Infinity);
    obj.graph = across ?? found.long ?? obj.graph;
    obj.flow = false;
    return;
  }
  // Rows: a stroke set to a fill by hand is filled whole.
  if (fixed) {
    obj.info = { kind: 'fill', label: obj.info.label, areaMm2: r.areaMm2, area: key };
  }
  obj.flow = t === 'dynamic';
}

/** Smart's look at an area: what it would choose and why, and what that rests on (see choose). */
interface Look {
  auto: Technique | 'run';
  reason: Reason;
  /** The techniques it can be set to. */
  offers: Technique[];
  /** It can be sewn as satin in sections. */
  sections: boolean;
  /** The cut lines and lines across of a shape cut into columns (see shapeOf). */
  plan?: SatinSuggestion | null;
  /** Lines across a small round area. */
  across: Graph | null;
}

function look(obj: Obj, o: DigitizeOptions, orient?: Orientation): Look {
  const r = obj.region;
  let auto: Technique | 'run';
  let reason: Reason;
  let across: Graph | null = null;
  // Satin in sections where the area is a drawing of lines that branch or close (an outline), or a
  // shape that is cut into columns (see satinSuggest).
  const lines = obj.info.kind !== 'run' && !!obj.graph && offersSections(obj.graph);
  const shape = obj.info.kind !== 'run' ? shapeOf(obj, o) : null;
  const sections = lines || !!shape;
  const offers: Technique[] = sections ? ['flat', 'dynamic', 'satin', 'sections'] : ['flat', 'dynamic', 'satin'];
  if (obj.info.kind === 'run') [auto, reason] = ['run', 'line'];
  else if (shape && SMART_SHAPES.includes(shape)) [auto, reason] = ['sections', 'shape'];
  else if (lines) [auto, reason] = ['sections', 'stroke'];
  else if (obj.info.kind === 'satin') [auto, reason] = ['satin', 'stroke'];
  else if ((across = acrossGraph(r, o.satinMax))) [auto, reason] = ['satin', 'round'];
  else if (r.areaMm2 >= STRUCTURE_MIN_MM2 && structure(r, orient) >= STRUCTURE) [auto, reason] = ['dynamic', 'structure'];
  else [auto, reason] = ['flat', 'calm'];
  return { auto, reason, offers, sections, plan: obj.plan, across };
}

/** Shapes Smart sews as satin in sections by itself (others only when set so by hand). */
const SMART_SHAPES: readonly ShapeClass[] = ['spikes', 'frame', 'leaf', 'drop', 'crescent', 'pointed'];
/** Areas larger than this (mm²) are not looked at as shapes (a background is none). */
const SHAPE_MAX_MM2 = 1500;

/** The class of shape the area is cut into satin columns as, or null (remembers the plan for sewing). */
function shapeOf(obj: Obj, o: DigitizeOptions): ShapeClass | null {
  if (obj.region.areaMm2 > SHAPE_MAX_MM2 || !obj.graph) return null;
  const plan = suggestSatin(obj.region, obj.graph, o.satinMax);
  obj.plan = plan?.ok ? plan : null;
  return obj.plan && obj.plan.kind !== 'strokes' && obj.plan.kind !== 'wide' ? obj.plan.kind : null;
}

/** What became of an area, for the list of areas. */
function areaInfo(obj: Obj, o: DigitizeOptions): AreaInfo {
  const r = obj.region;
  let best = -1;
  let at: Pt = [0, 0];
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const v = r.mask[y * r.w + x] ? r.inside[y * r.w + x] : -1;
      if (v > best) {
        best = v;
        at = [(x + r.x0 + 0.5) * r.pxMm, (y + r.y0 + 0.5) * r.pxMm];
      }
    }
  }
  const kind = obj.info.kind;
  const technique: AreaInfo['technique'] = obj.sections ? 'sections' : kind === 'satin' ? 'satin' : kind === 'run' ? 'run' : (obj.flow ?? o.flow) ? 'dynamic' : 'flat';
  const s = obj.smart!;
  return { key: s.key, letter: '', name: '', label: obj.info.label, areaMm2: Math.round(r.areaMm2 * 10) / 10, at, technique, auto: s.auto, reason: s.reason, fixed: s.fixed, offers: s.offers };
}

/** A satin in sections moved to pattern coordinates (see keep): its columns, and its area as pixels. */
function keepSections(obj: Obj, imgW: number, imgH: number): void {
  const r = obj.region;
  const dx = Math.floor(imgW / 2) * r.pxMm;
  const dy = Math.floor(imgH / 2) * r.pxMm;
  const mv = (q: Pt): Pt => [q[0] - dx, q[1] - dy];
  const mvAll = (qs: Pt[]) => qs.map(mv);
  obj.info.columns = obj.info.columns!.map((c) => ({
    ...c,
    left: mvAll(c.left),
    right: mvAll(c.right),
    ...(c.split ? { split: { outlines: c.split.outlines.map(mvAll), holes: c.split.holes.map(mvAll), cuts: c.split.cuts.map((f) => f.map(mv)) } } : {}),
  }));
  keepSatinArea(obj, imgW, imgH);
}

/** The area of a satin as pixels, in pattern coordinates (see keep). */
function keepSatinArea(obj: Obj, imgW: number, imgH: number): void {
  const r = obj.region;
  const mask = Uint8Array.from(r.sdfBase, (d) => (d < 0 ? 1 : 0));
  let area = 0;
  for (const m of mask) area += m;
  obj.info.satinShape = { x0: r.x0 - Math.floor(imgW / 2), y0: r.y0 - Math.floor(imgH / 2), w: r.w, h: r.h, pxMm: r.pxMm, mask, areaMm2: area * r.pxMm * r.pxMm };
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
    ...(o.pull ? { grow: o.pull } : {}),
    fill: {
      pattern: obj.info.curved ? 'follow' : 'tatami',
      spacing,
      spacingEnd: Math.min(1.2, round2(spacing * 2.5)),
      offset: 0.25,
      angle: Math.round(((((obj.info.angle ?? 0) % 180) + 180) % 180)) % 180,
      stitch: o.stitch,
      ...fillUnder(o, obj.region.areaMm2),
      edge: 0,
      tolerance: o.tolerance,
      ...gapOf(o),
    },
  };
}

/**
 * Colors in sewing order: what lies on top of something else is sewn after it, as digitizers do. Of
 * two regions that touch, the narrower lies on top (a vein on its leaf, an outline around its area, a
 * dot in a field): sewn later it covers the shared edge, and the wider one reaches under it instead
 * of over it. Colors are then ordered to agree with as much of that as they can (a linear ordering
 * problem, Schiavinotto and Stützle 2004); see sewing_order in core/src/digitize/picture.rs.
 */
export const sewingOrder = (labels: Uint8Array, w: number, h: number, pxMm: number, colors: number): number[] =>
  Array.from(core().sewingOrder(labels, w, h, pxMm, colors));

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

/** The runs of one thread, and the object each of them belongs to. */
interface Block {
  color: ThreadColor;
  runs: Pt[][];
  owners: number[];
}

/**
 * Builds the records with (cx, cy) mm of the image as their origin; coordinates in 0.1 mm (in the
 * core: ties, jumps and trims between the runs, see assemble in core/src/digitize/picture.rs).
 * `starts` gets the number of the first stitch of each object.
 */
function assemble(blocks: Block[], cx: number, cy: number, trimMm: number, name: string, starts: number[]): Pattern {
  const runs = blocks.flatMap((b) => b.runs);
  const lens = Uint32Array.from(runs, (r) => r.length);
  const flat = new Float64Array(2 * lens.reduce((a, n) => a + n, 0));
  let i = 0;
  for (const r of runs) for (const p of r) (flat[i++] = p[0]), (flat[i++] = p[1]);
  const a = core().assembleDesign(flat, lens, Uint32Array.from(blocks, (b) => b.runs.length), Uint32Array.from(blocks.flatMap((b) => b.owners)), cx, cy, trimMm);
  const [x, y, cmd] = [a.takeX(), a.takeY(), a.takeCmd()];
  for (const s of a.takeStarts()) starts.push(s);
  a.free();
  const colors = blocks.map((b) => b.color);
  return { name, format: 'pes', x, y, cmd, colors: colors.length ? colors : [{ r: 0, g: 0, b: 0 }], bounds: computeBounds(x, y, cmd) };
}

/** A satin line's ends and corners as the file paints its stroke: butt flat, bevel cut off, miter (and none) a miter, capped at the sharpest corners as SVG's miter limit does. */
const looksOf = (sh: ShapeInput): { ends: SatinEnd; corner: SatinCorner } => ({
  ends: sh.cap === 'round' ? 'round' : sh.cap === 'square' ? 'square' : 'flat',
  corner: sh.join === 'round' ? 'round' : sh.join === 'bevel' ? 'cap' : 'miter',
});

/** A painted part of a vector file (see svg.ts): a fill area or a line of a width, in mm from the top left. */
export interface ShapeInput {
  color: number;
  kind: 'fill' | 'stroke';
  form: Form;
  width?: number;
  /** How a line ends and turns its corners, as in SVG (see strokeForm). */
  cap?: StrokeCap;
  join?: StrokeJoin;
  miter?: number;
  /** The element of the file it was painted by: a fill and the stroke of the same element share it. */
  element?: number;
}

/**
 * The shapes with every line too wide for a satin (see lineClassOf) as an area in the shape the
 * line paints, its ends and corners as in the file.
 */
export function wideLinesAsAreas(shapes: ShapeInput[]): ShapeInput[] {
  return shapes.map((sh) => {
    if (sh.kind !== 'stroke' || lineClassOf(sh.width ?? 0) !== 'band') return sh;
    const form = strokeForm(sh.form, sh.width!, sh.cap, sh.join, sh.miter);
    return form ? { color: sh.color, kind: 'fill', form, ...(sh.element === undefined ? {} : { element: sh.element }) } : sh;
  });
}

/** Whether two lines are sewn alike: in the same stitch, a satin in the same width. */
function sameLine(a: ShapeInput, b: ShapeInput): boolean {
  const [x, y] = [lineStitchFor(a.width ?? 0.4), lineStitchFor(b.width ?? 0.4)];
  return x.type === y.type && (x.type !== 'satin' || Math.abs(x.width - y.width) < 0.05);
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

export function digitizeShapes(
  shapes: ShapeInput[],
  threads: ThreadColor[],
  o: DigitizeOptions,
  sizeMm: { w: number; h: number },
  knockout: boolean,
  name = 'image',
  pxMm = 0.1,
  progress?: (done: number, total: number) => void,
): Digitized {
  // Pattern coordinates: the middle of the design at 0, on the pixel grid.
  const [cx, cy] = shapesOrigin(sizeMm, pxMm);
  const items: { sh: ShapeInput; form: Form; whole: Region }[] = [];
  // Redwork: the lines of a color are one item, sewn where its last line is painted (on top of
  // the areas painted before), whatever their width.
  const lastLine = new Map<number, number>();
  if (o.redwork) shapes.forEach((sh, k) => sh.kind === 'stroke' && lastLine.set(sh.color, k));
  const gathered = new Map<number, { form: Form; wholes: Region[] }>();
  for (const [k, sh] of shapes.entries()) {
    const form = transformForm(sh.form, [1, 0, 0, 1, -cx, -cy]);
    const whole = sh.kind === 'fill' ? rasterize(form, pxMm) : rasterizeStroke(form, sh.width ?? 0.4, pxMm);
    if (!whole) {
      // The last line of a color too small to draw: its color's line goes where it would have been.
      const g = o.redwork && sh.kind === 'stroke' && lastLine.get(sh.color) === k ? gathered.get(sh.color) : undefined;
      if (g) items.push({ sh: { ...sh, element: undefined }, form: g.form, whole: g.wholes.length > 1 ? unionOf(g.wholes)! : g.wholes[0] });
      continue;
    }
    if (o.redwork && sh.kind === 'stroke') {
      const g = gathered.get(sh.color) ?? { form: { paths: [] }, wholes: [] };
      gathered.set(sh.color, g);
      g.form.paths.push(...form.paths);
      g.wholes.push(whole);
      if (lastLine.get(sh.color) === k) items.push({ sh: { ...sh, element: undefined }, form: g.form, whole: g.wholes.length > 1 ? unionOf(g.wholes)! : whole });
      continue;
    }
    // Lines of one color painted one after the other that touch are one network (a star of
    // strokes), when they are sewn alike: a line of another stitch or satin width is its own.
    const prev = items[items.length - 1];
    if (prev && sh.kind === 'stroke' && prev.sh.kind === 'stroke' && prev.sh.color === sh.color && sameLine(prev.sh, sh) && sharedArea(prev.whole, whole) > 0) {
      prev.whole = unionOf([prev.whole, whole])!;
      prev.form = { paths: [...prev.form.paths, ...form.paths] };
      continue;
    }
    items.push({ sh, form, whole });
  }
  for (let k = items.length - 1; k >= 0; k--) if (items[k].whole.areaMm2 < SPECK_MM2) items.splice(k, 1);
  // The stroke of a filled shape all of whose paths are closed (as SVG paints it, right after its
  // fill): the border of that fill, once it is sewn as a fill (see below).
  const edgeOf = new Map<number, number>();
  items.forEach((it, k) => {
    const next = items[k + 1];
    if (it.sh.kind !== 'fill' || it.sh.element === undefined || next?.sh.kind !== 'stroke' || next.sh.element !== it.sh.element) return;
    if (next.form.paths.every((x) => x.closed)) edgeOf.set(k, k + 1);
  });
  const edges = new Set<number>();
  const satin = satinOf(o);
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
  // How far it is, shape by shape (a shape sewn as the border of the one before counts with it).
  let done = 0;
  progress?.(0, items.length);
  for (const b of blocks) {
    const runs: Pt[][] = [];
    const owners: number[] = [];
    for (const k of b.items) {
      progress?.(done++, items.length);
      const it = items[k];
      let region = it.whole;
      const isFill = it.sh.kind === 'fill';
      if (edges.has(k)) continue;
      if (!isFill) {
        // Lines are sewn along their curves, so they stay exact and can be edited as lines.
        // Redwork: every line in running stitch (the way back a bean stitch when asked), each path
        // there and back, in one go where they touch.
        const line = o.redwork
          ? { ...lineStitchFor(0, o.tolerance), ...(o.redworkBean ? { type: 'triple' as const } : {}), redwork: true }
          : lineStitchFor(it.sh.width ?? 0.4, o.tolerance, { ...looksOf(it.sh), underCross: o.underCross });
        // A drawing of touching strokes in running stitch: in one go, without trims (redwork).
        if (line.type === 'run' && redworkHelps(it.form)) line.redwork = true;
        const sewn = lineStitches(it.form, line, false, pos);
        if (!sewn.length) continue;
        runs.push(...sewn);
        for (const _ of sewn) owners.push(objects.length);
        objects.push({ kind: line.type === 'satin' ? 'satin' : 'run', label: it.sh.color, areaMm2: region.areaMm2, path: it.form, line });
        const last = sewn[sewn.length - 1];
        pos = last[last.length - 1];
        continue;
      }
      if (knockout && isFill) {
        const covers = items.filter((x, j) => x.sh.kind === 'fill' && sewnAt.get(j)! > sewnAt.get(k)!).map((x) => x.whole);
        const left = knockOut(region, covers, o.overlap);
        if (!left || left.areaMm2 < SPECK_MM2) continue;
        region = left;
      }
      const { graph, kind } = classifyArea(region, o);
      const obj: Obj = { info: { kind, label: it.sh.color, areaMm2: region.areaMm2 }, region, graph, probe: new Float64Array(0) };
      const sewn = sewOne(obj, pos, o, satin, angles);
      if (!sewn.length) continue;
      if (obj.info.kind === 'fill') {
        obj.info.shape = keep(obj, o, 0, 0);
        if (isFill) {
          obj.info.form = it.form;
          obj.info.knockout = knockout;
          const e = edgeOf.get(k);
          if (e !== undefined) {
            // In the fill's thread, or one of its own.
            const line = lineStitchFor(items[e].sh.width ?? 0.4, o.tolerance, { ...looksOf(items[e].sh), underCross: o.underCross });
            obj.info.border = { ...line, ...(items[e].sh.color === it.sh.color ? {} : { color: { ...threads[items[e].sh.color] } }) };
            edges.add(e);
          }
        }
      } else if (obj.info.kind === 'satin' && isFill && !knockout) obj.info.form = it.form;
      runs.push(...sewn);
      for (const _ of sewn) owners.push(objects.length);
      objects.push(obj.info);
      const last = sewn[sewn.length - 1];
      pos = last[last.length - 1];
    }
    if (runs.length) out.push({ color: threads[b.color], runs, owners });
  }
  progress?.(items.length, items.length);
  const starts: number[] = [];
  return { pattern: assemble(out, 0, 0, o.trimMm, name, starts), objects, starts };
}
