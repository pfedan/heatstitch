import { core } from '../wasm/core';
import type { Pattern } from '../model/pattern';
import { readFormat } from './read';

/** Tajima DST, read by the core (core/src/parsers/dst.rs). */

export const DST_HEADER_SIZE = 512;
/** A run of at least this many consecutive jumps is interpreted as a trim (same default as pyembroidery). */
export const DST_TRIM_JUMP_COUNT = 3;

export const decodeDx = (b0: number, b1: number, b2: number): number => core().dstDecodeDx(b0, b1, b2);

/** Returns dy in DST orientation (y up). */
export const decodeDy = (b0: number, b1: number, b2: number): number => core().dstDecodeDy(b0, b1, b2);

export const parseDst = (data: Uint8Array, fileName = ''): Pattern => readFormat('dst', data, fileName);
