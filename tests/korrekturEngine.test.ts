import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyFix, designKey, fixedObjects, prepareFix, revertFix } from '../src/correct/engine/apply';
import { assess } from '../src/correct/engine/ampel';
import { sewObjects } from '../src/model/objects';
import { forgetAll, rememberedIn, restoreRemembered } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import type { Profile } from '../src/validation/profiles';

const WOVEN: Profile = { fabric: 'woven', thread: '40' };
const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);
const same = (a: { x: Int32Array; y: Int32Array; cmd: Uint8Array }, b: typeof a) =>
  a.cmd.length === b.cmd.length && a.x.every((v, i) => v === b.x[i]) && a.y.every((v, i) => v === b.y[i]) && a.cmd.every((v, i) => v === b.cmd[i]);

describe('correction engine', () => {
  it('fixes density on stacked fills without a new critical cell, and takes it back bit for bit', async () => {
    forgetAll();
    const p = load('demos/overlap.pes');
    const memBefore = JSON.stringify(rememberedIn(p, sewObjects(p)));
    const f = await prepareFix(p, WOVEN, 'density', { trimMm: 2 });
    // Planning changes nothing.
    expect(JSON.stringify(rememberedIn(p, sewObjects(p)))).toBe(memBefore);
    expect(f.after).toBeLessThan(f.before);
    expect(f.diff?.newCritical).toBe(0);
    const q = applyFix(p, f)!;
    expect(q).toBeTruthy();
    expect(fixedObjects(q).length).toBe(f.objects.length);
    // Stored with the project and read back: still taken back exactly.
    const stored = rememberedIn(q, sewObjects(q));
    forgetAll();
    restoreRemembered(structuredClone(stored));
    const back = revertFix(q, fixedObjects(q))!;
    expect(back).toBeTruthy();
    expect(same(back, p)).toBe(true);
    expect(fixedObjects(back)).toEqual([]);
  }, 120_000);

  it('applies a fix only to the design it was worked out on', async () => {
    forgetAll();
    const p = load('demos/overlap.pes');
    const f = await prepareFix(p, WOVEN, 'density', { trimMm: 2 });
    const other = { ...p, x: p.x.map((v) => v + 10) };
    expect(designKey(other)).not.toBe(f.base);
    expect(applyFix(other, f)).toBeNull();
  }, 120_000);

  it('reports the Ampel with a direct fix per kind', async () => {
    forgetAll();
    const p = load('demos/overlap.pes');
    const r = await assess(p, WOVEN, { trimMm: 2 });
    expect(r.color).toBe('red');
    const d = r.kinds.find((k) => k.kind === 'density')!;
    expect(d.areaMm2).toBeGreaterThan(0);
    expect(d.direct?.diff?.newCritical).toBe(0);
  }, 300_000);
});
