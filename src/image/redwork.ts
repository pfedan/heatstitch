import type { ShapeInput } from '../digitize/digitize';
import type { ThreadColor } from '../model/pattern';
import { intersectForms } from '../shape/ops';
import { clipLines, transformForm, type Box, type Form } from '../shape/path';
import type { Prepared } from './prepare';
import type { SvgShape } from './svg';

/**
 * The shapes of an SVG for the Bild assistant's Redwork style: sewn from the file's own curves (not
 * from the regions drawn of it), with what the assistant did to the picture before. The part cut
 * out (`box`, mm of the whole file at the size sewn) is kept, in mm from its top left: lines are cut
 * at its edge, areas cut to it (needs loadOps for that). Each color takes the thread its regions
 * got (`prepared.ofSource`, after thread matching, merging and changes of thread); a color not
 * sewn, or left with no region in the cut, is left out. `background` is the shape kept aside as
 * the background (see backgroundOf), or -1.
 */
export function redworkShapes(all: SvgShape[], prepared: Pick<Prepared, 'palette' | 'ofSource'>, box: Box, whole: boolean, background = -1): { shapes: ShapeInput[]; threads: ThreadColor[] } {
  const threads = prepared.palette.map((p) => p.thread);
  const rect: Form = {
    paths: [
      {
        closed: true,
        nodes: [
          [box.minX, box.minY],
          [box.maxX, box.minY],
          [box.maxX, box.maxY],
          [box.minX, box.maxY],
        ].map(([x, y]) => ({ p: [x, y], a: [x, y], b: [x, y], smooth: false })),
      },
    ],
  };
  const shapes: ShapeInput[] = [];
  all.forEach((sh, k) => {
    if (k === background) return;
    const color = prepared.ofSource?.[sh.color] ?? -1;
    if (color < 0 || !prepared.palette[color]?.sew) return;
    const kept = whole ? sh.form : sh.kind === 'stroke' ? clipLines(sh.form, box) : intersectForms(sh.form, rect);
    if (!kept?.paths.length) return;
    const form = transformForm(kept, [1, 0, 0, 1, -box.minX, -box.minY]);
    shapes.push({ ...sh, color, form });
  });
  return { shapes, threads };
}
