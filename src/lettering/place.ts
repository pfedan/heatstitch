import { sameColor } from '../model/recolor';
import { tidy, withRecords } from '../model/edit';
import { rememberObjects, sewObjects, type SewObject } from '../model/objects';
import { COLOR_CHANGE, computeBounds, END, JUMP, STITCH, TRIM, type Pattern } from '../model/pattern';
import { remember, remembered } from '../model/restitch';
import type { Lettering } from './layout';
import type { Rec, Sewn } from './sew';

/** The objects of lettering `id` in sewing order. */
export function letteringObjects(p: Pattern, objs: SewObject[], id: string): SewObject[] {
  return objs.filter((o) => remembered(p, o)?.lettering?.id === id);
}

/** The lettering object `o` belongs to, if any. */
export const letteringOf = (p: Pattern, o: SewObject | undefined): Lettering | undefined => (o ? remembered(p, o)?.lettering : undefined);

/** Records of an object with the jumps leading to it and the trim after it. */
function span(p: Pattern, o: SewObject): [number, number] {
  let a = o.first;
  while (a > 0 && p.cmd[a - 1] === JUMP) a--;
  let b = o.last + 1;
  if (b < p.cmd.length && p.cmd[b] === TRIM) b++;
  return [a, b];
}

/** The pattern without the objects `old` (their jumps and trims too); null when nothing would be left. */
export function withoutObjects(p: Pattern, old: SewObject[]): Pattern | null {
  if (!old.length) return null;
  const x = Array.from(p.x);
  const y = Array.from(p.y);
  const cmd = Array.from(p.cmd);
  for (const [a, b] of old.map((o) => span(p, o)).sort((a, b) => b[0] - a[0])) {
    x.splice(a, b - a);
    y.splice(a, b - a);
    cmd.splice(a, b - a);
  }
  if (!cmd.includes(STITCH)) return null;
  return tidy(withRecords(p, Int32Array.from(x), Int32Array.from(y), Uint8Array.from(cmd), p.colors.map((c) => ({ ...c }))));
}

export interface Placed {
  pattern: Pattern;
  /** The objects of the lettering in the new pattern. */
  objects: SewObject[];
}

/**
 * The pattern with the lettering's stitches put in: where its old objects were (they go), else
 * at the end, or as a new design when there is none. It gets its own color block when its
 * thread differs from the one it is sewn in; the objects remember the lettering.
 */
export function placeLettering(p: Pattern | null, old: SewObject[], sewn: Sewn, l: Lettering, name = 'lettering'): Placed | null {
  if (!sewn.recs.length) return null;
  let x: number[] = [];
  let y: number[] = [];
  let cmd: number[] = [];
  let colors = p ? p.colors.map((c) => ({ ...c })) : [];
  let at: number;
  if (!p) {
    at = 0;
    cmd = [END];
    x = [sewn.recs[sewn.recs.length - 1].x];
    y = [sewn.recs[sewn.recs.length - 1].y];
    colors = [{ ...l.color }];
  } else {
    x = Array.from(p.x);
    y = Array.from(p.y);
    cmd = Array.from(p.cmd);
    // The old objects go, the last first so the earlier records stay where they are.
    const spans = old.map((o) => span(p, o)).sort((a, b) => b[0] - a[0]);
    for (const [a, b] of spans) {
      x.splice(a, b - a);
      y.splice(a, b - a);
      cmd.splice(a, b - a);
    }
    at = spans.length ? spans[spans.length - 1][0] : cmd[cmd.length - 1] === END ? cmd.length - 1 : cmd.length;
  }
  // Its color block, and whether it shares it with other stitches before and after.
  let block = 0;
  for (let i = 0; i < at; i++) if (cmd[i] === COLOR_CHANGE) block++;
  const stitchesIn = (from: number, to: number, dir: 1 | -1) => {
    for (let i = from; dir > 0 ? i < to : i >= to; i += dir) {
      if (cmd[i] === COLOR_CHANGE) return false;
      if (cmd[i] === STITCH) return true;
    }
    return false;
  };
  const before = !!p && stitchesIn(at - 1, 0, -1);
  const after = !!p && stitchesIn(at, cmd.length, 1);
  const ins: Rec[] = [];
  const prevCmd = at > 0 ? cmd[at - 1] : TRIM;
  const here = { x: at > 0 ? x[at - 1] : sewn.recs[0].x, y: at > 0 ? y[at - 1] : sewn.recs[0].y };
  if (!p || sameColor(colors[block], l.color) || (!before && !after)) {
    if (p && !before && !after) colors[block] = { ...l.color };
    if (prevCmd === STITCH || prevCmd === JUMP) ins.push({ ...here, cmd: TRIM });
    ins.push(...sewn.recs);
  } else {
    if (before) {
      if (prevCmd === STITCH || prevCmd === JUMP) ins.push({ ...here, cmd: TRIM });
      ins.push({ ...here, cmd: COLOR_CHANGE });
    }
    ins.push(...sewn.recs);
    if (after) ins.push({ x: sewn.recs[sewn.recs.length - 1].x, y: sewn.recs[sewn.recs.length - 1].y, cmd: COLOR_CHANGE });
    const own = { ...l.color };
    if (before && after) colors.splice(block + 1, 0, own, { ...colors[block] });
    else if (before) colors.splice(block + 1, 0, own);
    else colors.splice(block, 0, own);
  }
  x.splice(at, 0, ...ins.map((r) => r.x));
  y.splice(at, 0, ...ins.map((r) => r.y));
  cmd.splice(at, 0, ...ins.map((r) => r.cmd));
  const X = Int32Array.from(x);
  const Y = Int32Array.from(y);
  const C = Uint8Array.from(cmd);
  const base: Pattern = p ?? { name, format: 'pes', x: X, y: Y, cmd: C, colors, bounds: computeBounds(X, Y, C) };
  // Where its first stitch is, counted from the start (tidy only drops trims and color changes).
  let first = 0;
  for (let i = 0; i < at; i++) if (cmd[i] === STITCH) first++;
  const next = tidy(withRecords(base, X, Y, C, colors));
  // The lettering is one object, also where it is trimmed between letters and words.
  rememberObjects(next, [first], first + sewn.stitches);
  const objs = sewObjects(next);
  let n = 0;
  const number = new Int32Array(next.cmd.length);
  for (let i = 0; i < next.cmd.length; i++) {
    number[i] = n;
    if (next.cmd[i] === STITCH) n++;
  }
  const mine = objs.filter((o) => number[o.first] >= first && number[o.first] < first + sewn.stitches);
  for (const o of mine) remember(next, o, { region: null, lettering: l });
  return { pattern: next, objects: mine };
}
