import type { ThreadColor } from '../model/pattern';
import { pecThreads } from '../parsers/pecPalette';
import { deltaE2000, rgbToLab, type Lab } from './color';

const THREADS = pecThreads().map((t) => ({ t, lab: rgbToLab(t.r, t.g, t.b) }));

/** Candidate threads per color: the nearest few are enough, a farther one never pays off. */
const CANDIDATES = 8;

export interface ThreadMatch {
  thread: ThreadColor;
  /** CIEDE2000 between the color and its thread. */
  deltaE: number;
}

/** Nearest Brother thread by CIEDE2000. */
export function nearestThread(lab: Lab): ThreadMatch {
  let best = THREADS[0];
  let bd = Infinity;
  for (const c of THREADS) {
    const d = deltaE2000(lab, c.lab);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return { thread: best.t, deltaE: bd };
}

/**
 * Brother threads for the colors of one image, chosen together rather than each on its own: two
 * colors that tell apart in the image (eye white next to light fur) should not end up as the same
 * thread when a second one keeps them apart. As embroidery-streamlines does it (Liu et al.,
 * Eurographics 2023), each choice costs its color difference, and each pair of colors the contrast
 * it loses:
 *
 *   E = sum_k dE(c_k, t_k)^2 + sum_{i<j} w_i w_j max(0, dE(c_i, c_j) - dE(t_i, t_j))^2
 *
 * all CIEDE2000. Colors close enough share a thread still, since a second thread costs more than
 * the little contrast it saves. `weights` (0 to 1, all 1 when left out) say how much a color is one
 * of the image's own rather than the blend along an edge between two others, whose contrast is not
 * worth a thread. Minimized over each color's nearest candidates: iterated conditional modes (Besag
 * 1986) from the nearest threads give a good first answer, branch and bound the exact one.
 */
export function matchThreads(colors: Lab[], weights: number[] = colors.map(() => 1)): ThreadMatch[] {
  const n = colors.length;
  const cands = colors.map((c) =>
    THREADS.map((t, j) => ({ j, d: deltaE2000(c, t.lab) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, CANDIDATES),
  );
  const contrast = colors.map((a) => colors.map((b) => deltaE2000(a, b)));
  const between = new Map<number, number>();
  const threadDiff = (a: number, b: number) => {
    if (a === b) return 0;
    const key = a < b ? a * 1000 + b : b * 1000 + a;
    let d = between.get(key);
    if (d === undefined) between.set(key, (d = deltaE2000(THREADS[a].lab, THREADS[b].lab)));
    return d;
  };
  const pick = cands.map(() => 0);
  const cost = (k: number, c: number) => {
    let e = cands[k][c].d ** 2;
    const j = cands[k][c].j;
    for (let o = 0; o < n; o++) {
      if (o === k) continue;
      const lost = contrast[k][o] - threadDiff(j, cands[o][pick[o]].j);
      if (lost > 0) e += weights[k] * weights[o] * lost * lost;
    }
    return e;
  };
  for (let round = 0; round < 50; round++) {
    let changed = false;
    for (let k = 0; k < n; k++) {
      let best = pick[k];
      let bestE = cost(k, best);
      for (let c = 0; c < cands[k].length; c++) {
        const e = cost(k, c);
        if (e < bestE - 1e-9) {
          bestE = e;
          best = c;
        }
      }
      if (best !== pick[k]) {
        pick[k] = best;
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Then the exact minimum by branch and bound, from that bound: every term is at least zero, so
  // the nearest thread's difference is a lower bound for each color still open. Within a budget of
  // steps (eight colors, twice the default, rarely need a tenth of it); past it, the best found so far.
  const total = (sel: number[]) => {
    let e = 0;
    for (let k = 0; k < n; k++) {
      e += cands[k][sel[k]].d ** 2;
      for (let o = k + 1; o < n; o++) {
        const lost = contrast[k][o] - threadDiff(cands[k][sel[k]].j, cands[o][sel[o]].j);
        if (lost > 0) e += weights[k] * weights[o] * lost * lost;
      }
    }
    return e;
  };
  let bestE = total(pick);
  const best = pick.slice();
  const rest = new Array<number>(n + 1).fill(0);
  for (let k = n - 1; k >= 0; k--) rest[k] = rest[k + 1] + cands[k][0].d ** 2;
  const sel = new Array<number>(n).fill(0);
  let budget = 30_000;
  const search = (k: number, e: number) => {
    if (budget-- <= 0) return;
    if (k === n) {
      if (e < bestE - 1e-9) {
        bestE = e;
        best.splice(0, n, ...sel);
      }
      return;
    }
    for (let c = 0; c < cands[k].length; c++) {
      let add = cands[k][c].d ** 2;
      const j = cands[k][c].j;
      for (let o = 0; o < k; o++) {
        const lost = contrast[k][o] - threadDiff(j, cands[o][sel[o]].j);
        if (lost > 0) add += weights[k] * weights[o] * lost * lost;
      }
      if (e + add + rest[k + 1] >= bestE - 1e-9) continue;
      sel[k] = c;
      search(k + 1, e + add);
    }
  };
  search(0, 0);
  pick.splice(0, n, ...best);
  return pick.map((c, k) => ({ thread: THREADS[cands[k][c].j].t, deltaE: cands[k][c].d }));
}
