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
 * rings for satin (they show the pull in every direction), labels with their values. Roidery sews
 * them in triple run; we take Glacial Tiny, a font made for small text, which read clearly at 4.5 mm
 * in the realistic view where Caffeine tiny's running stitch merged "0," into a "Q". Our own addition is a running stitch on each cell's nominal edge, sewn
 * last in a second thread: a gap between it and the stitches means too little compensation, stitches
 * far past it too much (Hatch: "It is easy to see if objects that should be touching or outlines have
 * gaps between them"). The grid is centred on the fabric's own values, never on values measured
 * before, so a swatch stitched once keeps matching the picker in the app.
 */

export type SwatchKind = 'fill' | 'satin';

export interface SwatchGrid {
  kind: SwatchKind;
  /** Spacing per row (mm), densest first. */
  spacings: number[];
  /** Pull compensation per column (the fabric's pullMm), none first. */
  pulls: number[];
}

/** Cells (mm), the gap between them, the column of row labels and the row of column labels. */
export const SWATCH_CELL = 12;
const GAP = 5;
const LABEL_W = 13;
const HEAD_H = 8;
/** Letter height (mm): Glacial Tiny is good from 2.8 to 8.3 mm. */
const LABEL_MM = 4.5;
/** Satin rings: column width (mm), the width at which a satin gets the whole pull (PULL_WIDTH). */
const RING_W = 4;
/** The font of the labels, made for small text. */
export const SWATCH_FONT = 'glacial_tiny';

/** Steps of the spacing (about 12 % each, as the density ladder's 16 % but finer) and how many pull steps. */
const SPACING_STEP = 1.12;
const ROWS = 5;
const COLS = 4;

/** The two threads: the cells (and labels) dark, the nominal edge in a colour that stands out against them. */
const CELLS = { r: 30, g: 60, b: 140 };
const EDGE = { r: 220, g: 70, b: 40 };

const ID: Mat = [1, 0, 0, 1, 0, 0];
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
export const cellAt = (row: number, col: number): [number, number] => [LABEL_W + col * (SWATCH_CELL + GAP), HEAD_H + row * (SWATCH_CELL + GAP)];

const square = (x: number, y: number, w: number) => parsePath(`M${x} ${y} L${x + w} ${y} L${x + w} ${y + w} L${x} ${y + w} Z`, ID);
const circle = (cx: number, cy: number, r: number) =>
  parsePath(`M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`, ID);

/**
 * The swatch as a new design: column labels (pull, with a plus) and row labels (spacing) as
 * lettering, the cells row by row in one thread, then the nominal edges in a second.
 * `fmt` writes a number as the app's language does, `names` names the two threads.
 */
export function testSwatch(p: Profile, kind: SwatchKind, font: Font, fmt: (v: number, digits: number) => string, names: { cells: string; edge: string }, trimMm: number): Pattern {
  const cells: ThreadColor = { ...CELLS, name: names.cells };
  const edgeColor: ThreadColor = { ...EDGE, name: names.edge };
  const fabric: Profile = { fabric: p.fabric, thread: p.thread };
  const grid = swatchGrid(fabric, kind);
  const base = digitizeDefaults(fabric);
  let pat: Pattern | null = null;
  let n = 0;
  const label = (text: string, x: number, y: number, align: Lettering['align']) => {
    const l: Lettering = { ...LETTERING_DEFAULTS, id: `swatch${n++}`, text, font: font.id, height: LABEL_MM, align, x, y, color: { ...cells } };
    const placed = placeLettering(pat, [], sewLettering(font, l, trimMm), l, 'swatch');
    if (placed) pat = placed.pattern;
  };
  // After the last object: in its thread when the color is the same, not a color block of its own.
  const last = () => sewObjects(pat!).length - 1;
  const add = (r: { pattern: Pattern } | null) => {
    if (r) pat = r.pattern;
  };
  grid.pulls.forEach((v, c) => label(`+${fmt(v, pullDigits(v))}`, cellAt(0, c)[0] + SWATCH_CELL / 2, HEAD_H - 2.5, 'center'));
  grid.spacings.forEach((s, r) => {
    const [, y] = cellAt(r, 0);
    label(fmt(s, 2), LABEL_W - 2, y + SWATCH_CELL / 2 + LABEL_MM / 2, 'right');
    // Every other row from the right: shorter ways between the cells.
    const cols = grid.pulls.map((_, c) => c);
    if (r % 2) cols.reverse();
    for (const c of cols) {
      const [x0, y0] = cellAt(r, c);
      const pull = grid.pulls[c];
      if (kind === 'fill') {
        // The edge a real fill of this size gets with this pull (see pullFor), rows across so the pull shows at the sides.
        const edge = pullFor({ ...fabric, own: { fill: { spacing: s, pull } } }, 'fill', SWATCH_CELL * SWATCH_CELL).edge;
        add(addShape(pat!, { form: square(x0, y0, SWATCH_CELL), kind: 'fill' }, cells, last(), { ...base, spacing: s, pull: edge, angle: 0, flow: false }));
      } else {
        // A satin gets half its pull fixed and half by its width (see satinOf): at RING_W all of it.
        const ring = circle(x0 + SWATCH_CELL / 2, y0 + SWATCH_CELL / 2, (SWATCH_CELL - RING_W) / 2);
        add(addLine(pat!, ring, { type: 'satin', width: RING_W, spacing: s, pull, tolerance: base.tolerance, ...(base.underCross ? { underCross: true } : {}) }, cells, last(), base));
      }
    }
  });
  // The nominal edges, last, so they lie on top where the cells should reach.
  grid.spacings.forEach((_, r) => {
    const cols = grid.pulls.map((_, c) => c);
    if (r % 2 === 0) cols.reverse();
    for (const c of cols) {
      const [x0, y0] = cellAt(r, c);
      const cx = x0 + SWATCH_CELL / 2;
      const cy = y0 + SWATCH_CELL / 2;
      const forms = kind === 'fill' ? [square(x0, y0, SWATCH_CELL)] : [circle(cx, cy, SWATCH_CELL / 2), circle(cx, cy, SWATCH_CELL / 2 - RING_W)];
      for (const f of forms) add(addLine(pat!, f, { type: 'run', width: 1, length: 2, tolerance: base.tolerance }, edgeColor, last(), base));
    }
  });
  if (!pat) throw new Error('test swatch: nothing sewn');
  return pat;
}
