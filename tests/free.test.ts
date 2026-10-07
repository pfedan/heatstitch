import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planCorrection } from '../src/correct/plan';
import { sewObjects } from '../src/model/objects';
import { stitchKinds } from '../src/model/sequence';
import { STITCH } from '../src/model/pattern';
import { transformSewObject } from '../src/model/reshape';
import { forget, keepShape, remember, remembered, rememberedIn, restitch, restoreRemembered } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import type { Profile } from '../src/validation/profiles';
import { ALL_CHECKS, validatePattern } from '../src/validation/validate';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);
const KNIT: Profile = { fabric: 'knit', thread: '40' };
const stitches = (p: { cmd: Uint8Array }) => p.cmd.filter((c) => c === STITCH).length;

describe('stitches loosed from their shape', () => {
  it('are never sewn anew, kept when stored, and get no proposals', async () => {
    const p = load('demos/overlap.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const fill = objs.find((o) => o.kind === 'fill')!;
    remember(p, fill, { ...keepShape(p, fill, kinds), read: undefined, free: true });
    try {
      const r = restitch(p, objs, [fill.index], { kind: 'fill', s: { pattern: 'tatami', spacing: 0.6, offset: 0.25, angle: 0, stitch: 4, underlay: false, edge: 0, spacingEnd: 0.6, tolerance: 0.15 } }, kinds, 2);
      expect(r.failed).toEqual([fill.index]);
      expect(r.starts).toEqual([]);
      // Stored with the project and read back.
      const stored = rememberedIn(p);
      expect(stored.objects.find((x) => x.memory?.free)).toBeTruthy();
      forget(p, fill);
      restoreRemembered(p, stored);
      expect(remembered(p, fill)?.free).toBe(true);
      // The correction proposes no settings for it.
      const plan = await planCorrection(p, validatePattern(p, KNIT), KNIT, ALL_CHECKS, { goal: 'critical', focus: 'both', trimMm: 2 });
      expect(plan.proposals.some((x) => x.index === fill.index)).toBe(false);
    } finally {
      forget(p, fill);
    }
  });

  it('are scaled as they are, the resting shape with them', () => {
    const p = load('demos/overlap.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const fill = objs.find((o) => o.kind === 'fill')!;
    remember(p, fill, { ...keepShape(p, fill, kinds), read: undefined, free: true });
    try {
      const t = transformSewObject(p, objs, fill, kinds, [1.5, 0, 0, 1.5, 0, 0], 2)!;
      expect(t.restitched).toBe(false);
      expect(stitches(t.pattern)).toBe(stitches(p));
      const moved = sewObjects(t.pattern).find((o) => o.first === t.first)!;
      const mem = remembered(t.pattern, moved)!;
      expect(mem.free).toBe(true);
      expect(mem.region!.areaMm2).toBeGreaterThan(remembered(p, fill)!.region!.areaMm2 * 2);
    } finally {
      forget(p, fill);
    }
  });
});
