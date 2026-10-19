import type { ThreadColor } from '../model/pattern';
import { pecThreads } from '../parsers/pecPalette';
import { core } from '../wasm/core';
import { deltaE2000, rgbToLab, type Lab } from './color';

const THREAD_COLORS = pecThreads();
const THREADS = THREAD_COLORS.map((t) => ({ t, lab: rgbToLab(t.r, t.g, t.b) }));

export interface ThreadMatch {
  thread: ThreadColor;
  /** CIEDE2000 between the color and its thread. */
  deltaE: number;
}

/**
 * Nearest Brother thread by CIEDE2000. One color per call, so it stays in TypeScript for its callers
 * here; core/src/image/thread_match.rs has its twin.
 */
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
 * Computed by the Rust core (core/src/image/thread_match.rs).
 */
export function matchThreads(colors: Lab[], weights?: number[]): ThreadMatch[] {
  const m = core().matchThreads(Float64Array.from(colors.flat()), weights && Float64Array.from(weights), THREAD_COLORS);
  return colors.map((_, k) => ({ thread: THREADS[m[k * 2]].t, deltaE: m[k * 2 + 1] }));
}
