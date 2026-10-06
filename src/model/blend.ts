import { chooseAngle } from '../digitize/fill';
import { newLink, syncBorders } from './border';
import { takeOver } from './knockout';
import { sewObjects } from './objects';
import type { Pattern, ThreadColor } from './pattern';
import { remembered, restitch, type FillSettings } from './restitch';
import { stitchKinds } from './sequence';

/**
 * A color blend from one fill: the fill fades out across its shape (FillSettings.deco.fade, the
 * density changing evenly), and a second object in the other thread fades in on the same area, so
 * together they stay as dense as the fill was. The two are coupled as a fill and its border of its
 * own thread: the second one follows every change of the fill (see syncBlends) and goes with it
 * when the fill gets another pattern. Its border stays with the fill.
 *
 * Returns null when the object has no fill shape to sew from, or a step fails.
 */
export function blendObject(p: Pattern, o: number, color: ThreadColor, trimMm: number): Pattern | null {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const m = objs[o] && remembered(p, objs[o]);
  // The second thread of a blend follows its fill: it blends with nothing of its own.
  if (!m?.fill || !m.region || m.blendOf || m.outline) return null;
  const { emboss: _e, focus: _f, centers: _c, blend: was, ...deco } = m.fill.deco ?? {};
  const s: FillSettings = { ...structuredClone(m.fill), pattern: 'gradient',
    // One angle for both, so their rows lie on each other.
    angle: Number.isFinite(m.fill.angle) ? m.fill.angle : chooseAngle(m.region, m.fill.spacing, []),
    deco: { ...deco, fade: 'out', blend: { color, link: was?.link ?? newLink() } } };
  const a = takeOver(restitch(p, objs, [o], { kind: 'fill', s }, kinds, trimMm));
  return a && syncBorders(a, trimMm);
}
