import { describe, it } from 'vitest';
import { chain } from './helpers/torture';

describe('found by the torture test', () => {
  // From the first long run (20 steps): a narrow added shape sewn as satin forgot what it was;
  // neighbours of one thread became one object after a delete or recolor between them; a copy
  // (or its border) landing on another object shared its memory; leaving out depended on what was
  // left out before.
  it.each([270, 387, 383, 130, 139, 315, 1124])('long chain %i still holds', async (seed) => {
    await chain(seed, 20);
  }, 60_000);

  // Lines combined where the second one's shadow is sewn before the first: the combined line was
  // looked for at its old place.
  it.each([89])('chain %i still holds', async (seed) => {
    await chain(seed);
  }, 60_000);
});
