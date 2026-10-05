import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rememberObjects, sewObjects, type SewObject } from '../src/model/objects';
import { STITCH, type Pattern } from '../src/model/pattern';
import { analyze, measureFill, remember, remembered, restitch, underlayRanges, type FillSettings } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { sample } from '../src/digitize/region';
import { syncBorders } from '../src/model/border';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);

/** The pattern after a restitch, with its objects remembered as the app does. */
function apply(p: Pattern, which: number, s: FillSettings) {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const r = restitch(p, objs, [which], { kind: 'fill', s }, kinds, 7);
  expect(r.failed).toEqual([]);
  rememberObjects(r.pattern, [r.starts[0]], r.ends[0]);
  const q = r.pattern;
  const qk = stitchKinds(q);
  const now = sewObjects(q, qk);
  let n = 0;
  let o = -1;
  for (let i = 0; i < q.cmd.length && o < 0; i++) if (q.cmd[i] === STITCH && ++n === r.starts[0] + 1) o = now.findIndex((x) => x.first <= i && x.last >= i);
  remember(q, now[o], r.memory[0]);
  return { q, kinds: qk, objs: now, o: now[o], memory: r.memory[0] };
}

const stitches = (p: Pattern, a: number, b: number) => {
  let n = 0;
  for (let i = a; i <= b; i++) if (p.cmd[i] === STITCH) n++;
  return n;
};

describe('fill border', () => {
  const p = load('cat-60mm.pes');
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const o = objs[1];
  const base = { ...measureFill(p, analyze(p, o, kinds)), pattern: 'tatami' as const, underlay: true };

  it('sews a running border on the edge after the fill, once also after a second change', () => {
    const a = apply(p, o.index, { ...base, border: { type: 'run', width: 2 } });
    const region = a.memory.region!;
    // The last stitches lie on the edge.
    let onEdge = 0;
    let n = 0;
    for (let i = a.o.last - 40; i <= a.o.last; i++) {
      if (a.q.cmd[i] !== STITCH) continue;
      n++;
      if (Math.abs(sample(region, region.sdfBase, a.q.x[i] / 10, a.q.y[i] / 10)) < 0.3) onEdge++;
    }
    expect(onEdge).toBeGreaterThan(n * 0.8);
    // The border is part of the fill: a new spacing makes it anew, not twice.
    const one = stitches(a.q, a.o.first, a.o.last);
    const b = apply(a.q, a.o.index, { ...base, spacing: base.spacing, border: { type: 'run', width: 2 } });
    expect(Math.abs(stitches(b.q, b.o.first, b.o.last) - one)).toBeLessThan(one * 0.05);
    // The border is the last part, and only one.
    const parts = analyze(b.q, b.o, b.kinds).parts;
    expect(parts[parts.length - 1]).toMatchObject({ kind: 'fill', e: b.o.last, border: true });
    expect(parts.filter((pt) => pt.border)).toHaveLength(1);
  });

  it('sews a satin border of the set width, and none once taken away', () => {
    const plain = apply(p, o.index, base);
    const sat = apply(p, o.index, { ...base, border: { type: 'satin', width: 3 } });
    expect(stitches(sat.q, sat.o.first, sat.o.last)).toBeGreaterThan(stitches(plain.q, plain.o.first, plain.o.last) + 200);
    const off = apply(sat.q, sat.o.index, base);
    expect(Math.abs(stitches(off.q, off.o.first, off.o.last) - stitches(plain.q, plain.o.first, plain.o.last))).toBeLessThan(60);
  });

  it('knows where the underlay of a fill sewn here ends', () => {
    const a = apply(p, o.index, base);
    expect(a.memory.under).toBeGreaterThan(10);
    const r = underlayRanges(a.q, a.o, a.kinds);
    expect(r).toHaveLength(1);
    expect(stitches(a.q, r[0][0], r[0][1])).toBe(a.memory.under);
    expect(remembered(a.q, a.o)?.under).toBe(a.memory.under);
    const none = apply(p, o.index, { ...base, underlay: false });
    expect(none.memory.under).toBeUndefined();
  });

  it('finds the underlay of a fill read from a file', () => {
    const r = underlayRanges(p, o, kinds);
    if (measureFill(p, analyze(p, o, kinds)).underlay) expect(r.length).toBeGreaterThan(0);
  });
});

describe('border in a thread of its own', () => {
  const red = { r: 200, g: 20, b: 30 };
  it('is an object of its own after the fill, in a color block of its own, kept when nothing changes', () => {
    const p = load('cat-60mm.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs[1];
    const base = { ...measureFill(p, analyze(p, o, kinds)), pattern: 'tatami' as const };
    const a = apply(p, o.index, { ...base, border: { type: 'satin', width: 2, color: red, link: 'l1' } });
    const next = syncBorders(a.q, 7);
    expect(next).not.toBe(a.q);
    expect(next.colors.length).toBe(a.q.colors.length + 1);
    const nobjs = sewObjects(next, stitchKinds(next));
    const border = nobjs.find((x) => remembered(next, x)?.outline === 'l1')!;
    expect(border).toBeDefined();
    expect(border.color).toMatchObject(red);
    expect(border.block).toBe(nobjs.find((x) => remembered(next, x)?.fill?.border?.link === 'l1')!.block + 1);
    // Nothing changed: nothing to do.
    expect(syncBorders(next, 7)).toBe(next);
    // Taken away with its link dropped.
    const fill = nobjs.find((x) => remembered(next, x)?.fill?.border?.link === 'l1')!;
    const m = remembered(next, fill)!;
    remember(next, fill, { ...m, fill: { ...m.fill!, border: undefined } });
    const gone = syncBorders(next, 7, new Set(['l1']));
    expect(gone.colors.length).toBe(a.q.colors.length);
    expect(sewObjects(gone, stitchKinds(gone)).some((x) => remembered(gone, x)?.outline)).toBe(false);
  });
});

describe('border and other parts', () => {
  it('drops the border from the fill when it gets its own thread', () => {
    const p = load('cat-60mm.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs[1];
    const base = { ...measureFill(p, analyze(p, o, kinds)), pattern: 'tatami' as const };
    const plain = apply(p, o.index, base);
    const a = apply(p, o.index, { ...base, border: { type: 'satin', width: 2 } });
    const b = apply(a.q, a.o.index, { ...base, border: { type: 'satin', width: 2, color: { r: 1, g: 2, b: 3 }, link: 'x' } });
    expect(Math.abs(stitches(b.q, b.o.first, b.o.last) - stitches(plain.q, plain.o.first, plain.o.last))).toBeLessThan(60);
  });
});

it('keeps the running stitch of a fill object when a border comes and goes', () => {
  const p = load('cat-60mm.pes');
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  // An object with a fill and a long running stitch after it (the yarn of the sweater).
  const o = objs.find((x) => {
    const parts = analyze(p, x, kinds).parts;
    const f = parts.findIndex((pt) => pt.kind === 'fill');
    return f >= 0 && parts.slice(f + 1).some((pt) => pt.kind === 'run' && pt.e - pt.s > 30);
  })!;
  expect(o).toBeDefined();
  const runOf = (q: Pattern, x: SewObject, k: Uint8Array) => analyze(q, x, k).parts.filter((pt) => pt.kind === 'run' && !pt.border).reduce((n, pt) => n + stitches(q, pt.s, pt.e), 0);
  const before = runOf(p, o, kinds);
  const base = { ...measureFill(p, analyze(p, o, kinds)) };
  const a = apply(p, o.index, { ...base, border: { type: 'satin', width: 2 } });
  const b = apply(a.q, a.o.index, { ...base, border: { type: 'run', width: 2 } });
  const c = apply(b.q, b.o.index, base);
  expect(runOf(c.q, c.o, c.kinds)).toBeGreaterThan(before * 0.8);
});
