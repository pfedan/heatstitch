import { describe, expect, it } from 'vitest';
import { keepVersion, relearn, remember, remembered, rememberedIn } from '../src/model/restitch';
import { hold, rememberObjects, sewObjects } from '../src/model/objects';
import { borderedSquare } from './helpers/torture';

/**
 * A version the app holds (current, undo, redo: kept with keepVersion) is settled: what its objects
 * know does not change any more, so undo brings back exactly what was. A change of knowledge alone
 * is a new version (relearn).
 */
describe('settled versions', () => {
  it('refuse to learn anything after they were kept', () => {
    const d = borderedSquare();
    const p = d.cur.p;
    keepVersion(p);
    const o = sewObjects(p)[0];
    const m = remembered(p, o)!;
    expect(() => remember(p, o, { ...m, lock: true })).toThrow(/relearn/);
    expect(() => rememberObjects(p, [0, 5])).toThrow(/relearn/);
    // Told again what it knows: no change, no complaint.
    expect(() => remember(p, o, m)).not.toThrow();
  });

  it('learn on a new version with the same stitches, and stay as they were', () => {
    const d = borderedSquare();
    const p = d.cur.p;
    keepVersion(p);
    const before = JSON.stringify(rememberedIn(p));
    const o = sewObjects(p)[0];
    const q = relearn(p, (v) => remember(v, o, { ...remembered(p, o)!, lock: true }));
    expect(q).not.toBe(p);
    expect(q.x).toBe(p.x);
    expect(remembered(q, sewObjects(q)[0])?.lock).toBe(true);
    expect(sewObjects(q).map((x) => x.id)).toEqual(sewObjects(p).map((x) => x.id));
    expect(JSON.stringify(rememberedIn(p))).toBe(before);
  });

  it('may be tried out with other knowledge inside hold, which puts it back', () => {
    const d = borderedSquare();
    const p = d.cur.p;
    keepVersion(p);
    const before = JSON.stringify(rememberedIn(p));
    const o = sewObjects(p)[0];
    const release = hold();
    remember(p, o, { ...remembered(p, o)!, lock: true });
    release();
    expect(JSON.stringify(rememberedIn(p))).toBe(before);
  });
});
