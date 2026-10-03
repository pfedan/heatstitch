import type { Pattern } from '../model/pattern';
import { parseDst } from './dst';
import { isPes, parsePes } from './pes';

export const SUPPORTED_EXTENSIONS = ['.dst', '.pes'];

export function parsePattern(data: Uint8Array, fileName: string): Pattern {
  const base = fileName.replace(/\.[^.]+$/, '');
  if (isPes(data)) return parsePes(data, base);
  if (/\.dst$/i.test(fileName)) return parseDst(data, base);
  throw new Error(`Unsupported file format: ${fileName}`);
}
