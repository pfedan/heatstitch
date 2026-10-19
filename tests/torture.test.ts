import { describe, it } from 'vitest';
import { chainSeeds, chain } from './helpers/torture';

// The other half of the chains is in tortureChains.test.ts, so both halves run side by side.
describe('torture test', () => {
  it.each(chainSeeds(0))('chain %i keeps the design consistent', async (seed) => {
    await chain(seed, undefined, { knit: true, motif: true });
    // Some chains build large designs (a contour filled as the ground, scaled up, left out under
    // others, a contour around a lettering): slower runners need more than the 30 s default.
  }, 120_000);
});
