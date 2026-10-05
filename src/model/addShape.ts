import { digitizeShapes, type DigitizeOptions } from '../digitize/digitize';
import type { Form } from '../shape/path';
import { build, recs, type Rec } from './jumps';
import { rememberObjects, sewObjects } from './objects';
import { reorder } from './order';
import { COLOR_CHANGE, END, STITCH, TRIM, type Pattern, type ThreadColor } from './pattern';
import { rememberShapes } from './restitch';

/**
 * New shapes sewn into a design: an area becomes a fill (or satin, when it is a stroke), a line
 * running stitch (satin from 1 mm wide), with the stitch settings of the material. The object is
 * sewn right after object `after` in its thread, or at the end in `color` without one.
 */

export interface NewShape {
  form: Form;
  kind: 'fill' | 'stroke';
  /** Line width (mm), lines only. */
  width?: number;
}

export interface Added {
  pattern: Pattern;
  /** Number of the first stitch of the new object. */
  start: number;
}

const stitches = (p: Pattern) => p.cmd.reduce((n, c) => n + (c === STITCH ? 1 : 0), 0);

/** The records of `p` up to its end mark. */
function body(p: Pattern): Rec[] {
  let n = p.cmd.length;
  while (n > 0 && p.cmd[n - 1] === END) n--;
  return recs(p, 0, n);
}

export function addShape(p: Pattern, shape: NewShape, color: ThreadColor, after: number | null, options: DigitizeOptions): Added | null {
  const d = digitizeShapes([{ color: 0, ...shape }], [color], options, { w: 0, h: 0 }, false, 'shape');
  if (!d.objects.length || !stitches(d.pattern)) return null;
  const before = stitches(p);
  let joined: Pattern;
  if (!before) joined = d.pattern;
  else {
    const out = body(p);
    const last = out[out.length - 1];
    // Its own color block at the end first; reorder moves it where it belongs.
    out.push({ x: last.x, y: last.y, cmd: TRIM }, { x: last.x, y: last.y, cmd: COLOR_CHANGE }, ...body(d.pattern));
    const end = out[out.length - 1];
    out.push({ x: end.x, y: end.y, cmd: END });
    joined = build({ ...p, colors: [...p.colors, ...d.pattern.colors] }, out);
  }
  const total = stitches(joined);
  // The objects as they were, and the new one as one object.
  const objsBefore = before ? sewObjects(p) : [];
  const startsBefore = objsBefore.map((o) => {
    let n = 0;
    for (let i = 0; i < o.first; i++) if (p.cmd[i] === STITCH) n++;
    return n;
  });
  rememberObjects(joined, [...startsBefore, before], total);
  let objs = sewObjects(joined);
  const mine = objs.findIndex((o) => {
    let n = 0;
    for (let i = 0; i < o.first; i++) if (joined.cmd[i] === STITCH) n++;
    return n === before;
  });
  if (mine < 0) return null;
  let result = joined;
  let start = before;
  if (after !== null && objs[after] && after !== mine - 1) {
    const order = objs.map((o) => o.index).filter((i) => i !== mine);
    order.splice(order.indexOf(after) + 1, 0, mine);
    const starts: number[] = [];
    result = reorder(joined, objs, order, options.trimMm, starts, { into: new Map([[mine, objs[after].block]]) });
    rememberObjects(result, starts);
    start = starts[order.indexOf(mine)];
  } else if (after !== null && objs[after] && objs[after].block !== objs[mine].block) {
    // Right after `after` already, but in its own block: into that thread.
    const starts: number[] = [];
    result = reorder(joined, objs, objs.map((o) => o.index), options.trimMm, starts, { into: new Map([[mine, objs[after].block]]) });
    rememberObjects(result, starts);
    start = starts[mine];
  }
  objs = sewObjects(result);
  rememberShapes(result, objs, [start], [d.objects[0].shape], [d.objects[0]]);
  return { pattern: result, start };
}
