import { core } from '../wasm/core';
import type { Hoop } from '../model/hoop';
import type { Pattern } from '../model/pattern';
import type { OutputFormat } from './index';

/**
 * Writes `p` as `format` with the core (core/src/writers). The name goes NFKD-normalized, so the
 * header labels can drop accents without Unicode tables in the core.
 */
export function writeWithCore(format: OutputFormat, p: Pattern, options: { hoop?: Hoop | null; stamp?: string } = {}): Uint8Array {
  const o: { hoop?: Hoop; stamp?: string } = {};
  if (options.hoop) o.hoop = { w: options.hoop.w, h: options.hoop.h };
  if (options.stamp !== undefined) o.stamp = options.stamp;
  return core().writeFormat(format, p.x, p.y, p.cmd, p.colors, (p.name ?? '').normalize('NFKD'), o);
}

/**
 * Splits a move into the fewest equal-ish pieces whose components stay within ±max.
 * Always returns at least one piece (a zero move stays one zero piece).
 */
export function splitMove(dx: number, dy: number, max: number): [number, number][] {
  const flat = core().splitMove(dx, dy, max);
  const out: [number, number][] = [];
  for (let k = 0; k < flat.length; k += 2) out.push([flat[k], flat[k + 1]]);
  return out;
}
