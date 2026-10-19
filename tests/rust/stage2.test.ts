import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { Clipper64, ClipType, FillRule, type Paths64 } from 'clipper2-ts';
import { bezier, bounds, compose, formFrom, rotation, segment, segments, transformForm, translation, type Form, type Mat, type Path } from '../../src/shape/path';
import type { Region } from '../../src/digitize/region';
import * as rsBand from '../../src/shape/band';
import * as rsOps from '../../src/shape/ops';
import * as rsParts from '../../src/shape/parts';
import * as rsRaster from '../../src/shape/rasterize';
import * as rsSimplify from '../../src/shape/simplify';
import * as rsSvg from '../../src/shape/svgPath';
import * as rsVec from '../../src/shape/vectorize';
import * as tsBand from './ts/shape/band';
import * as tsOps from './ts/shape/ops';
import * as tsParts from './ts/shape/parts';
import * as tsRaster from './ts/shape/rasterize';
import * as tsSimplify from './ts/shape/simplify';
import * as tsSvg from './ts/shape/svgPath';
import * as tsVec from './ts/shape/vectorize';

/**
 * Stage 2 of the Rust core (docs/rust-core.md): shapes. The TypeScript as it was (tests/rust/ts/shape)
 * and the Rust core run on the forms of the demo project and the shapes of the SVG examples and of
 * the screencast material (tests/rust/fixtures/stage2-svg-shapes.json.gz: path data and the map to
 * mm, as an SVG file gives them).
 *
 * Where the algorithm is the same (path data, simplifying, vectorizing, rastering, parts, bands,
 * offsets) the results agree to rounding. Joining and cutting on the curves moved from paper.js to
 * linesweeper: there the areas must agree within a band of 0.002 mm along the outline (the area where
 * the two differ, measured on polygons 1 µm from the curves) plus 0.01 mm².
 */

type Pt = [number, number];
type Item = { design: string; fill: boolean; geo: Form };

const unzip = (gz: Uint8Array): string => new TextDecoder().decode(gunzipSync(gz));

function corpus(): Item[] {
  const demo = JSON.parse(unzip(readFileSync('public/examples/demo/heatstitch-demo.heatstitch'))) as {
    files: { name?: string; objects: { objects: { memory?: { geo?: unknown; line?: unknown; fill?: unknown } }[] } }[];
  };
  const out: Item[] = [];
  for (const f of demo.files)
    for (const o of f.objects.objects) {
      const m = o.memory;
      const geo = m?.geo ? formFrom(m.geo) : null;
      if (geo) out.push({ design: (f.name ?? '').replace('.pes', ''), fill: !m!.line || !!m!.fill, geo });
    }
  const svg = JSON.parse(unzip(readFileSync('tests/rust/fixtures/stage2-svg-shapes.json.gz'))) as { design: string; fill: boolean; d: string; m: Mat }[];
  for (const s of svg) out.push({ design: s.design, fill: s.fill, geo: tsSvg.parsePath(s.d, s.m) });
  return out.filter((x) => x.geo.paths.length);
}

await tsOps.loadOps();
const items = corpus();
const fills = items
  .filter((x) => x.fill && x.geo.paths.some((p) => p.closed) && tsOps.areaOfForm(x.geo) > 4)
  .map((x) => ({ ...x, geo: { ...x.geo, paths: x.geo.paths.filter((p) => p.closed) } as Form }));
const lines = items.filter((x) => !x.fill || x.geo.paths.some((p) => !p.closed));

/** Every number of `a` within `tol` of the one in the same place of `b`, the shapes the same. */
function close(a: unknown, b: unknown, tol: number, at = ''): string | null {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol || (Number.isNaN(a) && Number.isNaN(b)) ? null : `${at}: ${a} vs ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${at}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = close(a[i], b[i], tol, `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) return close(Array.from(a as Float32Array), Array.from(b as Float32Array), tol, at);
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    // A false `nonzero` and none are the same.
    const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => (a as never)[k] !== undefined || (b as never)[k] !== undefined));
    for (const k of keys) {
      const [x, y] = [(a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]];
      if (k === 'nonzero' && !x === !y) continue;
      const d = close(x, y, tol, `${at}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${at}: ${String(a)} vs ${String(b)}`;
}

/** Points of a path at most `tol` from its curves. */
function flat(p: Path, tol: number): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < segments(p); k++) {
    const c = segment(p, k);
    const ddx = Math.max(Math.abs(c[0][0] - 2 * c[1][0] + c[2][0]), Math.abs(c[1][0] - 2 * c[2][0] + c[3][0]));
    const ddy = Math.max(Math.abs(c[0][1] - 2 * c[1][1] + c[2][1]), Math.abs(c[1][1] - 2 * c[2][1] + c[3][1]));
    const n = Math.min(2000, Math.max(1, Math.ceil(Math.sqrt((0.75 * Math.hypot(ddx, ddy)) / tol))));
    for (let i = 0; i < n; i++) out.push(bezier(c, i / n));
  }
  return out;
}

const SCALE = 1e5;
const poly = (f: Form | null): Paths64 =>
  (f?.paths ?? []).filter((p) => p.closed && p.nodes.length > 1).map((p) => flat(p, 0.001).map(([x, y]) => ({ x: Math.round(x * SCALE), y: Math.round(y * SCALE) })));

/** Area (mm²) where two results differ, and the length of their outlines (mm). */
function differ(a: Form | null, b: Form | null): { xor: number; length: number } {
  const c = new Clipper64();
  c.addSubject(poly(a));
  c.addClip(poly(b));
  const sol: Paths64 = [];
  c.execute(ClipType.Xor, FillRule.EvenOdd, sol);
  let xor = 0;
  for (const r of sol) {
    let s = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j].x - r[i].x) * (r[j].y + r[i].y);
    xor += s / 2;
  }
  let length = 0;
  for (const r of [...poly(a), ...poly(b)]) for (let i = 0, j = r.length - 1; i < r.length; j = i++) length += Math.hypot(r[i].x - r[j].x, r[i].y - r[j].y) / SCALE;
  return { xor: Math.abs(xor) / (SCALE * SCALE), length: length / 2 };
}

const agrees = (a: Form | null, b: Form | null) => {
  const d = differ(a, b);
  return d.xor <= 0.01 + 0.002 * d.length ? null : `differ by ${d.xor.toFixed(4)} mm² along ${d.length.toFixed(1)} mm`;
};

describe('stage 2: shapes', () => {
  it('has a corpus', () => {
    expect(fills.length).toBeGreaterThan(100);
    expect(lines.length).toBeGreaterThan(20);
  });

  it('reads SVG path data alike', () => {
    const svg = JSON.parse(unzip(readFileSync('tests/rust/fixtures/stage2-svg-shapes.json.gz'))) as { d: string; m: Mat }[];
    const extra = ['M0 0L10 0L10 10 x 20 20', 'm1 1l2 0 0 2z m5 5 h3 v3 h-3 z', 'M0 5a5 5 0 1010 0 5 5 0 10-10 0z', 'M0 0Q5 10 10 0T20 0S25 5 30 0', 'M0 0A0 5 0 0 1 10 0', 'M1e1.5.5', ''];
    for (const s of [...svg, ...extra.map((d) => ({ d, m: [1, 0, 0, 1, 0, 0] as Mat }))]) expect(close(rsSvg.parsePath(s.d, s.m), tsSvg.parsePath(s.d, s.m), 1e-9), s.d.slice(0, 60)).toBeNull();
  });

  it('joins, cuts and intersects within a hair of paper.js', () => {
    const cases: [string, Form, Form][] = [];
    for (const x of fills.filter((_, i) => i % 2 === 0)) {
      const b = bounds(x.geo)!;
      const [cx, cy, w] = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, b.maxX - b.minX];
      cases.push([`${x.design} copy`, x.geo, transformForm(x.geo, compose(translation(w * 0.3, w * 0.1), rotation(25, cx, cy)))]);
    }
    for (let i = 0; i + 1 < fills.length; i += 3) if (fills[i].design === fills[i + 1].design) cases.push([`${fills[i].design} neighbours`, fills[i].geo, fills[i + 1].geo]);
    for (const x of fills.slice(0, 10)) {
      const b = bounds(x.geo)!;
      cases.push([`${x.design} same`, x.geo, x.geo], [`${x.design} touching`, x.geo, transformForm(x.geo, translation(b.maxX - b.minX, 0))]);
    }
    const bad: string[] = [];
    for (const [name, a, b] of cases) {
      for (const [op, rs, ts] of [
        ['union', () => rsOps.unionForms([a, b]), () => tsOps.unionForms([a, b])],
        ['difference', () => rsOps.subtractForm(a, b), () => tsOps.subtractForm(a, b)],
        ['intersection', () => rsOps.intersectForms(a, b), () => tsOps.intersectForms(a, b)],
      ] as const) {
        const d = agrees(rs(), ts());
        if (d) bad.push(`${name} ${op}: ${d}`);
      }
    }
    expect(cases.length).toBeGreaterThan(80);
    expect(bad).toEqual([]);
  });

  it('measures areas alike', () => {
    for (const x of fills) {
      const [a, b] = [rsOps.areaOfForm(x.geo), tsOps.areaOfForm(x.geo)];
      expect(Math.abs(a - b), x.design).toBeLessThan(1e-6 * b + 1e-6);
    }
  });

  // The polygons are the same to the bit. The curves fitted to them run the same steps, but the
  // core's pow and Math.pow differ in the last bit for about 1 in 20 cubes, and the fit's Newton
  // steps can carry that a little further: the fitted forms are compared by area, as the booleans.
  it('offsets, bands and strokes as Clipper2 in TypeScript did', () => {
    const bad: string[] = [];
    const same = (r: Form | null, t: Form | null, what: string, exact: boolean) => {
      const d = exact ? close(r, t, 0) : !r !== !t ? 'one is empty' : agrees(r, t);
      if (d) bad.push(`${what}: ${d}`);
    };
    for (const x of fills.filter((_, i) => i % 2 === 0))
      for (const d of [1, -0.6, 3]) {
        same(rsOps.offsetForm(x.geo, d), tsOps.offsetForm(x.geo, d), `${x.design} ${d}`, false);
        same(rsOps.offsetForm(x.geo, d, 0, false), tsOps.offsetForm(x.geo, d, 0, false), `${x.design} ${d} polygons`, true);
      }
    for (const x of lines.slice(0, 40)) {
      same(rsOps.bandForm(x.geo, 0.8), tsOps.bandForm(x.geo, 0.8), `${x.design} band`, false);
      same(rsOps.bandForm(x.geo, 0.8, false), tsOps.bandForm(x.geo, 0.8, false), `${x.design} band polygons`, true);
      same(rsOps.offsetForm(x.geo, 0.5, 1), tsOps.offsetForm(x.geo, 0.5, 1), `${x.design} line offset`, false);
      for (const [cap, join] of [['butt', 'miter'], ['round', 'round'], ['square', 'bevel']] as const)
        same(rsOps.strokeForm(x.geo, 1.5, cap, join, 4), tsOps.strokeForm(x.geo, 1.5, cap, join, 4), `${x.design} ${cap}`, false);
    }
    expect(bad).toEqual([]);
  });

  it('finds the same crossings', () => {
    const bad: string[] = [];
    const forms = [...lines.map((x) => x.geo), ...fills.slice(0, 30).map((x) => ({ paths: [...x.geo.paths, ...transformForm(x.geo, translation(1.3, 0.7)).paths] }))];
    let crossed = 0;
    for (const f of forms) {
      const [r, t] = [rsOps.withCrossingNodes(f), tsOps.withCrossingNodes(f)];
      if (r) crossed++;
      if ((r?.added ?? 0) !== (t?.added ?? 0)) bad.push(`${r?.added ?? 0} vs ${t?.added ?? 0}`);
      else if (r && t) {
        const d = close(r.form, t.form, 1e-6);
        if (d) bad.push(d);
      }
    }
    expect(forms.length).toBeGreaterThan(50);
    expect(crossed).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it('cuts fills apart alike', () => {
    const bad: string[] = [];
    let split = 0;
    for (const x of fills.slice(0, 40)) {
      const b = bounds(x.geo)!;
      const y = (b.minY + b.maxY) / 2;
      const cut: Pt[][] = [Array.from({ length: 9 }, (_, i) => [b.minX - 1 + ((b.maxX - b.minX + 2) * i) / 8, y + 0.3 * Math.sin(i)] as Pt)];
      const [r, t] = [rsOps.splitForm(x.geo, cut, 0.4, 2, 2), tsOps.splitForm(x.geo, cut, 0.4, 2, 2)];
      if (!r !== !t || (r && t && r.parts.length !== t.parts.length)) {
        bad.push(`${x.design}: ${r?.parts.length} vs ${t?.parts.length} parts`);
        continue;
      }
      if (!r || !t) continue;
      split++;
      r.parts.forEach((p, i) => {
        const d = agrees(p, t.parts[i]);
        if (d) bad.push(`${x.design} part ${i}: ${d}`);
      });
      if (close(r.touching, t.touching, 0)) bad.push(`${x.design}: touching ${JSON.stringify(r.touching)} vs ${JSON.stringify(t.touching)}`);
    }
    expect(split).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it('finds the same gaps', () => {
    const sorted = (g: rsOps.GapResult) => ('form' in g ? { form: { paths: [...g.form.paths].sort((a, b) => a.nodes[0].p[0] - b.nodes[0].p[0] || a.nodes[0].p[1] - b.nodes[0].p[1]) } } : g);
    const bad: string[] = [];
    const designs = [...new Set(items.map((x) => x.design))];
    for (const name of designs) {
      const of = items.filter((x) => x.design === name);
      const obstacles: rsOps.Obstacle[] = of.map((x) => ({ form: x.geo, line: !x.fill, width: 0.8 }));
      const all = bounds({ paths: of.flatMap((x) => x.geo.paths) })!;
      for (const mode of ['closed', 'hull', 'wrap'] as const) {
        const [rf, tf] = [rsOps.gapFinder(obstacles, 0.5, mode), tsOps.gapFinder(obstacles, 0.5, mode)];
        for (let i = 0; i < 5; i++)
          for (let j = 0; j < 5; j++) {
            const at: Pt = [all.minX - 2 + ((all.maxX - all.minX + 4) * (i + 0.37)) / 5, all.minY - 2 + ((all.maxY - all.minY + 4) * (j + 0.61)) / 5];
            // Free parts outside the hull come in the order the polygon tree has them.
            const [r, t] = [sorted(rf(at)), sorted(tf(at))];
            const d = 'form' in r && 'form' in t ? agrees(r.form, t.form) : close(r, t, 0);
            if (d) bad.push(`${name} ${mode} ${at}: ${d}`);
          }
      }
    }
    expect(bad).toEqual([]);
  });

  it('simplifies, vectorizes and splits into parts alike', () => {
    for (const x of items.slice(0, 120)) {
      for (const tol of [0.3, 1.2]) expect(close(rsSimplify.simplifyForm(x.geo, tol), tsSimplify.simplifyForm(x.geo, tol), 1e-9), x.design).toBeNull();
      expect(close(rsParts.formParts(x.geo, x.fill), tsParts.formParts(x.geo, x.fill), 0), x.design).toBeNull();
    }
    for (const x of fills.slice(0, 30)) {
      const r = tsRaster.rasterize(x.geo, 0.1)!;
      for (const tol of [rsVec.FIT_TOLERANCE, rsVec.READ_TOLERANCE]) expect(close(rsVec.vectorize(r, tol), tsVec.vectorize(r, tol), 1e-9), x.design).toBeNull();
    }
    const pts: Pt[] = Array.from({ length: 80 }, (_, i) => [i * 0.3, 5 * Math.sin(i / 9) + 0.02 * Math.cos(i * 7)]);
    expect(close(rsVec.fitCubic(pts, [1, 0], [-1, 0], 0.05, true), tsVec.fitCubic(pts, [1, 0], [-1, 0], 0.05, true), 1e-9)).toBeNull();
    expect(close(rsVec.fitSingleCubic(pts, [1, 0], [-1, 0]), tsVec.fitSingleCubic(pts, [1, 0], [-1, 0]), 1e-9)).toBeNull();
  });

  it('draws bands alike', () => {
    for (const x of items.slice(0, 80))
      for (const off of [0, 1.5]) {
        expect(close(rsBand.bandEdges(x.geo, 3, off), tsBand.bandEdges(x.geo, 3, off), 1e-9), x.design).toBeNull();
        expect(close(rsBand.bandGrip(x.geo, 3, off), tsBand.bandGrip(x.geo, 3, off), 1e-9), x.design).toBeNull();
      }
  });

  it('rasters, knocks out and joins regions alike', () => {
    const same = (a: Region | null, b: Region | null, what: string) => expect(close(a, b, 0), what).toBeNull();
    const rs: Region[] = [];
    for (const x of fills.slice(0, 10)) {
      const r = rsRaster.rasterize(x.geo, 0.1);
      same(r, tsRaster.rasterize(x.geo, 0.1), x.design);
      if (r) rs.push(r);
      same(rsRaster.rasterize({ ...x.geo, nonzero: true }, 0.2), tsRaster.rasterize({ ...x.geo, nonzero: true }, 0.2), `${x.design} nonzero`);
    }
    for (const x of lines.slice(0, 10))
      for (const cap of ['round', 'flat'] as const) same(rsRaster.rasterizeStroke(x.geo, 1.2, 0.1, cap), tsRaster.rasterizeStroke(x.geo, 1.2, 0.1, cap), `${x.design} ${cap}`);
    for (let i = 0; i + 2 < rs.length; i++) {
      const covers = [rs[i + 1], rs[i + 2]];
      same(rsRaster.knockOut(rs[i], covers, 0.3), tsRaster.knockOut(rs[i], covers, 0.3), `knock out ${i}`);
      expect(rsRaster.sharedArea(rs[i], rs[i + 1])).toBe(tsRaster.sharedArea(rs[i], rs[i + 1]));
      same(rsRaster.unionOf(covers), tsRaster.unionOf(covers), `union ${i}`);
      same(rsRaster.regionOf(rs[i].mask.slice(), rs[i].x0, rs[i].y0, rs[i].w, rs[i].h, 0.1), tsRaster.regionOf(rs[i].mask.slice(), rs[i].x0, rs[i].y0, rs[i].w, rs[i].h, 0.1), `region ${i}`);
    }
    // Nothing hidden: the region itself.
    expect(rsRaster.knockOut(rs[0], [], 0.3)).toBe(rs[0]);
  });
});
