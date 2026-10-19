import { core } from '../wasm/core';
import { flatOf, ptsOf } from './fill';
import type { Pt } from './skeleton';

/**
 * Motif stitch: a small figure repeated along a line, sewn as one running stitch (what Brother and
 * Ink/Stitch call a motif or pattern line). The figures follow the line's curve; their size is the
 * width across the line, their period the distance from one to the next along it, stretched a
 * little so a whole number of them fits the line.
 *
 * The needle points are computed by the Rust core (core/src/digitize/motif.rs).
 */

export type LineMotif = 'waves' | 'scallops' | 'hearts' | 'chain' | HandStitch;
/** Machine imitations of classic hand embroidery stitches (see handStitches). */
export type HandStitch = 'stem' | 'feather' | 'cretan' | 'chevron';
export const HAND_STITCHES: HandStitch[] = ['stem', 'feather', 'cretan', 'chevron'];
export const LINE_MOTIFS: LineMotif[] = ['waves', 'scallops', 'hearts', 'chain', ...HAND_STITCHES];
export const isHandStitch = (m: LineMotif | undefined): m is HandStitch => !!m && (HAND_STITCHES as string[]).includes(m);

/**
 * Distance from one figure to the next (mm) when none is set. A stem stitch: from one stitch to the
 * next (each is twice as long); the others: from a point on one side to the next on the other.
 */
export const MOTIF_PERIOD: Record<LineMotif, number> = { waves: 5, scallops: 4, hearts: 8, chain: 2.2, stem: 2, feather: 3, cretan: 3, chevron: 3 };

/** Size of a motif across the line the panel starts with (mm). */
export const MOTIF_WIDTH = 3;
/** Size of a hand stitch across the line when it is picked (mm): a stem stitch is a narrow cord. */
export const HAND_WIDTH: Record<HandStitch, number> = { stem: 1, feather: 5, cretan: 5, chevron: 4 };
/** How often each stitch of a hand stitch is sewn when nothing is set: thick like embroidery floss. */
export const HAND_LAYERS = 3;
/**
 * A stem stitch as a cord (PathStitch.cord): the step from one stitch to the next when none is set
 * (mm). Each stitch lies at 45° over the next ones, so the parallel threads are 0.28 mm apart, less
 * than a 40 wt thread is wide: the cord covers, at the density of a satin.
 */
export const CORD_STEP = 0.4;
/** The step of a cord lies in this range (mm): denser crowds the holes, more open shows the fabric. */
export const CORD_STEP_RANGE: [number, number] = [0.25, 1.2];

/**
 * The largest size a motif takes with figures `period` mm apart: hearts stay apart (no wider than
 * 90 % of the period; a heart is 32 parts wide for 22 from notch to tip), the others take any size.
 */
export const motifMaxSize = (motif: LineMotif, period: number): number => (motif === 'hearts' ? ((period * 0.9) / 32) * 22 : Infinity);

/** Motifs with a side: they stand on the line and reach out to one side of it. */
export const SIDED_MOTIFS: LineMotif[] = ['scallops', 'hearts'];

/** Longest stitch of a motif (mm), and how close its stitches keep to the figure: small figures need short stitches to stay round. */
export const MOTIF_STITCH = 1.2;

/**
 * The needle points of `motif` along `line` (closed: first point repeated at the end): `width` mm
 * across, one figure every `period` mm, on the side `side` (1: the normal's, -1: the other).
 * `shift`: the figures start this share of a period later (0 to 1; an open line then begins and
 * ends with part of a figure).
 */
export function motifStitches(line: Pt[], closed: boolean, motif: LineMotif, width: number, period: number, side: 1 | -1 = 1, shift = 0, stitch = MOTIF_STITCH, layers = HAND_LAYERS, cord = false): Pt[] {
  return ptsOf(core().motifStitches(flatOf(line), closed, motif, width, period, side, shift, stitch, layers, cord));
}
