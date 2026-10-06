import { contourFill, type DirField, Grid, sewRows } from './flow';
import type { FillParams, FillResult } from './fill';
import { sample, type Region } from './region';
import { runStitch } from './run';
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
 */

export type Motif = 'diamonds' | 'waves' | 'stars' | 'hearts';
export const MOTIFS: Motif[] = ['diamonds', 'waves', 'stars', 'hearts'];
export type GridKind = 'hex' | 'diamond' | 'brick';
export const GRID_KINDS: GridKind[] = ['hex', 'diamond', 'brick'];
export type CrossKind = 'full' | 'half' | 'double';
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
 * whatever the direction of the rows, tiled from the design origin.
 */
export interface MotifRow {
  o: Pt;
  e: Pt;
}

/** Where the row crosses the motif lines between u = lo and hi, sorted; `size` is the tile width (mm). */
export function motifCrossings(m: Motif, size: number, row: MotifRow, lo: number, hi: number): number[] {
  const { o, e } = row;
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
 * Whether point `q` (mm) lies inside the motif: between the two lines of a wave, or within a
 * diamond, star or heart. Counts the lines crossed on the way to the corner of its tile, which is
 * outside every motif.
 */
export function motifInside(m: Motif, size: number, q: Pt): boolean {
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
// Fields

/** A smooth random function of the plane, about -1.6 to 1.6, with features about `scale` mm wide. */
export function noise(seed: number, scale: number, octaves = 4): (x: number, y: number) => number {
  const rnd = random(seed);
  const waves = Array.from({ length: octaves }, (_, o) => {
    const a = rnd() * 2 * Math.PI;
    const f = ((2 * Math.PI) / scale) * 1.9 ** o;
    return { cx: Math.cos(a) * f, cy: Math.sin(a) * f, ph: rnd() * 2 * Math.PI, w: 1 / 1.7 ** o };
  });
  return (x, y) => waves.reduce((s, q) => s + q.w * Math.sin(q.cx * x + q.cy * y + q.ph), 0);
}

/** A field from the direction (radians) at each point of the region's grid; null leaves a cell empty. */
function fieldOf(r: Region, dir: (p: Pt) => number | null): DirField {
  const g = new Grid(r);
  const n = g.gw * g.gh;
  const c = new Float32Array(n);
  const s = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (!g.dom[k]) continue;
    const t = dir(g.center(k % g.gw, Math.floor(k / g.gw)));
    if (t === null) continue;
    c[k] = Math.cos(2 * t);
    s[k] = Math.sin(2 * t);
  }
  return { g, c, s };
}

/**
 * Wave rows: every row is the same wave, `height` mm from crest to middle and `length` mm long,
 * one spacing below the last, running at `angle` degrees. The crests drift a little from row to
 * row, so the bands look woven, not ruled; on the flanks the rows lie a little closer, which
 * shades the waves.
 */
export function waveFill(r: Region, p: FillParams, angle: number, height: number, length: number, start: Pt): FillResult | null {
  const a = (angle * Math.PI) / 180;
  const e: Pt = [Math.cos(a), Math.sin(a)];
  const n: Pt = [-e[1], e[0]];
  const k = (2 * Math.PI) / Math.max(1, length);
  const [x0, y0, x1, y1] = regionBox(r);
  const corners: Pt[] = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ];
  const us = corners.map((q) => q[0] * e[0] + q[1] * e[1]);
  const vs = corners.map((q) => q[0] * n[0] + q[1] * n[1]);
  const step = 0.2;
  const reach = Math.max(0, p.pull);
  const rows: Pt[][] = [];
  const v0 = Math.floor((Math.min(...vs) - height) / p.spacing) * p.spacing + p.spacing / 2;
  for (let v = v0; v < Math.max(...vs) + height; v += p.spacing) {
    let row: Pt[] = [];
    const end = () => {
      if (row.length > 1 && dist(row[0], row[row.length - 1]) > 1) rows.push(row);
      row = [];
    };
    for (let u = Math.min(...us) - 1; u <= Math.max(...us) + 1; u += step) {
      const w = v + height * Math.sin(k * u + 0.3 * Math.sin(v / 6));
      const q: Pt = [e[0] * u + n[0] * w, e[1] * u + n[1] * w];
      if (sample(r, r.sdf, q[0], q[1]) < reach) row.push(q);
      else end();
    }
    end();
  }
  return rows.length ? sewRows(r, rows, p, start, angle) : null;
}

/** Grain: features about this wide (mm); wood rings, not ripples. */
const GRAIN_SCALE = 125;

/** Rows that wander softly around `angle` degrees, like wood grain; `strength` 0 to 1. */
export function grainField(r: Region, angle: number, strength: number, seed: number, scale = GRAIN_SCALE): DirField {
  const n = noise(seed, scale, 5);
  const a = (angle * Math.PI) / 180;
  return fieldOf(r, (p) => a + strength * 1.1 * n(p[0], p[1]));
}

/** Rows that run out from `focus` (mm) like rays. */
export function rayField(r: Region, focus: Pt): DirField {
  return fieldOf(r, (p) => (dist(p, focus) < 0.3 ? null : Math.atan2(p[1] - focus[1], p[0] - focus[0])));
}

/** Rows in rings around `focus` (mm), like Ink/Stitch's circle fill. */
export function circleField(r: Region, focus: Pt): DirField {
  return fieldOf(r, (p) => (dist(p, focus) < 0.3 ? null : Math.atan2(p[1] - focus[1], p[0] - focus[0]) + Math.PI / 2));
}

/**
 * Rows turning around a few points inside the region (`centers`, mm, or picked by `seed`), the
 * next one turning the other way.
 */
export function swirlField(r: Region, seed: number, centers: Pt[] = swirlCenters(r, seed)): DirField {
  return fieldOf(r, (p) => {
    let vx = 0;
    let vy = 0;
    centers.forEach((c, i) => {
      const dx = p[0] - c[0];
      const dy = p[1] - c[1];
      const w = (i % 2 ? -1 : 1) / (dx * dx + dy * dy + 16);
      vx -= dy * w;
      vy += dx * w;
    });
    return Math.hypot(vx, vy) < 1e-12 ? null : Math.atan2(vy, vx);
  });
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
}

/** Bean stitch: forward, back, forward. */
function tripled(run: Pt[]): Pt[] {
  const out: Pt[] = [run[0]];
  for (let i = 1; i < run.length; i++) out.push(run[i], run[i - 1], run[i]);
  return out;
}

/** Closed loops sewn one after the other, each from its point nearest the needle. */
function sewLoops(loops: Pt[][], start: Pt, p: OpenParams): Pt[][] {
  const runs: Pt[][] = [];
  let pos = start;
  const todo = loops.filter((l) => l.length > 2);
  while (todo.length) {
    let bi = 0;
    let bk = 0;
    let bd = Infinity;
    todo.forEach((l, i) =>
      l.forEach((q, k) => {
        const d = dist(pos, q);
        if (d < bd) {
          bd = d;
          bi = i;
          bk = k;
        }
      }),
    );
    const l = todo.splice(bi, 1)[0];
    const loop = [...l.slice(bk), ...l.slice(0, bk), l[bk]];
    let run = runStitch(loop, p.stitch, 0.2);
    if (p.triple) run = tripled(run);
    runs.push(run);
    pos = run[run.length - 1];
  }
  return runs;
}

const DIRS: Pt[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/**
 * The outline of a random spanning tree on a grid of `cell` mm inside the region, one closed loop
 * per connected part. `maze` grows the tree depth first (long corridors, a labyrinth), else from a
 * random edge of all grown so far (short branches, a meander).
 */
function treeLoops(r: Region, cell: number, seed: number, maze: boolean, margin: number): Pt[][] {
  const rnd = random(seed);
  const [bx0, by0, bx1, by1] = regionBox(r);
  // Anchored to the design origin, like tatami rows.
  const i0 = Math.floor(bx0 / cell);
  const j0 = Math.floor(by0 / cell);
  const gw = Math.ceil(bx1 / cell) - i0 + 1;
  const gh = Math.ceil(by1 / cell) - j0 + 1;
  const at = (i: number, j: number): Pt => [(i0 + i + 0.5) * cell, (j0 + j + 0.5) * cell];
  const ok = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (sample(r, r.sdf, ...at(i, j)) < -margin) ok[j * gw + i] = 1;
  const seen = new Uint8Array(gw * gh);
  // Tree edges per cell: bit d for direction d.
  const links = new Uint8Array(gw * gh);
  const loops: Pt[][] = [];
  const shuffled = (): number[] => {
    const d = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) {
      const k = Math.floor(rnd() * (i + 1));
      [d[i], d[k]] = [d[k], d[i]];
    }
    return d;
  };
  for (let root = 0; root < gw * gh; root++) {
    if (!ok[root] || seen[root]) continue;
    seen[root] = 1;
    if (maze) {
      const stack = [root];
      while (stack.length) {
        const c = stack[stack.length - 1];
        const ci = c % gw;
        const cj = Math.floor(c / gw);
        let moved = false;
        for (const d of shuffled()) {
          const ni = ci + DIRS[d][0];
          const nj = cj + DIRS[d][1];
          if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
          const nk = nj * gw + ni;
          if (!ok[nk] || seen[nk]) continue;
          seen[nk] = 1;
          links[c] |= 1 << d;
          links[nk] |= 1 << ((d + 2) % 4);
          stack.push(nk);
          moved = true;
          break;
        }
        if (!moved) stack.pop();
      }
    } else {
      const front: [number, number][] = [];
      const grow = (c: number) => {
        for (let d = 0; d < 4; d++) front.push([c, d]);
      };
      grow(root);
      while (front.length) {
        const [c, d] = front.splice(Math.floor(rnd() * front.length), 1)[0];
        const ni = (c % gw) + DIRS[d][0];
        const nj = Math.floor(c / gw) + DIRS[d][1];
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
        const nk = nj * gw + ni;
        if (!ok[nk] || seen[nk]) continue;
        seen[nk] = 1;
        links[c] |= 1 << d;
        links[nk] |= 1 << ((d + 2) % 4);
        grow(nk);
      }
    }
    loops.push(outlineOfTree(root, gw, links, at, cell / 4));
  }
  return loops;
}

/**
 * Walks round a tree with it on the left, a quarter cell off its edges, and returns the corners
 * of that walk: at every cell it takes the first link turning right, then straight on, left, back.
 */
function outlineOfTree(root: number, gw: number, links: Uint8Array, at: (i: number, j: number) => Pt, q: number): Pt[] {
  const right = (d: number) => (d + 1) % 4; // y grows downwards: (1,0) turned right is (0,1)
  const off = (d: number): Pt => DIRS[right(d)];
  const pos = (c: number) => at(c % gw, Math.floor(c / gw));
  if (!links[root]) {
    const [x, y] = pos(root);
    return [
      [x - q, y - q],
      [x + q, y - q],
      [x + q, y + q],
      [x - q, y + q],
      [x - q, y - q],
    ];
  }
  let d0 = 0;
  while (!(links[root] & (1 << d0))) d0++;
  const out: Pt[] = [];
  let c = root;
  let d = d0;
  for (let guard = 0; guard < 8 * links.length + 8; guard++) {
    // Along the link from c in direction d, to its next cell.
    const nc = c + DIRS[d][0] + DIRS[d][1] * gw;
    // At nc: the next direction, right first.
    let nd = -1;
    for (const t of [right(d), d, (d + 3) % 4, (d + 2) % 4]) {
      if (links[nc] & (1 << t)) {
        nd = t;
        break;
      }
    }
    const v = pos(nc);
    const o1 = off(d);
    if (nd === d) {
      // Straight on: no corner.
    } else if (nd === (d + 2) % 4) {
      // Dead end: round the cell's far side.
      out.push([v[0] + q * (o1[0] + DIRS[d][0]), v[1] + q * (o1[1] + DIRS[d][1])]);
      out.push([v[0] + q * (-o1[0] + DIRS[d][0]), v[1] + q * (-o1[1] + DIRS[d][1])]);
    } else {
      const o2 = off(nd);
      out.push([v[0] + q * (o1[0] + o2[0]), v[1] + q * (o1[1] + o2[1])]);
    }
    c = nc;
    d = nd;
    if (c === root && d === d0) break;
  }
  out.push(out[0]);
  return out;
}

/**
 * A closed loop smoothed `times` times with the weights 1, 2, 1: corners become round bends a
 * fraction of a corridor wide, too little to bring two passes together.
 */
function smooth(loop: Pt[], times: number): Pt[] {
  let l = loop.slice(0, -1);
  for (let t = 0; t < times; t++) {
    const n = l.length;
    l = l.map((q, i) => {
      const a = l[(i + n - 1) % n];
      const b = l[(i + 1) % n];
      return [(a[0] + 2 * q[0] + b[0]) / 4, (a[1] + 2 * q[1] + b[1]) / 4] as Pt;
    });
  }
  return [...l, l[0]];
}

/** Points every `step` mm along a closed loop (keeping its corners close enough). */
function densify(loop: Pt[], step: number): Pt[] {
  const out: Pt[] = [loop[0]];
  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1];
    const b = loop[i];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/**
 * Meander (stippling): a tree outline bent by a smooth warp of the plane, which keeps the line
 * from crossing itself, then rounded. Lines are `size` mm apart.
 */
export function meanderFill(r: Region, p: OpenParams, start: Pt): FillResult | null {
  const cell = 2 * p.size;
  const amp = 0.2 * cell;
  const nx = noise(p.seed * 31 + 1, 3 * cell, 2);
  const ny = noise(p.seed * 31 + 2, 3 * cell, 2);
  const loops = treeLoops(r, cell, p.seed, false, cell / 4 + amp + 0.2).map((l) => smooth(densify(l, cell / 8).map(([x, y]) => [x + amp * 0.6 * nx(x, y), y + amp * 0.6 * ny(x, y)] as Pt), 8));
  const runs = sewLoops(loops, start, p);
  return runs.length ? { runs, angle: 0, under: 0 } : null;
}

/** Maze: the tree outline with straight corridors and sharp corners. Lines are `size` mm apart. */
export function mazeFill(r: Region, p: OpenParams, start: Pt): FillResult | null {
  const cell = 2 * p.size;
  const runs = sewLoops(treeLoops(r, cell, p.seed, true, cell / 4 + 0.2), start, p);
  return runs.length ? { runs, angle: 0, under: 0 } : null;
}

/** Echo: rings `size` mm apart along the edge, like echo quilting. */
export function echoFill(r: Region, p: OpenParams, start: Pt): FillResult | null {
  const res = contourFill(r, { spacing: p.size, stitch: p.stitch, angle: 0, pull: 0, underlay: false, tolerance: 0.2 }, start);
  if (!res) return null;
  return { ...res, runs: p.triple ? res.runs.map(tripled) : res.runs, under: 0 };
}

/** A graph of points and their edges, keyed by the points rounded to 0.01 mm. */
class Graph {
  pts = new Map<string, Pt>();
  adj = new Map<string, Set<string>>();
  key = (q: Pt) => `${Math.round(q[0] * 100)},${Math.round(q[1] * 100)}`;
  add(a: Pt, b: Pt): void {
    const ka = this.key(a);
    const kb = this.key(b);
    if (ka === kb) return;
    this.pts.set(ka, a);
    this.pts.set(kb, b);
    if (!this.adj.has(ka)) this.adj.set(ka, new Set());
    if (!this.adj.has(kb)) this.adj.set(kb, new Set());
    this.adj.get(ka)!.add(kb);
    this.adj.get(kb)!.add(ka);
  }
  /** Takes away dead ends, again and again, so only closed cells stay. */
  prune(): void {
    const leaves = [...this.adj.keys()].filter((k) => this.adj.get(k)!.size < 2);
    while (leaves.length) {
      const k = leaves.pop()!;
      const ns = this.adj.get(k);
      if (!ns) continue;
      this.adj.delete(k);
      for (const n of ns) {
        const m = this.adj.get(n);
        if (!m) continue;
        m.delete(k);
        if (m.size < 2) leaves.push(n);
      }
    }
  }
  /**
   * Every edge once there and back, depth first, one run per connected part, the parts in the
   * order the needle reaches them.
   */
  walk(start: Pt): Pt[][] {
    const used = new Set<string>();
    const done = new Set<string>();
    const runs: Pt[][] = [];
    let pos = start;
    for (;;) {
      let first: string | null = null;
      let fd = Infinity;
      for (const [k] of this.adj) {
        if (done.has(k)) continue;
        const d = dist(pos, this.pts.get(k)!);
        if (d < fd) {
          fd = d;
          first = k;
        }
      }
      if (first === null) break;
      const path: Pt[] = [this.pts.get(first)!];
      const stack: string[] = [first];
      done.add(first);
      while (stack.length) {
        const v = stack[stack.length - 1];
        let next: string | null = null;
        // The nearest unused edge, so the walk stays local.
        let nd = Infinity;
        for (const w of this.adj.get(v)!) {
          const e = v < w ? `${v}|${w}` : `${w}|${v}`;
          if (used.has(e)) continue;
          const d = dist(this.pts.get(v)!, this.pts.get(w)!) + (done.has(w) ? 1e6 : 0);
          if (d < nd) {
            nd = d;
            next = w;
          }
        }
        if (next === null) {
          stack.pop();
          if (stack.length) path.push(this.pts.get(stack[stack.length - 1])!);
          continue;
        }
        used.add(v < next ? `${v}|${next}` : `${next}|${v}`);
        path.push(this.pts.get(next)!);
        if (done.has(next)) {
          // Already reached: back at once (the edge is sewn twice), the walk goes on from v.
          path.push(this.pts.get(v)!);
        } else {
          done.add(next);
          stack.push(next);
        }
      }
      if (path.length > 1) runs.push(path);
      pos = path[path.length - 1];
    }
    return runs;
  }
}

/** Whether a segment lies inside the region by more than `margin` (ends and middle). */
const segInside = (r: Region, a: Pt, b: Pt, margin: number) =>
  [a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Pt].every((q) => sample(r, r.sdf, q[0], q[1]) < -margin);

/** A grid of honeycombs, diamonds or bricks `size` mm wide, sewn in one go per connected part. */
export function gridFill(r: Region, p: OpenParams, kind: GridKind, start: Pt): FillResult | null {
  const [x0, y0, x1, y1] = regionBox(r);
  const g = new Graph();
  const s = p.size;
  const add = (a: Pt, b: Pt) => {
    if (segInside(r, a, b, 0.3)) g.add(a, b);
  };
  if (kind === 'hex') {
    const rad = s / Math.sqrt(3);
    const hx = s;
    const hy = 1.5 * rad;
    for (let j = Math.floor(y0 / hy) - 1; j <= Math.ceil(y1 / hy) + 1; j++) {
      for (let i = Math.floor(x0 / hx) - 1; i <= Math.ceil(x1 / hx) + 1; i++) {
        const cx = i * hx + (j % 2 ? hx / 2 : 0);
        const cy = j * hy;
        const c: Pt[] = [];
        for (let k = 0; k < 6; k++) c.push([cx + rad * Math.cos(((30 + 60 * k) * Math.PI) / 180), cy + rad * Math.sin(((30 + 60 * k) * Math.PI) / 180)]);
        for (let k = 0; k < 6; k++) add(c[k], c[(k + 1) % 6]);
      }
    }
  } else if (kind === 'diamond') {
    // A square grid turned by 45 degrees, `size` across a diamond.
    const h = s / 2;
    for (let j = Math.floor(y0 / h) - 1; j <= Math.ceil(y1 / h) + 1; j++) {
      for (let i = Math.floor(x0 / s) - 1; i <= Math.ceil(x1 / s) + 1; i++) {
        const c: Pt = [i * s + (j % 2 ? h : 0), j * h];
        add(c, [c[0] + h, c[1] + h]);
        add(c, [c[0] - h, c[1] + h]);
      }
    }
  } else {
    // Bricks twice as long as high, every row shifted by half a brick.
    const h = s / 2;
    for (let j = Math.floor(y0 / h) - 1; j <= Math.ceil(y1 / h) + 1; j++) {
      for (let i = Math.floor(x0 / h) - 1; i <= Math.ceil(x1 / h) + 1; i++) {
        const a: Pt = [i * h, j * h];
        add(a, [a[0] + h, a[1]]);
        if ((((i + j) % 2) + 2) % 2 === 0) add(a, [a[0], a[1] + h]);
      }
    }
  }
  g.prune();
  let runs = g.walk(start).map((run) => runStitch(run, p.stitch, 0.05));
  if (p.triple) runs = runs.map(tripled);
  return runs.length ? { runs, angle: 0, under: 0 } : null;
}

/**
 * Cross stitch on a grid of `size` mm cells anchored at the design origin, over the cells wholly
 * inside. Only the diagonals are sewn (each there and back, like Ink/Stitch's even cross
 * stitch), so no thread runs along the cells' sides.
 */
export function crossFill(r: Region, p: OpenParams, kind: CrossKind, start: Pt): FillResult | null {
  const [x0, y0, x1, y1] = regionBox(r);
  const c = p.size;
  const g = new Graph();
  const inset = 0.1;
  for (let j = Math.floor(y0 / c); j <= Math.ceil(y1 / c); j++) {
    for (let i = Math.floor(x0 / c); i <= Math.ceil(x1 / c); i++) {
      const L = i * c;
      const T = j * c;
      const corners: Pt[] = [
        [L, T],
        [L + c, T],
        [L + c, T + c],
        [L, T + c],
      ];
      if (!corners.every((q) => sample(r, r.sdf, q[0], q[1]) < -inset)) continue;
      const [tl, tr, br, bl] = corners;
      if (kind === 'double') {
        const m: Pt = [L + c / 2, T + c / 2];
        for (const q of [tl, tr, br, bl, [L + c / 2, T], [L + c, T + c / 2], [L + c / 2, T + c], [L, T + c / 2]] as Pt[]) g.add(q, m);
      } else {
        g.add(bl, tr);
        if (kind === 'full') g.add(tl, br);
      }
    }
  }
  let runs = g.walk(start);
  if (p.triple) runs = runs.map(tripled);
  return runs.length ? { runs, angle: 0, under: 0 } : null;
}

/** Remembered and loaded: a point at the share (0 to 1) of a box's width and height. */
export const atShare = (box: [number, number, number, number], f: Pt): Pt => [box[0] + f[0] * (box[2] - box[0]), box[1] + f[1] * (box[3] - box[1])];
