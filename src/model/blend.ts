import { takeOver } from './knockout';
import { sewObjects } from './objects';
import type { Pattern, ThreadColor } from './pattern';
import { remembered, restitch, type FillSettings } from './restitch';
import { stitchKinds } from './sequence';
import { duplicateObject, recolorObjects } from './shapeOps';

/**
 * A color blend from one fill: the fill fades out across its shape, and a copy on the same area
 * in a second thread fades in the other way (both with FillSettings.deco.fade, the density
 * changing evenly), so together they stay as dense as the fill was. The copy gets no underlay
 * (the first one's holds both) and no border. The two are objects of their own afterwards, like a
 * duplicate: each can be changed, moved or deleted by itself.
 *
 * Returns null when the object has no fill shape to sew from, or a step fails.
 */
export function blendObject(p: Pattern, o: number, color: ThreadColor, trimMm: number): Pattern | null {
  let kinds = stitchKinds(p);
  let objs = sewObjects(p, kinds);
  const m = objs[o] && remembered(p, objs[o]);
  if (!m?.fill || !m.region) return null;
  const { emboss: _e, ...deco } = m.fill.deco ?? {};
  const out: FillSettings = { ...structuredClone(m.fill), pattern: 'gradient', deco: { ...deco, fade: 'out' } };
  const inn: FillSettings = { ...structuredClone(out), underlay: false, border: undefined, deco: { ...deco, fade: 'in' } };
  const a = takeOver(restitch(p, objs, [o], { kind: 'fill', s: out }, kinds, trimMm));
  if (!a) return null;
  // The copy lies on the same spot: moved by nothing.
  const d = duplicateObject(a, o, trimMm, 0);
  if (!d) return null;
  kinds = stitchKinds(d.pattern);
  objs = sewObjects(d.pattern, kinds);
  const b = takeOver(restitch(d.pattern, objs, [d.index], { kind: 'fill', s: inn }, kinds, trimMm));
  if (!b) return null;
  return recolorObjects(b, [d.index], color, trimMm) ?? b;
}
