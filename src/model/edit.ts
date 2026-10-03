import { COLOR_CHANGE, computeBounds, STITCH, TRIM, type Pattern } from './pattern';

/** A copy of `p` with new record arrays; bounds are recomputed. */
export function withRecords(p: Pattern, x: Int32Array, y: Int32Array, cmd: Uint8Array, colors = p.colors): Pattern {
  return { ...p, x, y, cmd, colors, bounds: computeBounds(x, y, cmd) };
}

export function clonePattern(p: Pattern): Pattern {
  return withRecords(p, p.x.slice(), p.y.slice(), p.cmd.slice(), p.colors.map((c) => ({ ...c })));
}

/**
 * Removes every record with `remove[i]` set. Only STITCH records may be removed; the command
 * structure around them (jumps, trims, color changes) stays as it is, so removing a stitch simply
 * joins its neighbours with one longer stitch. The result is tidied (see `tidy`).
 */
export function removeStitches(p: Pattern, remove: Uint8Array): Pattern {
  let n = 0;
  for (let i = 0; i < p.cmd.length; i++) if (!(remove[i] && p.cmd[i] === STITCH)) n++;
  const x = new Int32Array(n);
  const y = new Int32Array(n);
  const cmd = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < p.cmd.length; i++) {
    if (remove[i] && p.cmd[i] === STITCH) continue;
    x[o] = p.x[i];
    y[o] = p.y[i];
    cmd[o++] = p.cmd[i];
  }
  return tidy(withRecords(p, x, y, cmd));
}

/** Moves the given records by (dx, dy) in 0.1 mm. Zero-movement records (trim, color change) follow their predecessor. */
export function moveRecords(p: Pattern, indices: Iterable<number>, dx: number, dy: number): Pattern {
  const x = p.x.slice();
  const y = p.y.slice();
  for (const i of indices) {
    x[i] += dx;
    y[i] += dy;
  }
  syncMarks(x, y, p.cmd);
  return withRecords(p, x, y, p.cmd.slice());
}

/** TRIM and COLOR_CHANGE records carry no movement: keep them on the position of the record before. */
export function syncMarks(x: Int32Array, y: Int32Array, cmd: Uint8Array): void {
  for (let i = 1; i < cmd.length; i++) {
    if (cmd[i] === TRIM || cmd[i] === COLOR_CHANGE) {
      x[i] = x[i - 1];
      y[i] = y[i - 1];
    }
  }
}

/**
 * Keeps the command structure coherent after edits: collapses repeated trims and removes color
 * blocks that no longer hold any stitch (together with their thread color). Positions of
 * zero-movement records are synced.
 */
export function tidy(p: Pattern): Pattern {
  const n = p.cmd.length;
  const keep = new Uint8Array(n).fill(1);
  // Stitches per color block, to find empty blocks.
  const blockStitches: number[] = [0];
  for (let i = 0; i < n; i++) {
    if (p.cmd[i] === COLOR_CHANGE) blockStitches.push(0);
    else if (p.cmd[i] === STITCH) blockStitches[blockStitches.length - 1]++;
  }
  const colors: typeof p.colors = [];
  let block = 0;
  let lastKept = -1;
  for (let i = 0; i < n; i++) {
    const c = p.cmd[i];
    if (c === TRIM && lastKept >= 0 && p.cmd[lastKept] === TRIM) keep[i] = 0;
    else if (c === COLOR_CHANGE) {
      block++;
      // An empty block before this change: drop the change that opened it (or this one for block 0).
      if (blockStitches[block - 1] === 0) keep[i] = 0;
    }
    if (keep[i]) lastKept = i;
  }
  // A trailing empty block: drop the change that opened it.
  if (blockStitches.length > 1 && blockStitches[blockStitches.length - 1] === 0) {
    for (let i = n - 1; i >= 0; i--) {
      if (p.cmd[i] === COLOR_CHANGE && keep[i]) {
        keep[i] = 0;
        break;
      }
    }
  }
  for (let b = 0; b < blockStitches.length; b++) {
    if (blockStitches[b] > 0 || (b === blockStitches.length - 1 && !colors.length)) {
      colors.push(p.colors[b] ?? p.colors[p.colors.length - 1]);
    }
  }
  const changed = keep.some((k) => !k);
  if (!changed && colors.length === p.colors.length) {
    const x = p.x.slice();
    const y = p.y.slice();
    syncMarks(x, y, p.cmd);
    return withRecords(p, x, y, p.cmd);
  }
  const m = keep.reduce((a, k) => a + k, 0);
  const x = new Int32Array(m);
  const y = new Int32Array(m);
  const cmd = new Uint8Array(m);
  let o = 0;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    x[o] = p.x[i];
    y[o] = p.y[i];
    cmd[o++] = p.cmd[i];
  }
  syncMarks(x, y, cmd);
  return withRecords(p, x, y, cmd, colors.length ? colors : p.colors.slice(0, 1));
}

/** Index of the STITCH record nearest to (x, y) (0.1 mm) within `maxDist`, or -1. */
export function nearestStitch(p: Pattern, x: number, y: number, maxDist: number): number {
  let best = -1;
  let bestD = maxDist * maxDist;
  for (let i = 0; i < p.cmd.length; i++) {
    if (p.cmd[i] !== STITCH) continue;
    const dx = p.x[i] - x;
    const dy = p.y[i] - y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** STITCH records inside the rectangle (0.1 mm). */
export function stitchesInRect(p: Pattern, x0: number, y0: number, x1: number, y1: number): number[] {
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0];
  const out: number[] = [];
  for (let i = 0; i < p.cmd.length; i++) {
    if (p.cmd[i] === STITCH && p.x[i] >= ax && p.x[i] <= bx && p.y[i] >= ay && p.y[i] <= by) out.push(i);
  }
  return out;
}
