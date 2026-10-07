import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { echoLines } from '../src/digitize/echo';
import type { Pt } from '../src/digitize/skeleton';
import { addShape } from '../src/model/addShape';
import { lineSettings, resewLine } from '../src/model/line';
import { reverseLines } from '../src/model/reverse';
import { sewObjects } from '../src/model/objects';
import { STITCH, type Pattern } from '../src/model/pattern';
import { remembered, rememberedIn, restitch, restoreRemembered } from '../src/model/restitch';
import { takeOver } from '../src/model/knockout';
import { transformSewObject } from '../src/model/reshape';
import { stitchKinds } from '../src/model/sequence';
import { duplicateObject } from '../src/model/shapeOps';
import { flatten, type Mat } from '../src/shape/path';
import { ellipsePath, parsePath } from '../src/shape/svgPath';
import { DEFAULT_PROFILE } from '../src/validation/profiles';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const red = { r: 200, g: 30, b: 30 };
const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as never;

const points = (p: Pattern, first: number, last: number) => {
  const out: Pt[] = [];
  for (let i = first; i <= last; i++) if (p.cmd[i] === STITCH) out.push([p.x[i] / 10, p.y[i] / 10]);
  return out;
};

/** Distance of q to the polyline. */
function distTo(line: Pt[], q: Pt): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy));
  }
  return best;
}

/** A line with an echo, as drawn and set in the panel. */
function echoed(path: string, echo = { side: 'out' as const, count: 2, gap: 3 }) {
  const a = addShape(empty, { form: parsePath(path, ID), kind: 'stroke', width: 0.4 }, red, null, options)!;
  const o = sewObjects(a.pattern)[0];
  const st = { ...lineSettings(a.pattern, o), echo };
  return resewLine(a.pattern, 0, remembered(a.pattern, o)!.path!, st, options.trimMm)!;
}

describe('echo of a line', () => {
  it('lays copies of an open line at the set distance on one side, in one run', () => {
    const line: Pt[] = [];
    for (let x = 0; x <= 40; x += 0.5) line.push([x, 5 * Math.sin(x / 6)]);
    const lines = echoLines(line, false, { side: 'out', count: 3, gap: 2.5 });
    expect(lines).toHaveLength(4);
    expect(lines[0].line).toBe(line);
    lines.slice(1).forEach((l, k) => {
      for (const q of l.line) expect(Math.abs(distTo(line, q) - 2.5 * (k + 1))).toBeLessThan(0.12);
    });
    // Each starts near where the one before ended (no long way across).
    for (let k = 1; k < lines.length; k++) {
      const end = lines[k - 1].line[lines[k - 1].line.length - 1];
      const start = lines[k].line[0];
      expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeLessThan(3.5);
    }
    // Left of the drawing direction on screen (y down): above a line going right.
    const mid = lines[1].line[Math.floor(lines[1].line.length / 2)];
    expect(mid[1]).toBeLessThan(5 * Math.sin(mid[0] / 6));
  });

  it('puts copies on both sides, the line in the middle', () => {
    const line: Pt[] = [
      [0, 0],
      [30, 0],
    ];
    const lines = echoLines(line, false, { side: 'both', count: 2, gap: 2 });
    const ys = lines.map((l) => l.line[Math.floor(l.line.length / 2)][1]);
    [4, 2, 0, -2, -4].forEach((y, k) => expect(Math.abs(ys[k] - y)).toBeLessThan(0.12));
  });

  it('rings a closed line outside and inside', () => {
    const circle = flatten(parsePath(ellipsePath(0, 0, 10, 10), ID).paths[0]);
    const loop = [...circle, circle[0]];
    const out = echoLines(loop, true, { side: 'out', count: 2, gap: 3 });
    const radius = (l: Pt[]) => l.reduce((s, q) => s + Math.hypot(q[0], q[1]), 0) / l.length;
    expect(out.map((l) => Math.round(radius(l.line)))).toEqual([10, 13, 16]);
    expect(out.every((l) => l.closed)).toBe(true);
    const inner = echoLines(loop, true, { side: 'in', count: 2, gap: 3 });
    expect(inner.map((l) => Math.round(radius(l.line)))).toEqual([10, 7, 4]);
  });

  it('is sewn with the line and remembered with it, through save and load', () => {
    const r = echoed('M0 0 C10 -10 20 10 30 0');
    const [o] = sewObjects(r.pattern);
    expect(sewObjects(r.pattern)).toHaveLength(1);
    const pts = points(r.pattern, o.first, o.last);
    // Stitches on the copies, up to 6 mm from the line.
    const line = flatten(remembered(r.pattern, o)!.path!.paths[0]);
    const far = Math.max(...pts.map((q) => distTo(line, q)));
    expect(far).toBeGreaterThan(5.8);
    expect(far).toBeLessThan(6.3);
    const stored = JSON.parse(JSON.stringify(rememberedIn(r.pattern)));
    expect(stored.objects[0].memory.line.echo).toEqual({ side: 'out', count: 2, gap: 3 });
    restoreRemembered(r.pattern, stored);
    expect(lineSettings(r.pattern, o).echo).toEqual({ side: 'out', count: 2, gap: 3 });
    // A broken echo from a file is left out, the line stays.
    stored.objects[0].memory.line.echo = { side: 'up', count: 99, gap: -1 };
    restoreRemembered(r.pattern, stored);
    expect(remembered(r.pattern, o)?.line?.echo).toBeUndefined();
    expect(remembered(r.pattern, o)?.path).toBeDefined();
  });

  it('stays when the stitch changes, and when the line is copied or scaled', () => {
    const r = echoed('M0 0 L30 0');
    const kinds = stitchKinds(r.pattern);
    const objs = sewObjects(r.pattern, kinds);
    const t = takeOver(restitch(r.pattern, objs, [0], { kind: 'run', s: { stitch: 2, triple: true, tolerance: 0.1 } }, kinds, 7))!;
    expect(lineSettings(t, sewObjects(t)[0]).echo).toEqual({ side: 'out', count: 2, gap: 3 });
    const d = duplicateObject(t, 0, 7)!;
    const copy = sewObjects(d.pattern)[d.index];
    expect(lineSettings(d.pattern, copy).echo).toEqual({ side: 'out', count: 2, gap: 3 });
    const k2 = stitchKinds(t);
    const s = transformSewObject(t, sewObjects(t, k2), sewObjects(t, k2)[0], k2, [2, 0, 0, 2, 0, 0], 7)!;
    expect(lineSettings(s.pattern, sewObjects(s.pattern)[0]).echo?.gap).toBe(3);
  });

  it('stays on the side where it was seen when the line is mirrored', () => {
    const r = echoed('M0 0 L30 0');
    const kinds = stitchKinds(r.pattern);
    const objs = sewObjects(r.pattern, kinds);
    // Above the line (y < 0) before.
    expect(Math.min(...points(r.pattern, objs[0].first, objs[0].last).map((q) => q[1]))).toBeLessThan(-5.5);
    const m = transformSewObject(r.pattern, objs, objs[0], kinds, [1, 0, 0, -1, 0, 0], 7)!;
    const o = sewObjects(m.pattern)[0];
    expect(lineSettings(m.pattern, o).echo?.side).toBe('in');
    // Sewn anew from what it remembers: still below, where the mirror put it.
    const again = resewLine(m.pattern, 0, remembered(m.pattern, o)!.path!, lineSettings(m.pattern, o), 7)!;
    const ys = points(again.pattern, again.first, again.last).map((q) => q[1]);
    expect(Math.max(...ys)).toBeGreaterThan(5.5);
    expect(Math.min(...ys)).toBeGreaterThan(-0.2);
  });

  it('stays where it is when the line is sewn from its other end', () => {
    const r = echoed('M0 0 L30 0');
    const t = reverseLines(r.pattern, [0], 7);
    expect(t.failed).toEqual([]);
    const o = sewObjects(t.pattern)[0];
    expect(lineSettings(t.pattern, o).echo?.side).toBe('in');
    const ys = points(t.pattern, o.first, o.last).map((q) => q[1]);
    expect(Math.min(...ys)).toBeLessThan(-5.5);
    expect(Math.max(...ys)).toBeLessThan(0.2);
  });

  it('gives each copy of an E stitch its prongs on the same side as the line', () => {
    const a = addShape(empty, { form: parsePath('M0 0 L30 0', ID), kind: 'stroke', width: 0.4 }, red, null, options)!;
    const o = sewObjects(a.pattern)[0];
    const st = { ...lineSettings(a.pattern, o), type: 'e' as const, width: 2, echo: { side: 'out' as const, count: 2, gap: 4 } };
    const r = resewLine(a.pattern, 0, remembered(a.pattern, o)!.path!, st, options.trimMm)!;
    const ys = points(r.pattern, r.first, r.last).map((q) => q[1]);
    // The line at 0, its copies at -4 and -8, all prongs pointing the same way (down).
    for (const y of ys) expect([0, -4, -8].some((l) => y > l - 0.2 && y < l + 2.2)).toBe(true);
    expect(Math.min(...ys)).toBeGreaterThan(-8.2);
  });

  it('keeps satin copies apart by their width', () => {
    const line: Pt[] = [
      [0, 0],
      [30, 0],
    ];
    const lines = echoLines(line, false, { side: 'out', count: 1, gap: 1 }, 3.5);
    expect(Math.abs(lines[1].line[0][1])).toBeCloseTo(3.5, 0);
  });
});
