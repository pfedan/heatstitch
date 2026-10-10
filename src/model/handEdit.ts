import type { Pattern } from './pattern';
import { sewObjects, type SewObject } from './objects';
import { carryOver, keepShape, remember, remembered, type Remembered } from './restitch';
import { partOf } from './shadow';
import { recordOfStitch, stitchKinds, stitchNumbers } from './sequence';
import { geoOf } from './geo';

/** What a hand edit did, so the objects it touched can keep what they remember. */
export type HandChange = { moved: number[] } | { removed: number[] } | { inserted: number; count?: number };

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
/** Whether an object has a shape of its own its stitches can be loosed from (and sewn from again). */
export const loosable = (m: Remembered | undefined): boolean => !!m && !m.read && !m.lettering && !m.outline && !m.blendOf && !partOf(m) && !!(m.region || geoOf(m) || m.columns);

/**
 * After a change made point by point (`p` became `next`), the objects it touched stay what they
 * were (carryOver: the same sections, shape and settings), and an object that remembered nothing
 * yet keeps the shape read from its stitches before the change, so moving a point does not move
 * its area. The changes by hand are counted, and an object with a shape of its own is loosed from
 * it: no setting sews it anew until it is sewn from its shape again. Returns, per touched object of `p`, its index in `next` (-1: gone).
 * `view` gives the objects of a pattern; it is asked for `next` only after its grouping is set.
 */
export function keepObjects(p: Pattern, next: Pattern, change: HandChange, view: (x: Pattern) => ObjectView = objectView): Map<number, number> {
  const q = view(p);
  // Records touched in `p`. New points go in before record `inserted`, after the one before it: they
  // belong to that one's object (at an object's thread end the record after is no longer its own).
  const touched = 'moved' in change ? change.moved : 'removed' in change ? change.removed : [change.inserted];
  const added = 'inserted' in change ? (change.count ?? 1) : 0;
  const counts = new Map<number, number>();
  for (const i of touched) {
    const o = added ? (i > 0 && q.objectAt[i - 1] >= 0 ? q.objectAt[i - 1] : (q.objectAt[i] ?? -1)) : (q.objectAt[i] ?? -1);
    if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + (added || 1));
  }
  // Stitch numbers (from 0) in `p`, and where they are in `next`.
  const num = (i: number) => q.numbers[i] - 1;
  const removed = 'removed' in change ? change.removed.map(num).sort((a, b) => a - b) : [];
  // Stitches before the new points: their number from 0.
  const inserted = 'inserted' in change ? (change.inserted > 0 ? q.numbers[change.inserted - 1] : 0) : -1;
  const map = (n: number) => {
    if (inserted >= 0) return n >= inserted ? n + added : n;
    let k = 0;
    while (k < removed.length && removed[k] < n) k++;
    return n - k;
  };
  const nn = stitchNumbers(next);
  const total = nn.length ? nn[nn.length - 1] : 0;
  const kept = [...counts].map(([o, n]) => {
    const obj = q.objects[o];
    const after = q.objects[o + 1];
    const r = keepShape(p, obj, q.kinds);
    const start = map(num(obj.first));
    const end = after ? map(num(after.first)) : total;
    // Its records in `next`: from its first stitch to its last.
    const range = end > start ? { first: recordOfStitch(nn, start + 1), last: recordOfStitch(nn, end) } : null;
    // The sections stay one object (see carryOver); what it remembers moves along below.
    if (range) carryOver(p, obj, next, range.first, range.last);
    const own = remembered(p, obj);
    // The parts it was sewn in end where they ended, counted in the stitches it has now.
    const s0 = obj.first > 0 ? q.numbers[obj.first - 1] : 0;
    const parts = r.parts
      ?.map((pt) => ({ ...pt, end: map(s0 + pt.end) - map(s0) }))
      .filter((pt, k, all) => pt.end > (k ? all[k - 1].end : 0));
    const mem = { ...r, ...(parts ? { parts } : {}), hand: (r.hand ?? 0) + n, ...(loosable(own) ? { free: true } : {}) };
    return { o, r: mem, range };
  });
  const nq = view(next);
  const out = new Map<number, number>();
  for (const k of kept) {
    const o = k.range ? nq.objectAt[k.range.first] : -1;
    if (o >= 0) remember(next, nq.objects[o], k.r);
    out.set(k.o, o);
  }
  return out;
}
