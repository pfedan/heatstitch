import { deltaE2000, rgbToLab } from '../image/color';
import type { ThreadColor } from '../model/pattern';

const key = (c: ThreadColor) => `${c.r},${c.g},${c.b},${c.pecIndex ?? ''}`;
const lab = (c: ThreadColor) => rgbToLab(c.r, c.g, c.b);

/**
 * Palette slot per color block for formats that store threads as palette indices (PEC, JEF). Every
 * distinct color gets a slot of its own, so two different threads never show up on the machine as
 * the same one. The distinct colors are assigned to the slots at the least total squared CIEDE2000
 * difference (Hungarian method), so no color takes a slot another one needs more; pyembroidery's
 * build_unique_palette does the same greedily, in set order, with a coarser color distance. A color
 * keeps the slot `own` names for it (one read from the file) unless another color has it already.
 * Colors beyond the number of slots share their nearest slot.
 */
export function uniqueSlots(
  colors: ThreadColor[],
  slots: number[],
  colorOf: (slot: number) => ThreadColor,
  own: (c: ThreadColor) => number | undefined = () => undefined,
): number[] {
  const slotLabs = slots.map((s) => lab(colorOf(s)));
  const cost = (c: ThreadColor) => {
    const l = lab(c);
    return slots.map((s, j) => (own(c) === s ? -1 : deltaE2000(l, slotLabs[j]) ** 2));
  };
  const distinct: ThreadColor[] = [];
  const row = new Map<string, number>();
  for (const c of colors) {
    if (row.has(key(c))) continue;
    row.set(key(c), distinct.length);
    distinct.push(c);
  }
  const costs = distinct.map(cost);
  const assigned = assign(costs.slice(0, slots.length), slots.length).map((j) => slots[j]);
  const nearest = (r: number) => slots[costs[r].indexOf(Math.min(...costs[r]))];
  return colors.map((c) => {
    const r = row.get(key(c))!;
    return assigned[r] ?? nearest(r);
  });
}

/**
 * Minimum-cost assignment of n rows to distinct columns out of m >= n (Hungarian method with
 * potentials, O(n^2 m)). Returns the column of each row.
 */
export function assign(cost: number[][], m: number): number[] {
  const n = cost.length;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const owner = new Array<number>(m + 1).fill(0); // row (1-based) holding each column, 0 = free
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    owner[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = owner[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[owner[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (owner[j0] !== 0);
    do {
      const j1 = way[j0];
      owner[j0] = owner[j1];
      j0 = j1;
    } while (j0);
  }
  const out = new Array<number>(n);
  for (let j = 1; j <= m; j++) if (owner[j]) out[owner[j] - 1] = j - 1;
  return out;
}
