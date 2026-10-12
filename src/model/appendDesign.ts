import { insertObject } from './addShape';
import { newLink, syncBorders } from './border';
import { recs } from './jumps';
import { sewObjects, type SewObject } from './objects';
import { JUMP, STITCH, type Pattern } from './pattern';
import { objectKey, remember, remembered, type Remembered } from './restitch';
import { stitchesBefore } from './transform';
import { transformSewObject } from './reshape';
import { stitchKinds } from './sequence';
import { translation } from '../shape/path';

/**
 * Another design sewn into `p` after all its objects, the middle of its stitches at (x, y) mm: a
 * motif of the library put into the open design. Every object of `add` stays one object, in its
 * thread (joined with the one before when that has the same color), and knows what it knew (its
 * form, stitch type, leaving out, its border or lettering, tied anew). Null when it did not come
 * out as many objects as it went in.
 */
export function appendDesign(p: Pattern, add: Pattern, x: number, y: number, trimMm: number): { pattern: Pattern; objects: number[] } | null {
  const src = movedTo(add, x, y, trimMm);
  if (!src) return null;
  const objs = sewObjects(src);
  const links = new Map<string, string>();
  let cur = p;
  const starts: number[] = [];
  for (const o of objs) {
    const own = recs(src, o.first, o.last + 1);
    if (!own.some((r) => r.cmd === STITCH)) continue;
    // Led to by a jump, as every object sewn here (never one long stitch from where the thread was).
    const records = [{ ...own[0], cmd: JUMP }, ...own];
    const before = sewObjects(cur);
    const r = insertObject(cur, records, o.color, before.length ? before.length - 1 : null, trimMm);
    if (!r) return null;
    cur = r.pattern;
    const mine = mineAt(cur, r.start);
    const memory = remembered(src, o);
    if (mine && memory) {
      // The memory of a copy is its own: the design it goes into gives it its id.
      const { id: _id, ...known } = memory;
      remember(cur, mine, renamed(known, links) as Remembered);
    }
    starts.push(r.start);
  }
  if (!starts.length) return null;
  const sewn = sewObjects(cur);
  const put = starts.map((s) => sewn.find((o) => stitchesBefore(cur, o.first) === s));
  if (put.some((o) => !o) || sewn.length !== sewObjects(p).length + starts.length) return null;
  // As after a move: a border whose fill came out otherwise is sewn anew (found again by its stitches).
  const keys = put.map((o) => objectKey(cur, o!));
  const next = syncBorders(cur, trimMm);
  const after = sewObjects(next).map((o) => objectKey(next, o));
  const objects = keys.map((k) => after.indexOf(k)).filter((i) => i >= 0);
  return { pattern: next, objects };
}

/**
 * `add` moved so the middle of its stitches is at (x, y) mm, to the nearest 0.1 mm (where a
 * stitch can be), as the app moves objects: each object with what it knows, borders after.
 */
function movedTo(add: Pattern, x: number, y: number, trimMm: number): Pattern | null {
  const b = add.bounds;
  const dx = Math.round(x * 10 - (b.minX + b.maxX) / 2) / 10;
  const dy = Math.round(y * 10 - (b.minY + b.maxY) / 2) / 10;
  if (!dx && !dy) return add;
  let cur = add;
  for (let k = sewObjects(add).length - 1; k >= 0; k--) {
    const kinds = stitchKinds(cur);
    const objs = sewObjects(cur, kinds);
    const r = objs[k] && transformSewObject(cur, objs, objs[k], kinds, translation(dx, dy), trimMm);
    if (!r) return null;
    cur = r.pattern;
  }
  return syncBorders(cur, trimMm);
}

/** Keys whose text ties objects together: a fill and its border, blend, shadow or echo, the parts of a cut fill, a lettering. */
const LINKS = new Set(['link', 'outline', 'piece', 'blendOf', 'shadowOf']);

/**
 * `v` with the ties between its objects named anew (the same new name for the same old one in all
 * objects of one design put in): the copies are tied to each other, never to what they were copied
 * from, as when the same motif goes in twice.
 */
function renamed(v: unknown, links: Map<string, string>, key = '', parent = ''): unknown {
  const fresh = (l: string) => links.get(l) ?? (links.set(l, newLink()), links.get(l)!);
  if (typeof v === 'string') {
    if (LINKS.has(key) || (key === 'id' && parent === 'lettering')) return fresh(v);
    // An echo's thread: the line's echo link and the number of the thread.
    if (key === 'echoOf') {
      const k = v.lastIndexOf(':');
      return k < 0 ? fresh(v) : `${fresh(v.slice(0, k))}${v.slice(k)}`;
    }
    return v;
  }
  if (!v || typeof v !== 'object' || ArrayBuffer.isView(v)) return v;
  if (Array.isArray(v)) return v.map((x) => renamed(x, links, '', key));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, renamed(x, links, k, key)]));
}

/** The object of `p` whose first stitch is stitch number `start`. */
function mineAt(p: Pattern, start: number): SewObject | undefined {
  return sewObjects(p).find((o) => stitchesBefore(p, o.first) === start);
}
