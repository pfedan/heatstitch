import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sample } from '../src/digitize/region';
import { sewObjects, type SewObject } from '../src/model/objects';
import { STITCH, type Pattern } from '../src/model/pattern';
import { reshapeFill, scaleBlocked, transformObjects, transformSewObject } from '../src/model/reshape';
import { analyze, measureFill, remember, remembered, rememberedIn, restoreRemembered } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { formArea, rotation, scaling, transformForm, translation } from '../src/shape/path';
import { rasterize } from '../src/shape/rasterize';
import { guessArea } from '../src/model/geo';
import { Writer } from './helpers/designs';

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
    // Its form was read from the stitches: still a guess, scaled as pixels, no curves kept (rule 6).
    expect(known.geo).toBeUndefined();
    expect(known.region!.areaMm2 / an.fill!.areaMm2).toBeGreaterThan(2.1);
    expect(known.region!.areaMm2 / an.fill!.areaMm2).toBeLessThan(2.4);
    expect(measureFill(r.pattern, analyze(r.pattern, no, nk, known)).spacing).toBeCloseTo(spacing, 1);
  });
});

describe('scaling a satin too narrow for rails', () => {
  // As the Image mode leaves a satin in a tiny area (an eye of a 2 cm cat): one line there and back,
  // remembered as satin, with no columns and none to read from its stitches.
  function design() {
    const w = new Writer();
    w.start([0, 0]);
    for (let y = 0; y <= 10; y += 0.4) {
      w.to([0, y]);
      w.to([10, y]);
    }
    w.color();
    w.start([20, 5]);
    for (const dx of [-0.3, -0.6, -0.3, 0, -0.6, 0, -0.3, -0.6, -0.3, 0]) w.to([20 + dx, 5]);
    const p = w.b.build('dot', 'pes', [{ r: 250, g: 160, b: 50 }, { r: 40, g: 50, b: 50 }]);
    const objs = sewObjects(p, stitchKinds(p));
    const dot = objs[objs.length - 1];
    remember(p, dot, { region: null, parts: [{ kind: 'satin', end: stitches(p, dot.first, dot.last) }] });
    return { p, objs, dot };
  }

  it('scales it with its stitches as they are, and the objects scaled with it too', () => {
    const { p, objs, dot } = design();
    const r = transformObjects(p, objs.map((o) => o.index), scaling(2, 2, 0, 0), 3);
    expect(r, 'the scaling goes through').toBeTruthy();
    const after = sewObjects(r!.pattern);
    expect(after.map((o) => o.id)).toEqual(objs.map((o) => o.id));
    const now = after[after.length - 1];
    // Twice as long, as many stitches, in its place scaled.
    expect((now.maxX - now.minX) / 10).toBeCloseTo(1.2, 5);
    expect(stitches(r!.pattern, now.first, now.last)).toBe(stitches(p, dot.first, dot.last));
    expect(center(r!.pattern, now)[1]).toBeCloseTo(10, 5);
    // The fill beside it was sewn anew, twice as wide.
    expect((after[0].maxX - after[0].minX) / 10).toBeGreaterThan(19);
  });
});

describe('changing the shape of a fill', () => {
  it('traces the fill area as curves', () => {
    const { p, kinds, objs } = setup('demos/letters.pes');
    const o = fillOf(p, objs, kinds);
    const f = guessArea(p, o, kinds)!;
    expect(f.paths.length).toBeGreaterThan(0);
    const area = analyze(p, o, kinds).fill!.areaMm2;
    expect(Math.abs(formArea(f) - area) / area).toBeLessThan(0.05);
  });

  it('fills the new shape and leaves nothing of the old stitches outside it', () => {
    const { p, kinds, objs } = setup('demos/letters.pes');
    const o = fillOf(p, objs, kinds);
    const f = guessArea(p, o, kinds)!;
    const [cx, cy] = center(p, o);
    // Shrunk to 70 % around its middle.
    const small = transformForm(f, scaling(0.7, 0.7, cx, cy));
    const r = reshapeFill(p, objs, o, kinds, small, 7)!;
    expect(r.starts).toHaveLength(1);
    const area = rasterize(small)!;
    const kept = r.memory[0];
    expect(kept.geo).toBe(small);
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
    const f = guessArea(p, o, kinds)!;
    const r = reshapeFill(p, objs, o, kinds, transformForm(f, translation(1, 1)), 7)!;
    const nobjs = sewObjects(r.pattern);
    const no = nobjs.find((x) => stitches(r.pattern, 0, x.first - 1) === r.starts[0])!;
    // What applying it remembers (as the app does), then stored and read again.
    remember(r.pattern, no, r.memory[0]);
    const stored = JSON.parse(JSON.stringify(rememberedIn(r.pattern, nobjs), (_k, v) => (v instanceof Uint8Array ? Array.from(v) : v)));
    const entry = stored.objects.find((e: { memory?: { geo?: unknown } }) => e.memory?.geo)?.memory;
    expect(entry).toBeDefined();
    entry.region.mask = Uint8Array.from(entry.region.mask);
    stored.objects = stored.objects.filter((e: { memory?: unknown }) => e.memory === entry);
    expect(restoreRemembered(r.pattern, stored)).toBe(1);
    expect(formArea(remembered(r.pattern, no)!.geo!)).toBeCloseTo(formArea(r.memory[0].geo!), 1);
  });
});
