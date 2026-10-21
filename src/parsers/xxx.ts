import type { Pattern } from '../model/pattern';
import { readFormat } from './read';

/** Reads a Singer XXX file (core/src/parsers/xxx.rs): two bytes per stitch, the thread colors as RGB after the end. */
export const parseXxx = (data: Uint8Array, fileName = ''): Pattern => readFormat('xxx', data, fileName);
