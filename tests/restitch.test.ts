import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sewObjects, type SewObject } from '../src/model/objects';
import { STITCH, TRIM, type Pattern } from '../src/model/pattern';
import { analyze, measureFill, measureRun, measureSatin, remember, remembered, restitch, shapeTrust } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);

/** Stitch coordinates from record a to b. */
const points = (p: Pattern, a: number, b: number) => {
  const out: string[] = [];
  for (let i = a; i <= b; i++) if (p.cmd[i] === STITCH) out.push(`${p.x[i]},${p.y[i]}`);
  return out;
};

/** Record of the n-th stitch (1-based). */
const recordOf = (p: Pattern, n: number) => {
  let k = 0;
  for (let i = 0; i < p.cmd.length; i++) if (p.cmd[i] === STITCH && ++k === n) return i;
  return p.cmd.length;
};

function setup(f: string) {
  const p = load(f);
  const kinds = stitchKinds(p);
  return { p, kinds, objs: sewObjects(p, kinds) };
}

const firstOf = (objs: SewObject[], kind: string) => objs.find((o) => o.kind === kind)!;

describe('measuring objects', () => {
  it('reads the fill spacing and angle of the demo letters', () => {
    const { p, kinds, objs } = setup('demos/letters.pes');
    for (const o of objs.filter((x) => x.kind === 'fill')) {
      const m = measureFill(p, analyze(p, o, kinds));
      expect(m.spacing).toBeGreaterThan(0.3);
      expect(m.spacing).toBeLessThan(0.5);
    }
  });

  it('splits an object into the kinds it is made of', () => {
    const { p, kinds, objs } = setup('demos/letters.pes');
    const sat = firstOf(objs, 'satin');
    const a = analyze(p, sat, kinds);
    expect(a.parts.some((pt) => pt.kind === 'satin')).toBe(true);
    // Parts follow each other without gaps or overlaps.
    for (let k = 1; k < a.parts.length; k++) expect(a.parts[k].s).toBeGreaterThanOrEqual(a.parts[k - 1].e);
    const m = measureSatin(p, a.parts.find((pt) => pt.kind === 'satin')!, kinds);
    expect(m.spacing).toBeGreaterThan(0.2);
    expect(m.spacing).toBeLessThan(0.8);
  });
});

describe('restitching objects', () => {
  it('refills an object at the new spacing and leaves everything else as it was', () => {
    const { p, kinds, objs } = setup('cat-60mm.pes');
    const o = objs[1];
    const before = measureFill(p, analyze(p, o, kinds));
    const r = restitch(p, objs, [o.index], { kind: 'fill', s: { ...before, pattern: 'tatami', spacing: 0.6, angle: 90 } }, kinds, 7);
    expect(r.failed).toEqual([]);
    const q = r.pattern;
    const a = recordOf(q, r.starts[0] + 1);
    const b = recordOf(q, r.ends[0]);
    // Before and after the object: the same stitches.
    expect(points(q, 0, a - 1)).toEqual(points(p, 0, o.first - 1));
    expect(points(q, b + 1, q.cmd.length - 1)).toEqual(points(p, o.last + 1, p.cmd.length - 1));
    // Patches are joined by travel along the old thread, not cut apart.
    let trims = 0;
    for (let i = a; i <= b; i++) if (q.cmd[i] === TRIM) trims++;
    expect(trims).toBe(0);
    const now = sewObjects(q, stitchKinds(q)).find((x) => x.first === a)!;
    const after = measureFill(q, analyze(q, now, stitchKinds(q)));
    expect(after.spacing).toBeGreaterThan(0.5);
    expect(after.spacing).toBeLessThan(0.7);
    expect(Math.min(Math.abs(after.angle - 90), 180 - Math.abs(after.angle - 90))).toBeLessThan(10);
  });

  it('widens a satin column', () => {
    const { p, kinds, objs } = setup('demos/letters.pes');
    const o = firstOf(objs, 'satin');
    const pt = analyze(p, o, kinds).parts.find((x) => x.kind === 'satin')!;
    const m = measureSatin(p, pt, kinds);
    const r = restitch(p, objs, [o.index], { kind: 'satin', s: { ...m, edge: 0.4 } }, kinds, 7);
    expect(r.failed).toEqual([]);
    const now = sewObjects(r.pattern).find((x) => x.first === recordOf(r.pattern, r.starts[0] + 1))!;
    expect((now.maxX - now.minX) * (now.maxY - now.minY)).toBeGreaterThan((o.maxX - o.minX) * (o.maxY - o.minY));
  });

  it('shortens running stitches', () => {
    const { p, kinds, objs } = setup('demos/letters.pes');
    const o = firstOf(objs, 'run');
    const pt = analyze(p, o, kinds).parts[0];
    const m = measureRun(p, pt);
    const r = restitch(p, objs, [o.index], { kind: 'run', s: { ...m, stitch: m.stitch / 2 } }, kinds, 7);
    expect(r.ends[0] - r.starts[0]).toBeGreaterThan(o.stitches * 1.5);
  });

  it('keeps a spiral an object of fill, with its shape for the next edit', () => {
    const { p, kinds, objs } = setup('demos/overlap.pes');
    const o = firstOf(objs, 'fill');
    const an = analyze(p, o, kinds);
    const m = measureFill(p, an);
    const r = restitch(p, objs, [o.index], { kind: 'fill', s: { ...m, pattern: 'spiral', stitch: 2.5 } }, kinds, 7);
    expect(r.failed).toEqual([]);
    const q = r.pattern;
    const now = sewObjects(q).find((x) => x.first === recordOf(q, r.starts[0] + 1))!;
    expect(now.kind).toBe('fill');
    remember(q, now, { region: r.regions[0], fill: { ...m, pattern: 'spiral' } });
    expect(remembered(q, now)?.fill?.pattern).toBe('spiral');
    const again = analyze(q, now, stitchKinds(q));
    expect(again.fill).toBe(r.regions[0]);
    expect(shapeTrust(q, now, again, 0.4)).toBe('kept');
  });

  it('trusts shapes of dense rows, not of open ones', () => {
    const { p, kinds, objs } = setup('demos/letters.pes');
    const o = firstOf(objs, 'fill');
    const an = analyze(p, o, kinds);
    expect(shapeTrust(p, o, an, measureFill(p, an).spacing)).toBe('good');
    expect(shapeTrust(p, o, an, 0.8)).toBe('approximate');
  });
});
