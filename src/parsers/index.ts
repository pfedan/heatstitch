import type { Pattern } from '../model/pattern';
import { parseDst } from './dst';
import { parseExp } from './exp';
import { parseJef } from './jef';
import { isPec, isPes, parsePecFile, parsePes } from './pes';
import { isVp3, parseVp3 } from './vp3';

export const SUPPORTED_EXTENSIONS = ['.dst', '.pes', '.pec', '.jef', '.exp', '.vp3'];

export function parsePattern(data: Uint8Array, fileName: string): Pattern {
  const base = fileName.replace(/\.[^.]+$/, '');
  if (isPes(data)) return parsePes(data, base);
  if (isPec(data)) return parsePecFile(data, base);
  if (isVp3(data)) return parseVp3(data, base);
  if (/\.dst$/i.test(fileName)) return parseDst(data, base);
  if (/\.jef$/i.test(fileName)) return parseJef(data, base);
  if (/\.exp$/i.test(fileName)) return parseExp(data, base);
  throw new Error(`Unsupported file format: ${fileName}`);
}
