import type { Digitized } from '../digitize/digitize';
import { parsePattern } from '../parsers';
import { encodeRecords } from '../parsers/records';
import { syncBorders } from './border';
import { rememberObjects, sewObjects } from './objects';
import type { Pattern } from './pattern';
import { remember, remembered, rememberShapes } from './restitch';
import { stitchesBefore } from './transform';

/**
 * Stitches from the Image mode or a vector file as a file in heatstitch's own records (see
 * parsers/records.ts) and the design read from it, each object remembering what it was made as; the
 * borders of shapes with a stroke (see digitizeShapes) sewn after their fills. The records keep
 * every thread color and record exactly, so the design read here is the one a reload reads.
 */
export function digitizedFile(d: Digitized, name: string, trimMm: number): { data: Uint8Array; pattern: Pattern } {
  let data = encodeRecords(d.pattern);
  let pattern = parsePattern(data, `${name}.hsr`);
  rememberObjects(pattern, d.starts);
  rememberShapes(pattern, sewObjects(pattern), d.starts, d.objects.map((o) => o.shape), d.objects);
  if (d.objects.some((o) => o.border)) {
    const synced = syncBorders(pattern, trimMm);
    data = encodeRecords(synced);
    // Read back as the app reads the file: the same records, so each object knows what it knew.
    pattern = parsePattern(data, `${name}.hsr`);
    const objs = sewObjects(synced);
    rememberObjects(pattern, objs.map((o) => stitchesBefore(synced, o.first)));
    const back = sewObjects(pattern);
    if (back.length !== objs.length) throw new Error(`digitizedFile: ${objs.length} objects sewn, ${back.length} read back`);
    objs.forEach((o, k) => {
      const m = remembered(synced, o);
      if (m) remember(pattern, back[k], m);
    });
  }
  return { data, pattern };
}
