import type { Pattern } from '../model/pattern';
import { readFormat } from './read';

/** Reads a Melco EXP file (core/src/parsers/exp.rs): two bytes per stitch, 0x80 introduces a command. EXP stores no colors. */
export const parseExp = (data: Uint8Array, fileName = ''): Pattern => readFormat('exp', data, fileName);
