import { describe, expect, it } from 'vitest';
import { redworkGraph, redworkRuns, redworkWalks, type RedworkLine } from '../src/digitize/redwork';
import { lineStitches, redworkHelps } from '../src/model/line';
import { isLineStitch } from '../src/model/restitch';
import { parsePath } from '../src/shape/svgPath';
import { addLine } from '../src/model/addShape';
import { sewObjects } from '../src/model/objects';
import { JUMP, patternStats, TRIM, type Pattern } from '../src/model/pattern';
import { digitizeDefaults } from '../src/digitize/digitize';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { validatePattern } from '../src/validation/validate';
import type { Pt } from '../src/digitize/skeleton';
import type { Mat } from '../src/shape/path';

const ID: Mat = [1, 0, 0, 1, 0, 0];
const open = (...pts: Pt[]): RedworkLine => ({ pts, closed: false });
const ring = (cx: number, cy: number, r: number, n = 24): RedworkLine => ({ pts: Array.from({ length: n }, (_, k): Pt => [cx + r * Math.cos((2 * Math.PI * k) / n), cy + r * Math.sin((2 * Math.PI * k) / n)]), closed: true });
const same = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
/** The walk as straight pieces between its points, each keyed without direction, counted per direction. */
function passes(run: Pt[]): Map<string, { there: number; back: number }> {
  const k = (q: Pt) => `${q[0].toFixed(3)},${q[1].toFixed(3)}`;
  const m = new Map<string, { there: number; back: number }>();
  for (let i = 1; i < run.length; i++) {
    const a = k(run[i - 1]);
    const b = k(run[i]);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const c = m.get(key) ?? { there: 0, back: 0 };
    if (a < b) c.there++;
    else c.back++;
    m.set(key, c);
  }
  return m;
}
const asIs = (pts: Pt[]) => pts;

/** A flower: a middle and five petals touching it, as one form of six paths. */
function flower(): string {
  const petals = Array.from({ length: 5 }, (_, k) => {
    const a = (2 * Math.PI * k) / 5;
    const [x, y] = [10 + 6 * Math.cos(a), 10 + 6 * Math.sin(a)];
    return `M${10 + 3 * Math.cos(a)} ${10 + 3 * Math.sin(a)} C${x - 3} ${y - 3} ${x + 3} ${y - 3} ${x + 3 * Math.cos(a)} ${y + 3 * Math.sin(a)} C${x + 3} ${y + 3} ${x - 3} ${y + 3} ${10 + 3 * Math.cos(a)} ${10 + 3 * Math.sin(a)} Z`;
  });
  return `M13 10 A3 3 0 1 1 7 10 A3 3 0 1 1 13 10 Z ${petals.join(' ')}`;
}

describe('redwork', () => {
  it('splits crossing lines into a planar graph', () => {
    const g = redworkGraph([open([0, 0], [10, 10]), open([0, 10], [10, 0])]);
    // An X: one node in the middle, four ends, four edges.
    expect(g.edges.length).toBe(4);
    expect(g.nodes.some((q) => same(q, [5, 5]))).toBe(true);
  });

  it('sews every piece of a drawing exactly once each way, in one run that ends where it began', () => {
    // A hash sign, a ring through it and a loose stroke touching the ring.
    const lines = [open([0, 3], [12, 3]), open([0, 9], [12, 9]), open([3, 0], [3, 12]), open([9, 0], [9, 12]), ring(6, 6, 4), open([10, 6], [16, 6])];
    const runs = redworkRuns(lines, asIs);
    expect(runs.length).toBe(1);
    const run = runs[0];
    expect(same(run[0], run[run.length - 1])).toBe(true);
    for (const c of passes(run).values()) expect(c).toEqual({ there: 1, back: 1 });
  });

  it('lays the first pass of a branch below: it comes back over it only after everything beyond', () => {
    // A path of three edges in a row: all the way out, then all the way back.
    const g = redworkGraph([open([0, 0], [5, 0]), open([5, 0], [10, 0]), open([10, 0], [15, 0])]);
    const [walk] = redworkWalks(g, [0, 0]);
    const n = walk.length / 2;
    const out = walk.slice(0, n).map((w) => w.edge);
    const back = walk.slice(n).map((w) => w.edge);
    expect(back).toEqual(out.slice().reverse());
    expect(walk.slice(0, n).every((w, k) => k === 0 || w.back === walk[0].back)).toBe(true);
  });

  it('bridges gaps up to about half a millimetre, not wider ones', () => {
    const t = (gap: number) => redworkRuns([open([0, 0], [10, 0]), open([5, gap], [5, 8])], asIs).length;
    expect(t(0)).toBe(1);
    expect(t(0.3)).toBe(1);
    expect(t(0.45)).toBe(1);
    expect(t(1)).toBe(2);
    expect(t(3)).toBe(2);
  });

  it('bridges a closed line that just misses another, once', () => {
    // A ring 0.3 mm beside a stroke: no free end, yet as good as touching.
    const runs = redworkRuns([open([0, 0], [20, 0]), ring(10, 4.3, 4)], asIs);
    expect(runs.length).toBe(1);
    // Shorter than a stitch, the gap is closed by making its two ends one node.
    for (const c of passes(runs[0]).values()) expect(c).toEqual({ there: 1, back: 1 });
  });

  it('does not bridge an end back onto its own curve', () => {
    // A tight curve: its points lie close to its end, but it is one line.
    const curve = open(...Array.from({ length: 20 }, (_, k): Pt => [k * 0.2, Math.sin(k / 3) * 0.2]));
    const g = redworkGraph([curve]);
    expect(g.edges.length).toBe(1);
  });

  it('sews parts that do not touch one after the other, the nearest next', () => {
    const runs = redworkRuns([open([40, 0], [50, 0]), open([0, 0], [10, 0]), open([20, 0], [30, 0])], asIs, [0, 0]);
    expect(runs.length).toBe(3);
    expect(runs.map((r) => Math.round(r[0][0] / 10))).toEqual([0, 2, 4]);
  });

  it('sews a line of touching paths in one go, path by path without it', () => {
    const form = parsePath(flower(), ID);
    expect(form.paths.length).toBe(6);
    expect(redworkHelps(form)).toBe(true);
    const plain = lineStitches(form, { type: 'run', width: 0.4, length: 2.5 });
    const red = lineStitches(form, { type: 'run', width: 0.4, length: 2.5, redwork: true });
    expect(plain.length).toBe(6);
    expect(red.length).toBe(1);
    // Twice as much thread, the same needle points each way.
    const len = (runs: Pt[][]) => runs.reduce((s, r) => s + r.slice(1).reduce((t, q, i) => t + Math.hypot(q[0] - r[i][0], q[1] - r[i][1]), 0), 0);
    expect(len(red) / len(plain)).toBeGreaterThan(1.9);
    expect(len(red) / len(plain)).toBeLessThan(2.1);
    for (const c of passes(red[0]).values()) expect(c.there + c.back).toBe(2);
    // Sewn the other way round: the same stitches backwards.
    const rev = lineStitches(form, { type: 'run', width: 0.4, length: 2.5, redwork: true }, true);
    expect(rev[0].slice().reverse()).toEqual(red[0]);
    // Only running stitch once: a triple stitch or satin stays path by path.
    expect(lineStitches(form, { type: 'triple', width: 0.4, redwork: true }).length).toBe(6);
  });

  it('helps only where paths touch', () => {
    expect(redworkHelps(parsePath('M0 0 L10 0 M20 0 L30 0', ID))).toBe(false);
    expect(redworkHelps(parsePath('M0 0 L10 0', ID))).toBe(false);
    expect(redworkHelps(parsePath('M0 0 L10 0 M5 -5 L5 5', ID))).toBe(true);
  });

  it('is kept as a setting of a line', () => {
    expect(isLineStitch({ type: 'run', width: 0.4, redwork: true })).toBe(true);
    expect(isLineStitch({ type: 'run', width: 0.4, redwork: 'yes' })).toBe(false);
  });

  it('stays quick on a drawing of many lines', () => {
    const lines: RedworkLine[] = [];
    for (let k = 0; k < 40; k++) lines.push(open(...Array.from({ length: 60 }, (_, i): Pt => [i, 30 + 25 * Math.sin(i / 7 + k)])));
    for (let k = 0; k < 40; k++) lines.push(open([k * 1.5, 0], [k * 1.5, 60]));
    const t0 = performance.now();
    const runs = redworkRuns(lines, asIs);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(runs.length).toBe(1);
  });

  it('is one object without jumps, its double line not too dense for the checks', () => {
    const empty = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as unknown as Pattern;
    const options = digitizeDefaults(DEFAULT_PROFILE);
    const red = { r: 200, g: 30, b: 30 };
    const form = parsePath(flower(), ID);
    const plain = addLine(empty, form, { type: 'run', width: 0.4, length: 2.5 }, red, null, options)!.pattern;
    const work = addLine(empty, form, { type: 'run', width: 0.4, length: 2.5, redwork: true }, red, null, options)!.pattern;
    expect(sewObjects(work)).toHaveLength(1);
    const count = (p: Pattern, c: number) => p.cmd.reduce((n, x) => n + (x === c ? 1 : 0), 0);
    // One jump to the start and one trim at the end; path by path it jumps from path to path.
    expect(count(work, JUMP)).toBeLessThan(count(plain, JUMP));
    expect(count(work, TRIM)).toBe(1);
    // About twice the thread (path by path has a lock stitch at each end of each path on top).
    expect(patternStats(work).threadLength).toBeGreaterThan(patternStats(plain).threadLength * 1.6);
    // Twice along a line is what a line sewn there and back is: no dense zone.
    expect(validatePattern(work, DEFAULT_PROFILE).criticalCells).toBe(0);
  });
});
