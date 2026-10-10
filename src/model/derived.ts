import type { Region } from '../digitize/region';
import { unionOf } from '../shape/rasterize';
import { sewObjects } from './objects';
import type { Pattern } from './pattern';
import { borderOf, regionFrom, remembered, type Remembered, type StoredObjects, type StoredObject } from './restitch';

/**
 * Areas a project file does not store because they come from another object (see
 * StoredObject.derived): a border or a blend's second thread in a thread of its own lies on the area
 * of its fill, of all parts of a fill cut apart together. Opening the file takes it from there again.
 *
 * Saving leaves out only areas that are exactly that (see dropDerived), so opening never guesses.
 * The area of a fill that leaves out what lies on top is still stored: rastering it again on
 * opening costs about as long again as the opening itself (measured in the masks proposal).
 */

/** Whether `x` is the fill (or a part of the fill) follower `m` lies on. */
const followsFill = (m: Remembered, x: Remembered | undefined): boolean => {
  const link = m.outline ?? m.blendOf;
  return !!link && !!x?.region && !x.outline && !x.blendOf && (m.outline ? borderOf(x)?.link === link : x.fill?.deco?.blend?.link === link);
};

/** The area a follower lies on: its fill's, or that of all parts of its fill together. */
export function leaderArea(mem: readonly (Remembered | undefined)[], m: Remembered): Region | null {
  const rs = mem.filter((x) => followsFill(m, x)).map((x) => x!.region!);
  if (rs.length <= 1) return rs[0] ?? null;
  return unionOf(rs.filter((r) => r.pxMm === rs[0].pxMm));
}

/** Gives the followers of `p` with the ids `ids` the area of their fill again (in place). */
export function deriveAreas(p: Pattern, ids: ReadonlySet<number>): void {
  const objs = sewObjects(p);
  const mem = objs.map((o) => remembered(p, o));
  objs.forEach((o, k) => {
    const m = mem[k];
    if (m && o.id !== undefined && ids.has(o.id)) m.region = leaderArea(mem, m);
  });
}

/** Whether two areas are the same pixels. */
function samePixels(a: Pick<Region, 'x0' | 'y0' | 'w' | 'h' | 'pxMm' | 'mask'>, b: NonNullable<StoredObject['region']>): boolean {
  if (a.x0 !== b.x0 || a.y0 !== b.y0 || a.w !== b.w || a.h !== b.h || a.pxMm !== b.pxMm || a.mask.length !== b.mask.length) return false;
  for (let i = 0; i < a.mask.length; i++) if (a.mask[i] !== b.mask[i]) return false;
  return true;
}

/**
 * The object list `out` (made from `list`, entry for entry, as written to a file) without the areas
 * of followers that are exactly the area of their fill, as opening gives it (leaderArea).
 */
export function dropDerived(list: StoredObjects, out: StoredObjects): StoredObjects {
  const byId = new Map(list.objects.map((e) => [e.id, e]));
  let changed = false;
  const objects = out.objects.map((e, k) => {
    const m = list.objects[k].memory;
    const role = m?.of?.role;
    if (!e.memory || !m?.region || (role !== 'border' && role !== 'blend')) return e;
    // The link opening names it by again, and the fills (parts) that give it.
    const lead = byId.get(m.of!.id)?.memory;
    const link = role === 'border' ? (lead?.fill ? lead.line?.link : undefined) : lead?.fill?.deco?.blend?.link;
    const fills = list.objects.filter((x) => {
      const f = x.memory;
      return !!link && !!f?.region && f.of?.role !== 'border' && f.of?.role !== 'blend' && (role === 'border' ? !!f.fill && f.line?.link === link : f.fill?.deco?.blend?.link === link);
    });
    let area: Pick<Region, 'x0' | 'y0' | 'w' | 'h' | 'pxMm' | 'mask'> | null = fills.length === 1 ? fills[0].memory!.region : null;
    if (fills.length > 1) {
      const rs = fills.map((x) => regionFrom(x.memory!.region!)).filter((r): r is Region => !!r);
      area = rs.length === fills.length ? unionOf(rs.filter((r) => r.pxMm === rs[0].pxMm)) : null;
    }
    if (!area || !samePixels(area, m.region)) return e;
    changed = true;
    return { ...e, memory: { ...e.memory, region: null, derived: 'leader' as const } };
  });
  return changed ? { ...out, objects } : out;
}
