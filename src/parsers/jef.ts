import type { Pattern } from '../model/pattern';
import { readFormat } from './read';

/**
 * JEF has no trim command: a zero-length jump is a cut (heatstitch, pyembroidery and Ink/Stitch
 * write three), and so is a move longer than this (0.1 mm, either axis), as pyembroidery reads it.
 */
export const JEF_TRIM_DISTANCE = 30;

/** Reads a Janome JEF file (core/src/parsers/jef.rs). Colors are palette indices; index 0 is a stop (the same thread again). */
export const parseJef = (data: Uint8Array, fileName = ''): Pattern => readFormat('jef', data, fileName);
