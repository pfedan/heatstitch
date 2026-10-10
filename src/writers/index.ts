import type { Hoop } from '../model/hoop';
import type { Pattern } from '../model/pattern';
import { writeDst } from './dst';
import { writeExp } from './exp';
import { writeJef } from './jef';
import { writePecFile, writePes } from './pes';
import { writeVp3 } from './vp3';
import { writeXxx } from './xxx';

export type OutputFormat = 'pes' | 'dst' | 'jef' | 'exp' | 'vp3' | 'xxx' | 'pec';

/** Save formats in menu order. */
export const OUTPUT_FORMATS: OutputFormat[] = ['pes', 'dst', 'jef', 'vp3', 'exp', 'xxx', 'pec'];

export function isOutputFormat(v: unknown): v is OutputFormat {
  return OUTPUT_FORMATS.includes(v as OutputFormat);
}

/** What the file should know beyond the stitches. */
export interface WriteOptions {
  /** The chosen hoop, for formats that store one (PES, JEF). */
  hoop?: Hoop | null;
}

const WRITERS: Record<OutputFormat, (p: Pattern, o: WriteOptions) => Uint8Array> = {
  pes: (p, o) => writePes(p, o.hoop ?? null),
  dst: writeDst,
  jef: (p, o) => writeJef(p, new Date(), o.hoop ?? null),
  exp: writeExp,
  vp3: writeVp3,
  xxx: writeXxx,
  pec: writePecFile,
};

export function writePattern(p: Pattern, format: OutputFormat, options: WriteOptions = {}): Uint8Array {
  return WRITERS[format](p, options);
}

/** A name typed by the user, without characters file systems refuse; empty when nothing is left. */
export function cleanName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .trim()
    .replace(/\.(pes|pec|dst|jef|exp|vp3|xxx|sew)$/i, '')
    .trim();
}

/** Offers the file as a download. */
export function downloadPattern(p: Pattern, format: OutputFormat, fileName: string, options: WriteOptions = {}): void {
  const data = writePattern(p, format, options);
  const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
