import { STITCH, type Pattern } from '../model/pattern';
import { FILL, SATIN, stitchKinds } from '../model/sequence';

/**
 * The lower limits a design has to keep, next to the upper ones (density, short stitches,
 * perforation): fabric that shows through, gaps that open where the thread pulls the fabric, and
 * stitches long enough to snag. Measured profile-independently like the rest (see measure.ts); the
 * profile picks the limit when the cells are classified.
 */

/** Raster for gaps (mm per pixel) and the half width of the thread drawn on it (40 wt). */
const PX = 0.1;
const THREAD_R = 2;
/** A gap needs thread of two objects within this many pixels on opposite sides. */
const REACH = 8;
/**
 * How far rows and satin stitches pull in at each end, as a share of their length and at most
 * `cap` mm: on stable fabric (woven, caps, leather) and on stretchy or soft fabric (knits, terry,
 * light fabrics). Typical pull compensation in digitizing guides: 0.1 to 0.3 mm on woven fabric,
 * 0.3 to 0.5 mm on knits.
 */
export const PULL = {
  low: { share: 0.015, cap: 0.25 },
  high: { share: 0.03, cap: 0.45 },
} as const;
export type PullLevel = keyof typeof PULL;
/** Stitches that change direction by less than this (radians) continue the same row. */
const ROW_TURN = (25 * Math.PI) / 180;

export interface CoverageMeasure {
  /** Mean thread density of cells well inside stitched area (everything within 2 mm stitched), else 0. */
  cover: Float32Array;
  /** Gap pixels (0.01 mm² each) per cell after pull: on stable and on stretchy fabric. */
  gapsLow: Uint8Array;
  gapsHigh: Uint8Array;
  /** Longest stitch ending in each cell (0.1 mm). */
  longest: Uint16Array;
}

/** Cells count as stitched area from this mean density on (mm/mm²); a running stitch has about 0.3. */
const STITCHED = 0.9;

/**
 * Lower-limit measurements on the 1 mm grid at (originX, originY). `mean` is the mean thread
 * density per cell; records with `skip` set do not count for fabric showing through (fills that are
 * open on purpose, such as gradients).
 */
export function measureCoverage(
  p: Pattern,
  mean: Float32Array,
  originX: number,
  originY: number,
  cols: number,
  rows: number,
  skip?: Uint8Array,
  gaps = true,
): CoverageMeasure {
  const n = cols * rows;
  const cover = new Float32Array(n);
  const skipped = skip ? cellsOf(p, skip, originX, originY, cols, rows) : null;
  // Well inside: everything within 2 mm is stitched too (edges and narrow columns are left out,
  // their cells are only partly covered).
  const R = 2;
  for (let cy = R; cy < rows - R; cy++) {
    for (let cx = R; cx < cols - R; cx++) {
      const i = cy * cols + cx;
      if (mean[i] < STITCHED || skipped?.[i]) continue;
      let inside = true;
      for (let dy = -R; dy <= R && inside; dy++) for (let dx = -R; dx <= R && inside; dx++) inside = mean[i + dy * cols + dx] >= STITCHED;
      if (inside) cover[i] = mean[i];
    }
  }
  const longest = new Uint16Array(n);
  for (let i = 1; i < p.cmd.length; i++) {
    if (p.cmd[i] !== STITCH || p.cmd[i - 1] !== STITCH) continue;
    const l = Math.round(Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]));
    for (const j of [i - 1, i]) {
      const c = cellAt(p.x[j], p.y[j], originX, originY, cols, rows);
      if (c >= 0 && l > longest[c]) longest[c] = Math.min(65535, l);
    }
  }
  // Gaps cost most of the measuring: a caller that does not look at them (the correction trying
  // a change for density) leaves them out.
  if (!gaps) return { cover, gapsLow: new Uint8Array(n), gapsHigh: new Uint8Array(n), longest };
  const owner = ownerOf(p);
  const kinds = stitchKinds(p);
  const rowList = pulledRows(p, kinds);
  const grid = { ox: originX, oy: originY, W: cols * PER, H: rows * PER };
  const sewn = threadRaster(p, rowList, owner, null, grid);
  return {
    cover,
    gapsLow: gapCells(threadRaster(p, rowList, owner, PULL.low, grid), sewn, grid, cols, rows),
    gapsHigh: gapCells(threadRaster(p, rowList, owner, PULL.high, grid), sewn, grid, cols, rows),
    longest,
  };
}

const cellAt = (x: number, y: number, ox: number, oy: number, cols: number, rows: number) => {
  const cx = Math.floor(x / 10 - ox);
  const cy = Math.floor(y / 10 - oy);
  return cx >= 0 && cy >= 0 && cx < cols && cy < rows ? cy * cols + cx : -1;
};

/** Cells the stitches of the marked records pass through (and their neighbours). */
function cellsOf(p: Pattern, mark: Uint8Array, ox: number, oy: number, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cols * rows);
  for (let i = 1; i < p.cmd.length; i++) {
    if (!mark[i] || p.cmd[i] !== STITCH || p.cmd[i - 1] !== STITCH) continue;
    const ax = p.x[i - 1];
    const ay = p.y[i - 1];
    const k = Math.max(1, Math.ceil(Math.hypot(p.x[i] - ax, p.y[i] - ay) / 5));
    for (let j = 0; j <= k; j++) {
      const cx = Math.floor((ax + ((p.x[i] - ax) * j) / k) / 10 - ox);
      const cy = Math.floor((ay + ((p.y[i] - ay) * j) / k) / 10 - oy);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && y >= 0 && x < cols && y < rows) out[y * cols + x] = 1;
        }
      }
    }
  }
  return out;
}

/**
 * The piece of thread each record belongs to (1-based): a new one after every jump, trim or color
 * change. Two pieces of one object pull apart as well as two objects do.
 */
function ownerOf(p: Pattern): Int32Array {
  const out = new Int32Array(p.cmd.length);
  let id = 0;
  let sewing = false;
  for (let i = 0; i < p.cmd.length; i++) {
    if (p.cmd[i] !== STITCH) {
      sewing = false;
      continue;
    }
    if (!sewing) id++;
    sewing = true;
    out[i] = id;
  }
  return out;
}

/**
 * Stitches in rows: runs of fill or satin stitches that go on in about the same direction (a fill
 * row of several stitches, a single satin stitch), and every running stitch on its own (it does
 * not pull in: it is held all along). Records from `a` to `b`.
 */
interface Row {
  a: number;
  b: number;
  pulls: boolean;
}

function pulledRows(p: Pattern, kinds: Uint8Array): Row[] {
  const out: Row[] = [];
  let cur: Row | null = null;
  let dir = 0;
  for (let i = 1; i < p.cmd.length; i++) {
    if (p.cmd[i] !== STITCH || p.cmd[i - 1] !== STITCH || (p.x[i] === p.x[i - 1] && p.y[i] === p.y[i - 1])) {
      cur = null;
      continue;
    }
    const pulls = kinds[i] === FILL || kinds[i] === SATIN;
    const a = Math.atan2(p.y[i] - p.y[i - 1], p.x[i] - p.x[i - 1]);
    let turn = Math.abs(a - dir);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (cur && pulls && cur.pulls && cur.b === i - 1 && turn < ROW_TURN) {
      cur.b = i;
    } else {
      cur = { a: i - 1, b: i, pulls };
      out.push(cur);
    }
    dir = a;
  }
  return out;
}

const PER = Math.round(1 / PX);

interface Grid {
  ox: number;
  oy: number;
  W: number;
  H: number;
}

/**
 * Where the thread lies once the rows have pulled in by `pull` (null: as sewn), drawn as thick as
 * the thread: per pixel the object on top, positive for fill and satin, negative for running stitch.
 */
function threadRaster(p: Pattern, rowList: Row[], owner: Int32Array, pull: { share: number; cap: number } | null, g: Grid): Int32Array {
  const { W, H } = g;
  const own = new Int32Array(W * H);
  const mark = (xMm: number, yMm: number, id: number) => {
    const cx = Math.floor((xMm - g.ox) / PX);
    const cy = Math.floor((yMm - g.oy) / PX);
    for (let dy = -THREAD_R; dy <= THREAD_R; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= H) continue;
      for (let dx = -THREAD_R; dx <= THREAD_R; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= W || dx * dx + dy * dy > THREAD_R * THREAD_R + 1) continue;
        own[y * W + x] = id;
      }
    }
  };
  rowList.forEach((r, k) => {
    const o = owner[r.b];
    if (!o) return;
    // The short turn from one row to the next goes where the row ends go.
    const turn = !r.pulls && rowList[k - 1]?.pulls && rowList[k + 1]?.pulls && rowList[k - 1].b === r.a && rowList[k + 1].a === r.b;
    if (pull && turn && Math.hypot(p.x[r.b] - p.x[r.a], p.y[r.b] - p.y[r.a]) < 10) return;
    const id = r.pulls ? o : -o;
    let len = 0;
    for (let i = r.a + 1; i <= r.b; i++) len += Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) / 10;
    // Both ends pull in, never by more than 40 % of the row.
    const cut = r.pulls && pull ? Math.min(pull.cap, pull.share * len, len * 0.4) : 0;
    let s = 0;
    for (let i = r.a + 1; i <= r.b; i++) {
      const ax = p.x[i - 1] / 10;
      const ay = p.y[i - 1] / 10;
      const bx = p.x[i] / 10;
      const by = p.y[i] / 10;
      const l = Math.hypot(bx - ax, by - ay);
      const k = Math.max(1, Math.ceil(l / (PX / 2)));
      for (let j = 0; j <= k; j++) {
        const at = s + (l * j) / k;
        if (at < cut || at > len - cut) continue;
        mark(ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k, id);
      }
      s += l;
    }
  });
  return own;
}

/**
 * Gap pixels per 1 mm cell: empty pixels with thread of two objects on opposite sides close by,
 * along one of four axes, where the thread lay as sewn: only what the pull opens counts (fabric
 * left free on purpose, between letters or beside a detail line, is part of the design).
 */
function gapCells(own: Int32Array, sewn: Int32Array, g: Grid, cols: number, rows: number): Uint8Array {
  const { W, H } = g;
  // Per pixel: on how many axes thread lies on both sides, and whether two pieces face each other.
  const closed = new Uint8Array(W * H);
  const facing = new Uint8Array(W * H);
  const before = new Int32Array(W * H);
  const after = new Int32Array(W * H);
  const axes: [number, number][] = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [ax, ay] of axes) {
    sweep(own, before, W, H, -ax, -ay);
    sweep(own, after, W, H, ax, ay);
    for (let i = 0; i < own.length; i++) {
      if (own[i] || !sewn[i]) continue;
      const a = before[i];
      const b = after[i];
      if (!a || !b) continue;
      closed[i]++;
      if (Math.abs(a) !== Math.abs(b)) facing[i] = 1;
    }
  }
  // Enclosed on three axes: across a gap (and both diagonals), not along the outer edge of a shape.
  const gap = new Uint8Array(W * H);
  for (let i = 0; i < gap.length; i++) gap[i] = facing[i] && closed[i] >= 3 ? 1 : 0;
  const out = new Uint8Array(cols * rows);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!gap[y * W + x]) continue;
      const c = Math.floor(y / PER) * cols + Math.floor(x / PER);
      if (out[c] < 255) out[c]++;
    }
  }
  return out;
}

/**
 * For every pixel, the owner of the nearest thread within REACH pixels when walking from it in
 * direction (dx, dy), or 0. Computed in one pass along that direction.
 */
function sweep(own: Int32Array, out: Int32Array, W: number, H: number, dx: number, dy: number): void {
  out.fill(0);
  // Walk each line of the direction from its far end back, carrying the last owner and its distance.
  const lines: [number, number][] = [];
  if (dy === 0) for (let y = 0; y < H; y++) lines.push([dx > 0 ? W - 1 : 0, y]);
  else if (dx === 0) for (let x = 0; x < W; x++) lines.push([x, dy > 0 ? H - 1 : 0]);
  else {
    // Diagonals: start on the two far edges.
    const sx = dx > 0 ? W - 1 : 0;
    const sy = dy > 0 ? H - 1 : 0;
    for (let x = 0; x < W; x++) lines.push([x, sy]);
    for (let y = 0; y < H; y++) if (y !== sy) lines.push([sx, y]);
  }
  for (const [x0, y0] of lines) {
    let x = x0;
    let y = y0;
    let last = 0;
    let d = REACH + 1;
    while (x >= 0 && y >= 0 && x < W && y < H) {
      const i = y * W + x;
      if (own[i]) {
        last = own[i];
        d = 0;
      } else {
        d++;
        out[i] = d <= REACH ? last : 0;
      }
      x -= dx;
      y -= dy;
    }
  }
}
