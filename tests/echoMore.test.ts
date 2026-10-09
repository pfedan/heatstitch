import { describe, expect, it } from 'vitest';
import { echoLines } from '../src/digitize/echo';
import { motifStitches } from '../src/digitize/motif';
import type { Pt } from '../src/digitize/skeleton';
import { passesOf, sewAlong, timesOf, type PathStitch } from '../src/model/along';
import { echoCopyLines, lineStitches, nearestCopy } from '../src/model/line';
import { rememberedIn, restoreRemembered, remembered } from '../src/model/restitch';
import { sewObjects } from '../src/model/objects';
import { shadowFrom, shadowOffset } from '../src/model/shadow';
import { addShape } from '../src/model/addShape';
import { digitizeDefaults } from '../src/digitize/digitize';
import { lineSettings, resewLine } from '../src/model/line';
import { parsePath } from '../src/shape/svgPath';
import type { Form, Mat } from '../src/shape/path';
import { DEFAULT_PROFILE } from '../src/validation/profiles';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const red = { r: 200, g: 30, b: 30 };
const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;
const straight: Pt[] = [
  [0, 0],
  [40, 0],
];
const lineForm = (pts: Pt[]): Form => ({ paths: [{ closed: false, nodes: pts.map((p) => ({ p, a: p, b: p, smooth: false })) }] });

describe('echo copies, nearer and further', () => {
  it('lies on the line at no distance, and overlaps below the stitch width', () => {
    const lines = echoLines(straight, false, { side: 'out', count: 2, gap: 0 });
    expect(lines).toHaveLength(3);
    for (const l of lines) for (const q of l.line) expect(Math.abs(q[1])).toBeLessThan(1e-9);
    // A satin 3 mm wide, copies 1 mm apart: they stay 1 mm apart, overlapping.
    const near = echoLines(straight, false, { side: 'out', count: 1, gap: 1 });
    expect(Math.abs(near[1].line[5][1])).toBeCloseTo(1, 1);
  });

  it('is sewn from the outside in when reversed', () => {
    const out = echoLines(straight, false, { side: 'out', count: 3, gap: 2 });
    const back = echoLines(straight, false, { side: 'out', count: 3, gap: 2, reverse: true });
    expect(out.map((l) => l.k)).toEqual([0, 1, 2, 3]);
    expect(back.map((l) => l.k)).toEqual([3, 2, 1, 0]);
    // On a closed line inside copies: the line (outermost) last.
    const square: Pt[] = [
      [0, 0],
      [30, 0],
      [30, 30],
      [0, 30],
      [0, 0],
    ];
    const inward = echoLines(square, true, { side: 'in', count: 2, gap: 3, reverse: true });
    expect(inward[inward.length - 1].k).toBe(0);
  });

  it('keeps each copy on its line when told apart (hover highlight)', () => {
    const st: PathStitch = { type: 'run', width: 0.4, echo: { side: 'both', count: 2, gap: 3 } };
    const form = lineForm(straight);
    const lines = echoCopyLines(form, st);
    const pts = lineStitches(form, st).flat();
    const k = nearestCopy(lines, pts);
    let on = 0;
    pts.forEach((q, i) => {
      const level = Math.abs(q[1]) / 3;
      if (Math.abs(level - Math.round(level)) > 0.05) return; // a connecting stitch
      on++;
      expect(Math.abs(k[i])).toBe(Math.round(level));
    });
    expect(on).toBeGreaterThan(pts.length / 2);
  });
});

describe('echo phase', () => {
  it('shifts a motif by a share of its period', () => {
    const a = motifStitches(straight, false, 'waves', 3, 5, 1, 0);
    const b = motifStitches(straight, false, 'waves', 3, 5, 1, 0.25);
    // A quarter period on: where a crosses the line going up, b is at its top.
    const at = (pts: Pt[], x: number) => pts.reduce((best, q) => (Math.abs(q[0] - x) < Math.abs(best[0] - x) ? q : best))[1];
    expect(Math.abs(at(a, 10))).toBeLessThan(0.5);
    expect(Math.abs(at(b, 10))).toBeGreaterThan(1);
  });

  it('adds up from copy to copy and leaves the line itself in place', () => {
    const st: PathStitch = { type: 'motif', motif: 'waves', width: 3, echo: { side: 'out', count: 2, gap: 6, cut: true } };
    const plain = lineStitches(lineForm(straight), st);
    const shifted = lineStitches(lineForm(straight), { ...st, echo: { ...st.echo!, phase: 90 } });
    expect(shifted[0]).toEqual(plain[0]);
    expect(shifted[1]).not.toEqual(plain[1]);
    expect(shifted[2]).not.toEqual(plain[2]);
    // Copy 2 is shifted twice as far: half a period, the wave upside down.
    const y = (run: Pt[], x: number, off: number) => run.reduce((best, q) => (Math.abs(q[0] - x) < Math.abs(best[0] - x) ? q : best))[1] - off;
    const top = plain[0].reduce((best, q) => (q[1] > best[1] ? q : best));
    expect(Math.sign(y(shifted[2], top[0], -12))).toBe(-Math.sign(y(plain[2], top[0], -12)));
  });
});

describe('a line sewn more than once', () => {
  it('goes there and back over its own needle points', () => {
    const st: PathStitch = { type: 'run', width: 0.4, length: 2.5, repeat: 2 };
    expect(passesOf(st)).toBe(2);
    const [run] = sewAlong(straight, false, st);
    const once = sewAlong(straight, false, { ...st, repeat: 1 })[0];
    expect(run.length).toBe(once.length * 2 - 1);
    expect(run[run.length - 1]).toEqual(once[0]);
    expect(run.slice(once.length - 1)).toEqual(once.slice().reverse());
  });

  it('is bean stitch at an odd number of a motif unless the whole line is asked for', () => {
    expect(timesOf({ type: 'motif', width: 3, repeat: 3 })).toBe(3);
    expect(passesOf({ type: 'motif', width: 3, repeat: 3 })).toBe(1);
    expect(timesOf({ type: 'motif', width: 3, repeat: 3, whole: true })).toBe(1);
    expect(passesOf({ type: 'motif', width: 3, repeat: 3, whole: true })).toBe(3);
    expect(passesOf({ type: 'motif', width: 3, repeat: 4 })).toBe(4);
    expect(passesOf({ type: 'triple', width: 0.4, repeat: 5 })).toBe(1);
  });

  it('sews a satin again without its underlay, ending where it began at an even number', () => {
    const st: PathStitch = { type: 'satin', width: 3, under: 'center', repeat: 2 };
    const once = sewAlong(straight, false, { ...st, repeat: 1 })[0];
    const twice = sewAlong(straight, false, st)[0];
    expect(twice.length).toBeGreaterThan(once.length);
    expect(Math.hypot(twice[twice.length - 1][0], twice[twice.length - 1][1])).toBeLessThan(3);
  });

  it('comes back from a project with its echo phase, order and passes', () => {
    const a = addShape(empty, { form: parsePath('M0 0 L40 0', ID), kind: 'stroke', width: 0.4 }, red, null, options)!;
    const o = sewObjects(a.pattern)[0];
    const st: PathStitch = { ...lineSettings(a.pattern, o), type: 'motif', width: 3, repeat: 3, whole: true, echo: { side: 'out', count: 2, gap: 1, phase: -45, reverse: true } };
    const r = resewLine(a.pattern, 0, remembered(a.pattern, o)!.path!, st, options.trimMm)!;
    const stored = JSON.parse(JSON.stringify(rememberedIn(r.pattern)));
    restoreRemembered(r.pattern, stored);
    const back = lineSettings(r.pattern, sewObjects(r.pattern)[0]);
    expect(back).toMatchObject({ repeat: 3, whole: true, echo: { gap: 1, phase: -45, reverse: true } });
  });

  it('keeps an older file\'s satin copies their width apart, as it sewed them', () => {
    const a = addShape(empty, { form: parsePath('M0 0 L40 0', ID), kind: 'stroke', width: 3 }, red, null, options)!;
    const o = sewObjects(a.pattern)[0];
    const st: PathStitch = { ...lineSettings(a.pattern, o), type: 'satin', width: 3, echo: { side: 'out', count: 1, gap: 1 } };
    const r = resewLine(a.pattern, 0, remembered(a.pattern, o)!.path!, st, options.trimMm)!;
    const stored = JSON.parse(JSON.stringify(rememberedIn(r.pattern)));
    delete stored.objects[0].memory.line.echo.overlap;
    restoreRemembered(r.pattern, stored);
    expect(lineSettings(r.pattern, sewObjects(r.pattern)[0]).echo?.gap).toBe(3.5);
  });
});

describe('shadow by angle', () => {
  it('falls where its angle points, its distance along it', () => {
    const [dx, dy] = shadowOffset({ color: red, link: 's', angle: 90, dist: 2 });
    expect(dx).toBeCloseTo(0);
    expect(dy).toBeCloseTo(2);
  });

  it('reads a shadow from before angles at the same offset', () => {
    const s = shadowFrom({ color: red, link: 's', dir: 'nw', dist: 1 })!;
    expect(s.angle).toBe(225);
    const [dx, dy] = shadowOffset(s);
    expect(dx).toBeCloseTo(-1, 1);
    expect(dy).toBeCloseTo(-1, 1);
    expect(shadowFrom({ color: red, link: 's', angle: 400, dist: 1 })).toBeNull();
  });
});
