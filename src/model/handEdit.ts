import type { Pattern } from './pattern';
import { rememberObjects, sewObjects, type SewObject } from './objects';
import { keepShape, remember } from './restitch';
import { recordOfStitch, stitchKinds, stitchNumbers } from './sequence';

/** What a hand edit did, so the objects it touched can keep what they remember. */
export type HandChange = { moved: number[] } | { removed: number[] } | { inserted: number };

/** The objects of a pattern as the caller has them (cached), or as worked out here. */
export interface ObjectView {
  objects: SewObject[];
  /** Object of each record (-1 between objects). */
  objectAt: Int32Array;
  /** Stitch records up to and including each record (see `stitchNumbers`). */
  numbers: Uint32Array;
  kinds: Uint8Array;
}

export function objectView(p: Pattern): ObjectView {
  const kinds = stitchKinds(p);
  const objects = sewObjects(p, kinds);
  const objectAt = new Int32Array(p.cmd.length).fill(-1);
  for (const o of objects) objectAt.fill(o.index, o.first, o.last + 1);
  return { objects, objectAt, numbers: stitchNumbers(p), kinds };
}

/**
 * After a change made point by point (`p` became `next`), the objects it touched stay what they
 * were: grouped from the same sections, with the same shape and settings (read from the stitches
 * before the first change by hand, so moving a point does not move the shape), and the number of
 * changes by hand counted. Returns, per touched object of `p`, its index in `next` (-1: gone).
 * `view` gives the objects of a pattern; it is asked for `next` only after its grouping is set.
 */
export function keepObjects(p: Pattern, next: Pattern, change: HandChange, view: (x: Pattern) => ObjectView = objectView): Map<number, number> {
  const q = view(p);
  // Records touched in `p` (an inserted point splits the stitch that ends at its index).
  const touched = 'moved' in change ? change.moved : 'removed' in change ? change.removed : [change.inserted];
  const counts = new Map<number, number>();
  for (const i of touched) {
    const o = q.objectAt[i] ?? -1;
    if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  // Stitch numbers (from 0) in `p`, and where they are in `next`.
  const num = (i: number) => q.numbers[i] - 1;
  const removed = 'removed' in change ? change.removed.map(num).sort((a, b) => a - b) : [];
  const inserted = 'inserted' in change ? num(change.inserted) : -1;
  const map = (n: number) => {
    if (inserted >= 0) return n >= inserted ? n + 1 : n;
    let k = 0;
    while (k < removed.length && removed[k] < n) k++;
    return n - k;
  };
  const kept = [...counts].map(([o, n]) => {
    const obj = q.objects[o];
    const after = q.objects[o + 1];
    const r = keepShape(p, obj, q.kinds);
    return { o, r: { ...r, hand: (r.hand ?? 0) + n }, start: map(num(obj.first)), end: after ? map(num(after.first)) : Infinity };
  });
  // The sections stay grouped as they were (and the object after does not join this one).
  for (const k of kept) if (k.end > k.start) rememberObjects(next, k.end === Infinity ? [k.start] : [k.start, k.end], k.end + 1);
  const nq = view(next);
  const out = new Map<number, number>();
  for (const k of kept) {
    const o = k.end > k.start ? nq.objectAt[recordOfStitch(nq.numbers, k.start + 1)] : -1;
    if (o >= 0) remember(next, nq.objects[o], k.r);
    out.set(k.o, o);
  }
  return out;
}
