import { digitizeShapes, type DigitizeOptions } from '../digitize/digitize';
import type { Form } from '../shape/path';
import { build, recs, type Rec } from './jumps';
import { rememberObjects, sewObjects } from './objects';
import { reorder } from './order';
import { stitchesBefore } from './transform';
import { COLOR_CHANGE, END, STITCH, TRIM, type Pattern, type ThreadColor } from './pattern';
import { remember, rememberShapes } from './restitch';
import { lineStitchFor, lineStitches } from './line';
import type { PathStitch } from './along';
import { runRecords } from './border';

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
  if (shape.kind === 'stroke') return addLine(p, shape.form, lineStitchFor(shape.width ?? 0, options.tolerance), color, after, options);
  const d = digitizeShapes([{ color: 0, ...shape }], [color], options, { w: 0, h: 0 }, false, 'shape');
  if (!d.objects.length || !stitches(d.pattern)) return null;
  const r = insertObject(p, body(d.pattern), d.pattern.colors[0], after, options.trimMm);
  if (!r) return null;
  rememberShapes(r.pattern, sewObjects(r.pattern), [r.start], [d.objects[0].shape], [d.objects[0]]);
  return r;
}

/** A line sewn along its curves (see line.ts); it remembers them, so it can be edited as a line. */
export function addLine(p: Pattern, form: Form, st: PathStitch, color: ThreadColor, after: number | null, options: { trimMm: number }): Added | null {
  const runs = lineStitches(form, st);
  if (!runs.length) return null;
  const r = insertObject(p, runRecords(runs, options.trimMm), color, after, options.trimMm);
  if (!r) return null;
  const obj = sewObjects(r.pattern).find((o) => stitchesBefore(r.pattern, o.first) === r.start);
  if (obj) remember(r.pattern, obj, { region: null, path: form, line: { ...st } });
  return r;
}

const same = (a: ThreadColor, b: ThreadColor) => a.r === b.r && a.g === b.g && a.b === b.b;

/**
 * Stitches `records` (one object, from its first stitch on) sewn into `p` in `color`: right after
 * object `after` (-1: before all others; null: at the end), in the thread of a neighbour of the
 * same color, else as a color of its own. Null when it did not come out as one object.
 */
export function insertObject(p: Pattern, records: Rec[], color: ThreadColor, after: number | null, trimMm: number): Added | null {
  const before = stitches(p);
  let joined: Pattern;
  if (!before) joined = build({ ...p, colors: [color] }, [...records, { ...records[records.length - 1], cmd: END }]);
  else {
    const out = body(p);
    const last = out[out.length - 1];
    // Its own color block at the end first; reorder moves it where it belongs.
    out.push({ x: last.x, y: last.y, cmd: TRIM }, { x: last.x, y: last.y, cmd: COLOR_CHANGE }, ...records);
    const end = out[out.length - 1];
    out.push({ x: end.x, y: end.y, cmd: END });
    joined = build({ ...p, colors: [...p.colors, color] }, out);
  }
  const total = stitches(joined);
  // The objects as they were, and the new one as one object.
  const objsBefore = before ? sewObjects(p) : [];
  const startsBefore = objsBefore.map((o) => stitchesBefore(p, o.first));
  rememberObjects(joined, [...startsBefore, before], total);
  const objs = sewObjects(joined);
  const mine = objs.findIndex((o) => stitchesBefore(joined, o.first) === before);
  if (mine < 0) return null;
  if (after === null || !objsBefore.length) return { pattern: joined, start: before };
  const at = Math.max(-1, Math.min(after, mine - 1));
  const prev = objs[at];
  const next = objs[at + 1] !== objs[mine] ? objs[at + 1] : undefined;
  // Into the thread of a neighbour of the same color.
  const host = prev && same(prev.color, color) ? prev : next && same(next.color, color) ? next : null;
  if (at === mine - 1 && (!host || host.block === objs[mine].block)) return { pattern: joined, start: before };
  const order = objs.map((o) => o.index).filter((i) => i !== mine);
  order.splice(at + 1, 0, mine);
  const starts: number[] = [];
  const result = reorder(joined, objs, order, trimMm, starts, host ? { into: new Map([[mine, host.block]]) } : {});
  rememberObjects(result, starts);
  return { pattern: result, start: starts[order.indexOf(mine)] };
}
