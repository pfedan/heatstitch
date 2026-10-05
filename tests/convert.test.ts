import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rememberObjects, sewObjects } from '../src/model/objects';
import { STITCH, type Pattern } from '../src/model/pattern';
import { remember, remembered, restitch, type Settings } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);

const SATIN: Settings = { kind: 'satin', s: { spacing: 0.4, edge: 0, short: true, underlay: true, tolerance: 0.15 } };
const FILL: Settings = { kind: 'fill', s: { pattern: 'tatami', spacing: 0.4, spacingEnd: 1, offset: 0.25, angle: NaN, stitch: 4, underlay: true, edge: 0, tolerance: 0.15 } };

/** Sews object `at` in the other kind, as the app does; returns the pattern and the object's new index. */
export function convertTo(p: Pattern, at: number, s: Settings) {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const r = restitch(p, objs, [at], s, kinds, 7, s.kind === 'fill' ? 'satin' : 'fill');
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

const stitchesOf = (p: Pattern, at: number) => {
  const o = sewObjects(p, stitchKinds(p))[at];
  const out: string[] = [];
  for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) out.push(`${p.x[i]},${p.y[i]}`);
  return out;
};

describe('switching between satin and fill', () => {
  it('gives the same satin back, however often', () => {
    const p = load('demos/letters.pes');
    const at = sewObjects(p, stitchKinds(p)).find((x) => x.kind === 'satin')!.index;
    const a = convertTo(p, at, FILL);
    // The fill keeps the satin's columns, its area is where they lie.
    const m = remembered(a.q, sewObjects(a.q, stitchKinds(a.q))[a.o])!;
    expect(m.asSatin?.length).toBeGreaterThan(0);
    const b = convertTo(a.q, a.o, SATIN);
    const first = stitchesOf(b.q, b.o);
    let cur = b;
    for (let k = 0; k < 3; k++) cur = convertTo(convertTo(cur.q, cur.o, FILL).q, cur.o, SATIN);
    expect(stitchesOf(cur.q, cur.o)).toEqual(first);
    const area = (x: { q: Pattern; o: number }) => remembered(x.q, sewObjects(x.q, stitchKinds(x.q))[x.o])?.shape?.areaMm2;
    expect(area(cur)).toBe(area(b));
  });

  it('keeps the drawn form of the object', () => {
    const p = load('demos/letters.pes');
    const o = sewObjects(p, stitchKinds(p)).find((x) => x.kind === 'satin')!;
    const n = (x: number, y: number) => ({ p: [x, y] as [number, number], a: [x, y] as [number, number], b: [x, y] as [number, number], smooth: false });
    const form = { paths: [{ closed: true, nodes: [n(o.minX / 10, o.minY / 10), n(o.maxX / 10, o.minY / 10), n(o.maxX / 10, o.maxY / 10), n(o.minX / 10, o.maxY / 10)] }] };
    remember(p, o, { ...remembered(p, o), region: remembered(p, o)?.region ?? null, form });
    const a = convertTo(p, o.index, FILL);
    const m = remembered(a.q, sewObjects(a.q, stitchKinds(a.q))[a.o])!;
    expect(m.form).toEqual(form);
    // The fill's area is the form's rectangle, not where the satin lay.
    expect(m.region!.areaMm2).toBeCloseTo(((o.maxX - o.minX) / 10) * ((o.maxY - o.minY) / 10), -1);
    const b = convertTo(a.q, a.o, SATIN);
    expect(remembered(b.q, sewObjects(b.q, stitchKinds(b.q))[b.o])?.form).toEqual(form);
  });
});
