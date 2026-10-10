import { chooseAngle } from '../digitize/fill';
import { appliqueDefaults, cutForm, stopsIn, type AppliqueSettings } from './applique';
import { followerLinks, syncBorders } from './border';
import { fillArea, fits, geoUse } from './geo';
import { sewObjects, type SewObject } from './objects';
import type { Pattern } from './pattern';
import { knownKind, remembered, type FillSettings, type Remembered } from './restitch';
import { partOf } from './shadow';
import { listOf, sewList } from './sew';
import type { Form } from '../shape/path';

/**
 * Making appliqués of fills and back (see applique.ts): the object stays the same one, with its id,
 * its place in the sewing order and its form; only how it is sewn changes. One undo step each.
 */

/** Whether object `o` of `p` can be an appliqué: a closed area with a shape, made here, not following another object. */
export function canApplique(p: Pattern, o: SewObject): boolean {
  const m = remembered(p, o);
  if (!m || m.applique || m.free || m.read || m.lettering || m.outline || m.blendOf || m.shadowOf || m.echoOf || m.piece || partOf(m)) return false;
  const use = geoUse(m);
  if (use === 'area') return fits(m.geo!, 'fill');
  return !use && !!m.fill && !!m.region;
}

/** What object `o` remembers as an appliqué with settings `s`: its area without the pull a fill was given, its fill kept for going back. */
function asApplique(m: Remembered, s: AppliqueSettings): Remembered {
  const { fill, satin: _s, line: _l, knockout: _k, cut: _c, overlapShare: _o, under: _u, underFrom: _f, borderAt: _b, parts: _p, columns: _r, fixed: _x, undo: _d, ...rest } = m;
  // A satin is kept only by a line (to sew it again over its area): an appliqué keeps its fill.
  const kept = { ...(m.kept ?? {}), ...(fill ? { fill } : {}) };
  // What it was is kept to go back to, where it has a form (settings are kept only with one).
  const out: Remembered = { ...rest, applique: s, ...(m.geo && Object.keys(kept).length ? { kept } : {}) };
  if (m.geo) out.region = fillArea({ region: null, geo: m.geo });
  return out;
}

/** The fill an appliqué goes back to: the one it kept, else `fill`. */
function asFill(m: Remembered, fill: FillSettings): Remembered {
  const { applique: _a, kept, parts: _p, under: _u, underFrom: _f, borderAt: _b, ...rest } = m;
  const { fill: was, ...others } = kept ?? {};
  const out: Remembered = { ...rest, fill: was ?? fill, ...(Object.keys(others).length ? { kept: others } : {}) };
  if (m.geo) out.region = fillArea(out);
  // A fill given without an angle (NaN: the rows' direction left open) gets the one with the
  // fewest sections on its area, as a satin made a fill does: rows need a direction to be sewn.
  const f = out.fill!;
  const area = out.region ?? m.region;
  if (!Number.isFinite(f.angle) && area) out.fill = { ...f, angle: chooseAngle(area, f.spacing, []) };
  return out;
}

/**
 * The design with objects `which` sewn as `memory(o)` gives them (unchanged where it gives null):
 * each sewn anew in its place, the others as they are. Null when nothing changed or one could not
 * be sewn so.
 */
function resew(p: Pattern, which: number[], memory: (m: Remembered, o: SewObject) => Remembered | null, trimMm: number): Pattern | null {
  const list = listOf(p);
  const fresh = new Set<number>();
  // Its border and second thread in threads of their own go: an appliqué has its own edge.
  const drop = new Set<string>();
  let changed = false;
  for (const k of which) {
    const e = list[k];
    const m = e && remembered(p, e.obj);
    const next = m && memory(m, e.obj);
    if (!next) continue;
    for (const l of followerLinks(m)) if (!followerLinks(next).includes(l)) drop.add(l);
    // The kind it is sewn in now, so it is sewn from what it remembers (see specOf).
    list[k] = { ...e, obj: { ...e.obj, kind: knownKind(next) ?? e.obj.kind }, sew: true, memory: next };
    fresh.add(e.obj.index);
    changed = true;
  }
  if (!changed) return null;
  const q = sewList(p, list, trimMm, { fresh });
  const objs = sewObjects(q);
  // Each one sewn from what it was given: one that could not be sewn (an appliqué too small, a fill
  // without rows) keeps its old stitches, and with them the stops it had or lacked, so its stops
  // tell (an appliqué stops twice inside, anything else never).
  for (const k of which) {
    const o = objs.find((x) => x.id === list[k]?.obj.id);
    const m = o && remembered(q, o);
    if (!o || !m || stopsIn(q, o.first, o.last).length !== (m.applique ? 2 : 0)) return null;
  }
  return syncBorders(q, trimMm, drop);
}

/** Objects `which` of `p` made appliqués (each in its thread's color, cotton, a satin edge, unless `s` says else); null when none could be. */
export function toApplique(p: Pattern, which: number[], trimMm: number, s?: Partial<AppliqueSettings>): Pattern | null {
  const objs = sewObjects(p);
  const ok = which.filter((k) => objs[k] && canApplique(p, objs[k]));
  return resew(p, ok, (m, o) => asApplique(m, { ...appliqueDefaults(o.color), ...s }), trimMm);
}

/** Appliqués `which` of `p` sewn as fills again (the fill they kept, else `fill`); null when none was one. */
export function fromApplique(p: Pattern, which: number[], fill: FillSettings, trimMm: number): Pattern | null {
  return resew(p, which, (m) => (m.applique ? asFill(m, fill) : null), trimMm);
}

/** The settings of appliqués `which` changed by `change`; null when none was one or nothing changed. */
export function setApplique(p: Pattern, which: number[], change: Partial<AppliqueSettings>, trimMm: number): Pattern | null {
  return resew(
    p,
    which,
    (m) => {
      if (!m.applique) return null;
      const s = { ...m.applique, ...change };
      return JSON.stringify(s) === JSON.stringify(m.applique) ? null : { ...m, applique: s };
    },
    trimMm,
  );
}

/** The appliqués among objects `which` (all when not given). */
export function appliquesOf(p: Pattern, which?: number[]): SewObject[] {
  const objs = sewObjects(p);
  return (which ? which.map((k) => objs[k]).filter(Boolean) : objs).filter((o) => !!remembered(p, o)?.applique);
}

/** The outlines to cut the fabric of appliqués `which` along (all when not given). */
export function cutForms(p: Pattern, which?: number[]): Form[] {
  return appliquesOf(p, which).flatMap((o) => cutForm(remembered(p, o)!) ?? []);
}
