import { describe, expect, it } from 'vitest';
import { underlay } from '../src/digitize/satin';
import type { Pt } from '../src/digitize/skeleton';
import { columnOf, reversedRails, satinRuns, sectionsOf, spacingAlong, widthFactor, type Rails, type SatinSettings } from '../src/model/restitch';

const line = (x0: number, y0: number, x1: number, y1: number, n = 31): Pt[] => Array.from({ length: n }, (_, k) => [x0 + ((x1 - x0) * k) / (n - 1), y0 + ((y1 - y0) * k) / (n - 1)] as Pt);
const SATIN: SatinSettings = { spacing: 0.4, edge: 0, short: true, underlay: false, tolerance: 0.15 };
const straight = (): Rails => ({ left: line(0, 0, 30, 0), right: line(0, 3, 30, 3), rungs: [] });

describe('satin sections', () => {
  it('cuts a column into sections at its cut lines, rungs and spacings going along', () => {
    const r: Rails = { ...straight(), rungs: [[5, 5], [20, 20]], cuts: [[10, 10]], spacings: [[20, 0.6]] };
    const [a, b] = sectionsOf(r);
    expect(a.left[a.left.length - 1][0]).toBeCloseTo(10);
    expect(b.left[0][0]).toBeCloseTo(10);
    expect(a.rungs).toEqual([[5, 5]]);
    expect(b.rungs).toEqual([[10, 10]]);
    expect(b.spacings).toEqual([[10, 0.6]]);
  });

  it('cuts rails paired point by point at the nearest point', () => {
    const r: Rails = { left: line(0, 0, 30, 0), right: line(0, 3, 30, 3), cuts: [[15.2, 15.2]] };
    const parts = sectionsOf(r);
    expect(parts.length).toBe(2);
    expect(parts[0].left.length + parts[1].left.length).toBe(r.left.length + 1);
  });

  it('sews the sections as one run, each starting anew at the cut', () => {
    const r: Rails = { ...straight(), cuts: [[15, 15]] };
    const runs = satinRuns([r], SATIN);
    expect(runs.length).toBe(1);
    const one = satinRuns([straight()], SATIN)[0];
    // About as many stitches as without the cut, a stitch or two more where the section starts.
    expect(Math.abs(runs[0].length - one.length)).toBeLessThan(6);
    // With an underlay out to the end, the sections come back from the far one.
    const under = satinRuns([r], { ...SATIN, underlay: true, under: 'center' })[0];
    const last = under[under.length - 1];
    expect(last[0]).toBeLessThan(1);
  });

  it('keeps cut lines and spacings at their place when the column is turned round', () => {
    const r: Rails = { ...straight(), rungs: [[20, 20]], cuts: [[10, 10]], spacings: [[20, 0.6]] };
    const back = reversedRails(r);
    expect(back.cuts![0][0]).toBeCloseTo(20);
    expect(back.spacings![0][0]).toBeCloseTo(10);
  });
});

describe('spacing along the column', () => {
  it('blends a spacing set at a rung towards the neighbouring rungs and ends', () => {
    const r: Rails = { ...straight(), rungs: [[10, 10], [20, 20]], spacings: [[20, 0.8]] };
    const col = columnOf(r);
    const at = spacingAlong(col, r, 0.4, false)!;
    const near = (x: number) => at[col.left.findIndex((p) => p[0] >= x)];
    expect(near(5)).toBeCloseTo(0.4);
    expect(near(15)).toBeCloseTo(0.6, 1);
    expect(near(20)).toBeCloseTo(0.8, 1);
    expect(near(25)).toBeCloseTo(0.6, 1);
  });

  it('loosens narrow parts and tightens wide ones by width', () => {
    expect(widthFactor(1.5)).toBeCloseTo(1.2);
    expect(widthFactor(4)).toBeCloseTo(1);
    expect(widthFactor(8)).toBeCloseTo(0.9);
    const narrow = satinRuns([{ left: line(0, 0, 30, 0), right: line(0, 1.5, 30, 1.5), rungs: [] }], { ...SATIN, byWidth: true })[0];
    const even = satinRuns([{ left: line(0, 0, 30, 0), right: line(0, 1.5, 30, 1.5), rungs: [] }], SATIN)[0];
    expect(narrow.length).toBeLessThan(even.length * 0.9);
  });
});

describe('automatic underlay along the column', () => {
  it('walks the middle where narrow and zigzags where wide', () => {
    // 3 mm wide for 15 mm, then 8 mm wide for 15 mm.
    const left: Pt[] = [...line(0, 0, 15, 0, 16), ...line(15.5, -2.5, 30, -2.5, 16)];
    const right: Pt[] = [...line(0, 3, 15, 3, 16), ...line(15.5, 5.5, 30, 5.5, 16)];
    const col = columnOf({ left, right });
    const pts = underlay(col);
    const narrow = pts.filter((p) => p[0] < 13);
    const wide = pts.filter((p) => p[0] > 18);
    expect(Math.max(...narrow.map((p) => Math.abs(p[1] - 1.5)))).toBeLessThan(0.3);
    expect(Math.max(...wide.map((p) => Math.abs(p[1] - 1.5)))).toBeGreaterThan(2.5);
  });
});

describe('sections on a real satin', () => {
  it('stays one object without new trims and stores its cut lines', async () => {
    const { readFileSync } = await import('node:fs');
    const { parsePattern } = await import('../src/parsers');
    const { sewObjects } = await import('../src/model/objects');
    const { stitchKinds } = await import('../src/model/sequence');
    const { keepShape, measureSatin, analyze, remember, restitch, rememberedIn, forget } = await import('../src/model/restitch');
    const { takeOver } = await import('../src/model/knockout');
    const { TRIM } = await import('../src/model/pattern');
    const p = parsePattern(readFileSync(new URL('../public/examples/demos/letters.pes', import.meta.url)), 'letters.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs.find((x) => x.kind === 'satin')!;
    const known = keepShape(p, o, kinds);
    const col = known.columns![0][0];
    const len = col.left.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - col.left[i - 1][0], q[1] - col.left[i - 1][1]) : 0), 0);
    const cut: Rails = { ...col, cuts: [[len / 2, len / 2]] };
    remember(p, o, { ...known, read: false, columns: [[cut, ...known.columns![0].slice(1)], ...known.columns!.slice(1)] });
    const s = measureSatin(p, analyze(p, o, kinds).parts.find((x) => x.kind === 'satin')!, kinds);
    const r = restitch(p, objs, [o.index], { kind: 'satin', s }, kinds, 2);
    const next = takeOver(r)!;
    const trims = (q: typeof p) => [...q.cmd].filter((c) => c === TRIM).length;
    expect(sewObjects(next).length).toBe(objs.length);
    expect(trims(next)).toBeLessThanOrEqual(trims(p));
    const stored = rememberedIn(next, sewObjects(next)).find((x) => x.columns);
    expect(stored?.columns?.[0][0].cuts?.length).toBe(2);
    forget(p, o);
  });
});
