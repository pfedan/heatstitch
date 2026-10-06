import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rememberObjects, sewObjects } from '../src/model/objects';
import { STITCH, type Pattern } from '../src/model/pattern';
import { remember, remembered, restitch, type SatinSettings } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);

const SATIN: SatinSettings = { spacing: 0.4, edge: 0, short: true, underlay: true, tolerance: 0.15 };
const E: SatinSettings = { ...SATIN, type: 'e', spacing: 2.5 };

/** Sews object `at` anew as satin with `s`, as the app does; returns the pattern and the object's new index. */
function sew(p: Pattern, at: number, s: SatinSettings) {
  const kinds = stitchKinds(p);
  const r = restitch(p, sewObjects(p, kinds), [at], { kind: 'satin', s }, kinds, 7);
  expect(r.failed).toEqual([]);
  rememberObjects(r.pattern, [r.starts[0]], r.ends[0]);
  const q = r.pattern;
  const now = sewObjects(q, stitchKinds(q));
  let n = 0;
  let o = -1;
  for (let i = 0; i < q.cmd.length && o < 0; i++) if (q.cmd[i] === STITCH && ++n === r.starts[0] + 1) o = now.findIndex((x) => x.first <= i && x.last >= i);
  remember(q, now[o], r.memory[0]);
  return { q, o };
}

const railsOf = (x: { q: Pattern; o: number }) => JSON.stringify(remembered(x.q, sewObjects(x.q, stitchKinds(x.q))[x.o])?.columns);

describe('switching between satin and E stitch', () => {
  it('keeps the rails, there and back', () => {
    const p = load('demos/letters.pes');
    for (const o of sewObjects(p, stitchKinds(p)).filter((x) => x.kind === 'satin').slice(0, 4)) {
      const a = sew(p, o.index, SATIN);
      const b = sew(a.q, a.o, E);
      const c = sew(b.q, b.o, SATIN);
      expect(railsOf(b)).toBe(railsOf(a));
      // Its E stitches read in places as running stitch: the rails were read anew from them.
      expect(railsOf(c)).toBe(railsOf(a));
    }
  });
});
