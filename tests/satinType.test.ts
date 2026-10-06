import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rememberObjects, sewObjects } from '../src/model/objects';
import { STITCH, TRIM, type Pattern } from '../src/model/pattern';
import type { Pt } from '../src/digitize/skeleton';
import { forget, keepShape, remember, remembered, restitch, type Rails, type SatinSettings } from '../src/model/restitch';
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

describe('chains and trims asked for', () => {
  const bar = (x0: number, y0: number, x1: number, y1: number, chain: number): Rails => {
    const line = (a: Pt, b: Pt): Pt[] => Array.from({ length: 21 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / 20, a[1] + ((b[1] - a[1]) * k) / 20] as Pt);
    return { left: line([x0, y0], [x0, y1]), right: line([x1, y0], [x1, y1]), rungs: [], chain };
  };
  const trimsIn = (q: Pattern, o: number) => {
    const x = sewObjects(q, stitchKinds(q))[o];
    let n = 0;
    for (let i = x.first; i <= x.last; i++) if (q.cmd[i] === TRIM) n++;
    return n;
  };

  it('cut apart parts a little apart, as the dot and the stem of an i', () => {
    const p = load('demos/letters.pes');
    const o = sewObjects(p, stitchKinds(p)).find((x) => x.kind === 'satin')!;
    const x0 = o.minX / 10;
    const y0 = o.minY / 10;
    // A stem 10 mm high, sewn from its top and back there, a dot 2 mm above it.
    const stem = bar(x0, y0 + 10, x0 + 2, y0, 0);
    const dot = bar(x0, y0 + 12, x0 + 2, y0 + 14, 1);
    remember(p, o, { ...keepShape(p, o, stitchKinds(p)), columns: [[stem, dot]], read: false });
    try {
      const a = sew(p, o.index, SATIN);
      expect(trimsIn(a.q, a.o)).toBe(1);
      // In one chain: sewn on without a trim.
      remember(p, o, { ...keepShape(p, o, stitchKinds(p)), columns: [[stem, { ...dot, chain: 0 }]], read: false });
      const b = sew(p, o.index, SATIN);
      expect(trimsIn(b.q, b.o)).toBe(0);
    } finally {
      forget(p, o);
    }
  });
});
