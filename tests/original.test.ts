import { describe, expect, it } from 'vitest';
import { STITCH, type Pattern } from '../src/model/pattern';
import { rememberObjects, sewObjects } from '../src/model/objects';
import { measureRun, remember, remembered, restitch, type RestitchResult } from '../src/model/restitch';
import { backToOriginal, originalOf } from '../src/model/original';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { writePes } from '../src/writers/pes';
import { Writer } from './helpers/designs';

/** Two lines of running stitches in one thread, read back from a file. */
function read(): Pattern {
  const w = new Writer();
  w.start([10, 10]);
  for (let x = 12; x <= 40; x += 2) w.to([x, 10 + (x % 4)]);
  w.start([10, 30]);
  for (let x = 12; x <= 40; x += 2) w.to([x, 30 - (x % 4)]);
  return parsePattern(writePes(w.b.build('linien', 'pes', [{ r: 70, g: 100, b: 180 }])), 'linien.pes');
}

const stitchesOf = (p: Pattern, first: number, last: number) => {
  const out: string[] = [];
  for (let i = first; i <= last; i++) if (p.cmd[i] === STITCH) out.push(`${p.x[i]},${p.y[i]}`);
  return out;
};

/** The changed objects of `r` kept as one each, with what they remember, as the app does (applyRestitched). */
function applied(r: RestitchResult): Pattern {
  const p = r.pattern;
  r.starts.forEach((a, k) => rememberObjects(p, [a], r.ends[k]));
  const objs = sewObjects(p);
  r.starts.forEach((a, k) => {
    let n = 0;
    const o = objs.find((x) => {
      let m = 0;
      for (let i = 0; i < x.first; i++) if (p.cmd[i] === STITCH) m++;
      n = m;
      return m === a;
    });
    expect(o, `object at stitch ${a} (last tried ${n})`).toBeTruthy();
    remember(p, o!, r.memory[k]);
  });
  return p;
}

/** Object `k` of `p` sewn anew with longer stitches, as the panel does. */
function longer(p: Pattern, k: number): Pattern {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  return applied(restitch(p, objs, [k], (_, an) => ({ kind: 'run', s: { ...measureRun(p, an.parts[0]), stitch: 5 } }), kinds, 3));
}

describe('back to the original stitches', () => {
  it('brings back the stitches the file had, for that object only', () => {
    const orig = read();
    const objs = sewObjects(orig);
    expect(objs.length).toBe(2);
    expect(originalOf(orig, orig, objs[1], objs)).toBeNull();
    const edited = longer(orig, 1);
    const eobjs = sewObjects(edited);
    const o = eobjs.find((x) => x.id === objs[1].id)!;
    expect(stitchesOf(edited, o.first, o.last)).not.toEqual(stitchesOf(orig, objs[1].first, objs[1].last));
    // The first line was not changed: nothing to go back to.
    expect(originalOf(edited, orig, eobjs.find((x) => x.id === objs[0].id)!, eobjs)).toBeNull();
    expect(originalOf(edited, orig, o, eobjs)).not.toBeNull();

    const r = backToOriginal(edited, orig, [o.index], 3)!;
    expect(r).not.toBeNull();
    const again = sewObjects(applied(r));
    expect(again.length).toBe(2);
    const b = again.find((x) => x.id === o.id)!;
    expect(b).toBeTruthy();
    expect(stitchesOf(r.pattern, b.first, b.last)).toEqual(stitchesOf(orig, objs[1].first, objs[1].last));
    expect(remembered(r.pattern, b)?.read).toBe(true);
    // The other line is as it was.
    const a = again.find((x) => x.id === objs[0].id)!;
    expect(stitchesOf(r.pattern, a.first, a.last)).toEqual(stitchesOf(orig, objs[0].first, objs[0].last));
    // Back where it was: no way back any more.
    expect(originalOf(r.pattern, orig, b, again)).toBeNull();
  });

  it('offers no way back for an object cut into parts', () => {
    const orig = read();
    const edited = longer(orig, 1);
    const eobjs = sewObjects(edited);
    const o = eobjs[1];
    remember(edited, o, { ...remembered(edited, o)!, piece: 'p1' });
    expect(originalOf(edited, orig, o, sewObjects(edited))).toBeNull();
  });
});
