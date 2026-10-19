import type { Pt } from '../digitize/skeleton';
import { core } from '../wasm/core';
import { inCore, type Font } from './font';
import { layout, layoutFrom, letteringIn, type Layout, type Lettering } from './layout';

/**
 * Stitches for a lettering: every letter's elements as the font digitized them, sewn at the
 * height asked for. Satin is sewn anew along its rails and rungs (so its density stays right at
 * any size), running stitch along its path, fills in their outline. Where letters overlap, the one
 * below leaves out what the one on top hides. All of it in the Rust core
 * (core/src/lettering/sew.rs, overlap.rs), one call per lettering.
 */

export interface Rec {
  x: number;
  y: number;
  cmd: number;
}

/** One continuous run of stitches and where in the text it belongs. */
export interface LetterRun {
  pts: Pt[];
  word: number;
  line: number;
  /** Index of its letter in the layout. */
  letter: number;
  /** Satin or fill: it leaves out what lies under later letters (running stitch stays whole). */
  leaves: boolean;
}

/**
 * Every run of the lettering in sewing order. Where a letter lies on one sewn before, that one
 * leaves out the stitches it hides, unless `all` asks for every stitch; running stitch stays
 * whole. The letters of `lay` on lines sewn in writing direction after all lose their `back`.
 */
export function letteringRuns(font: Font, l: Lettering, lay: Layout = layout(font, l), all = false): LetterRun[] {
  const o = core().letteringRuns(inCore(font), letteringIn(l), all);
  try {
    const pts = o.takePts();
    const lens = o.takeLens();
    const meta = o.takeMeta();
    const back = o.takeBack();
    lay.letters.forEach((p, i) => {
      if (i < back.length) p.back = back[i] === 1;
    });
    const out: LetterRun[] = [];
    let i = 0;
    for (let k = 0; k < lens.length; k++) {
      const run: Pt[] = new Array(lens[k]);
      for (let j = 0; j < lens[k]; j++, i++) run[j] = [pts[2 * i], pts[2 * i + 1]];
      out.push({ pts: run, word: meta[4 * k], line: meta[4 * k + 1], letter: meta[4 * k + 2], leaves: meta[4 * k + 3] === 1 });
    }
    return out;
  } finally {
    o.free();
  }
}

export interface Sewn {
  /** Records: starts with a jump, ends with a trim (no color change, no end). */
  recs: Rec[];
  /** Number of the first stitch of each piece between trims, from the first stitch of `recs`. */
  starts: number[];
  /** Number of the first stitch of each letter, counted the same way. */
  letters: number[];
  stitches: number;
  layout: Layout;
}

/**
 * The records of a lettering. Inside a word, moves up to 1 mm are sewn, up to `trimMm` jumped,
 * longer ones trimmed (a joined script stays one piece); between words and lines the thread is
 * always trimmed.
 */
export function sewLettering(font: Font, l: Lettering, trimMm: number): Sewn {
  const o = core().sewLettering(inCore(font), letteringIn(l), trimMm);
  try {
    const x = o.takeX();
    const y = o.takeY();
    const cmd = o.takeCmd();
    const recs: Rec[] = new Array(cmd.length);
    for (let i = 0; i < cmd.length; i++) recs[i] = { x: x[i], y: y[i], cmd: cmd[i] };
    return { recs, starts: Array.from(o.takeStarts()), letters: Array.from(o.takeLetters()), stitches: o.stitches, layout: layoutFrom(font, o.layout) };
  } finally {
    o.free();
  }
}
