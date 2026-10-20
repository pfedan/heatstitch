import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/digitize/skeleton';
import { rememberObjects, sewObjects, type SewObject } from '../src/model/objects';
import type { Pattern } from '../src/model/pattern';
import { bestChain, chainCost, remember, remembered, restitch, type Rails, type SatinSettings } from '../src/model/restitch';
import { reverseObjects } from '../src/model/reverse';
import { stitchKinds } from '../src/model/sequence';
import { stitchesBefore } from '../src/model/transform';
import { duplicateObjects } from '../src/model/shapeOps';
import { fill, Writer } from './helpers/designs';

const S: SatinSettings = { spacing: 0.4, edge: 0.1, short: true, underlay: true, tolerance: 0.15 };
const line = (a: Pt, b: Pt): Pt[] => Array.from({ length: 21 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / 20, a[1] + ((b[1] - a[1]) * k) / 20] as Pt);

/** A comb as one chain: a spine 3 mm high along the top and three teeth hanging from it. */
function comb(): Rails[] {
  const spine: Rails = { left: line([0, 0], [24, 0]), right: line([0, 3], [24, 3]), chain: 0 };
  const teeth = [0, 10.5, 21].map((x): Rails => ({ left: line([x + 3, 3], [x + 3, 15]), right: line([x, 3], [x, 15]), chain: 0 }));
  return [spine, ...teeth];
}

/** The comb sewn as satin in its best order: the ways between its columns under columns still to come. */
function combDesign(): Pattern {
  const w = new Writer();
  fill(w, [[0, 0], [24, 0], [24, 15], [21, 15], [21, 3], [13.5, 3], [13.5, 15], [10.5, 15], [10.5, 3], [3, 3], [3, 15], [0, 15]]);
  const p = w.b.build('comb', 'pes', [{ r: 200, g: 40, b: 50 }]);
  const kinds = stitchKinds(p);
  const r = restitch(p, sewObjects(p, kinds), [0], { kind: 'satin', s: S }, kinds, 3, 'fill', false, new Map([[0, bestChain(comb(), S)]]));
  expect(r.failed).toEqual([]);
  rememberObjects(r.pattern, [r.starts[0]], r.ends[0]);
  const at = sewObjects(r.pattern).find((x) => stitchesBefore(r.pattern, x.first) === r.starts[0])!;
  remember(r.pattern, at, r.memory[0]);
  return r.pattern;
}

/** What the ways between the columns of the chain of `o` cost as it is sewn (see bestChain). */
function wayCost(p: Pattern, o: SewObject): number {
  const m = remembered(p, o)!;
  return m.columns!.reduce((v, part) => v + chainCost(part, m.satin!), 0);
}

/**
 * A satin chain sewn the other way round (a copy on its original with Ctrl+D, Sew backwards) is
 * planned anew from where it starts: turned round in time, the ways between its columns, laid
 * under columns still to come, would all run on top of the satin sewn already.
 */
describe('a satin chain sewn the other way round', () => {
  it('keeps the ways between its columns hidden in a copy made in place', () => {
    const p = combDesign();
    const was = wayCost(p, sewObjects(p)[0]);
    const r = duplicateObjects(p, [0], 3, 0)!;
    expect(r.nudged).toBe(0);
    const objs = sewObjects(r.pattern);
    expect(objs).toHaveLength(sewObjects(p).length + 1);
    const copy = objs[r.copies[0]];
    expect(copy.kind).toBe('satin');
    // Before: the ways of the copy lay over its satin (some 80000 as bestChain scores them, against 26).
    expect(wayCost(r.pattern, copy)).toBeLessThan(was + 10);
  });

  it('keeps them hidden when sewn backwards', () => {
    const p = combDesign();
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const was = wayCost(p, objs[0]);
    const r = reverseObjects(p, objs, [0], kinds, 3);
    expect(r.failed).toEqual([]);
    const turned = sewObjects(r.pattern)[0];
    expect(wayCost(r.pattern, turned)).toBeLessThan(was + 10);
  });
});
