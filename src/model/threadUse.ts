import { formatNumber } from '../i18n';
import type { FabricId } from '../material/fabrics';
import { COLOR_CHANGE, STITCH, TRIM, type Pattern } from './pattern';
import { blockIndex, SATIN, stitchKinds } from './sequence';

/**
 * How much thread a design uses, estimated: more than the length of its stitches on the fabric.
 *
 * Each stitch (penetration to penetration, `d` mm) of a lockstitch takes `2d + 2t` of thread over a
 * fabric `t` mm thick (with its backing): the top thread goes down through the fabric and back up
 * (ZSK BasePac adds twice the material thickness to the top thread per stitch), the two threads meet
 * under the fabric. Where they meet sets the share: the top thread is pulled `a` mm under on each side,
 * so the top takes `d + 2t + 2a` and the bobbin `d - 2a`. A satin shows a third of bobbin in the middle
 * of its back (the tension rule of Madeira and others: a = d / 3); fills and running stitch lock
 * close to the needle hole (a = 0.25 mm, a third of the stitch at most). For 4 mm stitches on thin
 * fabric that is 5 m top and 3.5 m bobbin per 1000 stitches, the rule of thumb thread makers give.
 * A jump that is not cut lies on the fabric as a long stitch. Each start after a cut (and the very
 * first) leaves a tail: 35 mm top (the thread in the needle and the end cut off), 5 mm bobbin.
 *
 * Rough by nature: tension, thread and machine change it by tens of percent.
 */
export interface ThreadUse {
  /** Top thread per color block (mm). */
  top: number[];
  /** All top thread (mm). */
  topTotal: number;
  /** All bobbin thread (mm). */
  bobbin: number;
}

/** Thickness of fabric and backing as the needle meets it (mm), by fabric: typical values, not measured. */
export const FABRIC_THICK: Record<FabricId, number> = {
  woven: 0.4,
  woven_heavy: 0.9,
  cap: 1.5,
  knit: 0.7,
  fleece: 1.5,
  terry: 2,
  light: 0.3,
  sheer: 0.2,
  leather: 1,
};

/** Meters as shown: one decimal below 10 m, whole meters above. */
export const threadMeters = (mm: number): string => formatNumber(mm / 1000, mm < 10000 ? 1 : 0);

const TAIL_TOP = 35;
const TAIL_BOBBIN = 5;
const LOCK = 0.25;

const cache = new WeakMap<Pattern, Map<string, ThreadUse>>();

/** The thread `p` uses on `fabric` (see ThreadUse). */
export function threadUse(p: Pattern, fabric: FabricId): ThreadUse {
  let byFabric = cache.get(p);
  if (!byFabric) cache.set(p, (byFabric = new Map()));
  const known = byFabric.get(fabric);
  if (known) return known;
  const t = FABRIC_THICK[fabric] ?? FABRIC_THICK.woven;
  const kinds = stitchKinds(p);
  const blocks = blockIndex(p);
  const top: number[] = [];
  let bobbin = 0;
  const add = (b: number, mm: number) => (top[b] = (top[b] ?? 0) + mm);
  let cut = true;
  let last = -1;
  for (let i = 0; i < p.cmd.length; i++) {
    const c = p.cmd[i];
    if (c === TRIM || c === COLOR_CHANGE) {
      cut = true;
      continue;
    }
    if (c !== STITCH) continue;
    if (cut) {
      // A fresh start: the tails of the thread.
      add(blocks[i], TAIL_TOP);
      bobbin += TAIL_BOBBIN;
      cut = false;
    } else if (last >= 0) {
      const d = Math.hypot(p.x[i] - p.x[last], p.y[i] - p.y[last]) / 10;
      const a = kinds[i] === SATIN ? d / 3 : Math.min(LOCK, d / 3);
      add(blocks[i], d + 2 * t + 2 * a);
      bobbin += d - 2 * a;
    }
    last = i;
  }
  // The blocks as colorBlocks counts them: one for each color, also one without stitches.
  const n = Math.max(1, (p.colors?.length ?? 0), top.length);
  const out: ThreadUse = { top: Array.from({ length: n }, (_, k) => top[k] ?? 0), topTotal: top.reduce((s, v) => s + (v ?? 0), 0), bobbin };
  byFabric.set(fabric, out);
  return out;
}

/** The top thread of records `first` to `last` of `p` (mm), without tails: what one object takes. */
export function threadOfRange(p: Pattern, fabric: FabricId, first: number, last: number): number {
  const t = FABRIC_THICK[fabric] ?? FABRIC_THICK.woven;
  const kinds = stitchKinds(p);
  let mm = 0;
  let prev = -1;
  for (let i = first; i <= last; i++) {
    const c = p.cmd[i];
    if (c === TRIM || c === COLOR_CHANGE) prev = -1;
    if (c !== STITCH) continue;
    if (prev >= 0) {
      const d = Math.hypot(p.x[i] - p.x[prev], p.y[i] - p.y[prev]) / 10;
      mm += d + 2 * t + 2 * (kinds[i] === SATIN ? d / 3 : Math.min(LOCK, d / 3));
    }
    prev = i;
  }
  return mm;
}
