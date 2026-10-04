import { build, recs, tieIn, tieOff, type Rec } from './jumps';
import type { SewObject } from './objects';
import { COLOR_CHANGE, END, JUMP, STITCH, TRIM, type Pattern, type ThreadColor } from './pattern';
import { sameColor } from './recolor';

/**
 * Sewing order of the objects: what the machine sews when. Changing it changes neither the
 * stitches nor what lies on top where objects overlap (an object stays after everything it
 * covers); it changes how often the machine stops for a color, trims, and how far it travels.
 *
 * The optimizer works like the "auto sequence" of digitizing software: it sews all objects of one
 * thread together where the layering allows (combining color blocks), and goes from each object to
 * the nearest one that may come next (shortest ways), then straightens out crossings within a
 * color with 2-opt moves. It keeps the original when that is not worse.
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
  for (let b = 0; b < blocks; b++) {
    const c = p.colors[b] ?? p.colors[p.colors.length - 1];
    out.push(b > 0 && sameColor(c, p.colors[b - 1] ?? p.colors[p.colors.length - 1]) ? `stop${b}:${key(c)}` : key(c));
  }
  return out;
}

const keysOf = (p: Pattern, objs: SewObject[]) => {
  const blocks = objs.length ? Math.max(...objs.map((o) => o.block)) + 1 : 0;
  const keys = blockKeys(p, blocks);
  return objs.map((o) => keys[o.block]);
};

type Link = 'color' | 'original' | 'trim' | 'jump';

function link(p: Pattern, a: SewObject, b: SewObject, keyA: string, keyB: string, trimMm: number): Link {
  if (keyA !== keyB) return 'color';
  if (b.index === a.index + 1 && b.block === a.block) return 'original';
  return gap(p, a, b) > trimMm ? 'trim' : 'jump';
}

const gap = (p: Pattern, a: SewObject, b: SewObject) => Math.hypot(p.x[b.first] - p.x[a.last], p.y[b.first] - p.y[a.last]) / 10;

export function orderCost(p: Pattern, objs: SewObject[], order: number[], trimMm: number): OrderCost {
  const keys = keysOf(p, objs);
  const cost: OrderCost = { colorChanges: 0, trims: 0, travelMm: 0 };
  for (let k = 1; k < order.length; k++) {
    const a = objs[order[k - 1]];
    const b = objs[order[k]];
    const l = link(p, a, b, keys[a.index], keys[b.index], trimMm);
    cost.travelMm += gap(p, a, b);
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

function greedy(p: Pattern, objs: SewObject[], over: number[][], keys: string[], o: OrderOptions, pick: ColorPick): number[] {
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
      for (const i of pool) {
        // Going on with the object that followed in the file keeps its move as it was.
        const d = gap(p, last, objs[i]) - (i === last.index + 1 ? 0.5 : 0);
        if (d < bd) {
          bd = d;
          next = i;
        }
      }
    } else next = Math.min(...pool);
    take(next);
  }
  return order;
}

/** 2-opt within runs of one color: reverses stretches where that shortens the moves. */
function untangle(p: Pattern, objs: SewObject[], over: number[][], keys: string[], order: number[]): number[] {
  const out = order.slice();
  const d = (a: number, b: number) => gap(p, objs[a], objs[b]);
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
  const original = objs.map((_, i) => i);
  if (objs.length < 2) return original;
  const keys = keysOf(p, objs);
  let best = original;
  let bestCost = weigh(orderCost(p, objs, original, o.trimMm));
  for (const pick of ['original', 'complete'] as ColorPick[]) {
    let order = greedy(p, objs, over, keys, o, pick);
    if (o.shortestWays) order = untangle(p, objs, over, keys, order);
    if (violations(order, over).length) continue;
    const c = weigh(orderCost(p, objs, order, o.trimMm));
    if (c < bestCost - 1e-6) {
      best = order;
      bestCost = c;
    }
  }
  return best;
}

/**
 * The pattern with its objects sewn in `order`. Moves between objects that follow each other as
 * in the file are kept as they were; new ones are a jump, or a tie-off, trim, jump and tie-in when
 * longer than `trimMm`; a change of thread trims and stops for the color.
 */
export function reorder(p: Pattern, objs: SewObject[], order: number[], trimMm: number, starts?: number[]): Pattern {
  if (order.every((o, k) => o === k)) {
    starts?.push(...objs.map((o) => stitchesBefore(p, o.first)));
    return p;
  }
  const keys = keysOf(p, objs);
  const out: Rec[] = [];
  const colors: ThreadColor[] = [];
  const first = objs[order[0]];
  colors.push(first.color);
  // Before the first object: what the file had, or a jump to the new first object.
  if (first.index === 0) out.push(...recs(p, 0, first.first));
  else out.push({ x: p.x[first.first], y: p.y[first.first], cmd: JUMP });
  let sewn = 0;
  let counted = 0;
  const sew = (o: SewObject, lockIn: boolean) => {
    for (; counted < out.length; counted++) if (out[counted].cmd === STITCH) sewn++;
    // Objects can merge with their neighbours in the new pattern; the caller finds them again by
    // the number of their first stitch, which no later tidying changes.
    starts?.push(sewn);
    out.push(...recs(p, o.first, o.first + 1));
    if (lockIn && !o.tieIn) out.push(...tieIn(p, o.first));
    out.push(...recs(p, o.first + 1, o.last + 1));
  };
  sew(first, first.index !== 0);
  for (let k = 1; k < order.length; k++) {
    const a = objs[order[k - 1]];
    const b = objs[order[k]];
    const l = link(p, a, b, keys[a.index], keys[b.index], trimMm);
    if (l === 'original') {
      out.push(...recs(p, a.last + 1, b.first));
      sew(b, false);
      continue;
    }
    const at = { x: p.x[a.last], y: p.y[a.last] };
    if (l === 'color' || l === 'trim') {
      if (!a.tieOff) out.push(...tieOff(p, a.last));
      out.push({ ...at, cmd: TRIM });
      if (l === 'color') {
        out.push({ ...at, cmd: COLOR_CHANGE });
        colors.push(b.color);
      }
    }
    out.push({ x: p.x[b.first], y: p.y[b.first], cmd: JUMP });
    sew(b, l !== 'jump');
  }
  const last = objs[order[order.length - 1]];
  if (last.index === objs.length - 1) out.push(...recs(p, last.last + 1, p.cmd.length));
  else {
    if (!last.tieOff) out.push(...tieOff(p, last.last));
    out.push({ x: p.x[last.last], y: p.y[last.last], cmd: TRIM }, { x: p.x[last.last], y: p.y[last.last], cmd: END });
  }
  return build({ ...p, colors }, out);
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
