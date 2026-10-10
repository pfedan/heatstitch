import { describe, it } from 'vitest';
import { CHAINS, STEPS, FIRST_SEED, chain } from './helpers/torture';

describe('found by the torture test', () => {
  // Chains that failed once (borders on delete, cut out and recolor; knockouts after reopening a
  // project whose curves were stored rounded; a fill leaving out its own satin border; the parts of
  // a fill cut apart: an empty part, parts recolored apart, a part too small for its pattern, a tiny
  // part given a tie-off; a line sewn anew onto its copy, an echo copy right on its line): replayed
  // with every run.
  // The ones the regular chains in torture.test.ts already run with the same steps are not run twice.
  const regular = (seed: number) => STEPS === 14 && seed >= FIRST_SEED && seed < FIRST_SEED + CHAINS;
  it.each([3, 4, 9, 11, 12, 16, 18, 24, 34, 38, 101, 165, 288, 389, 1034, 1051, 1062, 1276, 2015, 2335].filter((s) => !regular(s)))('chain %i still holds', async (seed) => {
    await chain(seed, 14);
  });
});
