import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyProposals, crop, fineZones, planCorrection } from '../src/correct/plan';
import { sewObjects } from '../src/model/objects';
import { STITCH, TRIM } from '../src/model/pattern';
import { forget, objectKey, remember, remembered, rememberedIn } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import type { Profile } from '../src/validation/profiles';
import { ALL_CHECKS, validatePattern } from '../src/validation/validate';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);
const KNIT: Profile = { fabric: 'knit', thread: '40' };
const OPT = { goal: 'critical', focus: 'both', trimMm: 2 } as const;

describe('cropping a pattern', () => {
  it('keeps the stitches inside the window and cuts the thread where it leaves', () => {
    const p = load('demos/overlap.pes');
    const b = p.bounds;
    const box = { minX: b.minX / 10, minY: b.minY / 10, maxX: (b.minX + b.maxX) / 20, maxY: b.maxY / 10 };
    const c = crop(p, box).pattern;
    let inside = 0;
    for (let i = 0; i < p.cmd.length; i++) if (p.cmd[i] === STITCH && p.x[i] <= box.maxX * 10) inside++;
    let kept = 0;
    for (let i = 0; i < c.cmd.length; i++) {
      if (c.cmd[i] !== STITCH) continue;
      kept++;
      expect(c.x[i]).toBeLessThanOrEqual(box.maxX * 10);
    }
    expect(kept).toBe(inside);
    expect([...c.cmd].filter((x) => x === TRIM).length).toBeGreaterThan(0);
  });
});

describe('proposals from settings', () => {
  it('proposes wider spacing for dense fills and changes nothing while planning', async () => {
    const p = load('demos/overlap.pes');
    const v = validatePattern(p, KNIT);
    const before = rememberedIn(p, sewObjects(p)).length;
    const plan = await planCorrection(p, v, KNIT, ALL_CHECKS, OPT);
    expect(plan.proposals.length).toBeGreaterThan(0);
    for (const x of plan.proposals) {
      expect(x.changes.every((c) => c.field === 'spacing' && Number(c.to) > Number(c.from) && Number(c.to) <= 0.5)).toBe(true);
      expect(x.checked).toBe(true);
    }
    // Planning tries stitches but remembers none of them.
    expect(rememberedIn(p, sewObjects(p)).length).toBe(before);
    expect(validatePattern(plan.pattern, KNIT).cautionCells + 4 * validatePattern(plan.pattern, KNIT).criticalCells).toBeLessThan(v.cautionCells + 4 * v.criticalCells);
  });

  it('takes over the ticked proposals and remembers what it changed', async () => {
    const p = load('demos/overlap.pes');
    const v = validatePattern(p, KNIT);
    const plan = await planCorrection(p, v, KNIT, ALL_CHECKS, OPT);
    const r = applyProposals(p, plan.proposals, 2)!;
    expect(r.done).toBe(plan.proposals.length);
    const objs = sewObjects(r.pattern);
    expect(objs.length).toBe(sewObjects(p).length);
    for (const x of plan.proposals) {
      const mem = remembered(r.pattern, objs[x.index]);
      expect(mem?.fixed?.map((c) => c.field)).toEqual(x.changes.map((c) => c.field));
      expect(mem?.fill?.spacing).toBe(x.changes[0].to);
    }
  });

  it('leaves locked objects alone', async () => {
    const p = load('demos/overlap.pes');
    const objs = sewObjects(p);
    const keys = objs.map((o) => objectKey(p, o));
    for (const o of objs) remember(p, o, { region: null, lock: true });
    try {
      const plan = await planCorrection(p, validatePattern(p, KNIT), KNIT, ALL_CHECKS, OPT);
      expect(plan.proposals).toEqual([]);
      expect(plan.locked).toBeGreaterThan(0);
    } finally {
      for (const o of objs) forget(p, o);
      expect(objs.map((o) => objectKey(p, o))).toEqual(keys);
    }
  });

  it('leaves what no setting fixes to the fine correction on foreign stitches', async () => {
    const p = load('demos/overlap.pes');
    const v = validatePattern(p, KNIT);
    const boxes = fineZones(p, v, [], OPT);
    expect(boxes.length).toBeGreaterThan(0);
    // Objects with a proposal are not touched by it.
    const plan = await planCorrection(p, v, KNIT, ALL_CHECKS, OPT);
    const after = validatePattern(plan.pattern, KNIT);
    const objs = sewObjects(p);
    const changed = plan.proposals.map((x) => objs[x.index]);
    for (const b of fineZones(p, after, plan.proposals, OPT)) {
      for (const o of changed) {
        let inside = false;
        for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH && p.x[i] / 10 >= b.minX - 0.5 && p.x[i] / 10 <= b.maxX + 0.5 && p.y[i] / 10 >= b.minY - 0.5 && p.y[i] / 10 <= b.maxY + 0.5) inside = true;
        expect(inside).toBe(false);
      }
    }
  });
});

describe('tuning to the fabric', () => {
  it('brings spacing into the recommended range and leaves locked objects alone', async () => {
    const { planFabric } = await import('../src/correct/plan');
    const p = load('demos/overlap.pes');
    const loose: Profile = { fabric: 'terry', thread: '40' };
    const list = planFabric(p, loose);
    expect(list.length).toBeGreaterThan(0);
    for (const x of list) {
      const sp = x.changes.find((c) => c.field === 'spacing');
      if (sp) expect(Number(sp.to)).toBeGreaterThanOrEqual(0.55 - 1e-9);
    }
    const objs = sewObjects(p);
    for (const o of objs) remember(p, o, { region: null, lock: true });
    try {
      expect(planFabric(p, loose)).toEqual([]);
    } finally {
      for (const o of objs) forget(p, o);
    }
  });
});

describe('rules as defaults for what is made here', () => {
  it('gives small fills no underlay and large fills on stretchy fabric crossing layers', async () => {
    const { digitizeDefaults, fillUnder, pullFor } = await import('../src/digitize/digitize');
    const woven = digitizeDefaults({ fabric: 'woven', thread: '40' });
    const knit = digitizeDefaults(KNIT);
    expect(fillUnder(woven, 20)).toEqual({ underlay: false });
    expect(fillUnder(woven, 500)).toEqual({ underlay: true });
    expect(fillUnder(knit, 500)).toEqual({ underlay: true, underCross: true });
    expect(knit.splitMm).toBe(7);
    // Longer rows pull in more; satins half fixed, half by width.
    expect(pullFor(KNIT, 'fill', 900).edge).toBeGreaterThan(pullFor(KNIT, 'fill', 100).edge);
    const s = pullFor(KNIT, 'satin');
    expect(s.edge + 4 * s.edgeShare!).toBeCloseTo(0.35, 1);
  });
});
