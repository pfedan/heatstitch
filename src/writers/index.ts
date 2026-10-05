import type { Pattern } from '../model/pattern';
import { writeDst } from './dst';
import { writeExp } from './exp';
import { writeJef } from './jef';
import { writePecFile, writePes } from './pes';
import { writeVp3 } from './vp3';

export type OutputFormat = 'pes' | 'dst' | 'jef' | 'exp' | 'vp3' | 'pec';

/** Save formats in menu order. */
export const OUTPUT_FORMATS: OutputFormat[] = ['pes', 'dst', 'jef', 'vp3', 'exp', 'pec'];

export function isOutputFormat(v: unknown): v is OutputFormat {
  return OUTPUT_FORMATS.includes(v as OutputFormat);
}

const WRITERS: Record<OutputFormat, (p: Pattern) => Uint8Array> = {
  pes: writePes,
  dst: writeDst,
  jef: (p) => writeJef(p),
  exp: writeExp,
  vp3: writeVp3,
  pec: writePecFile,
};

export function writePattern(p: Pattern, format: OutputFormat): Uint8Array {
  return WRITERS[format](p);
}

/** "design.pes" saved as DST after edits becomes "design-corrected.dst". */
export function outputFileName(fileName: string, format: OutputFormat, edited: boolean): string {
  const base = fileName.replace(/\.[^.]+$/, '') || 'design';
  return `${base}${edited ? '-corrected' : ''}.${format}`;
}

/** Offers the file as a download. */
export function downloadPattern(p: Pattern, format: OutputFormat, fileName: string): void {
  const data = writePattern(p, format);
  const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
