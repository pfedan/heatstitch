import { core } from '../wasm/core';
import { coreParams, coreRegions, fillOf, fillRegion, type FillParams, type FillResult } from './fill';
import { fieldOf, type DirField } from './flow';
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
 * layer and the tests use point by point (motif lines, cross stitch cells, boxes) stays here too.
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
// Embossing

/**
 * One tile of each motif: its lines and its width and height, in units of the motif size (the
 * tile's width in mm). Tiles repeat without gaps, so lines leaving a tile go on in the next one.
 * Diamonds are a lattice of lines at about 62 degrees, waves run up and down, stars and hearts
 * stand in rows shifted by half a tile.
 */
interface Tile {
  w: number;
  h: number;
  lines: Pt[][];
}

const TILES: Record<Motif, Tile> = (() => {
  const star = (cx: number, cy: number, r: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i <= 10; i++) {
      const rr = i % 2 ? r * 0.45 : r;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
    return out;
  };
  const heart = (cx: number, cy: number, r: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = (2 * Math.PI * i) / 40;
      const x = 16 * Math.sin(t) ** 3;
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      out.push([cx + (x / 17) * r, cy - (y / 17) * r]);
    }
    return out;
  };
  const wave = (x: number): Pt[] => Array.from({ length: 33 }, (_, i) => [x + 0.2 * Math.sin((2 * Math.PI * i) / 32), (2.5 * i) / 32] as Pt);
  const dh = 1.88;
  const rows = 1.9;
  return {
    diamonds: {
      w: 1,
      h: dh,
      lines: [
        [
          [0.5, 0],
          [1, dh / 2],
          [0.5, dh],
          [0, dh / 2],
          [0.5, 0],
        ],
      ],
    },
    waves: { w: 1, h: 2.5, lines: [wave(0.25), wave(0.75)] },
    stars: { w: 1, h: rows, lines: [star(0.25, rows / 4, 0.4), star(0.75, (3 * rows) / 4, 0.4)] },
    hearts: { w: 1, h: rows, lines: [heart(0.25, rows / 4, 0.36), heart(0.75, (3 * rows) / 4, 0.36)] },
  };
})();

/**
 * A row of a fill: the point at u along it is o + u · e (mm). Motifs stand upright on the design
 * (or turned by their own angle) whatever the direction of the rows, tiled from the design origin.
 */
export interface MotifRow {
  o: Pt;
  e: Pt;
}

/**
 * Where the row crosses the motif lines between u = lo and hi, sorted; `size` is the tile width
 * (mm), and the motif is turned by `angle` degrees (see turning).
 */
export function motifCrossings(m: Motif, size: number, row: MotifRow, lo: number, hi: number, angle = 0): number[] {
  // In the motif's own frame the row is turned back; distances along it stay the same.
  const { from } = turning(angle);
  const o = from(row.o);
  const e = from(row.e);
  const tile = TILES[m];
  const tw = tile.w * size;
  const th = tile.h * size;
  const a: Pt = [o[0] + e[0] * lo, o[1] + e[1] * lo];
  const z: Pt = [o[0] + e[0] * hi, o[1] + e[1] * hi];
  const out: number[] = [];
  const i0 = Math.floor(Math.min(a[0], z[0]) / tw) - 1;
  const i1 = Math.floor(Math.max(a[0], z[0]) / tw) + 1;
  const j0 = Math.floor(Math.min(a[1], z[1]) / th) - 1;
  const j1 = Math.floor(Math.max(a[1], z[1]) / th) + 1;
  const reach = Math.hypot(tw, th);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      // Only tiles the row passes near (its bounding box touches more of them).
      const cx = (i + 0.5) * tw - o[0];
      const cy = (j + 0.5) * th - o[1];
      if (Math.abs(cx * e[1] - cy * e[0]) > reach) continue;
      for (const line of tile.lines) {
        for (let k = 1; k < line.length; k++) {
          const px = i * tw + line[k - 1][0] * size;
          const py = j * th + line[k - 1][1] * size;
          const dx = (line[k][0] - line[k - 1][0]) * size;
          const dy = (line[k][1] - line[k - 1][1]) * size;
          // Row o + u e meets segment p + t d.
          const den = e[0] * dy - e[1] * dx;
          if (Math.abs(den) < 1e-9) continue;
          const wx = px - o[0];
          const wy = py - o[1];
          const t = (wx * e[1] - wy * e[0]) / den;
          if (t < 0 || t >= 1) continue;
          const u = (wx * dy - wy * dx) / den;
          if (u > lo && u < hi) out.push(u);
        }
      }
    }
  }
  return out.sort((x, y) => x - y);
}

/**
 * Whether point `at` (mm) lies inside the motif turned by `angle` degrees: between the two lines
 * of a wave, or within a diamond, star or heart. Counts the lines crossed on the way to the corner of its tile, which is
 * outside every motif.
 */
export function motifInside(m: Motif, size: number, at: Pt, angle = 0): boolean {
  const q = turning(angle).from(at);
  const tile = TILES[m];
  const tw = tile.w * size;
  const th = tile.h * size;
  const i = Math.floor(q[0] / tw);
  const j = Math.floor(q[1] / th);
  const c: Pt = [i * tw, j * th];
  let n = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      for (const line of tile.lines) {
        for (let k = 1; k < line.length; k++) {
          const a: Pt = [(i + di) * tw + line[k - 1][0] * size, (j + dj) * th + line[k - 1][1] * size];
          const b: Pt = [(i + di) * tw + line[k][0] * size, (j + dj) * th + line[k][1] * size];
          if (crosses(q, c, a, b)) n++;
        }
      }
    }
  }
  return n % 2 === 1;
}

/** Whether segment p-q crosses segment a-b (a touching end counts once: half open at b). */
function crosses(p: Pt, q: Pt, a: Pt, b: Pt): boolean {
  const d1x = q[0] - p[0];
  const d1y = q[1] - p[1];
  const d2x = b[0] - a[0];
  const d2y = b[1] - a[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return false;
  const wx = a[0] - p[0];
  const wy = a[1] - p[1];
  const t = (wx * d2y - wy * d2x) / den;
  const s = (wx * d1y - wy * d1x) / den;
  return t >= 0 && t <= 1 && s >= 0 && s < 1;
}

/**
 * Needle points of an embossed row from lo to hi (sorted, u along the row), as in the program
 * split of commercial software: on every crossing of a motif line lies a needle point, so the
 * points of neighbouring rows line up into a groove that draws the motif. The regular points stay
 * where they are not too close to a crossing (no stitch shorter than about 1.2 mm), and no stitch
 * gets longer than 1.4 stitch lengths.
 */
export function embossPoints(cross: number[], regular: number[], len: number, lo: number, hi: number): number[] {
  const near = Math.min(1.2, len * 0.4);
  const ms: number[] = [];
  for (const m of cross) if (!ms.length || m - ms[ms.length - 1] >= 0.6) ms.push(m);
  const keep = regular.filter((r) => ms.every((m) => Math.abs(r - m) > near));
  const pts = [...ms, ...keep].sort((x, y) => x - y);
  const out: number[] = [];
  let prev = lo;
  for (const u of [...pts, hi]) {
    const g = u - prev;
    if (g > len * 1.4) {
      const n = Math.ceil(g / len);
      for (let i = 1; i < n; i++) out.push(prev + (g * i) / n);
    }
    if (u < hi) out.push(u);
    prev = u;
  }
  return out;
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
/** Steps of a staircase from bottom to top. */
const STEPS = 2;
/** No two needle points of a textured row closer than this share of a stitch (where herringbone columns meet). */
const TEXTURE_NEAR = 0.3;
/** No stitch of a textured row longer than this many stitch lengths. */
const TEXTURE_LONG = 1.4;

/** 0 at 0, 1 at 1/2, 0 at 1: a triangle wave of period 1. */
const tri = (t: number) => 1 - Math.abs(2 * (t - Math.floor(t)) - 1);

/**
 * Shift of the needle points of a row at v (in stitch lengths), in column `col` of a herringbone.
 * Zigzag and steps go P/2 along the row on P across it (lines at 45 degrees), the swell a third.
 */
function textureShift(t: Texture, size: number, len: number, v: number, col: number): number {
  const a = size / 2 / len;
  if (t === 'zigzag') return a * tri(v / size);
  if (t === 'swell') return ((2 * a) / 3) * 0.5 * (1 - Math.cos((2 * Math.PI * v) / size));
  if (t === 'steps') return (a * Math.floor(tri(v / size) * STEPS + 0.5)) / STEPS;
  // Herringbone: lines at 45 degrees, the other way in every second column.
  return ((col % 2 === 0 ? 1 : -1) * v) / len;
}

/**
 * Needle points of a textured row from lo to hi (u along the row, sorted), its first and last
 * `margin` mm left free as for plain rows. Herringbone columns are `size` wide along the rows,
 * from u = 0; where two columns meet, a point too close to the one before is left out, and no
 * stitch gets longer than TEXTURE_LONG stitch lengths.
 */
export function texturePoints(t: Texture, size: number, len: number, v: number, lo: number, hi: number, margin: number): number[] {
  const a = lo + margin;
  const b = hi - margin;
  if (b <= a) return [];
  const w = t === 'herringbone' ? size : Infinity;
  const raw: number[] = [];
  const c0 = Number.isFinite(w) ? Math.floor(a / w) : 0;
  const c1 = Number.isFinite(w) ? Math.floor(b / w) : 0;
  for (let c = c0; c <= c1; c++) {
    const from = Number.isFinite(w) ? Math.max(a, c * w) : a;
    const to = Number.isFinite(w) ? Math.min(b, (c + 1) * w) : b;
    const s = textureShift(t, size, len, v, ((c % 2) + 2) % 2);
    const ph = s - Math.floor(s);
    for (let j = Math.ceil(from / len - ph); (j + ph) * len < to + 1e-9; j++) {
      const u = (j + ph) * len;
      if (u >= from - 1e-9) raw.push(u);
    }
  }
  const near = len * TEXTURE_NEAR;
  const out: number[] = [];
  let prev = lo;
  for (const u of raw) if (u - prev >= near) (out.push(u), (prev = u));
  if (out.length && hi - out[out.length - 1] < near) out.pop();
  const full: number[] = [];
  prev = lo;
  for (const u of [...out, hi]) {
    const g = u - prev;
    if (g > len * TEXTURE_LONG) {
      const n = Math.ceil(g / len);
      for (let i = 1; i < n; i++) full.push(prev + (g * i) / n);
    }
    if (u < hi) full.push(u);
    prev = u;
  }
  return full;
}

// ------------------------------------------------------------------------------------------------
// Fields

/**
 * Wave rows: every row is the same wave, `height` mm from crest to middle and `length` mm long,
 * one spacing below the last, running at `angle` degrees. The crests drift a little from row to
 * row, so the bands look woven, not ruled; on the flanks the rows lie a little closer, which
 * shades the waves. Neighbouring rows never cross, so they are sewn as tatami rows are: in
 * sections back and forth, with travel under rows still to come (see fillRegion).
 */
export function waveFill(r: Region, p: FillParams, angle: number, height: number, length: number, start: Pt): FillResult | null {
  return fillRegion(r, { ...p, angle, wave: { height, length } }, start);
}

/** Zigzag rows (see model/zigzag): their course, from low to high peak, and where the peaks lie. */
export interface ZigzagRows {
  angle: number;
  height: number;
  /** High peaks at points q with wave · q = phase (modulo 2 pi), low ones half a turn on. */
  wave: Pt;
  phase: number;
}

/**
 * Straight rows that zigzag, `p.spacing` apart, their peaks where `z` puts them: each row's peaks
 * lie on the same lines as the next row's, so the slants line up into chevrons (the knit look).
 * Every stitch runs from peak to peak; where a row leaves the area it ends on the edge. Rows reach
 * into the area from beyond its edges by half their height, so the edges get as many layers as
 * the middle.
 */
export function zigzagFill(r: Region, p: FillParams, z: ZigzagRows, start: Pt): FillResult | null {
  return fillOf(core().zigzagFill(regionIn(r), coreParams(p), z, start[0], start[1], ...coreRegions(r, p)), true);
}

/** Grain: features about this wide (mm); wood rings, not ripples. */
const GRAIN_SCALE = 125;

/** Rows that wander softly around `angle` degrees, like wood grain; `strength` 0 to 1. */
export function grainField(r: Region, angle: number, strength: number, seed: number, scale = GRAIN_SCALE): DirField {
  return fieldOf(core().grainField(regionIn(r), angle, strength, seed, scale));
}

/** Rows that run out from `focus` (mm) like rays. */
export function rayField(r: Region, focus: Pt): DirField {
  return fieldOf(core().rayField(regionIn(r), focus[0], focus[1]));
}

/** Rows in rings around `focus` (mm), like Ink/Stitch's circle fill. */
export function circleField(r: Region, focus: Pt): DirField {
  return fieldOf(core().circleField(regionIn(r), focus[0], focus[1]));
}

/**
 * Rows turning around a few points inside the region (`centers`, mm, or picked by `seed`), the
 * next one turning the other way.
 */
export function swirlField(r: Region, seed: number, centers?: Pt[]): DirField {
  return fieldOf(core().swirlField(regionIn(r), seed, centers && Float64Array.from(centers.flat())));
}

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

/** Echo: rings `size` mm apart along the edge, like echo quilting. */
export function echoFill(r: Region, p: OpenParams, start: Pt): FillResult | null {
  return openFill(r, 'echo', null, p, start);
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
 * How often a cross lays each of its diagonals: there and back on small crosses, twice that on
 * coarse ones (3 mm and up, about Aida 8 ct), where one pair of threads looks thin. Always even,
 * so each cross is a closed loop and the next one starts where it ended.
 */
export function crossPasses(size: number): number {
  return size >= CROSS_COARSE ? 4 : 2;
}
const CROSS_COARSE = 2.75;

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
