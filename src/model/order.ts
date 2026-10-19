import { sewList } from './sew';
import type { SewObject } from './objects';
import { COLOR_CHANGE, JUMP, STITCH, TRIM, type Pattern, type ThreadColor } from './pattern';
import { sameColor } from './recolor';
import { innerStops } from './applique';
import { core } from '../wasm/core';

/**
 * Sewing order of the objects: what the machine sews when. Changing it changes neither the
 * stitches nor what lies on top where objects overlap (an object stays after everything it
 * covers); it changes how often the machine stops for a color, trims, and how far it travels.
 *
 * The optimizer works like the "auto sequence" of digitizing software: it sews all objects of one
 * thread together where the layering allows (combining color blocks), and goes from each object to
 * the nearest one that may come next (shortest ways), then straightens out crossings within a
 * color with 2-opt moves. Its costs only model the sewn result: bestOrder sews the best orders
 * found and proposes one only when the order card shows it better than the original.
 */

export interface OrderOptions {
  /** Sew objects of the same thread together where no other color has to lie in between. */
  combineColors: boolean;
  /** Within a color, go to the nearest object next. */
  shortestWays: boolean;
  /** New moves longer than this are trimmed (mm). */
  trimMm: number;
}

export interface OrderCost {
  colorChanges: number;
  trims: number;
  /** Total length of the moves between objects (mm). */
  travelMm: number;
}

/**
 * The thread of each color block as a key. A block in the same color as the one before it is a
 * stop on purpose (applique, a change of hoop), so it keeps a key of its own.
 */
export function blockKeys(p: Pattern, blocks: number): string[] {
  const out: string[] = [];
  const key = (c: ThreadColor | undefined) => (c ? `${c.r},${c.g},${c.b},${c.name ?? ''}` : '?');
  // A stop inside an object (an appliqué's fabric laid on or cut off) belongs to it: the block it
  // opens is sewn in the thread of the block before, what follows it in that block too.
  const inner = innerStops(p);
  for (let b = 0; b < blocks; b++) {
    const c = p.colors[b] ?? p.colors[p.colors.length - 1];
    if (inner.has(b)) out.push(out[b - 1]);
    else out.push(b > 0 && sameColor(c, p.colors[b - 1] ?? p.colors[p.colors.length - 1]) ? `stop${b}:${key(c)}` : key(c));
  }
  return out;
}

const keysOf = (p: Pattern, objs: SewObject[]) => {
  const blocks = objs.length ? Math.max(...objs.map((o) => o.block)) + 1 : 0;
  const keys = blockKeys(p, blocks);
  return objs.map((o) => keys[o.block]);
};

/**
 * The first and last stitch of an object (records): an object recognized in a file can begin or end
 * with the jump that leads on, and the way is measured between stitches, as the card does.
 */
const firstStitch = (p: Pattern, o: SewObject) => {
  let i = o.first;
  while (i < o.last && p.cmd[i] !== STITCH) i++;
  return i;
};
const lastStitch = (p: Pattern, o: SewObject) => {
  let i = o.last;
  while (i > o.first && p.cmd[i] !== STITCH) i--;
  return i;
};

/**
 * Where an object would start and end when sewn from the other side (0.1 mm): a fill starts where
 * it ended and ends about where it started; a satin that comes back to its start (underlay out,
 * column back) starts and ends at its far end then.
 */
export interface Reversal {
  sx: number;
  sy: number;
  ex: number;
  ey: number;
}

export function reversalOf(p: Pattern, o: SewObject): Reversal {
  const fx = p.x[firstStitch(p, o)];
  const fy = p.y[firstStitch(p, o)];
  const lx = p.x[lastStitch(p, o)];
  const ly = p.y[lastStitch(p, o)];
  if (o.kind === 'satin' && Math.hypot(lx - fx, ly - fy) < 30) {
    let far = o.first;
    let best = -1;
    for (let i = o.first; i <= o.last; i++) {
      if (p.cmd[i] !== STITCH) continue;
      const d = (p.x[i] - fx) ** 2 + (p.y[i] - fy) ** 2;
      if (d > best) {
        best = d;
        far = i;
      }
    }
    return { sx: p.x[far], sy: p.y[far], ex: p.x[far], ey: p.y[far] };
  }
  return { sx: lx, sy: ly, ex: fx, ey: fy };
}

/** Positions in `order` where an object would come before something it lies on (none: valid). */
export function violations(order: number[], over: number[][]): number[] {
  const pos = new Map<number, number>();
  order.forEach((o, k) => pos.set(o, k));
  const out: number[] = [];
  order.forEach((o, k) => {
    if (over[o].some((a) => (pos.get(a) ?? -1) > k)) out.push(k);
  });
  return out;
}

/** Objects `obj` lies on that `order` sews after it, and objects lying on `obj` that come before it. */
export function conflicts(order: number[], over: number[][], obj: number): number[] {
  const pos = new Map<number, number>();
  order.forEach((o, k) => pos.set(o, k));
  const at = pos.get(obj) ?? -1;
  const out: number[] = [];
  for (const a of over[obj]) if ((pos.get(a) ?? -1) > at) out.push(a);
  over.forEach((list, b) => {
    if (list.includes(obj) && (pos.get(b) ?? Infinity) < at) out.push(b);
  });
  return out;
}

/** The best order found, or the original one (0, 1, 2, ...) when nothing is better. */
export function optimizeOrder(p: Pattern, objs: SewObject[], over: number[][], o: OrderOptions): number[] {
  return optimizePlan(p, objs, over, o).order;
}

/** An order and the objects sewn from the other side in it. */
export interface OrderPlan {
  order: number[];
  /** Objects (by index) to sew from the other side, ascending. */
  flip: number[];
}

/**
 * The best order found, and with `reversible` (per object: may it be sewn from the other side)
 * the objects that are best sewn from the other side in it; the original order without any
 * reversed when nothing is better.
 */
export function optimizePlan(p: Pattern, objs: SewObject[], over: number[][], o: OrderOptions, reversible?: readonly boolean[]): OrderPlan {
  return planCandidates(p, objs, over, o, reversible)[0] ?? { order: objs.map((_, i) => i), flip: [] };
}

/**
 * Every order the optimizer finds (and with `reversible` the objects best sewn from the other side
 * in each), cheapest by the model first, each only when it is cheaper by the model than the
 * original; empty when nothing is. The model only estimates what the sewn result will be, so the
 * caller weighs them on what they really give. Planned by the core (core/src/model/order.rs) from
 * the ends, threads and cuts of the objects read here.
 */
export function planCandidates(p: Pattern, objs: SewObject[], over: number[][], o: OrderOptions, reversible?: readonly boolean[]): OrderPlan[] {
  const n = objs.length;
  if (n < 1) return [];
  // Threads as numbers, and the cuts (trims, color changes) in the records before each point.
  const keys = keysOf(p, objs);
  const ids = new Map<string, number>();
  const cuts = new Uint32Array(p.cmd.length + 1);
  for (let i = 0; i < p.cmd.length; i++) cuts[i + 1] = cuts[i] + (p.cmd[i] === TRIM || p.cmd[i] === COLOR_CHANGE ? 1 : 0);
  const ends = new Float64Array(8 * n);
  const meta = new Uint32Array(5 * n);
  objs.forEach((ob, i) => {
    const f = firstStitch(p, ob);
    const l = lastStitch(p, ob);
    const r = reversible?.[i] ? reversalOf(p, ob) : null;
    ends.set([p.x[f], p.y[f], p.x[l], p.y[l], r ? r.sx : NaN, r ? r.sy : NaN, r ? r.ex : NaN, r ? r.ey : NaN], 8 * i);
    if (!ids.has(keys[i])) ids.set(keys[i], ids.size);
    let trimAfter = false;
    const next = objs[i + 1];
    if (next) for (let k = ob.last + 1; k < next.first && !trimAfter; k++) trimAfter = p.cmd[k] === TRIM;
    meta.set([ob.block, ids.get(keys[i])!, cuts[ob.first], cuts[ob.last + 1], (ob.tieIn ? 1 : 0) | (ob.tieOff ? 2 : 0) | (trimAfter ? 4 : 0)], 5 * i);
  });
  const flat = core().planCandidates(ends, meta, Uint32Array.from(over.flat()), Uint32Array.from(over, (l) => l.length), o.combineColors, o.shortestWays, o.trimMm);
  const out: OrderPlan[] = [];
  let at = 1;
  for (let k = 0; k < flat[0]; k++) {
    const order = Array.from(flat.subarray(at, at + n));
    at += n;
    const flip = Array.from(flat.subarray(at + 1, at + 1 + flat[at]));
    at += 1 + flip.length;
    out.push({ order, flip });
  }
  return out;
}

export interface ReorderOptions {
  /** Objects (by index) that are sewn in the thread of another color block (by index), as part of it. */
  into?: ReadonlyMap<number, number>;
  /** Objects whose ways in and out are made anew, also to and from their neighbours in the file. */
  fresh?: ReadonlySet<number>;
  /** Places in the order (by position) where the object is trimmed off the one before, never joined to it. */
  apart?: ReadonlySet<number>;
  /** Every object stays an object of its own, never joined to a neighbour (moved by hand). */
  whole?: boolean;
}

/**
 * The pattern with its objects sewn in `order`. Moves between objects that follow each other as
 * in the file are kept as they were; new ones are a jump, or a tie-off, trim, jump and tie-in when
 * longer than `trimMm`; a change of thread trims and stops for the color.
 */
export function reorder(p: Pattern, objs: SewObject[], order: number[], trimMm: number, starts?: number[], opts: ReorderOptions = {}): Pattern {
  const { into, fresh, apart, whole } = opts;
  if (order.length === objs.length && order.every((o, k) => o === k) && !into?.size && !fresh?.size) {
    starts?.push(...objs.map((o) => stitchesBefore(p, o.first)));
    return p;
  }
  const keys = keysOf(p, objs);
  const colorOf = (o: SewObject): ThreadColor => {
    const b = into?.get(o.index);
    return b === undefined ? o.color : (p.colors[b] ?? o.color);
  };
  if (into?.size) {
    const byBlock = blockKeys(p, Math.max(...objs.map((o) => o.block), ...into.values()) + 1);
    for (const [o, b] of into) keys[o] = byBlock[b];
  }
  // Moved by hand: where two objects of the same thread now meet that did not before, their
  // colors become one (a stop the file had between them stays only where nothing moved).
  if (whole) {
    for (let k = 1; k < order.length; k++) {
      const a = objs[order[k - 1]];
      const b = objs[order[k]];
      const ka = keys[a.index];
      const kb = keys[b.index];
      if (ka === kb || b.index === a.index + 1 || !sameColor(colorOf(a), colorOf(b))) continue;
      for (let i = 0; i < keys.length; i++) if (keys[i] === kb) keys[i] = ka;
    }
  }
  const list = order.map((i) => ({ obj: objs[i], color: colorOf(objs[i]), thread: keys[i] }));
  return sewList(p, list, trimMm, { fresh, apart, whole, starts });
}

function stitchesBefore(p: Pattern, at: number): number {
  let n = 0;
  for (let i = 0; i < at; i++) if (p.cmd[i] === STITCH) n++;
  return n;
}

/** Color changes, trims and travel of a whole pattern, to show what a new order changes. */
export function moveStats(p: Pattern): OrderCost {
  const out: OrderCost = { colorChanges: 0, trims: 0, travelMm: 0 };
  let last = -1;
  let trimmed = false;
  let moved = false;
  let changes = 0;
  for (let i = 0; i < p.cmd.length; i++) {
    const c = p.cmd[i];
    if (c === STITCH) {
      if (last >= 0 && moved) out.travelMm += Math.hypot(p.x[i] - p.x[last], p.y[i] - p.y[last]) / 10;
      if (trimmed) out.trims++;
      if (changes) out.colorChanges++;
      last = i;
      trimmed = moved = false;
      changes = 0;
    } else if (c === TRIM) trimmed = last >= 0;
    else if (c === COLOR_CHANGE) changes = last >= 0 ? 1 : 0;
    else if (c === JUMP) moved = true;
    if (c === TRIM || c === COLOR_CHANGE) moved = true;
  }
  return out;
}
