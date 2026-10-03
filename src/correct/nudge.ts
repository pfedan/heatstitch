import { syncMarks, withRecords } from '../model/edit';
import { STITCH, type Pattern } from '../model/pattern';

export interface NudgeOptions {
  /** Penetrations that may move. */
  movable: (i: number) => boolean;
  /** Penetrations closer than this (0.1 mm) push each other apart. */
  radius: number;
  /** No penetration moves further than this from where it was (0.1 mm). */
  maxShift: number;
  iterations?: number;
}

/**
 * Pushes crowded penetrations apart, by at most `maxShift`. Each movable penetration is repelled by
 * every other penetration within `radius`, more strongly the closer it is; two penetrations in the
 * same hole separate sideways to the stitch direction. This separates stacked holes (two layers
 * hitting the same spot, the classic same-hole problem) and relieves perforation at stacked edges.
 * It does not lower the thread per area; only thinning does.
 */
export function nudgePenetrations(p: Pattern, opts: NudgeOptions): { pattern: Pattern; moved: number } {
  const n = p.cmd.length;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (p.cmd[i] === STITCH) idx.push(i);
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    fx[i] = p.x[i];
    fy[i] = p.y[i];
  }
  const r = opts.radius;
  const movable = idx.filter((i) => opts.movable(i));
  if (!movable.length) return { pattern: p, moved: 0 };
  const key = (bx: number, by: number) => bx * 1_000_003 + by;

  for (let it = 0; it < (opts.iterations ?? 12); it++) {
    const buckets = new Map<number, number[]>();
    for (const i of idx) {
      const k = key(Math.floor(fx[i] / r), Math.floor(fy[i] / r));
      const b = buckets.get(k);
      if (b) b.push(i);
      else buckets.set(k, [i]);
    }
    const mx = new Float64Array(movable.length);
    const my = new Float64Array(movable.length);
    movable.forEach((i, m) => {
      const bx = Math.floor(fx[i] / r);
      const by = Math.floor(fy[i] / r);
      let sx = 0;
      let sy = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const j of buckets.get(key(bx + dx, by + dy)) ?? []) {
            if (j === i) continue;
            const ex = fx[i] - fx[j];
            const ey = fy[i] - fy[j];
            const d = Math.hypot(ex, ey);
            if (d >= r) continue;
            const w = (r - d) / r;
            if (d < 0.5) {
              // Same hole: move sideways to the local stitch direction, the later stitch to the left.
              const a = Math.max(0, i - 1);
              const b = Math.min(n - 1, i + 1);
              let tx = fx[b] - fx[a];
              let ty = fy[b] - fy[a];
              const tl = Math.hypot(tx, ty) || 1;
              tx /= tl;
              ty /= tl;
              const side = i > j ? 1 : -1;
              sx += -ty * side * w;
              sy += tx * side * w;
            } else {
              sx += (ex / d) * w;
              sy += (ey / d) * w;
            }
          }
        }
      }
      // At most 0.1 mm per iteration keeps the relaxation stable.
      const l = Math.hypot(sx, sy);
      const step = Math.min(1, l * 0.5);
      mx[m] = l ? (sx / l) * step : 0;
      my[m] = l ? (sy / l) * step : 0;
    });
    movable.forEach((i, m) => {
      let nx = fx[i] + mx[m];
      let ny = fy[i] + my[m];
      const ox = nx - p.x[i];
      const oy = ny - p.y[i];
      const o = Math.hypot(ox, oy);
      if (o > opts.maxShift) {
        nx = p.x[i] + (ox / o) * opts.maxShift;
        ny = p.y[i] + (oy / o) * opts.maxShift;
      }
      fx[i] = nx;
      fy[i] = ny;
    });
  }

  const x = p.x.slice();
  const y = p.y.slice();
  let moved = 0;
  for (const i of movable) {
    const nx = Math.round(fx[i]);
    const ny = Math.round(fy[i]);
    if (nx !== x[i] || ny !== y[i]) moved++;
    x[i] = nx;
    y[i] = ny;
  }
  if (!moved) return { pattern: p, moved: 0 };
  syncMarks(x, y, p.cmd);
  return { pattern: withRecords(p, x, y, p.cmd.slice()), moved };
}

/**
 * Penetrations that share a hole (closer than `within`, 0.1 mm) with a penetration more than four
 * stitches away in the same run, or in another run. Lock stitches and bean stitches revisit their
 * holes within a few stitches on purpose and are skipped.
 */
export function sameHoleStitches(p: Pattern, within = 2): Uint8Array {
  const n = p.cmd.length;
  const out = new Uint8Array(n);
  const buckets = new Map<number, number[]>();
  const key = (x: number, y: number) => Math.floor(x / within) * 1_000_003 + Math.floor(y / within);
  for (let i = 0; i < n; i++) {
    if (p.cmd[i] !== STITCH) continue;
    const bx = Math.floor(p.x[i] / within);
    const by = Math.floor(p.y[i] / within);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of buckets.get((bx + dx) * 1_000_003 + by + dy) ?? []) {
          if (i - j <= 4 && p.cmd.subarray(j, i + 1).every((c) => c === STITCH)) continue;
          if (Math.hypot(p.x[i] - p.x[j], p.y[i] - p.y[j]) < within) out[i] = out[j] = 1;
        }
      }
    }
    const k = key(p.x[i], p.y[i]);
    const b = buckets.get(k);
    if (b) b.push(i);
    else buckets.set(k, [i]);
  }
  return out;
}
