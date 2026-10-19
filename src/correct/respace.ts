import { computeBounds, nextVersion, type Pattern } from '../model/pattern';
import { tidy } from '../model/edit';
import { core } from '../wasm/core';

/**
 * Re-spaces fill rows evenly at a wider spacing.
 *
 * Lowering the density of a fill is a matter of row spacing: a fill at 0.4 mm has 2.5 mm thread per
 * mm², at 0.5 mm 2.0. Dropping single rows (what the first version did) leaves stripes of double
 * spacing that show on the fabric. Instead the sweep is rebuilt: the row ends of the original are
 * the outline of the shape on either side, new rows are laid between them at even spacing, and the
 * stitches inside each row follow the stitch length and stagger of the original rows. The first and
 * last stitch stay where they are, so the sweep connects to the rest of the design as before.
 * Satin columns are re-spaced the same way: each edge resampled evenly, both with as many
 * penetrations. Sweeps need 6 rows and rows of 3 mm, columns 8 penetrations; a gain below 5 % is
 * not worth it. Rebuilt in the Rust core (core/src/correct/respace.rs), one call per design.
 */

export interface RespaceOptions {
  /** Share (0 to 1) by which the density around record i should drop; 0 where nothing should change. */
  needAt: (i: number) => number;
  /** Widest row spacing allowed (0.1 mm), from the material's recommended range. */
  maxSpacing: number;
  /** Share of a sweep's rows that must be asked to change before the whole sweep is re-spaced. */
  minShare?: number;
}

export interface RespaceResult {
  pattern: Pattern;
  sweeps: number;
  /** Rows removed in total (the remaining rows are spread evenly). */
  rows: number;
}

/** The version of `p` with the records the core rebuilt, tidied. */
function respaced(p: Pattern, r: { a: number; b: number; takeX(): Int32Array; takeY(): Int32Array; takeCmd(): Uint8Array; free(): void }): RespaceResult {
  try {
    if (!r.a) return { pattern: p, sweeps: 0, rows: 0 };
    const x = r.takeX();
    const y = r.takeY();
    const cmd = r.takeCmd();
    return { pattern: tidy(nextVersion(p, { x, y, cmd, bounds: computeBounds(x, y, cmd) })), sweeps: r.a, rows: r.b };
  } finally {
    r.free();
  }
}

/** The need at every record. */
function needs(p: Pattern, needAt: (i: number) => number): Float64Array {
  const out = new Float64Array(p.cmd.length);
  for (let i = 0; i < out.length; i++) out[i] = needAt(i);
  return out;
}

export function respaceFills(p: Pattern, opts: RespaceOptions): RespaceResult {
  return respaced(p, core().respaceFills(p.x, p.y, p.cmd, needs(p, opts.needAt), opts.maxSpacing, opts.minShare ?? 0.25));
}

/**
 * Re-spaces satin columns evenly: the penetrations along each edge are resampled at a wider,
 * even spacing (removing single zigzags would leave visible gaps in the column). Each edge keeps
 * its shape, both edges keep the same number of penetrations so the column still turns as before,
 * and the first and last penetration stay.
 */
export function respaceSatins(p: Pattern, opts: RespaceOptions, columns: { start: number; end: number }[]): RespaceResult {
  const cols = Uint32Array.from(columns.flatMap((c) => [c.start, c.end]));
  return respaced(p, core().respaceSatins(p.x, p.y, p.cmd, needs(p, opts.needAt), opts.maxSpacing, opts.minShare ?? 0.25, cols));
}
