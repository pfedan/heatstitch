import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sample } from '../src/digitize/region';
import { sewObjects, type SewObject } from '../src/model/objects';
import { STITCH, type Pattern } from '../src/model/pattern';
import { formOf, reshapeFill, scaleBlocked, transformSewObject } from '../src/model/reshape';
import { analyze, measureFill, remember, remembered, rememberedIn, restoreRemembered } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { formArea, rotation, scaling, transformForm, translation } from '../src/shape/path';
import { rasterize } from '../src/shape/rasterize';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);

function setup(f: string) {
  const p = load(f);
  const kinds = stitchKinds(p);
  return { p, kinds, objs: sewObjects(p, kinds) };
}

const stitches = (p: Pattern, a = 0, b = p.cmd.length - 1) => {
  let n = 0;
  for (let i = a; i <= b; i++) if (p.cmd[i] === STITCH) n++;
  return n;
};

/** Center of an object's stitches (mm). */
const center = (p: Pattern, o: { first: number; last: number }) => {
  let x = 0;
  let y = 0;
  let n = 0;
  for (let i = o.first; i <= o.last; i++) {
    if (p.cmd[i] !== STITCH) continue;
    x += p.x[i] / 10;
    y += p.y[i] / 10;
    n++;
  }
  return [x / n, y / n];
};

const fillOf = (p: Pattern, objs: SewObject[], kinds: Uint8Array) => objs.find((o) => o.kind === 'fill' && scaleBlocked(p, o, kinds) === null && analyze(p, o, kinds).fill)!;

describe('moving, turning and scaling objects', () => {
  it('moves an object with its stitches as they are, and the object stays one', () => {
    const { p, kinds, objs } = setup('demos/letters.pes');
    const o = fillOf(p, objs, kinds);
    const r = transformSewObject(p, objs, o, kinds, translation(5, -3), 7)!;
    expect(r.restitched).toBe(false);
    expect(stitches(r.pattern)).toBe(stitches(p));
    const [cx, cy] = center(p, o);
    const [nx, ny] = center(r.pattern, r);
    expect(nx - cx).toBeCloseTo(5, 1);
    expect(ny - cy).toBeCloseTo(-3, 1);
    // Every other object is where it was.
    expect(sewObjects(r.pattern).length).toBe(objs.length);
    // The way in is a jump, not a long stitch.
    expect(r.pattern.cmd[r.first - 1]).not.toBe(STITCH);
  });

  it('turns an object with its row direction and keeps its area', () => {
    const { p, kinds, objs } = setup('demos/letters.pes');
    const o = fillOf(p, objs, kinds);
    const before = analyze(p, o, kinds).fill!.areaMm2;
    const angle = measureFill(p, analyze(p, o, kinds)).angle;
    const [cx, cy] = center(p, o);
    const r = transformSewObject(p, objs, o, kinds, rotation(30, cx, cy), 7)!;
    expect(r.restitched).toBe(false);
    const nobjs = sewObjects(r.pattern);
    const no = nobjs.find((x) => x.first === r.first)!;
    const known = remembered(r.pattern, no);
    // Nothing was remembered for a file object that was never edited: it is read from the stitches.
    const an = analyze(r.pattern, no, stitchKinds(r.pattern), known);
    expect(Math.abs(an.fill!.areaMm2 - before) / before).toBeLessThan(0.05);
    const turned = measureFill(r.pattern, an).angle;
    const diff = Math.abs((((turned - angle - 30) % 180) + 270) % 180 - 90);
    expect(diff).toBeLessThan(4);
  });

  it('scales a fill by sewing it anew at the same density', () => {
    const { p, kinds, objs } = setup('demos/letters.pes');
    const o = fillOf(p, objs, kinds);
    const an = analyze(p, o, kinds);
    const spacing = measureFill(p, an).spacing;
    const [cx, cy] = center(p, o);
    const r = transformSewObject(p, objs, o, kinds, scaling(1.5, 1.5, cx, cy), 7)!;
    expect(r.restitched).toBe(true);
    const nk = stitchKinds(r.pattern);
    const no = sewObjects(r.pattern, nk).find((x) => x.first === r.first)!;
    const known = remembered(r.pattern, no)!;
    expect(known.form).toBeDefined();
    expect(known.region!.areaMm2 / an.fill!.areaMm2).toBeGreaterThan(2.1);
    expect(known.region!.areaMm2 / an.fill!.areaMm2).toBeLessThan(2.4);
    expect(measureFill(r.pattern, analyze(r.pattern, no, nk, known)).spacing).toBeCloseTo(spacing, 1);
  });
});

describe('changing the shape of a fill', () => {
  it('traces the fill area as curves', () => {
    const { p, kinds, objs } = setup('demos/letters.pes');
    const o = fillOf(p, objs, kinds);
    const f = formOf(p, o, kinds)!;
    expect(f.paths.length).toBeGreaterThan(0);
    const area = analyze(p, o, kinds).fill!.areaMm2;
    expect(Math.abs(formArea(f) - area) / area).toBeLessThan(0.05);
  });

  it('fills the new shape and leaves nothing of the old stitches outside it', () => {
    const { p, kinds, objs } = setup('demos/letters.pes');
    const o = fillOf(p, objs, kinds);
    const f = formOf(p, o, kinds)!;
    const [cx, cy] = center(p, o);
    // Shrunk to 70 % around its middle.
    const small = transformForm(f, scaling(0.7, 0.7, cx, cy));
    const r = reshapeFill(p, objs, o, kinds, small, 7)!;
    expect(r.starts).toHaveLength(1);
    const area = rasterize(small)!;
    const kept = r.memory[0];
    expect(kept.form).toBe(small);
    expect(kept.region!.areaMm2).toBeCloseTo(area.areaMm2, 0);
    // Every stitch of the object lies in (or right at the edge of) the new area.
    const no = sewObjects(r.pattern).find((x) => stitches(r.pattern, 0, x.first - 1) === r.starts[0])!;
    let outside = 0;
    for (let i = no.first; i <= no.last; i++) if (r.pattern.cmd[i] === STITCH && sample(area, area.sdfBase, r.pattern.x[i] / 10, r.pattern.y[i] / 10) > 0.6) outside++;
    expect(outside).toBe(0);
    // The others keep their stitches.
    expect(sewObjects(r.pattern).length).toBe(objs.length);
  });

  it('stores the curves with the file and reads them back', () => {
    const { p, kinds, objs } = setup('demos/letters.pes');
    const o = fillOf(p, objs, kinds);
    const f = formOf(p, o, kinds)!;
    const r = reshapeFill(p, objs, o, kinds, transformForm(f, translation(1, 1)), 7)!;
    const nobjs = sewObjects(r.pattern);
    const no = nobjs.find((x) => stitches(r.pattern, 0, x.first - 1) === r.starts[0])!;
    // What applying it remembers (as the app does), then stored and read again.
    remember(r.pattern, no, r.memory[0]);
    const stored = JSON.parse(JSON.stringify(rememberedIn(r.pattern, nobjs), (_k, v) => (v instanceof Uint8Array ? Array.from(v) : v)));
    const entry = stored.find((e: { form?: unknown }) => e.form);
    expect(entry).toBeDefined();
    entry.region.mask = Uint8Array.from(entry.region.mask);
    expect(restoreRemembered([entry])).toBe(1);
    expect(formArea(remembered(r.pattern, no)!.form!)).toBeCloseTo(formArea(r.memory[0].form!), 1);
  });
});
