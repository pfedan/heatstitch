import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { changed, sewWith } from '../src/correct/engine/variants';
import { movesOf } from '../src/correct/engine/units';
import { currentSettings } from '../src/correct/plan';
import { sewObjects } from '../src/model/objects';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';

/**
 * Satin letters read from a file, sewn there in one go (columns joined by travel under the columns
 * still to come), stay in one piece when sewn anew with other settings: no trims between their
 * columns, as Beheben does it on patch.pes (Screencast Teil 8).
 */
describe('satin read from stitches, sewn anew', () => {
  it('keeps letters sewn in one go in one piece', () => {
    const p = parsePattern(new Uint8Array(readFileSync(new URL('../public/examples/demos/patch.pes', import.meta.url))), 'patch.pes');
    const objs = sewObjects(p);
    const letters = objs.filter((o) => o.kind === 'satin' && o.index >= 8);
    expect(letters.length).toBeGreaterThan(5);
    for (const o of letters) {
      expect(o.sections).toBe(1);
      const s = currentSettings(p, o, stitchKinds(p))!;
      const q = sewWith(p, o.index, changed(s, [{ field: 'under', from: 'auto', to: 'center' }]), false, 3)!;
      expect(q, `letter ${o.index}`).toBeTruthy();
      expect(sewObjects(q)[o.index].sections, `letter ${o.index}: pieces`).toBe(1);
      // Not one trim more in the whole design, at most one more move.
      const [a, b] = [movesOf(p), movesOf(q)];
      expect(b.trims, `letter ${o.index}: trims`).toBeLessThanOrEqual(a.trims);
      expect(b.moves, `letter ${o.index}: moves`).toBeLessThanOrEqual(a.moves + 1);
    }
  });
});
