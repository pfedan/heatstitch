import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rememberObjects, sewObjects, type SewObject } from '../src/model/objects';
import { STITCH, type Pattern } from '../src/model/pattern';
import { analyze, measureFill, remember, remembered, restitch, underlayRanges, withLine, type BorderSettings, type FillSettings } from '../src/model/restitch';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { sample } from '../src/digitize/region';
import { syncBorders, takeThreads } from '../src/model/border';
import { blendObject } from '../src/model/blend';
import { reorder } from '../src/model/order';
import { borderLines, borderStitches, sewAlong } from '../src/model/along';
import { regionOf } from '../src/shape/rasterize';
import type { Pt } from '../src/digitize/skeleton';
import { patch } from './helpers/demoProject';

const load = (f: string) => parsePattern(readFileSync(new URL(`../public/examples/${f}`, import.meta.url)), f);

/** The pattern after a restitch, with its objects remembered as the app does. */
/** Fill settings and the border beside them (none when not set). */
type Bordered = FillSettings & { border?: BorderSettings };

function apply(p: Pattern, which: number, settings: Bordered) {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const { border, ...s } = settings;
  const r = restitch(p, objs, [which], { kind: 'fill', s, line: border ?? null }, kinds, 7);
  expect(r.failed).toEqual([]);
  rememberObjects(r.pattern, [r.starts[0]], r.ends[0]);
  const q = r.pattern;
  const qk = stitchKinds(q);
  const now = sewObjects(q, qk);
  let n = 0;
  let o = -1;
  for (let i = 0; i < q.cmd.length && o < 0; i++) if (q.cmd[i] === STITCH && ++n === r.starts[0] + 1) o = now.findIndex((x) => x.first <= i && x.last >= i);
  remember(q, now[o], r.memory[0]);
  return { q, kinds: qk, objs: now, o: now[o], memory: r.memory[0] };
}

/** The pattern after a restitch with its borders made (as the app does), with the fill and its border object. */
function applyAll(p: Pattern, which: number, s: Bordered) {
  const a = apply(p, which, s);
  const q = syncBorders(a.q, 7);
  const kinds = stitchKinds(q);
  const objs = sewObjects(q, kinds);
  const fill = objs.find((x) => remembered(q, x)?.region && sameAt(q, x, a.q, a.o))!;
  const link = remembered(q, fill)?.line?.link;
  const border = link ? objs.find((x) => remembered(q, x)?.outline === link) : undefined;
  return { ...a, q, kinds, objs, o: fill, border };
}

/** Whether object `x` of `q` starts where object `o` of `p` does. */
const sameAt = (q: Pattern, x: SewObject, p: Pattern, o: SewObject) => {
  const i = firstStitch(q, x);
  const j = firstStitch(p, o);
  return q.x[i] === p.x[j] && q.y[i] === p.y[j] && x.block === o.block;
};
const firstStitch = (p: Pattern, o: SewObject) => {
  for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) return i;
  return o.first;
};

const stitches = (p: Pattern, a: number, b: number) => {
  let n = 0;
  for (let i = a; i <= b; i++) if (p.cmd[i] === STITCH) n++;
  return n;
};

describe('fill border', () => {
  const p = load('cat-60mm.pes');
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const o = objs[1];
  const base = { ...measureFill(p, analyze(p, o, kinds)), pattern: 'tatami' as const, underlay: true };

  /** How many of the stitches of `x` lie `off` mm from the edge of `region`. */
  const near = (q: Pattern, x: SewObject, region: NonNullable<ReturnType<typeof apply>['memory']['region']>, off = 0) => {
    let hit = 0;
    let n = 0;
    for (let i = x.first; i <= x.last; i++) {
      if (q.cmd[i] !== STITCH) continue;
      n++;
      if (Math.abs(sample(region, region.sdfBase, q.x[i] / 10, q.y[i] / 10) - off) < 0.3) hit++;
    }
    return hit / n;
  };

  it('sews a running border on the edge as an object of its own right after the fill, once also after a second change', () => {
    const a = applyAll(p, o.index, { ...base, border: { type: 'run', width: 2 } });
    const region = a.memory.region!;
    expect(a.border).toBeDefined();
    expect(near(a.q, a.border!, region)).toBeGreaterThan(0.8);
    // In the fill's thread, right after it, trimmed off it.
    expect(a.border!.index).toBe(a.o.index + 1);
    expect(a.border!.block).toBe(a.o.block);
    expect(a.q.colors.length).toBe(p.colors.length);
    // The fill has no border stitches of its own.
    expect(analyze(a.q, a.o, a.kinds).parts.some((pt) => pt.border)).toBe(false);
    // A new spacing makes it anew, not twice.
    const one = stitches(a.q, a.border!.first, a.border!.last);
    const b = applyAll(a.q, a.o.index, { ...base, spacing: base.spacing, border: { ...remembered(a.q, a.o)!.line! } });
    expect(b.border).toBeDefined();
    expect(Math.abs(stitches(b.q, b.border!.first, b.border!.last) - one)).toBeLessThan(one * 0.05);
    expect(b.objs.filter((x) => remembered(b.q, x)?.outline)).toHaveLength(1);
  });

  it('sews a satin border of the set width, and none once taken away', () => {
    const plain = applyAll(p, o.index, base);
    expect(plain.border).toBeUndefined();
    const sat = applyAll(p, o.index, { ...base, border: { type: 'satin', width: 3 } });
    expect(stitches(sat.q, sat.border!.first, sat.border!.last)).toBeGreaterThan(200);
    const link = remembered(sat.q, sat.o)!.line!.link!;
    const off = apply(sat.q, sat.o.index, base);
    const gone = syncBorders(off.q, 7, new Set([link]));
    expect(sewObjects(gone, stitchKinds(gone)).some((x) => remembered(gone, x)?.outline)).toBe(false);
    expect(Math.abs(gone.cmd.length - plain.q.cmd.length)).toBeLessThan(80);
  });

  it('moves the border off the edge by the set offset, inside and outside', { timeout: 30000 }, () => {
    for (const offset of [1, -0.8]) {
      const a = applyAll(p, o.index, { ...base, border: { type: 'run', width: 2, offset } });
      expect(near(a.q, a.border!, a.memory.region!, offset)).toBeGreaterThan(0.8);
    }
  });

  it('sews the satin border with its own density and underlay', { timeout: 30000 }, () => {
    const count = (b: object) => {
      const a = applyAll(p, o.index, { ...base, border: { type: 'satin', width: 3, ...b } });
      return stitches(a.q, a.border!.first, a.border!.last);
    };
    const plain = count({});
    expect(count({ spacing: 0.8 })).toBeLessThan(plain - 100);
    expect(count({ under: 'off' })).toBeLessThan(plain);
  });

  it('knows where the underlay of a fill sewn here ends', () => {
    const a = apply(p, o.index, base);
    expect(a.memory.under).toBeGreaterThan(10);
    const r = underlayRanges(a.q, a.o, a.kinds);
    expect(r).toHaveLength(1);
    expect(stitches(a.q, r[0][0], r[0][1])).toBe(a.memory.under);
    expect(remembered(a.q, a.o)?.under).toBe(a.memory.under);
    const none = apply(p, o.index, { ...base, underlay: false });
    expect(none.memory.under).toBeUndefined();
  });

  it('finds the underlay of a fill read from a file', () => {
    const r = underlayRanges(p, o, kinds);
    if (measureFill(p, analyze(p, o, kinds)).underlay) expect(r.length).toBeGreaterThan(0);
  });
});

describe('border in a thread of its own', () => {
  const red = { r: 200, g: 20, b: 30 };
  it('is an object of its own after the fill, in a color block of its own, kept when nothing changes', () => {
    const p = load('cat-60mm.pes');
    const kinds = stitchKinds(p);
    const objs = sewObjects(p, kinds);
    const o = objs[1];
    const base = { ...measureFill(p, analyze(p, o, kinds)), pattern: 'tatami' as const };
    const a = apply(p, o.index, { ...base, border: { type: 'satin', width: 2, color: red, link: 'l1' } });
    const next = syncBorders(a.q, 7);
    expect(next).not.toBe(a.q);
    expect(next.colors.length).toBe(a.q.colors.length + 1);
    const nobjs = sewObjects(next, stitchKinds(next));
    const border = nobjs.find((x) => remembered(next, x)?.outline === 'l1')!;
    expect(border).toBeDefined();
    expect(border.color).toMatchObject(red);
    expect(border.block).toBe(nobjs.find((x) => remembered(next, x)?.line?.link === 'l1')!.block + 1);
    // Nothing changed: nothing to do.
    expect(syncBorders(next, 7)).toBe(next);
    // Taken away with its link dropped.
    const fill = nobjs.find((x) => remembered(next, x)?.line?.link === 'l1')!;
    const m = remembered(next, fill)!;
    remember(next, fill, withLine(m, undefined));
    const gone = syncBorders(next, 7, new Set(['l1']));
    expect(gone.colors.length).toBe(a.q.colors.length);
    expect(sewObjects(gone, stitchKinds(gone)).some((x) => remembered(gone, x)?.outline)).toBe(false);
  });
});

it('keeps the running stitch of a fill object when a border comes and goes', () => {
  const p = load('cat-60mm.pes');
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  // An object with a fill and a long running stitch after it (the yarn of the sweater).
  const o = objs.find((x) => {
    const parts = analyze(p, x, kinds).parts;
    const f = parts.findIndex((pt) => pt.kind === 'fill');
    return f >= 0 && parts.slice(f + 1).some((pt) => pt.kind === 'run' && pt.e - pt.s > 30);
  })!;
  expect(o).toBeDefined();
  const runOf = (q: Pattern, x: SewObject, k: Uint8Array) => analyze(q, x, k).parts.filter((pt) => pt.kind === 'run' && !pt.border).reduce((n, pt) => n + stitches(q, pt.s, pt.e), 0);
  const before = runOf(p, o, kinds);
  const base = { ...measureFill(p, analyze(p, o, kinds)) };
  const a = apply(p, o.index, { ...base, border: { type: 'satin', width: 2 } });
  const b = apply(a.q, a.o.index, { ...base, border: { type: 'run', width: 2 } });
  const c = apply(b.q, b.o.index, base);
  // As much of it as when the fill is sewn anew without a border at all (the running stitch
  // between its patches was travel and goes with the first change; the new fill's own travel is
  // part of the fill, not running stitch).
  const plain = apply(p, o.index, base);
  expect(runOf(c.q, c.o, c.kinds)).toBeGreaterThanOrEqual(runOf(plain.q, plain.o, plain.kinds) * 0.95);
  expect(runOf(b.q, b.o, b.kinds)).toBeGreaterThanOrEqual(runOf(plain.q, plain.o, plain.kinds) * 0.95);
  expect(before).toBeGreaterThan(30);
});

describe('stitches along a drawn line', () => {
  const line: [number, number][] = [
    [0, 0],
    [10, 0],
    [20, 5],
  ];
  it('runs from the end nearest the needle', () => {
    const [run] = sewAlong(line, false, { type: 'run', width: 2 }, [21, 5]);
    expect(run[0]).toEqual([20, 5]);
    expect(run[run.length - 1]).toEqual([0, 0]);
    const triple = sewAlong(line, false, { type: 'triple', width: 2 })[0];
    expect(triple.length).toBe(3 * run.length - 2);
  });
  it('sews a satin of the set width centered on the line', () => {
    const runs = sewAlong(line, false, { type: 'satin', width: 3 });
    const pts = runs.flat();
    const far = Math.max(...pts.filter((q) => q[0] > 2 && q[0] < 8).map((q) => Math.abs(q[1])));
    expect(far).toBeGreaterThan(1.3);
    expect(far).toBeLessThan(1.7);
  });
});

it('remembers its border apart from the settings it was sewn with, which the panel goes on changing', () => {
  const p = load('cat-60mm.pes');
  const kinds = stitchKinds(p);
  const o = sewObjects(p, kinds)[1];
  const s = { ...measureFill(p, analyze(p, o, kinds)), pattern: 'tatami' as const, border: { type: 'satin' as const, width: 2 } as BorderSettings };
  const a = apply(p, o.index, s);
  // The thread is picked in the panel: its settings change in place.
  s.border!.color = { r: 1, g: 2, b: 3 };
  expect(remembered(a.q, a.o)?.line?.color).toBeUndefined();
  // So the next change finds the border in the fill and moves it to its own thread.
  const b = apply(a.q, a.o.index, { ...s, border: { ...s.border!, link: 'k' } });
  const plain = apply(p, o.index, { ...s, border: undefined });
  expect(Math.abs(stitches(b.q, b.o.first, b.o.last) - stitches(plain.q, plain.o.first, plain.o.last))).toBeLessThan(60);
}, 30000);

it('shows only the underlay of a fill, not the running stitch sewn before it in the same object', () => {
  const p = load('cat-60mm.pes');
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  // An object with a long running stitch before its fill.
  const o = objs.find((x) => {
    const parts = analyze(p, x, kinds).parts;
    const f = parts.findIndex((pt) => pt.kind === 'fill');
    return f > 0 && parts.slice(0, f).some((pt) => pt.kind === 'run' && pt.e - pt.s > 30);
  });
  expect(o).toBeDefined();
  if (!o) return;
  const a = apply(p, o.index, { ...measureFill(p, analyze(p, o, kinds)), pattern: 'tatami', underlay: true });
  const [r] = underlayRanges(a.q, a.o, a.kinds);
  const run = analyze(a.q, a.o, a.kinds).parts.find((pt) => pt.kind === 'run' && pt.e - pt.s > 30)!;
  expect(r[0]).toBeGreaterThan(run.e - 1);
  expect(stitches(a.q, r[0], r[1])).toBe(a.memory.under);
}, 30000);

describe('border on a fill with parts left out', () => {
  // A 20 mm square, and the same without a disk on top of its right edge (as knockout cuts it).
  const grid = (inside: (x: number, y: number) => boolean) => {
    const W = 300;
    const mask = new Uint8Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) mask[y * W + x] = inside((x + 0.5) * 0.1, (y + 0.5) * 0.1) ? 1 : 0;
    return regionOf(mask, 0, 0, W, W, 0.1)!;
  };
  const sq = (x: number, y: number) => x > 5 && x < 25 && y > 5 && y < 25;
  const whole = grid(sq);
  const cut = grid((x, y) => sq(x, y) && Math.hypot(x - 25, y - 15) > 5);
  const deep = (runs: Pt[][]) => runs.flat().filter(([x, y]) => sample(whole, whole.sdfBase, x, y) < -1).length;

  for (const type of ['run', 'satin'] as const) {
    it(`leaves out the edges shapes on top cut (${type})`, () => {
      const s = { type, width: 1.5 };
      // Without knowing the whole area, the cut edge gets a border too.
      expect(deep(borderStitches(cut, s, [5, 5]))).toBeGreaterThan(5);
      const runs = borderStitches(cut, s, [5, 5], whole);
      expect(deep(runs)).toBe(0);
      // The rest of the edge keeps its border: around three sides and most of the fourth.
      const len = runs.reduce((a, r) => a + r.slice(1).reduce((b, q, i) => b + Math.hypot(q[0] - r[i][0], q[1] - r[i][1]), 0), 0);
      expect(len).toBeGreaterThan(type === 'run' ? 65 : 100);
    });
  }

  it('keeps a border that is not cut whole and closed', () => {
    const lines = borderLines(whole, 0, whole);
    expect(lines).toHaveLength(1);
    expect(lines[0].closed).toBe(true);
    const open = borderLines(cut, 0, whole);
    expect(open).toHaveLength(1);
    expect(open[0].closed).toBe(false);
  });
});

describe('border moved by hand', () => {
  const lilac = { r: 200, g: 160, b: 220 };
  /** A blend from the cat's fill with a satin border in the fill's thread: fill, second thread, border. */
  const blended = () => {
    const p = load('cat-60mm.pes');
    const kinds = stitchKinds(p);
    const o = sewObjects(p, kinds)[1];
    const base = { ...measureFill(p, analyze(p, o, kinds)), pattern: 'tatami' as const };
    const a = applyAll(p, o.index, { ...base, border: { type: 'satin', width: 2 } });
    const q = blendObject(a.q, a.o.index, lilac, 7)!;
    expect(q).not.toBeNull();
    const objs = sewObjects(q, stitchKinds(q));
    const fill = objs.findIndex((x) => remembered(q, x)?.fill?.deco?.blend);
    const second = objs.findIndex((x) => remembered(q, x)?.blendOf);
    const border = objs.findIndex((x) => remembered(q, x)?.outline);
    return { q, objs, fill, second, border };
  };
  const moved = (b: ReturnType<typeof blended>, into?: number) => {
    const order = b.objs.map((x) => x.index).filter((x) => x !== b.border);
    order.splice(order.indexOf(b.fill) + 1, 0, b.border);
    const starts: number[] = [];
    const next = reorder(b.q, b.objs, order, 7, starts, into === undefined ? {} : { into: new Map([[b.border, into]]) });
    const objs = sewObjects(next, stitchKinds(next));
    const border = objs.findIndex((x) => remembered(next, x)?.outline);
    return { next, objs, border };
  };

  it('comes after the second thread of a blend made just now', () => {
    const b = blended();
    expect(b.second).toBeGreaterThan(b.fill);
    expect(b.border).toBeGreaterThan(b.second);
  });

  it('stays where it is moved to before the second thread, an object of its own', { timeout: 30000 }, () => {
    const b = blended();
    const m = moved(b);
    expect(m.border).toBe(b.fill + 1);
    expect(m.objs[m.border].block).toBe(m.objs[b.fill].block);
    // Nothing to sew anew: it stays there.
    expect(syncBorders(m.next, 7)).toBe(m.next);
  });

  it('keeps the thread of the color it is moved into', { timeout: 30000 }, () => {
    const b = blended();
    const m = moved(b, b.objs[b.second].block);
    expect(m.objs[m.border].color).toMatchObject(lilac);
    takeThreads(m.next, [m.border]);
    const s = syncBorders(m.next, 7);
    const objs = sewObjects(s, stitchKinds(s));
    const borders = objs.filter((x) => remembered(s, x)?.outline);
    expect(borders).toHaveLength(1);
    expect(borders[0].color).toMatchObject(lilac);
    expect(borders[0].index).toBe(b.fill + 1);
    expect(remembered(s, objs[b.fill])?.line?.color).toMatchObject(lilac);
  });
});

describe('a border sewn anew', () => {
  it('stays the same object: its id goes with it (the patch of the demo project)', () => {
    const d = patch();
    const q = syncBorders(d.p, d.T);
    // The demo's border was stored with other settings than its fill now has: it is sewn anew.
    expect(q).not.toBe(d.p);
    const ids = (p: Pattern) => sewObjects(p).map((o) => o.id);
    expect(ids(q)).toEqual(ids(d.p));
    // And its fill still finds it by its link.
    const border = sewObjects(q).find((o) => remembered(q, o)?.outline);
    expect(border && remembered(q, border)?.id).toBe(border?.id);
  });
});
