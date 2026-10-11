import { sewList } from './sew';
import { joinedUncut, type SewObject } from './objects';
import { COLOR_CHANGE, JUMP, STITCH, TRIM, type Pattern, type ThreadColor } from './pattern';
import { sameColor } from './recolor';
import { innerStops } from './applique';

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

type Link = 'color' | 'original' | 'trim' | 'jump';

/**
 * How the machine goes from `a` to `b`: a change of thread, the way the file had (they follow each
 * other as in the file), or a new jump, trimmed when long. With `fresh`, the way is new also
 * between neighbours as in the file (their stitches changed, so the old way may not fit).
 */
function link(p: Pattern, a: SewObject, b: SewObject, keyA: string, keyB: string, trimMm: number, fresh?: ReadonlySet<number>, d = gap(p, a, b)): Link {
  if (keyA !== keyB) return 'color';
  const kept = !fresh?.has(a.index) && !fresh?.has(b.index);
  if (b.index === a.index + 1 && b.block === a.block && kept) return 'original';
  // Joined without a cut in the file, they stay so (as sewList keeps them).
  if (kept && joinedUncut(p, a, b)) return 'jump';
  return d > trimMm ? 'trim' : 'jump';
}

const flippedSet = (ends: Ends) => {
  const out = new Set<number>();
  ends.flip.forEach((f, i) => f && out.add(i));
  return out;
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

const gap = (p: Pattern, a: SewObject, b: SewObject) => {
  const i = lastStitch(p, a);
  const j = firstStitch(p, b);
  return Math.hypot(p.x[j] - p.x[i], p.y[j] - p.y[i]) / 10;
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

/** Start and end of each object as sewn (flip 0) or from the other side (flip 1). */
class Ends {
  private firsts: Int32Array;
  private lasts: Int32Array;

  constructor(
    private p: Pattern,
    objs: SewObject[],
    private rev: (Reversal | null)[],
    readonly flip: Uint8Array,
  ) {
    this.firsts = Int32Array.from(objs, (o) => firstStitch(p, o));
    this.lasts = Int32Array.from(objs, (o) => lastStitch(p, o));
  }

  can(i: number): boolean {
    return !!this.rev[i];
  }

  /** Way from the end of `a` to the start of `b` (mm), `b` sewn with `fb`. */
  gap(a: number, b: number, fb = this.flip[b]): number {
    const p = this.p;
    const ra = this.flip[a] ? this.rev[a] : null;
    const rb = fb ? this.rev[b] : null;
    const ax = ra ? ra.ex : p.x[this.lasts[a]];
    const ay = ra ? ra.ey : p.y[this.lasts[a]];
    const bx = rb ? rb.sx : p.x[this.firsts[b]];
    const by = rb ? rb.sy : p.y[this.firsts[b]];
    return Math.hypot(bx - ax, by - ay) / 10;
  }
}

const noFlips = (p: Pattern, objs: SewObject[]) => new Ends(p, objs, objs.map(() => null), new Uint8Array(objs.length));

export function orderCost(p: Pattern, objs: SewObject[], order: number[], trimMm: number, ends = noFlips(p, objs)): OrderCost {
  const keys = keysOf(p, objs);
  const cost: OrderCost = { colorChanges: 0, trims: 0, travelMm: 0 };
  const flipped = flippedSet(ends);
  for (let k = 1; k < order.length; k++) {
    const a = objs[order[k - 1]];
    const b = objs[order[k]];
    const d = ends.gap(a.index, b.index);
    const l = link(p, a, b, keys[a.index], keys[b.index], trimMm, flipped, d);
    cost.travelMm += d;
    if (l === 'color') {
      cost.colorChanges++;
      cost.trims++;
    } else if (l === 'trim') cost.trims++;
    else if (l === 'original') {
      for (let i = a.last + 1; i < b.first; i++) {
        if (p.cmd[i] === TRIM) {
          cost.trims++;
          break;
        }
      }
    }
  }
  return cost;
}

/** One number to compare orders by: a color change costs most, then a trim, then travel. */
export const weigh = (c: OrderCost) => c.colorChanges * 1000 + c.trims * 40 + c.travelMm;

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

type ColorPick = 'original' | 'complete';

function greedy(objs: SewObject[], over: number[][], keys: string[], o: OrderOptions, pick: ColorPick, ends: Ends): number[] {
  const n = objs.length;
  const waiting = over.map((l) => l.length);
  const after: number[][] = objs.map(() => []);
  over.forEach((l, b) => l.forEach((a) => after[a].push(b)));
  const done = new Uint8Array(n);
  const order: number[] = [];
  const remaining = new Map<string, number>();
  for (const k of keys) remaining.set(k, (remaining.get(k) ?? 0) + 1);
  const take = (i: number) => {
    done[i] = 1;
    order.push(i);
    remaining.set(keys[i], remaining.get(keys[i])! - 1);
    for (const b of after[i]) waiting[b]--;
  };
  take(0);
  while (order.length < n) {
    const last = objs[order[order.length - 1]];
    const avail: number[] = [];
    for (let i = 0; i < n; i++) if (!done[i] && waiting[i] === 0) avail.push(i);
    let pool: number[];
    if (!o.combineColors) {
      // Color blocks stay as they are: finish the current block, then the next one in order.
      const block = avail.some((i) => objs[i].block === last.block) ? last.block : Math.min(...avail.map((i) => objs[i].block));
      pool = avail.filter((i) => objs[i].block === block);
    } else {
      pool = avail.filter((i) => keys[i] === keys[last.index]);
      if (!pool.length) {
        let key = keys[Math.min(...avail)];
        if (pick === 'complete') {
          // The thread the most of whose remaining objects can be sewn now.
          let best = -1;
          for (const i of avail) {
            const k = keys[i];
            const share = avail.filter((j) => keys[j] === k).length / remaining.get(k)!;
            if (share > best + 1e-9) {
              best = share;
              key = k;
            }
          }
        }
        pool = avail.filter((i) => keys[i] === key);
      }
    }
    let next = pool[0];
    if (o.shortestWays) {
      let bd = Infinity;
      let bf = 0;
      for (const i of pool) {
        for (let f = 0; f <= (ends.can(i) ? 1 : 0); f++) {
          // Going on with the object that followed in the file keeps its move as it was.
          const d = ends.gap(last.index, i, f) - (i === last.index + 1 && !f && !ends.flip[last.index] ? 0.5 : 0);
          // Sewing one from the other side has to be clearly shorter: it means new stitches.
          if (d + (f ? 1 : 0) < bd) {
            bd = d + (f ? 1 : 0);
            next = i;
            bf = f;
          }
        }
      }
      ends.flip[next] = bf;
    } else next = Math.min(...pool);
    take(next);
  }
  return order;
}

/** 2-opt within runs of one color: reverses stretches where that shortens the moves. */
function untangle(over: number[][], keys: string[], order: number[], ends: Ends): number[] {
  const out = order.slice();
  const d = (a: number, b: number) => ends.gap(a, b);
  let start = 0;
  while (start < out.length) {
    let end = start;
    while (end + 1 < out.length && keys[out[end + 1]] === keys[out[start]]) end++;
    if (end - start >= 2 && end - start < 250) {
      for (let pass = 0; pass < 4; pass++) {
        let improved = false;
        for (let i = start; i < end; i++) {
          for (let j = i + 1; j <= end; j++) {
            // Moves into, inside and out of the stretch before and after reversing it.
            let before = 0;
            let afterRev = 0;
            if (i > 0) {
              before += d(out[i - 1], out[i]);
              afterRev += d(out[i - 1], out[j]);
            }
            if (j + 1 < out.length) {
              before += d(out[j], out[j + 1]);
              afterRev += d(out[i], out[j + 1]);
            }
            for (let k = i; k < j; k++) {
              before += d(out[k], out[k + 1]);
              afterRev += d(out[k + 1], out[k]);
            }
            if (afterRev >= before - 0.05) continue;
            const seg = out.slice(i, j + 1);
            const set = new Set(seg);
            // Nothing in the stretch may lie on another part of it.
            if (seg.some((o) => over[o].some((a) => set.has(a)))) continue;
            out.splice(i, seg.length, ...seg.reverse());
            improved = true;
          }
        }
        if (!improved) break;
      }
    }
    start = end + 1;
  }
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

/** Sewing one from the other side has to save at least this much (weigh units, 1 per mm). */
const FLIP_GAIN = 2;

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
 * caller weighs them on what they really give.
 */
export function planCandidates(p: Pattern, objs: SewObject[], over: number[][], o: OrderOptions, reversible?: readonly boolean[]): OrderPlan[] {
  const original = objs.map((_, i) => i);
  if (objs.length < 1) return [];
  const keys = keysOf(p, objs);
  const rev = objs.map((ob, i) => (reversible?.[i] ? reversalOf(p, ob) : null));
  const plain = noFlips(p, objs);
  const base = weigh(orderCost(p, objs, original, o.trimMm, plain));
  const found: { plan: OrderPlan; cost: number }[] = [];
  const consider = (order: number[], ends: Ends) => {
    if (violations(order, over).length) return;
    const c = weigh(orderCost(p, objs, order, o.trimMm, ends));
    const flip = [...flippedSet(ends)].sort((a, b) => a - b);
    // Sewing some from the other side has to save clearly more than the order alone.
    if (c >= base - 1e-6 - (flip.length ? FLIP_GAIN : 0)) return;
    const key = `${order.join(',')}|${flip.join(',')}`;
    if (found.some((f) => `${f.plan.order.join(',')}|${f.plan.flip.join(',')}` === key)) return;
    found.push({ plan: { order, flip }, cost: c + (flip.length ? FLIP_GAIN : 0) });
  };
  const flipping = rev.some(Boolean);
  for (const pick of ['original', 'complete'] as ColorPick[]) {
    for (const withFlips of flipping ? [false, true] : [false]) {
      if (objs.length < 2 && !withFlips) continue;
      const ends = withFlips ? new Ends(p, objs, rev, new Uint8Array(objs.length)) : noFlips(p, objs);
      let order = objs.length < 2 ? original : greedy(objs, over, keys, o, pick, ends);
      if (o.shortestWays) order = untangle(over, keys, order, ends);
      if (withFlips) improveFlips(p, objs, order, o.trimMm, ends);
      consider(order, ends);
    }
  }
  // The original order with only some objects reversed.
  if (flipping) {
    const ends = new Ends(p, objs, rev, new Uint8Array(objs.length));
    improveFlips(p, objs, original, o.trimMm, ends);
    consider(original, ends);
  }
  return found.sort((a, b) => a.cost - b.cost).map((f) => f.plan);
}

/** Turns objects around one at a time where that makes the order cheaper (a few passes). */
function improveFlips(p: Pattern, objs: SewObject[], order: number[], trimMm: number, ends: Ends): void {
  let cost = weigh(orderCost(p, objs, order, trimMm, ends));
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const i of order) {
      if (!ends.can(i)) continue;
      ends.flip[i] ^= 1;
      const c = weigh(orderCost(p, objs, order, trimMm, ends));
      // Turned around only for a real saving, and back again when that is not worse.
      if (c < cost - (ends.flip[i] ? FLIP_GAIN : -1e-6)) {
        cost = c;
        changed = true;
      } else ends.flip[i] ^= 1;
    }
    if (!changed) break;
  }
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
