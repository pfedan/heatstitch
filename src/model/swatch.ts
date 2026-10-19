import { digitizeDefaults, pullFor } from '../digitize/digitize';
import type { Font } from '../lettering/font';
import { LETTERING_DEFAULTS, type Lettering } from '../lettering/layout';
import { placeLettering } from '../lettering/place';
import { sewLettering } from '../lettering/sew';
import { parsePath } from '../shape/svgPath';
import type { Mat } from '../shape/path';
import { fabricOf, fabricSpacing, type Profile } from '../validation/profiles';
import { addLine, addShape } from './addShape';
import { sewObjects } from './objects';
import type { Pattern, ThreadColor } from './pattern';

/**
 * A test swatch ("Probestück"): a grid of fills or satin rings to stitch once on one's own fabric,
 * rows by spacing (density), columns by pull compensation, labelled with their values. The cell
 * that looks best there becomes the profile's own values (Profile.own), which new objects and
 * "Tune to fabric" then use in place of the fabric's.
 *
 * As in Roidery's test swatches (lork-fork/Roidery, cmd/embroidery/swatches.rs): squares for fills,
 * rings for satin (they show the pull in every direction), labels with their values in triple run.
 * The labels are in Hershey Sans, a single line font, sewn as triple stitch: a satin font as small
 * (Glacial Tiny) sank into terry and lost its comma when stitched. They are sewn after the cells, on
 * fabric the cells already hold, each next to where the one before ended. Our own addition is a
 * running stitch on each cell's nominal edge, sewn last in a second thread: a gap between it and the
 * stitches means too little compensation, stitches far past it too much (Hatch: "It is easy to see if
 * objects that should be touching or outlines have gaps between them"). The grid is centred on the
 * fabric's own values, never on values measured before, so a swatch stitched once keeps matching the
 * picker in the app.
 */

export type SwatchKind = 'fill' | 'satin';

export interface SwatchGrid {
  kind: SwatchKind;
  /** Spacing per row (mm), densest first. */
  spacings: number[];
  /** Pull compensation per column (the fabric's pullMm), none first. */
  pulls: number[];
}

/**
 * Cells (mm), the gaps between them (wider across, for the column labels), the column of row labels
 * and the row of column labels.
 */
export const SWATCH_CELL = 12;
const GAP = 5;
const GAP_X = 8.5;
const LABEL_W = 16;
const HEAD_H = 8.5;
/** Letter height (mm), and the letters a little closer than Hershey's wide spacing so the labels fit. */
const LABEL_MM = 5;
const LABEL_SPACING = -0.4;
/**
 * Moves between letters of a label longer than this (mm) are trimmed: a single line hides nothing,
 * so a thread from one digit to the next would read as a stroke ("0," as "Q"). The comma's tail and
 * dot, closer, stay one piece.
 */
const LABEL_TRIM = 0.5;
/** Satin rings: column width (mm), the width at which a satin gets the whole pull (PULL_WIDTH). */
const RING_W = 4;
/** The font of the labels: single line, triple stitch. */
export const SWATCH_FONT = 'hershey_sans';

/** Steps of the spacing (about 12 % each, as the density ladder's 16 % but finer) and how many pull steps. */
const SPACING_STEP = 1.12;
const ROWS = 5;
const COLS = 4;

/** The two threads: the cells (and labels) dark, the nominal edge in a colour that stands out against them. */
const CELLS = { r: 30, g: 60, b: 140 };
const EDGE = { r: 220, g: 70, b: 40 };

const ID: Mat = [1, 0, 0, 1, 0, 0];
const EMPTY: Pattern = { name: '', format: 'pes', x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
const round = (v: number, step: number) => Math.round(v / step) * step;
const fix = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The values of the swatch for the fabric and thread of `p` (measured values left aside): spacing
 * two steps denser to two steps wider than the fabric's default, pull from none to well over the
 * fabric's in steps of half of it (at least 0.1 mm, the step digitizers adjust it by).
 */
export function swatchGrid(p: Profile, kind: SwatchKind): SwatchGrid {
  const s = fabricSpacing(p)[0];
  const spacings = Array.from({ length: ROWS }, (_, k) => fix(round(s * SPACING_STEP ** (k - 2), 0.01)));
  const pull = fabricOf(p).pullMm;
  const step = Math.max(0.1, round(pull / 2, 0.05));
  const pulls = Array.from({ length: COLS }, (_, k) => fix(k * step));
  return { kind, spacings, pulls };
}

/** Decimals a pull value needs: one, two for steps like 0.15. */
export const pullDigits = (v: number): number => (Math.abs(v * 10 - Math.round(v * 10)) < 1e-6 ? 1 : 2);

/** Top left corner of cell (`row`, `col`) in mm. */
export const cellAt = (row: number, col: number): [number, number] => [LABEL_W + col * (SWATCH_CELL + GAP_X), HEAD_H + row * (SWATCH_CELL + GAP)];

const square = (x: number, y: number, w: number) => parsePath(`M${x} ${y} L${x + w} ${y} L${x + w} ${y + w} L${x} ${y + w} Z`, ID);
const circle = (cx: number, cy: number, r: number) =>
  parsePath(`M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`, ID);

/**
 * The swatch as a new design: the cells row by row in one thread, then in the same thread the row
 * labels (spacing) from the bottom up and the column labels (pull, with a plus) as lettering, then
 * the nominal edges in a second thread. `fmt` writes a number as the app's language does, `names`
 * names the two threads.
 */
export function testSwatch(p: Profile, kind: SwatchKind, font: Font, fmt: (v: number, digits: number) => string, names: { cells: string; edge: string }, trimMm: number): Pattern {
  const cells: ThreadColor = { ...CELLS, name: names.cells };
  const edgeColor: ThreadColor = { ...EDGE, name: names.edge };
  const fabric: Profile = { fabric: p.fabric, thread: p.thread };
  const grid = swatchGrid(fabric, kind);
  const base = digitizeDefaults(fabric);
  let pat: Pattern = EMPTY;
  let n = 0;
  const label = (text: string, x: number, y: number, align: Lettering['align']) => {
    const l: Lettering = { ...LETTERING_DEFAULTS, id: `swatch${n++}`, text, font: font.id, height: LABEL_MM, spacing: LABEL_SPACING, align, x, y, color: { ...cells } };
    const placed = placeLettering(pat, [], sewLettering(font, l, Math.min(trimMm, LABEL_TRIM)), l, 'swatch');
    if (placed) pat = placed.pattern;
  };
  // After the last object: in its thread when the color is the same, not a color block of its own.
  const last = () => sewObjects(pat).length - 1;
  const add = (r: { pattern: Pattern } | null) => {
    if (r) pat = r.pattern;
  };
  // Rows back and forth, the last from right to left: it ends next to the row labels.
  const rows = grid.spacings.length;
  grid.spacings.forEach((s, r) => {
    const cols = grid.pulls.map((_, c) => c);
    if ((rows - 1 - r) % 2 === 0) cols.reverse();
    for (const c of cols) {
      const [x0, y0] = cellAt(r, c);
      const pull = grid.pulls[c];
      if (kind === 'fill') {
        // The edge a real fill of this size gets with this pull (see pullFor), rows across so the pull shows at the sides.
        const edge = pullFor({ ...fabric, own: { fill: { spacing: s, pull } } }, 'fill', SWATCH_CELL * SWATCH_CELL).edge;
        add(addShape(pat, { form: square(x0, y0, SWATCH_CELL), kind: 'fill' }, cells, last(), { ...base, spacing: s, pull: edge, angle: 0, flow: false }));
      } else {
        // A satin gets half its pull fixed and half by its width (see satinOf): at RING_W all of it.
        const ring = circle(x0 + SWATCH_CELL / 2, y0 + SWATCH_CELL / 2, (SWATCH_CELL - RING_W) / 2);
        add(addLine(pat, ring, { type: 'satin', width: RING_W, spacing: s, pull, tolerance: base.tolerance, ...(base.underCross ? { underCross: true } : {}) }, cells, last(), base));
      }
    }
  });
  for (let r = rows - 1; r >= 0; r--) label(fmt(grid.spacings[r], 2), LABEL_W - 2, cellAt(r, 0)[1] + SWATCH_CELL / 2 + LABEL_MM / 2, 'right');
  grid.pulls.forEach((v, c) => label(`+${fmt(v, pullDigits(v))}`, cellAt(0, c)[0] + SWATCH_CELL / 2, HEAD_H - 2.5, 'center'));
  // The nominal edges, last, so they lie on top where the cells should reach.
  grid.spacings.forEach((_, r) => {
    const cols = grid.pulls.map((_, c) => c);
    if (r % 2 === 0) cols.reverse();
    for (const c of cols) {
      const [x0, y0] = cellAt(r, c);
      const cx = x0 + SWATCH_CELL / 2;
      const cy = y0 + SWATCH_CELL / 2;
      const forms = kind === 'fill' ? [square(x0, y0, SWATCH_CELL)] : [circle(cx, cy, SWATCH_CELL / 2), circle(cx, cy, SWATCH_CELL / 2 - RING_W)];
      for (const f of forms) add(addLine(pat, f, { type: 'run', width: 1, length: 2, tolerance: base.tolerance }, edgeColor, last(), base));
    }
  });
  if (!pat.cmd.length) throw new Error('test swatch: nothing sewn');
  return pat;
}
