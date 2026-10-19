import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { v8Math } from './v8math';
import * as rsSuggest from '../../src/digitize/satinSuggest';
import * as rsEase from '../../src/digitize/satinEase';
import * as tsSuggest from './ts/satinSuggest';
import * as tsEase from './ts/satinEase';
import { inChainOrder } from '../../src/model/reshape';
import { satinRuns, type Rails, type SatinSettings } from '../../src/model/restitch';
import { stripsOfAreas } from '../../src/digitize/rungs';
import { peakDensity } from '../../src/digitize/measure';
import { skeleton, type Graph, type Pt } from '../../src/digitize/skeleton';
import { buildRegion, type Region } from '../../src/digitize/region';
import { rasterize, rasterizeStroke } from '../../src/shape/rasterize';
import { parsePath } from '../../src/shape/svgPath';
import type { Mat } from '../../src/shape/path';
import type { Font } from '../../src/lettering/font';

/**
 * Stage 4c of the Rust core (docs/rust-core.md): "Vorschlagen" (satinSuggest) and easing a satin in
 * sections where it piles up (satinEase). The TypeScript as it was (tests/rust/ts) and the Rust core
 * run on letter strokes of the lettering fonts, the fills and lines of the SVG examples rasterized
 * as areas, and synthetic areas (a star, an L, a ring, a heart, a cross on a dot, an eye), and must
 * agree exactly: the algorithms are the same and the core does its arithmetic as JavaScript does.
 * Where sin, cos, atan2 or acos decide (planning the strokes, the cuts tried through a pile), the
 * comparison needs V8's own routines (see v8math). The `ratio` a strip carries from the outline is
 * not compared on columns: nothing reads it, and the core's columns leave it out.
 */

const unzip = (gz: Uint8Array): string => new TextDecoder().decode(gunzipSync(gz));
const pairs = (a: number[]): Pt[] => {
  const o: Pt[] = [];
  for (let k = 0; k + 1 < a.length; k += 2) o.push([a[k], a[k + 1]]);
  return o;
};
const font = (id: string): Font => JSON.parse(readFileSync(new URL(`../../public/fonts/${id}.json`, import.meta.url), 'utf8')) as Font;

/** Areas of satin columns of some letters (rail out, the other back), rasterized: letter strokes. */
function letterAreas(id: string, chars: string, cap = 20): Region[] {
  const f = font(id);
  const k = cap / f.cap;
  const out: Region[] = [];
  for (const ch of chars) {
    for (const e of f.glyphs[ch]?.e ?? []) {
      if (e.k !== 's') continue;
      const tf = (p: Pt): Pt => [p[0] * k + 5, p[1] * k + 30];
      const ring = [...pairs(e.l).map(tf), ...pairs(e.r).map(tf).reverse()];
      const r = rasterize({ paths: [{ closed: true, nodes: ring.map((p) => ({ p, a: p, b: p, smooth: false })) }] });
      if (r) out.push(r);
    }
  }
  return out;
}

/** The SVG examples: fills as areas, lines stroked 2 mm wide (strokes to plan), the small enough ones. */
function svgAreas(): Region[] {
  const svg = JSON.parse(unzip(readFileSync('tests/rust/fixtures/stage2-svg-shapes.json.gz'))) as { design: string; fill: boolean; d: string; m: Mat }[];
  const out: Region[] = [];
  svg.forEach((s, k) => {
    if (k % 2) return;
    const form = parsePath(s.d, s.m);
    if (!form.paths.length) return;
    const r = s.fill ? rasterize({ ...form, paths: form.paths.filter((p) => p.closed) }) : rasterizeStroke(form, 2);
    if (r && r.areaMm2 > 4 && r.areaMm2 < 1500 && r.w * r.h < 400 * 400) out.push(r);
  });
  return out;
}

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
const inPoly = (poly: Pt[]) => (x: number, y: number) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const near = (a: Pt, b: Pt, w: number) => (x: number, y: number) => {
  const v: Pt = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * v[0] + (y - a[1]) * v[1]) / (v[0] * v[0] + v[1] * v[1])));
  return Math.hypot(x - a[0] - v[0] * t, y - a[1] - v[1] * t) < w / 2;
};
const disk = (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) < r;
const star: Pt[] = Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5;
  const r = i % 2 ? 6 : 15;
  return [20 + r * Math.cos(a), 20 + r * Math.sin(a)] as Pt;
});
/** A loop with a wedge beside it, thick where it meets the loop, and a line leaving it: it piles up. */
const PILE = region((x, y) => (disk(30, 24, 3.2)(x, y) && !disk(30, 24, 2)(x, y)) || inPoly([[16, 28], [30, 26], [34, 32], [16, 29.4]])(x, y) || inPoly([[32, 30], [38, 34], [38, 35.2], [32, 31.4]])(x, y));
const SYN: Region[] = [
  region(inPoly(star)),
  region(inPoly([[5, 5], [10, 5], [10, 30], [35, 30], [35, 35], [5, 35]])),
  region((x, y) => Math.hypot(x - 20, y - 20) < 12 && Math.hypot(x - 20, y - 20) > 7),
  region((x, y) => disk(15, 15, 6)(x, y) || disk(25, 15, 6)(x, y) || (y >= 15 && y < 32 && Math.abs(x - 20) < ((32 - y) / 17) * 11)),
  region((x, y) => disk(20, 20, 5)(x, y) || near([5, 20], [35, 20], 1.6)(x, y) || near([20, 5], [20, 35], 1.6)(x, y)),
  region((x, y) => (Math.hypot((x - 20) / 12, (y - 20) / 7) < 1 && Math.hypot((x - 20) / 10, (y - 20) / 5) > 1) || (Math.hypot(x - 20, y - 20) < 3.5 && Math.hypot(x - 21, y - 19) > 1)),
  region((x, y) => near([5, 10], [35, 10], 2)(x, y) || near([20, 10], [20, 35], 2)(x, y) || near([10, 35], [30, 35], 2)(x, y)),
  PILE,
];

const ALL = [...letterAreas('roman_ags', 'AKSgR&'), ...letterAreas('marifenda', 'aeQ'), ...letterAreas('mam_script', 'Hy'), ...svgAreas(), ...SYN];
const graphs: Graph[] = ALL.map((r) => skeleton(r));

const SATIN: SatinSettings = { spacing: 0.4, edge: 0, short: true, underlay: false, tolerance: 0.15 };
const noRatio = (c: Rails) => {
  const { ratio: _r, ...rest } = c as Rails & { ratio?: number };
  return rest;
};

describe('stage 4c: the loops of an area', () => {
  it('reads the same outsides and holes', () => {
    let holes = 0;
    for (const r of ALL) {
      const ts = tsSuggest.areaLoops(r);
      expect(rsSuggest.areaLoops(r)).toEqual(ts);
      holes += ts.holes.length;
    }
    expect(holes).toBeGreaterThan(3);
  });
});

describe.runIf(v8Math)('stage 4c: suggestions', () => {
  const plans: { r: Region; s: tsSuggest.SatinSuggestion }[] = [];
  it('suggests the same cut lines and lines across', () => {
    const kinds = new Map<string, number>();
    let ok = 0;
    let ts = 0;
    let rs = 0;
    ALL.forEach((r, i) => {
      for (const [max, columns, crossings, graph] of [
        [7, false, true, true],
        [4, false, true, true],
        [7, true, false, true],
        [7, false, true, false],
      ] as const) {
        const g = graph ? graphs[i] : undefined;
        let t0 = performance.now();
        const a = tsSuggest.suggestSatin(r, g, max, columns, crossings);
        ts += performance.now() - t0;
        t0 = performance.now();
        const b = rsSuggest.suggestSatin(r, g, max, columns, crossings);
        rs += performance.now() - t0;
        expect(b).toEqual(a);
        if (a) kinds.set(a.kind, (kinds.get(a.kind) ?? 0) + 1);
        if (a?.ok) ok++;
        if (a && max === 7 && !columns && graph) plans.push({ r, s: a });
      }
    });
    console.log(`suggestSatin on ${ALL.length} areas x4: TypeScript ${ts.toFixed(0)} ms, Rust ${rs.toFixed(0)} ms; kinds ${JSON.stringify(Object.fromEntries(kinds))}`);
    expect(ok).toBeGreaterThan(ALL.length);
    expect(kinds.size).toBeGreaterThan(4);
  });

  it('makes the same columns and keeps cut lines by hand the same way', () => {
    let made = 0;
    for (const { r, s } of plans) {
      const a = tsSuggest.columnsAlong(r, s.lines, s.cuts);
      const b = rsSuggest.columnsAlong(r, s.lines, s.cuts);
      if (a && 'columns' in a && b && 'columns' in b) {
        made++;
        expect(b.columns.map(noRatio)).toEqual(a.columns.map(noRatio));
      } else expect(b).toEqual(a);
      const { outsides, holes } = tsSuggest.areaLoops(r);
      // Two of its cut lines as drawn by hand, the first bent through a third point.
      const own: Pt[][] = s.cuts.slice(0, 2).map((c, k) => (k ? c : [c[0], [(c[0][0] + c[1][0]) / 2 + 0.3, (c[0][1] + c[1][1]) / 2], c[1]]));
      expect(rsSuggest.aroundCuts(s, own, outsides, holes)).toEqual(tsSuggest.aroundCuts(s, own, outsides, holes));
      // The suggestion in the kind switch, in chain order (see reshape).
      const want = s.kind !== 'wide' && s.ok && a && 'columns' in a ? inChainOrder(a.columns, SATIN) : null;
      const got = rsSuggest.suggestedColumns(r, SATIN);
      expect(got?.map(noRatio) ?? null).toEqual(want?.map(noRatio) ?? null);
    }
    expect(made).toBeGreaterThan(20);
  });

  it('reads the same split from columns that do not know it', () => {
    let split = 0;
    for (const { r, s } of plans) {
      const a = tsSuggest.columnsAlong(r, s.lines, s.cuts);
      if (!a || !('columns' in a)) continue;
      const cols = a.columns.map(({ split: _s, ...c }) => c);
      const ts = tsSuggest.withSplit([cols], r);
      expect(rsSuggest.withSplit([cols], r)).toEqual(ts);
      expect(rsSuggest.withSplit([[], cols], r, 1)).toEqual(tsSuggest.withSplit([[], cols], r, 1));
      if ((ts[0][0] as Rails).split) split++;
    }
    expect(split).toBeGreaterThan(10);
  });

  it('eases piles with the same cuts', () => {
    let eased = 0;
    let ts = 0;
    let rs = 0;
    // Every third plan (each is sewn some sixty times), the satin as sewn passed on every sixth.
    plans.forEach(({ r, s }, k) => {
      if (!s.ok || k % 3) return;
      const { outsides, holes } = tsSuggest.areaLoops(r);
      const made = stripsOfAreas(outsides, s.lines, s.cuts, holes);
      if (made.bad || made.hole >= 0) return;
      const runs = satinRuns(made.areas.flatMap((strips, a) => strips.map((x) => ({ ...x, chain: a }))), SATIN);
      // Below the measured peak, so most get a cut tried.
      const limit = peakDensity(runs) * 0.9;
      let t0 = performance.now();
      const a = tsEase.easePiles(r, s, SATIN, 7, limit);
      ts += performance.now() - t0;
      t0 = performance.now();
      const b = rsEase.easePiles(r, s, SATIN, 7, limit);
      rs += performance.now() - t0;
      expect(b).toEqual(a);
      if (k % 6 === 0) expect(rsEase.easePiles(r, s, SATIN, 7, limit, runs)).toEqual(tsEase.easePiles(r, s, SATIN, 7, limit, runs));
      if (a !== s) eased++;
      expect(b === s).toBe(a === s);
    });
    console.log(`easePiles: TypeScript ${ts.toFixed(0)} ms, Rust ${rs.toFixed(0)} ms, ${eased} eased`);
    expect(eased).toBeGreaterThan(3);
  });
});

describe('stage 4c: helpers without trigonometry', () => {
  it('orders cut lines and tells covered holes the same way', () => {
    let n = 0;
    ALL.forEach((r, i) => {
      const { outsides, holes } = tsSuggest.areaLoops(r);
      if (!holes.length) return;
      const s = tsSuggest.suggestSatin(r, graphs[i]);
      if (!s?.cuts.length) return;
      n++;
      const shuffled = s.cuts.slice().reverse();
      expect(rsSuggest.bridgeOrder(shuffled, outsides, holes)).toEqual(tsSuggest.bridgeOrder(shuffled, outsides, holes));
      const made = stripsOfAreas(outsides, s.lines, s.cuts, holes);
      const strips = made.areas.flat();
      expect(rsSuggest.covers(strips, holes)).toBe(tsSuggest.covers(strips, holes));
      // Each part's outline as one strip, which runs round the hole.
      const wide = outsides.map((o) => ({ left: o.slice(0, o.length >> 1), right: o.slice(o.length >> 1).reverse(), rungs: [] as [number, number][] }));
      expect(rsSuggest.covers(wide, holes)).toBe(tsSuggest.covers(wide, holes));
    });
    expect(n).toBeGreaterThan(2);
  });

  it('classifies the same and leaves a plan alone that does not pile up', () => {
    for (const g of graphs) expect([rsSuggest.classify(g), rsSuggest.offersSections(g)]).toEqual([tsSuggest.classify(g), tsSuggest.offersSections(g)]);
    const plan = rsSuggest.suggestSatin(PILE)!;
    expect(plan.ok).toBe(true);
    expect(rsEase.easePiles(PILE, plan, SATIN, 7)).toBe(plan);
  });
});
