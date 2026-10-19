import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as rsSatin from '../../src/digitize/satin';
import * as rsRungs from '../../src/digitize/rungs';
import * as rsForms from '../../src/digitize/satinForms';
import * as rsShapes from '../../src/digitize/satinShapes';
import * as rsJoins from '../../src/digitize/satinJoins';
import * as tsSatin from './ts/satin';
import * as tsRungs from './ts/rungs';
import * as tsForms from './ts/satinForms';
import * as tsShapes from './ts/satinShapes';
import * as tsJoins from './ts/satinJoins';
import { areaLoops, suggestSatin } from '../../src/digitize/satinSuggest';
import { skeleton, type Graph } from '../../src/digitize/skeleton';
import { buildRegion, type Region } from '../../src/digitize/region';
import { rasterize } from '../../src/shape/rasterize';
import type { Font } from '../../src/lettering/font';

/**
 * Stage 3b of the Rust core (docs/rust-core.md): satin columns, rungs, satin forms and shapes and
 * the corners of satin along a line. The TypeScript as it was (tests/rust/ts) and the Rust core run
 * on the same letters (columns of the lettering fonts, their areas rasterized), synthetic areas and
 * the plans "Vorschlagen" makes for them, and must agree exactly: the algorithms are the same and
 * the core does its arithmetic as JavaScript does.
 */

type Pt = [number, number];
const pairs = (a: number[]): Pt[] => {
  const o: Pt[] = [];
  for (let k = 0; k + 1 < a.length; k += 2) o.push([a[k], a[k + 1]]);
  return o;
};
const font = (id: string): Font => JSON.parse(readFileSync(new URL(`../../public/fonts/${id}.json`, import.meta.url), 'utf8')) as Font;

/** Satin columns of some letters of a font, scaled to `cap` mm capitals. */
function columnsOf(id: string, chars: string, cap = 20): { left: Pt[]; right: Pt[]; rungs: [number, number][] }[] {
  const f = font(id);
  const k = cap / f.cap;
  const out: { left: Pt[]; right: Pt[]; rungs: [number, number][] }[] = [];
  for (const ch of chars) {
    for (const e of f.glyphs[ch]?.e ?? []) {
      if (e.k !== 's') continue;
      const tf = (p: Pt): Pt => [p[0] * k + 5, p[1] * k + 30];
      out.push({ left: pairs(e.l).map(tf), right: pairs(e.r).map(tf), rungs: pairs(e.g).map(([a, b]) => [a * k, b * k]) });
    }
  }
  return out;
}

const COLS = [...columnsOf('roman_ags', 'AKSgR&'), ...columnsOf('marifenda', 'aeQ'), ...columnsOf('mam_script', 'Hy'), ...columnsOf('barstitch_regular', 'MO')];

/** The areas of satin columns (rail out, the other back), rasterized: letter strokes as areas. */
const areas: Region[] = COLS.filter((_, i) => i % 3 === 0)
  .map((c) => {
    const ring = [...c.left, ...c.right.slice().reverse()];
    return rasterize({ paths: [{ closed: true, nodes: ring.map((p) => ({ p, a: p, b: p, smooth: false })) }] });
  })
  .filter((r): r is Region => !!r);

/** Synthetic areas from a test on pixel centers: a star, an L, a ring, a heart, a blob with lines, an eye. */
const PX = 0.1;
const W = 400;
function region(inside: (x: number, y: number) => boolean): Region {
  const comp = new Int32Array(W * W);
  let [minX, minY, maxX, maxY] = [W, W, 0, 0];
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside((x + 0.5) * PX, (y + 0.5) * PX)) continue;
      comp[y * W + x] = 1;
      [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
    }
  }
  return buildRegion(comp, new Uint8Array(W * W), W, 1, 1, { minX, minY, maxX, maxY }, W, PX, 0, () => false);
}
const inPoly = (poly: Pt[]) => (x: number, y: number) => tsRungs.inside(poly, [x, y]);
const near = (a: Pt, b: Pt, w: number) => (x: number, y: number) => {
  const v: Pt = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * v[0] + (y - a[1]) * v[1]) / (v[0] * v[0] + v[1] * v[1])));
  return Math.hypot(x - a[0] - v[0] * t, y - a[1] - v[1] * t) < w / 2;
};
const star: Pt[] = Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5;
  const r = i % 2 ? 6 : 15;
  return [20 + r * Math.cos(a), 20 + r * Math.sin(a)] as Pt;
});
const SYN: Region[] = [
  region(inPoly(star)),
  region(inPoly([[5, 5], [10, 5], [10, 30], [35, 30], [35, 35], [5, 35]])),
  region((x, y) => Math.hypot(x - 20, y - 20) < 12 && Math.hypot(x - 20, y - 20) > 7),
  region((x, y) => {
    // A heart: two circles and a triangle under them.
    const c = Math.hypot(x - 15, y - 15) < 6 || Math.hypot(x - 25, y - 15) < 6;
    return c || (y >= 15 && y < 32 && Math.abs(x - 20) < ((32 - y) / 17) * 11);
  }),
  region((x, y) => Math.hypot(x - 20, y - 20) < 5 || near([5, 20], [35, 20], 1.6)(x, y) || near([20, 5], [20, 35], 1.6)(x, y)),
  region((x, y) => (Math.hypot((x - 20) / 12, (y - 20) / 7) < 1 && Math.hypot((x - 20) / 10, (y - 20) / 5) > 1) || (Math.hypot(x - 20, y - 20) < 3.5 && Math.hypot(x - 21, y - 19) > 1)),
];

const ALL = [...areas, ...SYN];
const graphs = ALL.map((r) => skeleton(r));

describe('stage 3b: satin columns', () => {
  const cols: { ts: tsSatin.Column; rs: rsSatin.Column }[] = [];
  it('casts the same rails from the centerlines', () => {
    ALL.forEach((r, i) => {
      for (const b of graphs[i].branches) {
        for (const [fa, fb] of [[true, true], [false, true], [false, false]]) {
          const ts = tsSatin.column(r, b, fa, fb);
          const rs = rsSatin.column(r, b, fa, fb);
          expect(rs).toEqual(ts);
          if (fa && fb) cols.push({ ts, rs });
        }
      }
    });
    expect(cols.length).toBeGreaterThan(20);
  });

  const PARAMS: tsSatin.SatinParams[] = [
    { spacing: 0.4, pull: 0.2, splitMm: 7 },
    { spacing: 0.35, pull: 0.1, splitMm: 4, stagger: true, pullB: 0.3, pullShare: 0.1 },
    { spacing: 0.5, pull: -0.1, splitMm: Infinity, short: false, pullShareB: 0.05 },
    { spacing: 0.3, pull: 0.15, splitMm: 5, fringe: 1, fringeB: 0.5, lead: 0.2 },
    { spacing: 0.4, pull: 0.2, splitMm: 6, rough: 0.7, seed: 12345.6, stagger: true },
    { spacing: 0.4, pull: 0.2, splitMm: 7, rough: 0.3 },
  ];

  it('places the same pairs and needle points', () => {
    for (const { ts: c } of cols) {
      for (const p of PARAMS) {
        const at = { ...p, spacingAt: c.center.map((_, i) => 0.3 + 0.2 * Math.sin(i / 7)) };
        for (const q of [p, at]) {
          const ends = { from: c.center[0], fromTrim: 0.6, to: c.center[c.center.length - 1], toTrim: 0.3 };
          for (const e of [undefined, ends]) {
            const ps = tsSatin.pairs(c, q, e);
            expect(rsSatin.pairs(c, q, e)).toEqual(ps);
            expect(rsSatin.satinStitches(ps, q)).toEqual(tsSatin.satinStitches(ps, q));
            expect(rsSatin.eStitches(ps, q)).toEqual(tsSatin.eStitches(ps, q));
          }
        }
      }
      expect(rsSatin.fringedColumn(c, 0.4, 0.8)).toEqual(tsSatin.fringedColumn(c, 0.4, 0.8));
    }
  });

  it('sews the same underlay', () => {
    for (const { ts: c } of cols) {
      for (const stretch of [false, true]) {
        expect(rsSatin.underlay(c, 0.15, undefined, stretch)).toEqual(tsSatin.underlay(c, 0.15, undefined, undefined, stretch));
        for (const kind of ['auto', 'center', 'contour', 'zigzag', 'both'] as const) {
          for (const ins of [undefined, { mm: 0.3 }, { share: 0.12 }]) {
            for (const oneWay of [false, true]) {
              expect(rsSatin.underlayOf(c, kind, 0.15, ins, oneWay, stretch)).toEqual(tsSatin.underlayOf(c, kind, 0.15, ins, oneWay, stretch));
            }
          }
        }
      }
    }
  });
});

describe('stage 3b: rungs', () => {
  it('makes the same columns, rungs and corner rungs from the fonts', () => {
    for (const c of COLS) {
      for (const step of [0.05, 0.2]) expect(rsRungs.columnFromRungs(c.left, c.right, c.rungs, step)).toEqual(tsRungs.columnFromRungs(c.left, c.right, c.rungs, step));
      const col = tsRungs.columnFromRungs(c.left, c.right, c.rungs, 0.4);
      for (const deg of [3, 10]) expect(rsRungs.seedRungs(col.left, col.right, deg)).toEqual(tsRungs.seedRungs(col.left, col.right, deg));
      for (const deg of [35, 60]) {
        expect(rsRungs.cornerRungs(c.left, c.right, c.rungs, deg)).toEqual(tsRungs.cornerRungs(c.left, c.right, c.rungs, deg));
        expect(rsRungs.cornerCuts(c.left, c.right, c.rungs, deg)).toEqual(tsRungs.cornerCuts(c.left, c.right, c.rungs, deg));
      }
    }
  });

  it('cuts the areas into the same strips along the suggested lines', () => {
    let made = 0;
    const count = { rails: 0, loops: 0 };
    ALL.forEach((r, i) => {
      const s = suggestSatin(r, graphs[i]);
      if (!s) return;
      const { outsides, holes } = areaLoops(r);
      const ts = tsRungs.stripsOfAreas(outsides, s.lines, s.cuts, holes);
      expect(rsRungs.stripsOfAreas(outsides, s.lines, s.cuts, holes)).toEqual(ts);
      expect(rsRungs.checkSections(outsides, s.lines, s.cuts, holes)).toEqual(tsRungs.checkSections(outsides, s.lines, s.cuts, holes));
      // Fewer lines, so some parts make no strip; no cuts, so holes stay closed.
      const few = s.lines.filter((_, k) => k % 3 === 0);
      expect(rsRungs.checkSections(outsides, few, s.cuts, holes)).toEqual(tsRungs.checkSections(outsides, few, s.cuts, holes));
      expect(rsRungs.stripsOfAreas(outsides, s.lines, [], holes)).toEqual(tsRungs.stripsOfAreas(outsides, s.lines, [], holes));
      for (const o of outsides) {
        const mine = holes.filter((h) => tsRungs.inside(o, h[0]));
        expect(rsRungs.stripsOfOutline(o, s.lines, s.cuts, mine)).toEqual(tsRungs.stripsOfOutline(o, s.lines, s.cuts, mine));
        const rails = tsRungs.railsFromOutline(o, s.lines);
        expect(rsRungs.railsFromOutline(o, s.lines)).toEqual(rails);
        if (rails) count.rails++;
      }
      if (!ts.bad && ts.hole < 0) {
        const strips = ts.areas.flat();
        made += strips.length;
        expect(rsRungs.cutLinesBetween(strips, outsides, holes)).toEqual(tsRungs.cutLinesBetween(strips, outsides, holes));
        // Each strip again from its outline, as restitch finds a section's rails.
        for (const st of strips) {
          const ring = [...st.left, ...st.right.slice().reverse(), st.left[0]];
          const cum = tsRungs.cumulative(ring);
          const total = cum[cum.length - 1];
          const chords: [number, number][] = st.rungs.map(([a, b]) => [a, total - b]);
          const caps: [number, number][] = [[total - 0.01, 0.01]];
          for (const far of [false, true]) {
            const loop = tsRungs.stripOfLoop(ring, chords, caps, far);
            expect(rsRungs.stripOfLoop(ring, chords, caps, far)).toEqual(loop);
            if (loop) count.loops++;
          }
        }
      }
    });
    expect(made).toBeGreaterThan(20);
    expect(count.rails).toBeGreaterThan(0);
    expect(count.loops).toBeGreaterThan(10);
  });

  it('cuts along bent cut lines the same way', () => {
    const r = SYN[2];
    const { outsides, holes } = areaLoops(r);
    const cuts: Pt[][] = [
      [[20, 4], [21, 10], [20, 14]],
      [[20, 26], [19.5, 30], [20, 36]],
      [[4, 20], [10, 20]],
    ];
    const lines: [Pt, Pt][] = [[[29, 20], [34, 20]], [[13, 13], [9, 9]], [[13, 27], [9, 31]]];
    expect(rsRungs.stripsOfAreas(outsides, lines, cuts, holes)).toEqual(tsRungs.stripsOfAreas(outsides, lines, cuts, holes));
    expect(rsRungs.checkSections(outsides, lines, cuts, holes)).toEqual(tsRungs.checkSections(outsides, lines, cuts, holes));
  });
});

describe('stage 3b: satin forms and shapes', () => {
  let stroked = 0;
  const strokes = (part: Graph, rings: Pt[][]) => (stroked++, { cuts: [] as [Pt, Pt][], lines: [[part.nodes[0].p, rings[0][0]]] as [Pt, Pt][] });
  it('cuts the same corners and plans the same parts and shapes', () => {
    let cut = 0;
    let blobs = 0;
    let filled = 0;
    ALL.forEach((r, i) => {
      const { outsides, holes } = areaLoops(r);
      if (!outsides.length) return;
      const g = graphs[i];
      const tm = tsShapes.materialOf(outsides, holes);
      const rm = rsShapes.materialOf(outsides, holes);
      for (const max of [4, 7]) {
        const tc = tsForms.cornerCuts(outsides, holes, tm, max);
        expect(rsForms.cornerCuts(outsides, holes, rm, max)).toEqual(tc);
        cut += tc.cuts.length;
        expect(rsForms.planParts(outsides, holes, tc.cuts, tc.tips, g, max, strokes)).toEqual(tsForms.planParts(outsides, holes, tc.cuts, tc.tips, g, max, strokes));
        const tw = tsShapes.wholeShape(outsides, holes, tm);
        expect(rsShapes.wholeShape(outsides, holes, rm)).toEqual(tw);
        for (const [split, column] of [[true, false], [true, true], [false, false]]) {
          expect(rsShapes.planShape(tw, rm, max, split, column)).toEqual(tsShapes.planShape(tw, tm, max, split, column));
        }
      }
      expect(rsShapes.smallHoles(g, holes)).toEqual(tsShapes.smallHoles(g, holes));
      const split = tsShapes.splitBlobs(g);
      expect(rsShapes.splitBlobs(g)).toEqual(split);
      for (const b of split?.blobs ?? []) {
        blobs++;
        const s = tsShapes.blobShape(b, split!.strokes, outsides, holes, tm);
        expect(rsShapes.blobShape(b, split!.strokes, outsides, holes, rm)).toEqual(s);
        expect(rsShapes.planShape(s, rm, 7)).toEqual(tsShapes.planShape(s, tm, 7));
      }
      if (holes.length) {
        filled++;
        const a = tsShapes.filled(r, holes);
        const b = rsShapes.filled(r, holes);
        expect([b.x0, b.y0, b.w, b.h, b.areaMm2]).toEqual([a.x0, a.y0, a.w, a.h, a.areaMm2]);
        expect(b.mask).toEqual(a.mask);
        expect(b.sdfBase).toEqual(a.sdfBase);
      }
    });
    expect(cut).toBeGreaterThan(5);
    expect(blobs).toBeGreaterThan(0);
    expect(filled).toBeGreaterThan(0);
    expect(stroked).toBeGreaterThan(0);
  });
});

describe('stage 3b: satin along a line', () => {
  it('turns the same corners and ends', () => {
    const lines: { line: Pt[]; closed: boolean }[] = [
      ...COLS.flatMap((c) => [{ line: c.left, closed: false }, { line: c.right, closed: false }]),
      { line: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], closed: true },
      { line: star.concat([star[0]]), closed: true },
      { line: [[0, 0], [10, 0], [2, 3]], closed: false },
    ];
    for (const { line, closed } of lines) {
      for (const [w, corner, ends] of [[2, 'miter', 'flat'], [3, 'cap', 'round'], [1.5, 'round', 'square'], [4, 'overlap', 'round']] as const) {
        expect(rsJoins.strokeRails(line, closed, w, corner, ends)).toEqual(tsJoins.strokeRails(line, closed, w, corner, ends));
      }
    }
  });
});
