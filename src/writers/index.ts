import type { Pattern } from '../model/pattern';
import { writeDst } from './dst';
import { writePes } from './pes';

export type OutputFormat = 'dst' | 'pes';

export function writePattern(p: Pattern, format: OutputFormat): Uint8Array {
  return format === 'dst' ? writeDst(p) : writePes(p);
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
