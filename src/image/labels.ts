import { distanceToSeeds } from './edt';
import { NONE } from './quantize';

/**
 * Operations on label maps (one palette index per pixel, NONE = not sewn): connected components
 * with their adjacency, and the cleanup that turns a quantized image into regions that can be
 * embroidered, as commercial tools describe it ("removes anti-aliasing, noise and dithering, and
 * removes colors less than specified area", Wilcom) and as the Goldman patent (US 6,836,695) does
 * it: small objects are reassigned to their neighbours.
 */

export interface Components {
  /** Component per pixel. */
  comp: Int32Array;
  /** Per component: label, pixel count, bounding box. */
  label: number[];
  area: number[];
  minX: number[];
  minY: number[];
  maxX: number[];
  maxY: number[];
}

/**
 * 4-connected components of equal labels (two-pass union-find). 4-connectivity keeps every region
 * a union of whole pixel squares, so outlines never pinch at a diagonal.
 */
export function components(labels: Uint8Array, w: number, h: number): Components {
  const n = w * h;
  const parent = new Int32Array(n);
  const find = (i: number) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      parent[i] = i;
      const l = labels[i];
      if (x > 0 && labels[i - 1] === l) parent[i] = find(i - 1);
      if (y > 0 && labels[i - w] === l) {
        const a = find(i);
        const b = find(i - w);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const comp = new Int32Array(n);
  const id = new Map<number, number>();
  const out: Components = { comp, label: [], area: [], minX: [], minY: [], maxX: [], maxY: [] };
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let c = id.get(r);
    if (c === undefined) {
      c = out.label.length;
      id.set(r, c);
      out.label.push(labels[i]);
      out.area.push(0);
      out.minX.push(w);
      out.minY.push(h);
      out.maxX.push(-1);
      out.maxY.push(-1);
    }
    comp[i] = c;
    const x = i % w;
    const y = (i - x) / w;
    out.area[c]++;
    if (x < out.minX[c]) out.minX[c] = x;
    if (x > out.maxX[c]) out.maxX[c] = x;
    if (y < out.minY[c]) out.minY[c] = y;
    if (y > out.maxY[c]) out.maxY[c] = y;
  }
  return out;
}

/** Shared border length (pixel edges) between components, per component: neighbour -> edges. */
function adjacency(c: Components, w: number, h: number): Map<number, number>[] {
  const adj = c.label.map(() => new Map<number, number>());
  const add = (a: number, b: number) => {
    adj[a].set(b, (adj[a].get(b) ?? 0) + 1);
    adj[b].set(a, (adj[b].get(a) ?? 0) + 1);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = c.comp[i];
      if (x + 1 < w && c.comp[i + 1] !== a) add(a, c.comp[i + 1]);
      if (y + 1 < h && c.comp[i + w] !== a) add(a, c.comp[i + w]);
    }
  }
  return adj;
}

/**
 * 3 x 3 majority filter: a pixel takes the label most of its neighbourhood has, if that is a clear
 * majority (5 of 9). Removes single-pixel specks and smooths stair steps; lines of 2 pixels survive.
 */
export function modeFilter(labels: Uint8Array, w: number, h: number): Uint8Array {
  const out = labels.slice();
  const count = new Map<number, number>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const own = labels[i];
      let mixed = false;
      count.clear();
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const l = labels[yy * w + xx];
          if (l !== own) mixed = true;
          count.set(l, (count.get(l) ?? 0) + 1);
        }
      }
      if (!mixed) continue;
      for (const [l, k] of count) {
        if (k >= 5 && l !== own) out[i] = l;
      }
    }
  }
  return out;
}

/**
 * Merges every component smaller than `minArea` pixels into the neighbour it shares the longest
 * border with, smallest first, until none is left. NONE regions take part too, so small holes in a
 * region are closed and stray pixels on the background disappear. Components with the `keep` label
 * set (painted by hand) are not merged away.
 */
export function mergeSmall(labels: Uint8Array, w: number, h: number, minArea: number, keep?: Uint8Array): Uint8Array {
  const c = components(labels, w, h);
  const adj = adjacency(c, w, h);
  const count = c.label.length;
  const target = Int32Array.from({ length: count }, (_, i) => i);
  const root = (i: number) => {
    while (target[i] !== i) {
      target[i] = target[target[i]];
      i = target[i];
    }
    return i;
  };
  const area = c.area.slice();
  const order = [...Array(count).keys()].filter((i) => area[i] < minArea).sort((a, b) => area[a] - area[b]);
  for (const i of order) {
    if (root(i) !== i || area[i] >= minArea) continue;
    if (keep && keep[i]) continue;
    let best = -1;
    let bestLen = 0;
    for (const [nb, len] of adj[i]) {
      const r = root(nb);
      if (r === i) continue;
      if (len > bestLen) {
        bestLen = len;
        best = r;
      }
    }
    if (best < 0) continue;
    target[i] = best;
    area[best] += area[i];
    for (const [nb, len] of adj[i]) {
      const r = root(nb);
      if (r === best) continue;
      adj[best].set(r, (adj[best].get(r) ?? 0) + len);
      adj[r].set(best, (adj[r].get(best) ?? 0) + len);
    }
  }
  const out = new Uint8Array(labels.length);
  for (let p = 0; p < labels.length; p++) out[p] = c.label[root(c.comp[p])];
  return out;
}

/**
 * Removes anti-aliasing seams: thin components (inscribed width below `maxWidth` pixels) whose
 * color lies between the colors of the two regions they separate. A thin component in a color of
 * its own (a drawn line) is kept; it will be sewn as a running stitch or satin.
 */
export function removeSeams(
  labels: Uint8Array,
  w: number,
  h: number,
  maxWidth: number,
  between: (seam: number, a: number, b: number) => boolean,
): Uint8Array {
  const c = components(labels, w, h);
  // Distance to the nearest pixel of another region: half the local width of every region.
  const edge = new Uint8Array(labels.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = labels[i];
      if ((x > 0 && labels[i - 1] !== l) || (x + 1 < w && labels[i + 1] !== l) || (y > 0 && labels[i - w] !== l) || (y + 1 < h && labels[i + w] !== l)) edge[i] = 1;
    }
  }
  const dist = distanceToSeeds(edge, w, h);
  const maxHalf = new Float32Array(c.label.length);
  for (let i = 0; i < labels.length; i++) maxHalf[c.comp[i]] = Math.max(maxHalf[c.comp[i]], dist[i] + 1);
  const adj = adjacency(c, w, h);
  const out = labels.slice();
  for (let k = 0; k < c.label.length; k++) {
    if (c.label[k] === NONE || 2 * maxHalf[k] > maxWidth) continue;
    const nbs = [...adj[k]].sort((a, b) => b[1] - a[1]);
    if (nbs.length < 2) continue;
    const a = c.label[nbs[0][0]];
    const second = nbs.find(([nb]) => c.label[nb] !== a);
    if (!second) continue;
    const b = c.label[second[0]];
    if (!between(c.label[k], a, b)) continue;
    // Each pixel goes to whichever of the two sides is nearer: grow both into the seam.
    let todo: number[] = [];
    for (let y = c.minY[k]; y <= c.maxY[k]; y++) {
      for (let x = c.minX[k]; x <= c.maxX[k]; x++) if (c.comp[y * w + x] === k) todo.push(y * w + x);
    }
    const seam = c.label[k];
    while (todo.length) {
      const changes: number[] = [];
      const rest: number[] = [];
      for (const i of todo) {
        const x = i % w;
        let pick = -1;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
          if (j < 0 || j >= out.length) continue;
          const l = out[j];
          if (c.comp[j] !== k ? l === a || l === b : l !== seam) {
            pick = l;
            break;
          }
        }
        if (pick >= 0) changes.push(i, pick);
        else rest.push(i);
      }
      if (!changes.length) break;
      for (let q = 0; q < changes.length; q += 2) out[changes[q]] = changes[q + 1];
      todo = rest;
    }
  }
  return out;
}

/**
 * Background: the label covering at least 60 % of the image border (and three of its corners) is
 * removed where it is connected to the border (4-connected flood fill), so the same color inside the
 * design (eyes, the counters of letters) is still sewn.
 */
export function removeBackground(labels: Uint8Array, w: number, h: number): Uint8Array {
  const counts = new Map<number, number>();
  let total = 0;
  const ring: number[] = [];
  for (let x = 0; x < w; x++) ring.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) ring.push(y * w, y * w + w - 1);
  for (const i of ring) {
    const l = labels[i];
    if (l === NONE) continue;
    counts.set(l, (counts.get(l) ?? 0) + 1);
    total++;
  }
  // Mostly transparent border: the image has its own background removed already.
  if (total < ring.length * 0.5) return labels;
  let bg = -1;
  let best = 0;
  for (const [l, k] of counts) {
    if (k > best) {
      best = k;
      bg = l;
    }
  }
  const corners = [0, w - 1, (h - 1) * w, h * w - 1].filter((i) => labels[i] === bg).length;
  if (best < total * 0.6 || corners < 3) return labels;
  const out = labels.slice();
  const stack: number[] = ring.filter((i) => labels[i] === bg);
  for (const i of stack) out[i] = NONE;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= out.length || out[j] !== bg) continue;
      out[j] = NONE;
      stack.push(j);
    }
  }
  return out;
}
