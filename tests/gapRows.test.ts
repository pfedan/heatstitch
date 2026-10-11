import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { fillRegion, GAP_ROWS_MAX, type FillParams } from '../src/digitize/fill';
import type { Pt } from '../src/digitize/skeleton';
import { addShape } from '../src/model/addShape';
import { sewObjects } from '../src/model/objects';
import { STITCH, type Pattern } from '../src/model/pattern';
import { fillRuns, remembered, type FillSettings } from '../src/model/restitch';
import { duplicateObject, mirrorMatrix } from '../src/model/shapeOps';
import { autoCorrect, DEFAULT_CORRECTION } from '../src/correct/auto';
import { planFabric } from '../src/correct/plan';
import { FABRIC, FABRICS, type Profile } from '../src/validation/profiles';
import { validatePattern } from '../src/validation/validate';
import { rasterize } from '../src/shape/rasterize';
import { ellipsePath, parsePath } from '../src/shape/svgPath';
import { boxOf, COLORS, Doc, empty, ID, saveAndOpen, shapes, T, transform } from './helpers/torture';

const KNIT: Profile = { fabric: 'knit', thread: '40' };
const WOVEN: Profile = { fabric: 'woven', thread: '40' };

/** A ring 40 mm across with a hole of 16 mm: rows split around the hole and join again below it. */
const RING = `${ellipsePath(30, 30, 20, 20)} ${ellipsePath(30, 30, 8, 8)}`;
/** A five-pointed star 46 mm across: its points split from and join the middle. */
const STAR = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 9 : 23;
    pts.push(`${30 + r * Math.cos(a)} ${30 + r * Math.sin(a)}`);
  }
  return `M${pts.join(' L')} Z`;
})();

const BASE: FillParams = { spacing: 0.42, stitch: 4, angle: 0, pull: 0.35, underlay: false };

/** Thread of the top rows (horizontal stitches) per row (y to 0.01 mm) and side of x = 30. */
function rowThread(runs: Pt[][], under: number): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const run of runs) {
    for (let i = 0; i < run.length; i++, n++) {
      if (i === 0 || n <= under) continue;
      const [a, b] = [run[i - 1], run[i]];
      if (Math.abs(a[1] - b[1]) > 1e-6 || Math.abs(a[0] - b[0]) < 1e-6) continue;
      const key = `${a[1].toFixed(2)}|${(a[0] + b[0]) / 2 < 30 ? 'L' : 'R'}`;
      out.set(key, (out.get(key) ?? 0) + Math.abs(a[0] - b[0]));
    }
  }
  return out;
}

/** Rows that carry clearly more thread with gap rows than without: [y, side]. */
function doubled(r: ReturnType<typeof rasterize>, p: FillParams): [number, string][] {
  const plain = fillRegion(r!, { ...p, gapRows: 0 }, [0, 0])!;
  const gap = fillRegion(r!, { ...p, gapRows: 1 }, [0, 0])!;
  const a = rowThread(plain.runs, plain.under ?? 0);
  const b = rowThread(gap.runs, gap.under ?? 0);
  const out: [number, string][] = [];
  for (const [k, v] of b) if (v > (a.get(k) ?? 0) + 1) out.push([Number(k.split('|')[0]), k.split('|')[1]]);
  return out;
}

/** A design of one fill drawn on `profile`, as the app makes it. */
function drawn(path: string, profile: Profile, gapRows?: number): Pattern {
  const o = digitizeDefaults(profile);
  return addShape(empty, { form: parsePath(path, ID), kind: 'fill' }, COLORS[0], null, { ...o, gapRows: gapRows ?? o.gapRows, trimMm: T })!.pattern;
}

const fillOf = (p: Pattern, k = 0): FillSettings => remembered(p, sewObjects(p)[k])!.fill!;

describe('gap rows where sections of a fill meet', () => {
  it('cover every join of a ring, on both sides of its hole, and nowhere else', () => {
    const r = rasterize(parsePath(RING, ID), 0.1);
    const rows = doubled(r, BASE);
    // The rows split at the top of the hole (y 22) and join at its bottom (y 38).
    const near = (y: number, at: number) => Math.abs(y - at) <= 2 * BASE.spacing + 0.01;
    for (const at of [22, 38]) {
      for (const side of ['L', 'R']) expect(rows.some(([y, s]) => s === side && near(y, at)), `join at y ${at}, ${side}`).toBe(true);
    }
    expect(rows.filter(([y]) => !near(y, 22) && !near(y, 38)), 'rows away from the joins').toEqual([]);
  });

  it('are one row deep with one gap row, up to GAP_ROWS_MAX', () => {
    const r = rasterize(parsePath(RING, ID), 0.1)!;
    const count = (g: number) => fillRegion(r, { ...BASE, gapRows: g }, [0, 0])!.runs.flat().length;
    expect(count(1)).toBeGreaterThan(count(0));
    expect(count(2)).toBeGreaterThan(count(1));
    expect(count(GAP_ROWS_MAX + 3)).toBe(count(GAP_ROWS_MAX));
  });

  it('change nothing where a fill is one section, or rows are spaced unevenly', () => {
    const disc = rasterize(parsePath(ellipsePath(30, 30, 15, 15), ID), 0.1)!;
    expect(fillRegion(disc, { ...BASE, gapRows: 1 }, [0, 0])).toEqual(fillRegion(disc, BASE, [0, 0]));
    const ring = rasterize(parsePath(RING, ID), 0.1)!;
    const gradient = { ...BASE, spacingEnd: 0.9 };
    expect(fillRegion(ring, { ...gradient, gapRows: 1 }, [0, 0])).toEqual(fillRegion(ring, gradient, [0, 0]));
    // No gap rows (0 or not set) is the fill as before.
    expect(fillRegion(ring, { ...BASE, gapRows: 0 }, [0, 0])).toEqual(fillRegion(ring, BASE, [0, 0]));
  });

  it('add no jump: the fill is sewn in as many runs as without', () => {
    for (const path of [RING, STAR]) {
      for (const angle of [0, 30, 45, 90]) {
        const r = rasterize(parsePath(path, ID), 0.1)!;
        const p = { ...BASE, angle, underlay: true, underCross: true };
        expect(fillRegion(r, { ...p, gapRows: 1 }, [0, 0])!.runs.length, `${angle}°`).toBeLessThanOrEqual(fillRegion(r, p, [0, 0])!.runs.length);
      }
    }
  });
});

describe('gap rows by fabric', () => {
  it('one on knit (jersey), none on stable or density-sensitive fabric', () => {
    expect(FABRIC.knit.gapRows).toBe(1);
    for (const f of FABRICS) expect(f.gapRows, f.id).toBeLessThanOrEqual(1);
    for (const id of ['woven', 'woven_heavy', 'cap', 'leather'] as const) expect(FABRIC[id].gapRows, id).toBe(0);
  });

  it('a fill drawn on knit gets them, one drawn on woven fabric does not', () => {
    expect(fillOf(drawn(RING, KNIT)).gapRows).toBe(1);
    expect(fillOf(drawn(RING, WOVEN)).gapRows).toBeUndefined();
    // Sewn with them: more stitches than the same fill without.
    const knit = drawn(RING, KNIT);
    const s = fillOf(knit);
    const r = remembered(knit, sewObjects(knit)[0])!.region!;
    const way = { start: [0, 0] as Pt };
    expect(fillRuns(r, s, way)!.runs.flat().length).toBeGreaterThan(fillRuns(r, { ...s, gapRows: undefined }, way)!.runs.flat().length);
  });

  it('the density check finds nothing new on knit: no critical cell, no new finding', () => {
    for (const path of [RING, STAR]) {
      const p = drawn(path, KNIT);
      const v = validatePattern(p, KNIT);
      expect(v.criticalCells, 'critical cells').toBe(0);
      // Findings beyond small spots (see practice.ts): none, as without gap rows.
      const findings = (q: Pattern) => validatePattern(q, KNIT).zones.filter((z) => !z.practice);
      expect(findings(p), 'findings').toEqual([]);
      expect(findings(drawn(path, KNIT, 0)), 'findings without gap rows').toEqual([]);
      expect(v.maxDensity).toBeLessThan(v.thresholds.critical);
    }
  });

  it('the automatic correction neither removes them nor finds anything to correct', () => {
    const p = drawn(STAR, KNIT);
    const r = autoCorrect(p, KNIT, DEFAULT_CORRECTION);
    expect(r.report.after.criticalCells).toBe(0);
    expect(Array.from(r.pattern.x)).toEqual(Array.from(p.x));
    expect(planFabric(p, KNIT).flatMap((x) => x.changes).filter((c) => c.field === 'gapRows'), 'tuned to knit already').toEqual([]);
  });

  it('"Tune to fabric" adds them for knit and takes them out for woven fabric', () => {
    const woven = drawn(RING, WOVEN);
    expect(planFabric(woven, KNIT).flatMap((x) => x.changes).filter((c) => c.field === 'gapRows')).toEqual([{ field: 'gapRows', from: 0, to: 1 }]);
    const knit = drawn(RING, KNIT);
    expect(planFabric(knit, WOVEN).flatMap((x) => x.changes).filter((c) => c.field === 'gapRows')).toEqual([{ field: 'gapRows', from: 1, to: 0 }]);
  });
});

describe('gap rows stay with the fill', () => {
  it('through duplicate, mirror, undo and save and open', async () => {
    const d = new Doc();
    shapes(d, drawn(RING, KNIT));
    const first = d.cur;
    expect(shapes(d, duplicateObject(d.cur.p, 0, T)?.pattern)).toBe(true);
    expect(transform(d, [1], mirrorMatrix('x', boxOf(d, [1])))).toBe(true);
    const gaps = () => d.objects.map((o) => remembered(d.cur.p, o)?.fill?.gapRows);
    expect(gaps()).toEqual([1, 1]);
    const before = Array.from(d.cur.p.x);
    await saveAndOpen(d);
    expect(gaps()).toEqual([1, 1]);
    expect(Array.from(d.cur.p.x)).toEqual(before);
    // Undo: back to the one fill, with its gap rows.
    d.cur = first;
    expect(gaps()).toEqual([1]);
    let stitches = 0;
    for (let i = 0; i < first.p.cmd.length; i++) if (first.p.cmd[i] === STITCH) stitches++;
    expect(stitches).toBeGreaterThan(0);
  });
});
