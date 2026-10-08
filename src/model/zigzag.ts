import type { Pt } from '../digitize/skeleton';

/**
 * Fills whose rows zigzag (the knit look of many bought designs): the needle runs along a row in
 * slanted stitches that turn sharply left and right, so every stitch crosses the row at a large
 * angle and the row runs along the line through the middles of its stitches. Rows lie close
 * beside each other and their peaks line up across the rows, so the stitches form chevrons.
 *
 * Read from the stitches, the rows keep their course, height, period and peaks when the fill is
 * sewn again ("Wie bisher"), instead of each slanted stitch being taken for a row of its own.
 */

/** Rows read from zigzagging stitches. */
export interface Zigzag {
  /** Direction the rows run (degrees, -90 to 90); the normal (this turned by +90 degrees) points to the high peaks. */
  angle: number;
  /** Rows run straight (one direction all over), so their peaks can be laid out again exactly. */
  straight: boolean;
  /** From the low to the high peaks of a row, across it (mm). */
  height: number;
  /**
   * Where the peaks lie: at points q with wave · q = phase (radians, modulo 2 pi) the high peaks
   * (on the side of the normal, the direction turned by +90 degrees), half a turn on the low ones.
   */
  wave: Pt;
  phase: number;
  /** Distance from row to row (mm). */
  spacing: number;
  /** Length of a slanted stitch (mm). */
  stitch: number;
  /** The first stitch in a zigzag: its run and the point it ends at. */
  first: [number, number];
  /** Thread in zigzags (mm). */
  thread: number;
}

/** Stitches shorter than this are travel or turns, not part of a row (mm). */
const LONG = 0.8;
/** Two stitches turn sharply at a zigzag peak: more than this between their directions (degrees). */
const TURN = 45;
/** Share of the thread of the long stitches in zigzags for the fill to read as zigzag rows. */
const ZIG_SHARE = 0.6;
/** The middles of the stitches keep one direction this well (1 is all the same) for straight rows. */
const STRAIGHT = 0.9;
/** Heights and half periods spread this little (interquartile range over median) for even rows. */
const EVEN = 0.35;
/** Share of the peaks that line up across the rows (the length of their mean wave). */
const ALIGNED = 0.5;

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const len = (v: Pt) => Math.hypot(v[0], v[1]);
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (at - lo);
}

/**
 * Whether the stitches a to b and b to c turn at b as a zigzag peak: both long, sharply turned,
 * and the needle still moves on along the row (not back beside it, as a satin does).
 */
function peak(a: Pt, b: Pt, c: Pt): boolean {
  const u = sub(b, a);
  const v = sub(c, b);
  const lu = len(u);
  const lv = len(v);
  if (lu < LONG || lv < LONG) return false;
  const cos = (u[0] * v[0] + u[1] * v[1]) / (lu * lv);
  if (cos > Math.cos((TURN * Math.PI) / 180)) return false;
  return len(sub(c, a)) >= Math.max(LONG, 0.35 * (lu + lv));
}

/**
 * The lines a fill's rows follow, from runs of consecutive needle points (mm): each long stitch,
 * but in zigzag rows (`zigzag`) where stitches zigzag the line from the middle of one to the
 * middle of the next (the row's course, not the slant of its stitches).
 */
export function rowLines(runs: Pt[][], zigzag: boolean): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  for (const run of runs) {
    const zig = run.map((_, i) => zigzag && i > 0 && i < run.length - 1 && peak(run[i - 1], run[i], run[i + 1]));
    for (let i = 1; i < run.length; i++) {
      if (zig[i]) out.push([mid(run[i - 1], run[i]), mid(run[i], run[i + 1])]);
      else if (!zig[i - 1] && len(sub(run[i], run[i - 1])) >= LONG) out.push([run[i - 1], run[i]]);
    }
  }
  return out;
}

/**
 * The zigzag rows of a fill, from runs of consecutive needle points (mm), or null when most of
 * its thread is not in zigzags of an even height and period.
 */
export function zigzagOf(runs: Pt[][]): Zigzag | null {
  let thread = 0;
  for (const run of runs) for (let i = 1; i < run.length; i++) if (len(sub(run[i], run[i - 1])) >= LONG) thread += len(sub(run[i], run[i - 1]));
  // Peaks: a needle point between two stitches that turn sharply, with the course through it.
  const peaks: { b: Pt; course: Pt; side: Pt; ab: Pt; bc: Pt }[] = [];
  const inZig = new Set<string>();
  let zigThread = 0;
  runs.forEach((run, r) => {
    for (let i = 1; i < run.length - 1; i++) {
      if (!peak(run[i - 1], run[i], run[i + 1])) continue;
      peaks.push({ b: run[i], course: sub(run[i + 1], run[i - 1]), side: sub(run[i], mid(run[i - 1], run[i + 1])), ab: sub(run[i], run[i - 1]), bc: sub(run[i + 1], run[i]) });
      for (const k of [i, i + 1]) {
        const key = `${r}:${k}`;
        if (inZig.has(key)) continue;
        inZig.add(key);
        zigThread += len(sub(run[k], run[k - 1]));
      }
    }
  });
  if (peaks.length < 8 || zigThread < thread * ZIG_SHARE) return null;
  const first = [...inZig].map((k) => k.split(':').map(Number) as [number, number]).reduce((a, b) => (b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]) ? b : a));
  // The course: the mean direction of the lines through the stitch middles (doubled angles).
  const courseOf = (list: typeof peaks) => {
    let cx = 0;
    let cy = 0;
    let w = 0;
    for (const { course } of list) {
      const l = len(course);
      const t = Math.atan2(course[1], course[0]);
      cx += l * Math.cos(2 * t);
      cy += l * Math.sin(2 * t);
      w += l;
    }
    return { main: Math.atan2(cy, cx) / 2, even: Math.hypot(cx, cy) / w };
  };
  const frame = (main: number) => {
    const e: Pt = [Math.cos(main), Math.sin(main)];
    return { e, n: [-e[1], e[0]] as Pt };
  };
  // Height and half period from the stitches between peaks (across and along the course).
  let { e, n } = frame(courseOf(peaks).main);
  const across: number[] = [];
  const along: number[] = [];
  runs.forEach((run, r) => {
    for (let k = 1; k < run.length; k++) {
      if (!inZig.has(`${r}:${k}`)) continue;
      const d = sub(run[k], run[k - 1]);
      across.push(Math.abs(d[0] * n[0] + d[1] * n[1]));
      along.push(Math.abs(d[0] * e[0] + d[1] * e[1]));
    }
  });
  let height = quantile(across, 0.5);
  let half = quantile(along, 0.5);
  const spread = (xs: number[], m: number) => (quantile(xs, 0.75) - quantile(xs, 0.25)) / m;
  if (!(height > LONG / 2 && half > 0.2) || spread(across, height) > EVEN || spread(along, half) > EVEN) return null;
  // Then from whole peaks only: where a row ends on the edge, its last stitch is cut short, and
  // turns along the edge are no peaks of the rows. Means, not medians: needle points lie on a
  // 0.1 mm grid in the files, and only a mean of many evens that out.
  const whole = (d: Pt) => Math.abs(Math.abs(d[0] * e[0] + d[1] * e[1]) / half - 1) < 0.25 && Math.abs(Math.abs(d[0] * n[0] + d[1] * n[1]) / height - 1) < 0.25;
  const good = peaks.filter((q) => whole(q.ab) && whole(q.bc));
  if (good.length < 8) return null;
  const course = courseOf(good);
  ({ e, n } = frame(course.main));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  height = mean(good.map((q) => Math.abs(q.ab[0] * n[0] + q.ab[1] * n[1])));
  half = mean(good.map((q) => Math.abs(q.ab[0] * e[0] + q.ab[1] * e[1])));
  const slant = mean(good.map((q) => len(q.ab)));
  // Where the peaks lie: a plane wave over the area whose crests are the high peaks and whose
  // troughs are the low ones (the strongest one near a period along the course, found by a
  // narrowing search). Its crests need not cross the rows square: the peaks line up as they do.
  const high = good.map((q) => q.side[0] * n[0] + q.side[1] * n[1] >= 0);
  const power = (k: Pt) => {
    let re = 0;
    let im = 0;
    good.forEach((q, j) => {
      const a = k[0] * q.b[0] + k[1] * q.b[1];
      const sg = high[j] ? 1 : -1;
      re += sg * Math.cos(a);
      im += sg * Math.sin(a);
    });
    return { re, im, p: re * re + im * im };
  };
  let wave: Pt = [(Math.PI / half) * e[0], (Math.PI / half) * e[1]];
  let step = (Math.PI / half) * 0.05;
  for (let round = 0; round < 12; round++, step /= 2) {
    let best = wave;
    let bp = power(wave).p;
    for (let i = -2; i <= 2; i++)
      for (let j = -2; j <= 2; j++) {
        const k: Pt = [wave[0] + i * step, wave[1] + j * step];
        const q = power(k).p;
        if (q > bp) {
          bp = q;
          best = k;
        }
      }
    wave = best;
  }
  const w = power(wave);
  // The peaks must line up across the rows for the rows to be laid out again as they were.
  if (Math.sqrt(w.p) < good.length * ALIGNED) return null;
  const phase = Math.atan2(w.im, w.re);
  // Row spacing: rows follow each other back and forth; the middle of each row across the course,
  // one row to the next.
  const centers: number[] = [];
  for (const run of runs) {
    let sum = 0;
    let cnt = 0;
    let dir = 0;
    const flush = () => {
      if (cnt >= 3) centers.push(sum / cnt);
      sum = 0;
      cnt = 0;
    };
    for (let i = 1; i < run.length; i++) {
      const d = sub(run[i], run[i - 1]);
      const fwd = d[0] * e[0] + d[1] * e[1];
      const s = Math.abs(fwd) < 0.2 ? dir : Math.sign(fwd);
      if (s !== dir) {
        flush();
        dir = s;
      }
      const m = mid(run[i - 1], run[i]);
      sum += m[0] * n[0] + m[1] * n[1];
      cnt++;
    }
    flush();
  }
  const gaps: number[] = [];
  for (let k = 1; k < centers.length; k++) {
    const g = Math.abs(centers[k] - centers[k - 1]);
    if (g > 0.1 && g < Math.max(2, height)) gaps.push(g);
  }
  const spacing = quantile(gaps, 0.5);
  if (!(spacing > 0)) return null;
  return { angle: (course.main * 180) / Math.PI, straight: course.even >= STRAIGHT, height, wave, phase, spacing, stitch: slant, first, thread: zigThread };
}
