import { describe, it } from 'vitest';
import { chain, chainSeeds } from './helpers/torture';

// The other half of the regular chains of torture.test.ts, in a file of its own so both halves run
// side by side.
describe('torture test', () => {
  it.each(chainSeeds(1))('chain %i keeps the design consistent', async (seed) => {
    await chain(seed, undefined, { knit: true, motif: true });
    // Some chains build large designs: slower runners need more than the 30 s default.
  }, 120_000);
});
