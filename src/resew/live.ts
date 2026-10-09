import { isReadFromFile, nextVersion, readFromFile, type Pattern } from '../model/pattern';
import { transformObjects } from '../model/reshape';
import { rememberedIn, restoreRemembered, type StoredObjects } from '../model/restitch';
import type { Mat } from '../shape/path';

/**
 * Scaling sewn anew while the frame is dragged, to be seen before it is let go. Sewing a fill anew
 * takes 40 ms to a few seconds, so it runs in a worker. A design goes there with its object list as
 * a project stores it; what comes back is only to be looked at: its stitches and where its objects
 * are, without what they know (for a fill that is megabytes, and letting go sews it here anyway).
 */

/** A design as it goes to the worker and back: plain data, cloned by postMessage. */
export interface Shipped {
  name: string;
  format: Pattern['format'];
  x: Int32Array;
  y: Int32Array;
  cmd: Uint8Array;
  colors: Pattern['colors'];
  bounds: Pattern['bounds'];
  hoop?: Pattern['hoop'];
  read: boolean;
  objects: StoredObjects;
}

/** Design `p` to send; `bare`: where its objects are, without what they know. */
export function ship(p: Pattern, bare = false): Shipped {
  const all = rememberedIn(p);
  const objects = bare ? { ...all, objects: all.objects.map(({ memory: _m, ...e }) => e) } : all;
  return { name: p.name, format: p.format, x: p.x, y: p.y, cmd: p.cmd, colors: p.colors, bounds: p.bounds, ...(p.hoop ? { hoop: p.hoop } : {}), read: isReadFromFile(p), objects };
}

/** The design `s` with its objects; with `from`, as a new version of that one. */
export function unship(s: Shipped, from?: Pattern): Pattern {
  const records = { x: s.x, y: s.y, cmd: s.cmd, colors: s.colors, bounds: s.bounds };
  const p: Pattern = from ? nextVersion(from, records) : { name: s.name, format: s.format, ...records, ...(s.hoop ? { hoop: s.hoop } : {}) };
  if (s.read) readFromFile(p);
  restoreRemembered(p, s.objects);
  return p;
}

/** The objects `sel` of `p` scaled by `m` and sewn anew (see transformObjects), to be looked at. */
export function resew(p: Pattern, sel: number[], m: Mat, trimMm: number): Shipped | null {
  const r = transformObjects(p, sel, m, trimMm);
  return r && ship(r.pattern, true);
}
