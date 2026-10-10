import { tidy, withRecords } from './edit';
import { sewObjects, type SewObject } from './objects';
import { isReadFromFile, JUMP, STITCH, TRIM, type Pattern } from './pattern';
import { remembered, type Rec, type Remembered, type RestitchResult } from './restitch';
import { stitchKinds } from './sequence';

/**
 * The stitches a design had in the file it was loaded from, to go back to. None for a design made
 * in the app (new, from a picture, a lettering): its file only holds where it began, and its
 * objects there are told apart anew on every load, so an id there names some other object.
 */
export const loadedOriginal = (f: { original?: Pattern; own: boolean }): Pattern | undefined => (f.own ? undefined : f.original);

/**
 * The way back to an object's own stitches in a file from elsewhere: the object of `original` it
 * was when the file was read (same id), as long as it is still that one object here (not cut into
 * parts, not a copy) and its stitches are not those any more. Null otherwise.
 */
export function originalOf(p: Pattern, original: Pattern | undefined, o: SewObject, objs: SewObject[], origObjs?: SewObject[]): SewObject | null {
  if (!original || original === p || !isReadFromFile(original) || !o.id) return null;
  // Cut apart (one of the parts may keep the id) or copied: the original would be there twice.
  if (remembered(p, o)?.piece || objs.some((x) => x !== o && x.id === o.id)) return null;
  const was = (origObjs ?? sewObjects(original)).find((x) => x.id === o.id);
  if (!was || sameStitches(p, o, original, was)) return null;
  return was;
}

/** Whether the stitches of `a` in `p` are those of `b` in `q`. */
function sameStitches(p: Pattern, a: SewObject, q: Pattern, b: SewObject): boolean {
  if (a.last - a.first !== b.last - b.first) return false;
  for (let k = 0; k <= a.last - a.first; k++) {
    const i = a.first + k;
    const j = b.first + k;
    if (p.cmd[i] !== q.cmd[j] || p.x[i] !== q.x[j] || p.y[i] !== q.y[j]) return false;
  }
  return true;
}

/** First record that belongs to object `o`: its first stitch and the jumps leading to it. */
function leadOf(p: Pattern, o: SewObject): number {
  let i = o.first;
  while (i - 1 >= 0 && p.cmd[i - 1] === JUMP) i--;
  return i;
}

/**
 * The objects `which` of `p` sewn with their stitches from `original` again (see originalOf), in
 * their place in the sewing order and in their thread now; what they remember is what they did
 * when the file was read. Long ways to and from them are trimmed. Null when none of them can.
 */
export function backToOriginal(p: Pattern, original: Pattern, which: number[], trimMm: number): RestitchResult | null {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const origObjs = sewObjects(original);
  const swaps = new Map<number, { o: SewObject; was: SewObject }>();
  for (const i of which) {
    const o = objs[i];
    const was = o && originalOf(p, original, o, objs, origObjs);
    if (was) swaps.set(leadOf(p, o), { o, was });
  }
  if (!swaps.size) return null;
  const out: Rec[] = [];
  const push = (q: Pattern, i: number, cmd = q.cmd[i]) => out.push({ x: q.x[i], y: q.y[i], cmd });
  const lastStitch = () => {
    for (let k = out.length - 1; k >= 0; k--) {
      if (out[k].cmd === TRIM) return null;
      if (out[k].cmd === STITCH) return out[k];
    }
    return null;
  };
  const far = (a: Rec | null, x: number, y: number) => !!a && Math.hypot(a.x - x, a.y - y) / 10 > trimMm;
  const starts: number[] = [];
  const ends: number[] = [];
  const memory: Remembered[] = [];
  let stitches = 0;
  for (let i = 0; i < p.cmd.length; i++) {
    const swap = swaps.get(i);
    if (!swap) {
      push(p, i);
      if (p.cmd[i] === STITCH) stitches++;
      continue;
    }
    const { o, was } = swap;
    // Coming from far away: the thread is cut first, as the stitches before may not have done.
    const prev = lastStitch();
    if (far(prev, original.x[was.first], original.y[was.first])) out.push({ ...prev!, cmd: TRIM });
    starts.push(stitches);
    for (let j = leadOf(original, was); j <= was.last; j++) {
      push(original, j);
      if (original.cmd[j] === STITCH) stitches++;
    }
    ends.push(stitches);
    // Going far on from here without a trim: one after the object.
    let next = o.last + 1;
    while (next < p.cmd.length && p.cmd[next] === JUMP) next++;
    if (next < p.cmd.length && p.cmd[next] === STITCH && far(out[out.length - 1], p.x[next], p.y[next])) out.push({ ...out[out.length - 1], cmd: TRIM });
    const known = remembered(original, was);
    memory.push(known ? { ...structuredClone(known), id: o.id } : { region: null, read: true, id: o.id });
    i = o.last;
  }
  const next = tidy(
    withRecords(
      p,
      Int32Array.from(out, (r) => r.x),
      Int32Array.from(out, (r) => r.y),
      Uint8Array.from(out, (r) => r.cmd),
    ),
  );
  return { pattern: next, starts, ends, failed: [], regions: starts.map(() => null), memory };
}
