import { describe, it } from 'vitest';
import { chain } from './helpers/torture';

describe('found by the torture test', () => {
  // Chains that failed once (borders on delete, cut out and recolor; knockouts after reopening a
  // project whose curves were stored rounded; a fill leaving out its own satin border; the parts of
  // a fill cut apart: an empty part, parts recolored apart, a part too small for its pattern, a tiny
  // part given a tie-off; a line sewn anew onto its copy, an echo copy right on its line; an echo
  // copy with no room left beside its line): replayed with every run. The regular chains
  // (torture.test.ts, tortureChains.test.ts) put in fills on knit as well, so they do not run these
  // steps again, not even for the same seed.
  it.each([3, 4, 9, 11, 12, 16, 18, 24, 34, 38, 101, 165, 288, 389, 1034, 1051, 1062, 1276, 2015, 2335])('chain %i still holds', async (seed) => {
    await chain(seed, 14);
    // A new step changes what the chains do: some build large designs and take longer than most.
  }, 60_000);

  // Found by long runs of the regular chains (with fills on knit): an appliqué's running edge read
  // back from the project with its stitch length filled in; a satin's sections along a straight cut
  // line that reaches to the edge; a contour bulging out between the points it was fitted to; a
  // jump that does not move written to DST; a fill's border kept right after it when gathered; a
  // fill's border in its thread left in the old one when an appliqué's thread was recolored; a
  // closed line cut out as if it were a fill; a line made from a bordered fill keeping the motif of
  // a line it was before; a contour round a speck that looped for ever.
  it.each([31, 33, 53, 58, 70, 80, 513, 538, 563, 569, 582, 612, 1011])('chain %i with fills on knit still holds', async (seed) => {
    await chain(seed, 14, { knit: true });
  }, 60_000);
});
