import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { insertStitch, moveRecords, nearestSegment, removeStitches } from '../src/model/edit';
import { keepObjects, objectView } from '../src/model/handEdit';
import { STITCH, type Pattern } from '../src/model/pattern';
import { analyze, remembered, restitch, shapeTrust } from '../src/model/restitch';
import { parsePattern } from '../src/parsers';
import { Shape } from './helpers/shapes';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);

/** A penetration in the middle of object `o` (with a stitch after it). */
const middle = (p: Pattern, v: ReturnType<typeof objectView>, o: number) => {
  const { first, last } = v.objects[o];
  let i = (first + last) >> 1;
  while (p.cmd[i] !== STITCH || p.cmd[i + 1] !== STITCH || p.cmd[i - 1] !== STITCH) i++;
  return i;
};

describe('points edited by hand', () => {
  it('inserts a penetration on the nearest stitch', () => {
    const p = new Shape().to(0, 0).to(10, 0).build();
    const hit = nearestSegment(p, 40, 3, 10);
    expect(hit).toMatchObject({ at: 1, x: 40, y: 0 });
    const q = insertStitch(p, hit!.at, hit!.x, hit!.y);
    expect(Array.from(q.x)).toEqual([0, 40, 100]);
    expect(q.cmd.filter((c) => c === STITCH)).toHaveLength(3);
  });

  it('keeps the object, its grouping and its shape when a point is moved', () => {
    const p = load('demos/letters.pes');
    const v = objectView(p);
    const fill = v.objects.findIndex((o) => o.kind === 'fill' && o.sections > 1);
    expect(fill).toBeGreaterThanOrEqual(0);
    const before = analyze(p, v.objects[fill], v.kinds).fill!;
    const i = middle(p, v, fill);
    const next = moveRecords(p, [i], 15, -10);
    const moved = keepObjects(p, next, { moved: [i] });
    const nv = objectView(next);
    expect(nv.objects).toHaveLength(v.objects.length);
    const o = moved.get(fill)!;
    expect(o).toBe(fill);
    expect(nv.objects[o].sections).toBe(v.objects[fill].sections);
    const r = remembered(next, nv.objects[o])!;
    expect(r.hand).toBe(1);
    // The area is the one read before the change, not one read from the moved point.
    expect(r.region).toStrictEqual(before);
    expect(shapeTrust(next, nv.objects[o], analyze(next, nv.objects[o], nv.kinds), 0.4)).not.toBe('kept');
  });

  it('counts changes on, and follows the object through deletes and inserts', () => {
    const p = load('demos/letters.pes');
    const v = objectView(p);
    const k = v.objects.length - 1;
    const i = middle(p, v, k);
    const mask = new Uint8Array(p.cmd.length);
    mask[i] = mask[i + 1] = 1;
    const a = removeStitches(p, mask);
    expect(keepObjects(p, a, { removed: [i, i + 1] }).get(k)).toBe(k);
    const av = objectView(a);
    expect(remembered(a, av.objects[k])?.hand).toBe(2);
    const j = middle(a, av, k);
    const b = insertStitch(a, j, a.x[j] + 3, a.y[j]);
    expect(keepObjects(a, b, { inserted: j }).get(k)).toBe(k);
    const bv = objectView(b);
    expect(bv.objects[k].stitches).toBe(v.objects[k].stitches - 1);
    expect(remembered(b, bv.objects[k])?.hand).toBe(3);
  });

  it('new stitch settings replace the changes by hand', () => {
    const p = load('demos/letters.pes');
    const v = objectView(p);
    const fill = v.objects.findIndex((o) => o.kind === 'fill');
    const i = middle(p, v, fill);
    const next = moveRecords(p, [i], 10, 0);
    keepObjects(p, next, { moved: [i] });
    const nv = objectView(next);
    const r = restitch(next, nv.objects, [fill], { kind: 'fill', s: { ...remembered(next, nv.objects[fill])!, ...defaults } } as never, nv.kinds, 3);
    expect(r.memory[0].hand).toBeUndefined();
    expect(r.memory[0].region).toBe(remembered(next, nv.objects[fill])!.region);
  });
});

const defaults = { pattern: 'tatami', spacing: 0.45, spacingEnd: 0.45, offset: 0.25, angle: 45, stitch: 3.5, edge: 0, underlay: true, tolerance: 0.15 };
