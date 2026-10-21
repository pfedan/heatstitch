import type { Pattern } from '../model/pattern';
import { readFormat } from './read';

/** Reads a Tajima DST file (core/src/parsers/dst.rs). */
export const parseDst = (data: Uint8Array, fileName = ''): Pattern => readFormat('dst', data, fileName);
