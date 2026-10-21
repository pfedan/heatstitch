import { readFromFile, type Pattern } from '../model/pattern';
import { readDesign } from './read';
import { isRecords, parseRecords } from './records';

export const SUPPORTED_EXTENSIONS = ['.dst', '.pes', '.pec', '.jef', '.exp', '.vp3', '.xxx', '.sew'];

export function parsePattern(data: Uint8Array, fileName: string): Pattern {
  return readFromFile(parseFile(data, fileName));
}

function parseFile(data: Uint8Array, fileName: string): Pattern {
  if (isRecords(data)) return parseRecords(data, fileName.replace(/\.[^.]+$/, ''));
  // The embroidery formats, by their signature or else by the extension (core/src/parsers/read.rs).
  return readDesign(data, fileName);
}
