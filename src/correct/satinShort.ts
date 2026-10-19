import { withRecords } from '../model/edit';
import type { Pattern } from '../model/pattern';
import { core } from '../wasm/core';
import { wantedMask } from './shorts';

/**
 * Short stitches on the inside of satin curves and corners.
 *
 * Where a satin column turns, its inner edge is shorter than the outer one, so the penetrations
 * there crowd together: thread piles up and the holes can cut the fabric. Digitizing programs
 * counter this with "short stitches": every second stitch on the crowded side stops short of the
 * edge. The outline stays closed (the full-length stitches still reach it) and the inner edge gets
 * half the penetrations. Every second stitch on a side spaced at less than half the other side's
 * stops a quarter of the column width short; computed in the Rust core (core/src/correct/satin_short.rs).
 */

export interface SatinShortOptions {
  /** Penetrations that may move (record index). */
  wanted: (i: number) => boolean;
}

export function shortenSatinCurves(p: Pattern, opts: SatinShortOptions): { pattern: Pattern; moved: number } {
  const r = core().shortenSatinCurves(p.x, p.y, p.cmd, wantedMask(p.cmd.length, opts.wanted));
  try {
    const moved = r.a;
    return moved ? { pattern: withRecords(p, r.takeX(), r.takeY(), p.cmd.slice()), moved } : { pattern: p, moved: 0 };
  } finally {
    r.free();
  }
}
