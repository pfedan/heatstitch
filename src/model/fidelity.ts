import type { SewObject } from './objects';
import { STITCH, type Pattern } from './pattern';
import { measureFill, measureRun, measureSatin, objectKey, restitch, type Analysis, type Remembered, type Settings } from './restitch';

/**
 * How true an object is to its stitches ("Treue"): the object is sewn anew from what is known or
 * recognized about it (its shape and the measured stitch settings, as when the user asks for new
 * stitches without changing anything) and the new stitches are laid over the old ones.
 *
 * - area: intersection over union of the fabric the thread covers. Each stitch is drawn about
 *   0.2 mm thick on a 0.1 mm grid, then gaps up to the row spacing are closed, so rows count as
 *   an area and not as single lines.
 * - density: thread length per mm² inside the area both cover, new over old (`ratio`); `density`
 *   is the agreement min(ratio, 1 / ratio), 1 when both lay the same thread there.
 * - direction: for long stitches (1 mm and more) the mean direction per 1 mm cell (doubled angles,
 *   so a stitch and its way back count the same), and the mean cosine of the angle between old
 *   and new over the cells both have stitches in. Null when one of them has no long stitches.
 * - score: weighted geometric mean area^0.5 · density^0.25 · direction^0.25 (without a direction
 *   area^(2/3) · density^(1/3)), so one bad part pulls the whole down. 1 is a perfect match.
 */
export interface Fidelity {
  area: number;
  density: number;
  /** New thread over old thread inside the shared area. */
  ratio: number;
  direction: number | null;
  score: number;
}

/** Records are 0.1 mm: one grid cell is one record unit. */
const CELL = 1;
/** Half the drawn thread width in cells (about 0.2 mm wide in all). */
const THREAD = 1;
/** Stitches at least this long (0.1 mm) count for the direction. */
const LONG = 10;
/** Size of a direction cell (0.1 mm). */
const DIR_CELL = 10;
/** Sample step along a stitch (cells). */
const STEP = 0.5;
/** Rows closer than this always close into an area (mm), so a run's own width is not counted as a gap. */
const MIN_GAP = 0.2;
/** Largest gap closed (mm): rows further apart stay open, as they look on the fabric. */
const MAX_GAP = 1;
const TRIM_MM = 3;

/** Results by pattern and object stitches: unchanged objects are not sewn anew again. */
const cache = new WeakMap<Pattern, Map<string, Fidelity | null>>();

/**
 * The settings an object is sewn with now: what it remembers, else as measured from its stitches
 * (as currentSettings in correct/plan.ts), from the analysis restitch makes anyway.
 */
function settingsOf(p: Pattern, o: SewObject, an: Analysis, known: Remembered | undefined, kinds: Uint8Array): Settings | null {
  const part = an.parts.find((pt) => pt.kind === o.kind && !pt.border);
  if (!part) return null;
  if (o.kind === 'fill') return { kind: 'fill', s: structuredClone(known?.fill ?? measureFill(p, an)) };
  if (o.kind === 'satin') return { kind: 'satin', s: structuredClone(known?.satin ?? measureSatin(p, part, kinds)) };
  return { kind: 'run', s: measureRun(p, part) };
}

/** Thread pieces (x0, y0, x1, y1 in 0.1 mm) between consecutive stitches of records a to b. */
function segments(p: Pattern, a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a + 1; i <= b; i++) if (p.cmd[i] === STITCH && p.cmd[i - 1] === STITCH) out.push(p.x[i - 1], p.y[i - 1], p.x[i], p.y[i]);
  return out;
}

/** Grows (`grow`) or shrinks a mask by a square of radius r cells, in place. */
function morph(m: Uint8Array, w: number, h: number, r: number, grow: boolean): void {
  if (r <= 0) return;
  const want = grow ? 1 : 0;
  const line = new Int32Array(Math.max(w, h) + 1);
  const tmp = new Uint8Array(Math.max(w, h));
  const pass = (n: number, get: (k: number) => number, set: (k: number, v: number) => void) => {
    line[0] = 0;
    for (let k = 0; k < n; k++) line[k + 1] = line[k] + (get(k) === want ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const hit = line[Math.min(n, k + r + 1)] - line[Math.max(0, k - r)] > 0;
      tmp[k] = hit ? want : 1 - want;
    }
    for (let k = 0; k < n; k++) set(k, tmp[k]);
  };
  for (let y = 0; y < h; y++) {
    const o = y * w;
    pass(w, (k) => m[o + k], (k, v) => (m[o + k] = v));
  }
  for (let x = 0; x < w; x++) pass(h, (k) => m[k * w + x], (k, v) => (m[k * w + x] = v));
}

/** Calls `cb` for sample points along each piece with the thread length each stands for. */
function walk(segs: number[], cb: (x: number, y: number, len: number, seg: number) => void): void {
  for (let s = 0; s < segs.length; s += 4) {
    const [x0, y0, x1, y1] = [segs[s], segs[s + 1], segs[s + 2], segs[s + 3]];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len / STEP));
    for (let k = 0; k <= n; k++) cb(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, k === 0 ? 0 : len / n, s);
  }
}

/** Old and new stitches compared (pieces as from `segments`; `gap` the row spacing in mm). */
export function compareStitches(old: number[], neu: number[], gap: number): Fidelity {
  const close = Math.round(Math.min(MAX_GAP, Math.max(MIN_GAP, gap)) * 5) / CELL;
  const pad = THREAD + close + 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const segs of [old, neu])
    for (let k = 0; k < segs.length; k += 2) {
      minX = Math.min(minX, segs[k]);
      maxX = Math.max(maxX, segs[k]);
      minY = Math.min(minY, segs[k + 1]);
      maxY = Math.max(maxY, segs[k + 1]);
    }
  const x0 = Math.floor(minX / CELL) - pad;
  const y0 = Math.floor(minY / CELL) - pad;
  const w = Math.floor(maxX / CELL) - x0 + pad + 1;
  const h = Math.floor(maxY / CELL) - y0 + pad + 1;
  const cellOf = (x: number, y: number) => Math.floor(y / CELL - y0) * w + Math.floor(x / CELL - x0);
  const cover = (segs: number[]) => {
    const m = new Uint8Array(w * h);
    walk(segs, (x, y) => (m[cellOf(x, y)] = 1));
    morph(m, w, h, THREAD + close, true);
    morph(m, w, h, close, false);
    return m;
  };
  const a = cover(old);
  const b = cover(neu);
  let both = 0;
  let either = 0;
  for (let k = 0; k < a.length; k++) {
    both += a[k] & b[k];
    either += a[k] | b[k];
  }
  const area = either ? both / either : 0;
  // Thread inside the shared area.
  const inside = (segs: number[]) => {
    let len = 0;
    walk(segs, (x, y, l) => {
      const c = cellOf(x, y);
      if (a[c] & b[c]) len += l;
    });
    return len;
  };
  const lo = inside(old);
  const ln = inside(neu);
  const ratio = lo > 0 ? ln / lo : ln > 0 ? Infinity : 1;
  const density = ratio > 0 && Number.isFinite(ratio) ? Math.min(ratio, 1 / ratio) : 0;
  const direction = directionAgreement(old, neu);
  const score = direction === null ? area ** (2 / 3) * density ** (1 / 3) : area ** 0.5 * density ** 0.25 * direction ** 0.25;
  return { area, density, ratio, direction, score };
}

/** Mean doubled-angle vector of the long stitches per direction cell (key: cell, value: [cos, sin]). */
function directions(segs: number[]): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  walk(segs, (x, y, len, s) => {
    if (!len) return;
    const dx = segs[s + 2] - segs[s];
    const dy = segs[s + 3] - segs[s + 1];
    if (dx * dx + dy * dy < LONG * LONG) return;
    const t = 2 * Math.atan2(dy, dx);
    const key = Math.floor(y / DIR_CELL) * 100003 + Math.floor(x / DIR_CELL);
    const v = out.get(key) ?? [0, 0];
    v[0] += Math.cos(t) * len;
    v[1] += Math.sin(t) * len;
    out.set(key, v);
  });
  return out;
}

/** Mean cosine of the angle between old and new long stitches over the cells both have them in. */
function directionAgreement(old: number[], neu: number[]): number | null {
  const a = directions(old);
  const b = directions(neu);
  let sum = 0;
  let n = 0;
  for (const [key, u] of a) {
    const v = b.get(key);
    if (!v || !Math.hypot(...u) || !Math.hypot(...v)) continue;
    // Angle between the doubled angles, halved: 0 to 90 degrees between the stitch lines.
    let d = Math.abs(Math.atan2(u[1], u[0]) - Math.atan2(v[1], v[0]));
    if (d > Math.PI) d = 2 * Math.PI - d;
    sum += Math.cos(d / 2);
    n++;
  }
  return n ? sum / n : null;
}

/** The row spacing that closes an object's rows into an area (mm). */
function gapOf(s: Settings): number {
  if (s.kind === 'fill') return Math.max(s.s.spacing, s.s.spacingEnd || 0);
  if (s.kind === 'satin') return s.s.spacing;
  return 0;
}

/**
 * How true object `o` of `p` is to its stitches (see Fidelity), or null when it cannot be sewn
 * anew (no settings, no shape found, or no stitches). `objs` and `kinds` are the design's objects
 * and stitch kinds as the app has them (sewObjects, stitchKinds).
 */
export function fidelity(p: Pattern, objs: SewObject[], o: SewObject, kinds: Uint8Array, trimMm = TRIM_MM): Fidelity | null {
  let byKey = cache.get(p);
  if (!byKey) cache.set(p, (byKey = new Map()));
  const key = `${objectKey(p, o)}:${trimMm}`;
  if (byKey.has(key)) return byKey.get(key)!;
  const out = measure(p, objs, o, kinds, trimMm);
  byKey.set(key, out);
  return out;
}

function measure(p: Pattern, objs: SewObject[], o: SewObject, kinds: Uint8Array, trimMm: number): Fidelity | null {
  let s: Settings | null = null;
  let r;
  try {
    r = restitch(p, objs, [o.index], (x, an, known) => (s = settingsOf(p, x, an, known, kinds)), kinds, trimMm);
  } catch {
    return null;
  }
  if (!s || r.failed.includes(o.index) || !r.starts.length || r.ends[0] <= r.starts[0]) return null;
  const q = r.pattern;
  // Records of the first and last new stitch.
  let first = -1;
  let last = -1;
  let n = 0;
  for (let i = 0; i < q.cmd.length && n < r.ends[0]; i++) {
    if (q.cmd[i] !== STITCH) continue;
    if (n === r.starts[0]) first = i;
    last = i;
    n++;
  }
  if (first < 0) return null;
  const old = segments(p, o.first, o.last);
  const neu = segments(q, first, last);
  if (!old.length || !neu.length) return null;
  return compareStitches(old, neu, gapOf(s as Settings));
}
