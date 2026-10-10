import type { Digitized } from '../digitize/digitize';
import { parsePattern } from '../parsers';
import { writePattern } from '../writers';
import { syncBorders } from './border';
import { rememberObjects, sewObjects } from './objects';
import type { Pattern } from './pattern';
import { rememberShapes } from './restitch';

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
    pattern = syncBorders(pattern, trimMm);
    data = writePattern(pattern, 'pes');
  }
  return { data, pattern };
}
