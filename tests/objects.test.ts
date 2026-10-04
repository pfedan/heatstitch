import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { digitize, digitizeDefaults } from '../src/digitize/digitize';
import { DEFAULT_PREPARE, Preparer } from '../src/image/prepare';
import { rememberObjects, sewObjects } from '../src/model/objects';
import { STITCH, TRIM, type Pattern } from '../src/model/pattern';
import { analyze, measureFill, measureSatin, rememberedIn, restitch, restoreRemembered } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { writePattern } from '../src/writers';
import { RED, WHITE, shape } from './helpers/images';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);

const points = (p: Pattern, a: number, b: number) => {
  const out = new Set<string>();
  for (let i = a; i <= b; i++) if (p.cmd[i] === STITCH) out.add(`${p.x[i]},${p.y[i]}`);
  return out;
};

const trimsIn = (p: Pattern, a: number, b: number) => {
  let n = 0;
  for (let i = a; i <= b; i++) if (p.cmd[i] === TRIM) n++;
  return n;
};

/** A U shape from the Image mode: one fill, sewn in pieces with trims between them. */
function uShape() {
  const mm = 50;
  const img = shape(mm * 10, mm * 10, (x, y) => {
    const X = x / 10;
    const Y = y / 10;
    return X > 5 && X < 45 && Y > 5 && Y < 45 && !(X > 18 && X < 32 && Y < 35) ? RED : null;
  }, WHITE);
  const prep = new Preparer(img).run({ ...DEFAULT_PREPARE, widthMm: mm });
  return digitize(prep, digitizeDefaults(DEFAULT_PROFILE), 'u');
}

describe('objects made of several sections', () => {
  it('counts the underlay trimmed off from a fill or satin as part of it', () => {
    const p = load('demos/letters.pes');
    const objs = sewObjects(p);
    // Four letters filled, then four satin borders, each with its underlay.
    expect(objs.map((o) => o.kind)).toEqual(['fill', 'fill', 'fill', 'fill', 'satin', 'satin', 'satin', 'satin']);
    for (const o of objs) expect(o.sections).toBeGreaterThan(1);
  });

  it('keeps fills apart that are not sewn one after the other', () => {
    const p = load('demos/sun.dst');
    const objs = sewObjects(p);
    // The rays are satins of their own.
    expect(objs.filter((o) => o.kind === 'satin' && o.sections === 1).length).toBe(12);
  });

  it('keeps what the Image mode sewed as one object one, through a PES file', () => {
    const d = uShape();
    const p = parsePattern(writePattern(d.pattern, 'pes'), 'u.pes');
    expect(trimsIn(p, 0, p.cmd.length - 1)).toBeGreaterThan(2);
    rememberObjects(p, d.starts);
    const objs = sewObjects(p);
    expect(objs.length).toBe(1);
    expect(objs[0].kind).toBe('fill');
    // Stored with the file and read again.
    const stored = rememberedIn(p, objs);
    expect(stored.filter((s) => s.join !== undefined).length).toBe(objs[0].sections);
    expect(restoreRemembered(JSON.parse(JSON.stringify(stored)))).toBe(stored.length);
  });

  it('replaces the underlay of a fill when it gets new stitches, instead of adding a second one', () => {
    const p = load('demos/letters.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs[0];
    const before = points(p, o.first, o.last);
    const m = measureFill(p, analyze(p, o, kinds));
    expect(m.underlay).toBe(true);
    const r = restitch(p, objs, [0], { kind: 'fill', s: { ...m, angle: (m.angle + 45) % 180 } }, kinds, 3);
    expect(r.failed).toEqual([]);
    rememberObjects(r.pattern, [r.starts[0]], r.ends[0]);
    const now = sewObjects(r.pattern);
    expect(now.length).toBe(objs.length);
    // Nothing of the old object is left (its underlay was a section of its own).
    const after = points(r.pattern, now[0].first, now[0].last);
    let kept = 0;
    for (const k of before) if (after.has(k)) kept++;
    expect(kept).toBeLessThan(before.size * 0.05);
    expect(now[0].stitches).toBeLessThan(o.stitches * 1.6);
  });

  it('replaces the underlay of a satin column too', () => {
    const p = load('demos/letters.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs.find((x) => x.kind === 'satin')!;
    const parts = analyze(p, o, kinds).parts;
    expect(parts.map((x) => x.kind)).toEqual(['satin']);
    const m = measureSatin(p, parts[0], kinds);
    expect(m.underlay).toBe(true);
    // The underlay is the section before the first trim.
    let t = o.first;
    while (p.cmd[t] !== TRIM) t++;
    const underlay = points(p, o.first, t);
    const r = restitch(p, objs, [o.index], { kind: 'satin', s: { ...m, spacing: m.spacing + 0.1 } }, kinds, 3);
    expect(r.failed).toEqual([]);
    rememberObjects(r.pattern, [r.starts[0]], r.ends[0]);
    const now = sewObjects(r.pattern);
    expect(now.length).toBe(objs.length);
    const n = now[o.index];
    const after = points(r.pattern, n.first, n.last);
    let kept = 0;
    for (const k of underlay) if (after.has(k)) kept++;
    expect(kept).toBeLessThan(underlay.size * 0.3);
    // Wider spacing and one underlay: fewer stitches than before.
    expect(n.stitches).toBeLessThan(o.stitches);
  });

  it('gives a fill sewn in pieces new stitches as one area', () => {
    const d = uShape();
    const p = d.pattern;
    rememberObjects(p, d.starts);
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    expect(objs.length).toBe(1);
    const m = measureFill(p, analyze(p, objs[0], kinds));
    const r = restitch(p, objs, [0], { kind: 'fill', s: { ...m, pattern: 'tatami', angle: 0 } }, kinds, 3);
    expect(r.failed).toEqual([]);
    expect(r.regions[0]!.areaMm2).toBeGreaterThan(1000);
    rememberObjects(r.pattern, [r.starts[0]], r.ends[0]);
    expect(sewObjects(r.pattern).length).toBe(1);
  });
});
