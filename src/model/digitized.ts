import type { Digitized } from '../digitize/digitize';
import { parsePattern } from '../parsers';
import { writePattern } from '../writers';
import { syncBorders } from './border';
import { rememberObjects, sewObjects } from './objects';
import type { Pattern } from './pattern';
import { remember, remembered, rememberShapes, withLine } from './restitch';
import { stitchesBefore } from './transform';

/**
 * Stitches from the Image mode or a vector file as a PES file and the design read from it, each
 * object remembering what it was made as; the borders of shapes with a stroke (see digitizeShapes)
 * sewn after their fills.
 */
export function digitizedFile(d: Digitized, name: string, trimMm: number): { data: Uint8Array; pattern: Pattern } {
  let data = writePattern(d.pattern, 'pes');
  let pattern = parsePattern(data, `${name}.pes`);
  rememberObjects(pattern, d.starts);
  rememberShapes(pattern, sewObjects(pattern), d.starts, d.objects.map((o) => o.shape), d.objects);
  if (d.objects.some((o) => o.border)) {
    const synced = syncBorders(pattern, trimMm);
    data = writePattern(synced, 'pes');
    // Read back as the app reads the file (the PES writer adds records between threads): each
    // object, the same stitches, knows what it knew.
    pattern = parsePattern(data, `${name}.pes`);
    const objs = sewObjects(synced);
    rememberObjects(pattern, objs.map((o) => stitchesBefore(synced, o.first)));
    const back = sewObjects(pattern);
    if (back.length !== objs.length) return { data, pattern };
    const mem = objs.map((o) => remembered(synced, o));
    mem.forEach((m, k) => {
      if (!m) return;
      // A border's own thread is the one the file has (PES keeps threads of its own palette).
      const at = m.fill && m.line?.color ? mem.findIndex((x) => x?.outline && x.outline === m.line!.link) : -1;
      remember(pattern, back[k], at >= 0 ? withLine(m, { ...m.line!, color: { ...back[at].color } }) : m);
    });
  }
  return { data, pattern };
}
