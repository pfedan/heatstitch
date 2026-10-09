import { describe, expect, it } from 'vitest';
import { bestChain, chainCost, type Rails } from '../src/model/restitch';

/**
 * A comb: a bar with teeth hanging off it, each a column of one chain. Sewn in the order given
 * (the bar first), the ways between the teeth cross the fabric; sewn teeth first and the bar
 * last, every way hides under the bar.
 */
function comb(teeth: number, chain = 0): Rails[] {
  const bar: Rails = { left: [[0, 0], [teeth * 4, 0]], right: [[0, 3], [teeth * 4, 3]], chain };
  const cols: Rails[] = [bar];
  for (let k = 0; k < teeth; k++) {
    const x = 1 + k * 4;
    cols.push({ left: [[x, 3], [x, 12]], right: [[x + 2, 3], [x + 2, 12]], chain });
  }
  return cols;
}

const S = { spacing: 0.4, edge: 0, short: false, underlay: false, tolerance: 0.15 };

/** Which comb column (the bar 0, tooth k at k) each rails is, by where it lies. */
const which = (r: Rails): number => (r.left[0][1] === r.left[1][1] ? 0 : 1 + Math.round((Math.min(r.left[0][0], r.right[0][0]) - 1) / 4));

const shuffled = <T>(xs: T[], seed: number): T[] => {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

describe('bestChain', () => {
  it('sews the teeth of a comb before its bar, so the ways between them hide under it', () => {
    for (const teeth of [3, 6, 14]) {
      const cols = comb(teeth);
      const best = bestChain(cols, S);
      expect(best.length, `${teeth} teeth`).toBe(cols.length);
      expect(new Set(best.map(which)).size, `${teeth} teeth: each column once`).toBe(cols.length);
      expect(which(best[best.length - 1]), `${teeth} teeth: bar last`).toBe(0);
      expect(chainCost(best, S), `${teeth} teeth: cheaper`).toBeLessThan(chainCost(cols, S));
      // Nothing of the ways shows: they cost their length only (less than a tenth of a mm per mm shown).
      expect(chainCost(best, S), `${teeth} teeth: hidden`).toBeLessThan(100 * teeth);
    }
  });

  it('is never dearer than the order given, and finds the same cost from any order of a short chain', () => {
    for (const teeth of [4, 9]) {
      const cols = comb(teeth);
      const costs = [0, 1, 2].map((seed) => {
        const start = shuffled(cols, 7 + seed * 13);
        const best = bestChain(start, S);
        expect(chainCost(best, S)).toBeLessThanOrEqual(chainCost(start, S) + 1e-6);
        return chainCost(best, S);
      });
      // Up to eleven columns the best order is found outright: the same cost whatever the start.
      for (const v of costs) expect(v, `${teeth} teeth`).toBeCloseTo(costs[0], 3);
    }
  });

  it('keeps a long chain no dearer than given, from any order', () => {
    const cols = comb(20);
    for (const seed of [1, 2, 3]) {
      const start = shuffled(cols, seed * 31);
      const best = bestChain(start, S);
      expect(best.length).toBe(cols.length);
      expect(new Set(best.map(which)).size).toBe(cols.length);
      expect(chainCost(best, S)).toBeLessThanOrEqual(chainCost(start, S) + 1e-6);
    }
  });

  it('leaves a chain alone that is already best', () => {
    const best = bestChain(comb(5), S);
    expect(bestChain(best, S)).toEqual(best);
    const one = [comb(2)[1]];
    expect(bestChain(one, S)).toBe(one);
  });
});

