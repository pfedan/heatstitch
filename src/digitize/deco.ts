import { core } from '../wasm/core';
import { coreParams, fillOf, type FillResult } from './fill';
import { regionIn, sample, type Region } from './region';
import type { Pt } from './skeleton';

/**
 * Decorative fills, all drawn from a few numbers so they need no stored geometry:
 *
 * - Embossing (Prägung) on tatami: rows put their needle points where they cross the lines of a
 *   motif tiled over the area (diamonds, waves, stars, hearts). Many needle points on one line
 *   form a groove, so the motif shows in the light while the fill stays as dense as before (what
 *   professional software calls program split).
 * - Fields for curved rows: waves, grain (a soft random flow), rays from a point and swirls. The
 *   rows are laid on them by fieldFill like guided fills.
 * - Open patterns: one line through the area with the fabric showing between, for large areas on
 *   soft fabric and the quilting look. Meander and maze are the outline of a random tree on a
 *   grid: that outline is always one closed line that never crosses itself. Grids (honeycomb,
 *   diamonds, bricks) and cross stitch are graphs sewn in one go, every edge there and back.
 *   Echo is the contour fill with wide spacing.
 *
 * Every random choice comes from `seed`, so the same settings always give the same stitches.
 *
 * The fills and fields are computed by the Rust core (core/src/digitize/deco.rs); what the model
 * layer uses point by point (cross stitch cells, boxes) stays here too.
 */
export type Motif = 'diamonds' | 'waves' | 'stars' | 'hearts';
export const MOTIFS: Motif[] = ['diamonds', 'waves', 'stars', 'hearts'];
export type GridKind = 'hex' | 'diamond' | 'brick';
export const GRID_KINDS: GridKind[] = ['hex', 'diamond', 'brick'];
export type CrossKind = 'full' | 'half' | 'double';
/** Figures of a motif fill. */
export type Figure = 'hearts' | 'stars' | 'flowers' | 'circles';
export const FIGURES: Figure[] = ['hearts', 'stars', 'flowers', 'circles'];
export const CROSS_KINDS: CrossKind[] = ['full', 'half', 'double'];

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Small, fast and repeatable random numbers (mulberry32). */
export function random(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------------------------
// Textures

/**
 * Textures on tatami: every needle point of a row is shifted along it by a function of where the
 * row lies (v, across the rows), so the points of neighbouring rows line up into lines that zigzag,
 * swell, step or form a herringbone (what professional software calls program split; Ember's
 * offset fills). Unlike embossing no needle point is added: stitch count, stitch length and
 * density stay those of plain tatami, and the lines show only by where the stitches end.
 */
export type Texture = 'zigzag' | 'swell' | 'steps' | 'herringbone';
export const TEXTURES: Texture[] = ['zigzag', 'swell', 'steps', 'herringbone'];
/** Size of a texture when none is set (mm): from crest to crest, or the width of a herringbone column. */
export const TEXTURE_SIZE = 12;
export const TEXTURE_SIZE_RANGE: [number, number] = [4, 40];

// ------------------------------------------------------------------------------------------------
// Fields

/** The extent of the region's pixels (mm): min x, min y, max x, max y. */
export function regionBox(r: Region): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (!r.mask[y * r.w + x]) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  if (x0 > x1) return [r.x0 * r.pxMm, r.y0 * r.pxMm, (r.x0 + r.w) * r.pxMm, (r.y0 + r.h) * r.pxMm];
  return [(r.x0 + x0) * r.pxMm, (r.y0 + y0) * r.pxMm, (r.x0 + x1) * r.pxMm, (r.y0 + y1) * r.pxMm];
}

/**
 * A pattern turned by `angle` degrees (clockwise on screen) about the design origin: `to` takes a
 * point of the upright pattern onto the design, `from` back. At 0 both leave every point exactly
 * as it is.
 */
export function turning(angle = 0): { to: (q: Pt) => Pt; from: (q: Pt) => Pt } {
  const a = (angle * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { to: (q) => [c * q[0] - s * q[1], s * q[0] + c * q[1]], from: (q) => [c * q[0] + s * q[1], c * q[1] - s * q[0]] };
}

/** One to three points well inside the region, far enough apart, picked by `seed`. */
export function swirlCenters(r: Region, seed: number): Pt[] {
  const rnd = random(seed * 7919 + 13);
  const [x0, y0, x1, y1] = regionBox(r);
  const want = Math.max(1, Math.min(3, Math.round(r.areaMm2 / 500)));
  const apart = Math.max(6, Math.sqrt(r.areaMm2 / want) * 0.6);
  const out: Pt[] = [];
  let deepest: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
  let dd = Infinity;
  for (let tries = 0; tries < 400 && out.length < want; tries++) {
    const p: Pt = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)];
    const f = sample(r, r.sdfBase, p[0], p[1]);
    if (f < dd) {
      dd = f;
      deepest = p;
    }
    if (f > -Math.min(4, apart / 3)) continue;
    if (out.some((q) => dist(p, q) < apart)) continue;
    out.push(p);
  }
  return out.length ? out : [deepest];
}

// ------------------------------------------------------------------------------------------------
// Open patterns

export interface OpenParams {
  /** Distance between neighbouring lines (mm); for grids and cross stitch the cell size. */
  size: number;
  /** Stitch length (mm). */
  stitch: number;
  seed: number;
  /** Every stitch three times (bean stitch). */
  triple: boolean;
  /** Grids, motifs, cross stitch, meander and maze: the pattern turned by this many degrees (see turning). */
  angle?: number;
  /** Cross stitch: the corner of its grid (mm); the design origin when not set (see CrossGrid). */
  origin?: Pt;
}

/**
 * Meander (stippling): a tree outline with its corners rounded, bent by a smooth warp of the plane,
 * which keeps the line from crossing itself. Lines are `size` mm apart.
 */
export function meanderFill(r: Region, p: OpenParams, start: Pt): FillResult | null {
  return openFill(r, 'meander', null, p, start);
}

/** Maze: the tree outline with straight corridors and sharp corners. Lines are `size` mm apart. */
export function mazeFill(r: Region, p: OpenParams, start: Pt): FillResult | null {
  return openFill(r, 'maze', null, p, start);
}

/**
 * A grid of honeycombs, diamonds or bricks `size` mm wide, turned by `p.angle`, sewn in one go per
 * connected part.
 */
export function gridFill(r: Region, p: OpenParams, kind: GridKind, start: Pt): FillResult | null {
  return openFill(r, 'grid', kind, p, start);
}

/**
 * Motif fill: small figures (hearts, stars, flowers, circles) `size` mm apart in rows shifted by
 * half a figure, each row strung on one line from figure to figure, sewn in one go like the grids
 * (the motif fill of Hatch, Wilcom and PE-Design). Figures and links the edge cuts end on the line
 * along the edge, which joins the rows; every line is sewn there and back, so the figures come out
 * as a double line.
 */
export function motifFill(r: Region, p: OpenParams, figure: Figure, start: Pt): FillResult | null {
  return openFill(r, 'motif', figure, p, start);
}

/**
 * The grid of a cross stitch: cells `size` mm wide, turned by `angle` degrees (as `turning`) about
 * `origin`. Fills on the same grid (same size, angle and origin) put their crosses side by side
 * without a gap, which is why the grid is anchored at the design origin unless an object asks
 * for one of its own.
 */
export interface CrossGrid {
  size: number;
  angle: number;
  origin: Pt;
}

/** A cell of a cross stitch grid: its column and row. */
export type Cell = [number, number];
const cellKey = (i: number, j: number) => `${i},${j}`;

/**
 * A cell is crossed when the area covers at least this share of it, as Ink/Stitch's fill coverage
 * (50 % by default) and pixel art: two areas that meet share out the cells along their edge
 * between them, each cell to the one that covers more of it, so their crosses meet without a gap.
 */
export const CROSS_COVERAGE = 0.5;

/** Where a point of the design (mm) lies on the grid, in cells (upright, from the origin). */
export function onGrid(g: CrossGrid): (q: Pt) => Pt {
  const { from } = turning(g.angle);
  return (q) => {
    const u = from([q[0] - g.origin[0], q[1] - g.origin[1]]);
    return [u[0] / g.size, u[1] / g.size];
  };
}

/** Where a point of the grid (in cells) lies in the design (mm). */
export function offGrid(g: CrossGrid): (q: Pt) => Pt {
  const { to } = turning(g.angle);
  return (q) => {
    const u = to([q[0] * g.size, q[1] * g.size]);
    return [u[0] + g.origin[0], u[1] + g.origin[1]];
  };
}

/**
 * The cells of grid `g` the region covers enough of (CROSS_COVERAGE), counted pixel by pixel, in
 * rows from the top.
 */
export function crossCells(r: Region, g: CrossGrid): Cell[] {
  const at = onGrid(g);
  const count = new Map<string, { c: Cell; n: number }>();
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (!r.mask[y * r.w + x]) continue;
      const q = at([(x + r.x0 + 0.5) * r.pxMm, (y + r.y0 + 0.5) * r.pxMm]);
      const i = Math.floor(q[0]);
      const j = Math.floor(q[1]);
      const k = cellKey(i, j);
      const e = count.get(k);
      if (e) e.n++;
      else count.set(k, { c: [i, j], n: 1 });
    }
  }
  const need = (CROSS_COVERAGE * g.size * g.size) / (r.pxMm * r.pxMm) - 1e-6;
  return [...count.values()]
    .filter((e) => e.n >= need)
    .map((e) => e.c)
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}


/**
 * Cross stitch on grid `g` over the cells the region covers (crossCells).
 *
 * A full cross is sewn the way Ink/Stitch sews its crosses: the thread only ever runs along the
 * diagonals of the crosses, never along the sides of a cell. Its two diagonals meet only in the
 * middle (their ends lie on different corners), so each cross is one closed loop through its
 * middle: the bottom diagonal (/) there and back, half of it again to the middle, the top
 * diagonal (\) there and back, half of it back to the middle and on to the corner it started
 * from. Loops of crosses that share a corner are joined there (as Hierholzer joins cycles into
 * one tour), so a connected area is sewn in one go; every cross gets its top diagonal last, so all
 * crosses lie the same way. Areas that only meet nowhere are separate runs (each a trim apart).
 *
 * Half and double crosses are graphs walked as the grids are: every line there and back.
 */
export function crossFill(r: Region, p: OpenParams, kind: CrossKind, start: Pt): FillResult | null {
  return openFill(r, 'cross', kind, p, start);
}

/** Remembered and loaded: a point at the share (0 to 1) of a box's width and height. */
export const atShare = (box: [number, number, number, number], f: Pt): Pt => [box[0] + f[0] * (box[2] - box[0]), box[1] + f[1] * (box[3] - box[1])];

/** An open pattern by the core: `kind` names it, `variant` its grid, figure or cross kind. */
function openFill(r: Region, kind: string, variant: string | null, p: OpenParams, start: Pt): FillResult | null {
  const res = fillOf(core().openFill(regionIn(r), kind, variant, coreParams(p), start[0], start[1]));
  // Echo is a contour fill and keeps its travel.
  return res && (kind === 'echo' ? { ...res, under: 0 } : { runs: res.runs, angle: res.angle, under: 0 });
}
