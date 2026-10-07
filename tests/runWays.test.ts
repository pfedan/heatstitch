import { describe, expect, it } from 'vitest';
import { JUMP, STITCH, type Pattern } from '../src/model/pattern';
import { sewObjects } from '../src/model/objects';
import { measureRun, restitch, analyze } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { lineOf, lineSettings, lineStitches } from '../src/model/line';
import { writePes } from '../src/writers/pes';
import { Writer, type Pt } from './helpers/designs';

/** A line of running stitches sewn the way hobby designs sew their details, read back from a file. */
function read(sew: (w: Writer) => void): Pattern {
  const w = new Writer();
  sew(w);
  return parsePattern(writePes(w.b.build('linie', 'pes', [{ r: 70, g: 100, b: 180 }])), 'linie.pes');
}

const curve = (n: number): Pt[] => Array.from({ length: n }, (_, k) => [10 + k * 2.4, 10 + 6 * Math.sin(k / 3)]);

/** The run object sewn anew as measured: the thread pieces (mm) of its new stitches. */
function anew(p: Pattern): [Pt, Pt][] {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const o = objs.find((x) => x.kind === 'run')!;
  const r = restitch(p, objs, [o.index], (_, an) => ({ kind: 'run', s: measureRun(p, an.parts.find((pt) => pt.kind === 'run')!) }), kinds, 3);
  expect(r.failed).toEqual([]);
  const q = r.pattern;
  const out: [Pt, Pt][] = [];
  let n = 0;
  for (let i = 0; i < q.cmd.length; i++) {
    if (q.cmd[i] !== STITCH) continue;
    if (n > r.starts[0] && n < r.ends[0] && q.cmd[i - 1] === STITCH) out.push([[q.x[i - 1] / 10, q.y[i - 1] / 10], [q.x[i] / 10, q.y[i] / 10]]);
    n++;
  }
  return out;
}

const thread = (segs: [Pt, Pt][]) => segs.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);

describe('a line sewn anew', () => {
  it('keeps a line sewn there and back', () => {
    const c = curve(16);
    const p = read((w) => {
      w.start(c[0]);
      for (const q of c.slice(1)) w.to(q);
      for (const q of c.slice(0, -1).reverse()) w.to(q);
    });
    const segs = anew(p);
    // Out to the tip and back again: as much thread as before, and the tip is reached.
    const tip = c[c.length - 1];
    expect(thread(segs)).toBeGreaterThan(2 * 15 * 2.4 * 0.9);
    expect(Math.min(...segs.flat().map((q) => Math.hypot(q[0] - tip[0], q[1] - tip[1])))).toBeLessThan(0.2);
  });

  it('sews a triple stitch along its line once, tripled', () => {
    const c = curve(10);
    const p = read((w) => {
      w.start(c[0]);
      for (let k = 1; k < c.length; k++) [c[k], c[k - 1], c[k]].forEach((q) => w.to(q));
    });
    const kinds = stitchKinds(p);
    const o = sewObjects(p, kinds).find((x) => x.kind === 'run')!;
    expect(measureRun(p, analyze(p, o, kinds).parts[0]).triple).toBe(true);
    const segs = anew(p);
    // Three times the line, not more.
    const once = c.slice(1).reduce((s, q, k) => s + Math.hypot(q[0] - c[k][0], q[1] - c[k][1]), 0);
    expect(thread(segs)).toBeGreaterThan(once * 2.7);
    expect(thread(segs)).toBeLessThan(once * 3.3);
  });

  it('does not sew over where the line jumped', () => {
    const p = read((w) => {
      w.start([10, 10]);
      for (let x = 12.5; x <= 30; x += 2.5) w.to([x, 10]);
      w.to([30, 20], JUMP);
      for (let x = 30; x >= 10; x -= 2.5) w.to([x, 20]);
    });
    // No stitch crosses from one stroke to the other.
    for (const [a, b] of anew(p)) expect(Math.abs(a[1] - b[1])).toBeLessThan(1);
  });

  it('keeps a line sewn there and back as its curve, when sewn anew along it', () => {
    // A stem with a branch sewn out and back, as feathers are drawn: the curve keeps the branch.
    const c = curve(16);
    const branch: Pt[] = Array.from({ length: 6 }, (_, k) => [c[8][0] + k * 0.3, c[8][1] + k * 2]);
    const p = read((w) => {
      w.start(c[0]);
      for (const q of c.slice(1, 9)) w.to(q);
      for (const q of branch.slice(1)) w.to(q);
      for (const q of branch.slice(0, -1).reverse()) w.to(q);
      for (const q of c.slice(9)) w.to(q);
    });
    const kinds = stitchKinds(p);
    const o = sewObjects(p, kinds).find((x) => x.kind === 'run')!;
    const st = lineSettings(p, o, kinds);
    expect(st.type).toBe('run');
    const runs = lineStitches(lineOf(p, o, kinds)!, { ...st, length: 3 });
    const tip = branch[branch.length - 1];
    const pts = runs.flat();
    expect(Math.min(...pts.map((q) => Math.hypot(q[0] - tip[0], q[1] - tip[1])))).toBeLessThan(0.3);
    const end = c[c.length - 1];
    expect(Math.min(...pts.map((q) => Math.hypot(q[0] - end[0], q[1] - end[1])))).toBeLessThan(0.3);
  });
});
