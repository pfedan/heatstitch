import { withRecords } from '../../model/edit';
import { sewObjects } from '../../model/objects';
import type { Pattern } from '../../model/pattern';
import { forget, holdMemory, remembered, rememberedIn, restoreRemembered, type Remembered, type StoredObject } from '../../model/restitch';
import type { Profile } from '../../validation/profiles';
import type { FixTarget } from './cells';
import { planFix, type FixOptions, type FixResult } from './solve';
import { designKey } from './units';

/**
 * A fix worked out ahead (in the worker, after loading and after each change) and applied with one
 * click. Planning changes nothing: what the tries teach the object memory is put back afterwards,
 * and what the result's objects remember is kept with the result, so applying it is exact and
 * instant. Each object a fix changes keeps how it was before, in its own memory (that is, in the
 * design's version, not on the side): "Korrektur zurücknehmen" puts exactly that back, stitch for
 * stitch, also after other changes elsewhere, as long as the object itself was not changed again.
 */

export interface PlannedFix extends FixResult {
  /** Key of the design the fix was worked out on: a fix applies only to it. */
  base: string;
  /** What the objects of the result remember, as stored (it can cross to and from a worker). */
  memory: StoredObject[];
}

export { designKey };

/** Works out a fix without changing anything (see planFix). */
export async function prepareFix(p: Pattern, profile: Profile, kind: FixTarget, opt: FixOptions): Promise<PlannedFix> {
  const release = holdMemory();
  try {
    const r = await planFix(p, profile, kind, opt);
    return { ...r, base: designKey(p), memory: r.pattern === p ? [] : rememberedIn(r.pattern, sewObjects(r.pattern)) };
  } finally {
    release();
  }
}

/**
 * The design with fix `f` applied; null when the design is no longer the one it was worked out on
 * (then it is worked out again). The changed objects remember what was changed and how they were.
 */
export function applyFix(p: Pattern, f: PlannedFix): Pattern | null {
  if (designKey(p) !== f.base) return null;
  if (!f.objects.length) return p;
  const before = sewObjects(p);
  const after = sewObjects(f.pattern);
  restoreRemembered(f.memory);
  for (const x of f.objects) {
    const o = before[x.index];
    const was = remembered(p, o);
    const now = remembered(f.pattern, after[x.index]) ?? { region: null };
    // A fix on a fix: the first "before" stays, so taking it back goes to the original.
    // With the travel to it: sewing anew also moves where the jump to the object lands.
    const from = x.index ? before[x.index - 1].last + 1 : 0;
    const undo = was?.undo ?? { x: p.x.slice(from, o.last + 1), y: p.y.slice(from, o.last + 1), cmd: p.cmd.slice(from, o.last + 1), lead: o.first - from, ...(was ? { memory: was } : {}) };
    const fixed = [...x.changes, ...(x.knockout ? [{ field: 'knockout', from: false, to: true }] : []), ...x.tools.filter((t) => t.startsWith('fine.')).map((t) => ({ field: t, from: '', to: true }))];
    forget(f.pattern, after[x.index], { ...now, fixed, undo });
  }
  return f.pattern;
}

/** Objects of `p` a fix changed that can be taken back. */
export function fixedObjects(p: Pattern): number[] {
  return sewObjects(p)
    .filter((o) => !!remembered(p, o)?.undo)
    .map((o) => o.index);
}

/**
 * The design with the fix on objects `which` taken back: each gets exactly the stitches and memory
 * it had before. Null when none of them has a fix to take back.
 */
export function revertFix(p: Pattern, which: number[]): Pattern | null {
  const objs = sewObjects(p);
  const list = [...new Set(which)]
    .map((i) => objs[i])
    .filter((o) => o && remembered(p, o)?.undo)
    .sort((a, b) => b.first - a.first);
  if (!list.length) return null;
  let x = p.x;
  let y = p.y;
  let cmd = p.cmd;
  const restored: { at: number; memory?: Remembered }[] = [];
  // From the back, so the earlier records stay where they are.
  for (const o of list) {
    const u = remembered(p, o)!.undo!;
    const from = o.index ? objs[o.index - 1].last + 1 : 0;
    const cat = <T extends Int32Array | Uint8Array>(a: T, mid: T, make: (n: number) => T): T => {
      const out = make(a.length - (o.last + 1 - from) + mid.length);
      out.set(a.subarray(0, from), 0);
      out.set(mid, from);
      out.set(a.subarray(o.last + 1), from + mid.length);
      return out;
    };
    x = cat(x, u.x, (n) => new Int32Array(n));
    y = cat(y, u.y, (n) => new Int32Array(n));
    cmd = cat(cmd, u.cmd, (n) => new Uint8Array(n));
    for (const r of restored) r.at += u.x.length - (o.last + 1 - from);
    restored.push({ at: from + u.lead, memory: u.memory });
  }
  const next = withRecords(p, x, y, cmd);
  const now = sewObjects(next);
  if (now.length !== objs.length) return null;
  for (const r of restored) {
    const o = now.find((q) => q.first === r.at);
    if (o && r.memory) forget(next, o, r.memory);
  }
  return next;
}
