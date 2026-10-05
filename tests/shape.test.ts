import { describe, expect, it } from 'vitest';
import type { Region } from '../src/digitize/region';
import type { Pt } from '../src/digitize/skeleton';
import { formArea, formFrom, insertNode, moveHandle, moveNode, removeNode, rotation, setSmooth, storeForm, transformForm, type Form, type Node } from '../src/shape/path';
import { rasterize } from '../src/shape/rasterize';
import { vectorize } from '../src/shape/vectorize';

const corner = (p: Pt): Node => ({ p, a: [...p] as Pt, b: [...p] as Pt, smooth: false });
const rect = (x: number, y: number, w: number, h: number) => ({ closed: true, nodes: [corner([x, y]), corner([x + w, y]), corner([x + w, y + h]), corner([x, y + h])] });

/** A circle from four curves (the usual 0.5523 handle length). */
function circle(cx: number, cy: number, r: number) {
  const k = 0.5523 * r;
  const node = (x: number, y: number, dx: number, dy: number): Node => ({ p: [x, y], a: [x - dx, y - dy], b: [x + dx, y + dy], smooth: true });
  return { closed: true, nodes: [node(cx + r, cy, 0, k), node(cx, cy + r, -k, 0), node(cx - r, cy, 0, -k), node(cx, cy - r, k, 0)] };
}

/** Share of pixels on in either region that are on in both (in world positions). */
function overlap(a: Region, b: Region): number {
  const on = (r: Region, x: number, y: number) => {
    const u = Math.floor(x / r.pxMm) - r.x0;
    const v = Math.floor(y / r.pxMm) - r.y0;
    return u >= 0 && v >= 0 && u < r.w && v < r.h && r.mask[v * r.w + u] === 1;
  };
  let both = 0;
  let either = 0;
  for (const r of [a, b]) {
    for (let v = 0; v < r.h; v++) {
      for (let u = 0; u < r.w; u++) {
        const x = (u + r.x0 + 0.5) * r.pxMm;
        const y = (v + r.y0 + 0.5) * r.pxMm;
        const ia = on(a, x, y);
        const ib = on(b, x, y);
        if (r === b && ia) continue;
        if (ia || ib) either++;
        if (ia && ib) both++;
      }
    }
  }
  return both / either;
}

describe('rasterize', () => {
  it('fills a rectangle with its area and leaves holes open', () => {
    const r = rasterize({ paths: [rect(10, 10, 20, 10)] })!;
    expect(r.areaMm2).toBeCloseTo(200, 0);
    const holed = rasterize({ paths: [rect(10, 10, 20, 10), rect(15, 12, 5, 5)] })!;
    expect(holed.areaMm2).toBeCloseTo(175, 0);
  });

  it('gives a circle the area of a circle', () => {
    const r = rasterize({ paths: [circle(20, 20, 8)] })!;
    expect(r.areaMm2 / (Math.PI * 64)).toBeGreaterThan(0.99);
    expect(r.areaMm2 / (Math.PI * 64)).toBeLessThan(1.01);
  });
});

describe('vectorize', () => {
  it('traces a rectangle as four corners', () => {
    const r = rasterize({ paths: [rect(10, 10, 20, 10)] })!;
    const f = vectorize(r);
    expect(f.paths).toHaveLength(1);
    expect(f.paths[0].nodes.filter((n) => !n.smooth)).toHaveLength(4);
    expect(f.paths[0].nodes.length).toBeLessThanOrEqual(8);
  });

  it('traces a ring with its hole and few nodes, and rasters back to the same pixels', () => {
    const r = rasterize({ paths: [circle(20, 20, 10), circle(20, 20, 4)] })!;
    const f = vectorize(r);
    expect(f.paths).toHaveLength(2);
    for (const p of f.paths) expect(p.nodes.length).toBeLessThanOrEqual(12);
    const back = rasterize(f)!;
    expect(overlap(r, back)).toBeGreaterThan(0.98);
    expect(Math.abs(back.areaMm2 - r.areaMm2) / r.areaMm2).toBeLessThan(0.02);
  });

  it('does not drift: the form is traced once, and the same form always gives the same pixels', () => {
    const r = rasterize({ paths: [circle(20, 20, 7)] })!;
    const f = vectorize(r);
    const a = rasterize(f)!;
    const there = transformForm(transformForm(f, [1, 0, 0, 1, 3, 2]), [1, 0, 0, 1, -3, -2]);
    expect(rasterize(there)!.mask).toEqual(a.mask);
    expect(overlap(r, a)).toBeGreaterThan(0.96);
  });
});

describe('editing a form', () => {
  const sq: Form = { paths: [rect(0, 0, 10, 10)] };

  it('inserts a node without changing the outline and removes it again', () => {
    const { form, node } = insertNode(sq, 0, 0, 0.5);
    expect(form.paths[0].nodes).toHaveLength(5);
    expect(form.paths[0].nodes[node].p).toEqual([5, 0]);
    expect(formArea(form)).toBeCloseTo(100, 3);
    const back = removeNode(form, 0, node)!;
    expect(formArea(back)).toBeCloseTo(100, 3);
    // A closed path keeps at least three nodes.
    const tri = removeNode(sq, 0, 0)!;
    expect(removeNode(tri, 0, 0)).toBeNull();
  });

  it('splits a curve exactly', () => {
    const c: Form = { paths: [circle(0, 0, 5)] };
    const { form } = insertNode(c, 0, 1, 0.3);
    expect(formArea(form)).toBeCloseTo(formArea(c), 3);
  });

  it('moves nodes and handles, keeps smooth nodes smooth', () => {
    const moved = moveNode(sq, 0, 2, [12, 10]);
    expect(formArea(moved)).toBeCloseTo(110, 3);
    const round = setSmooth(sq, 0, 1, true);
    const n = round.paths[0].nodes[1];
    expect(n.smooth).toBe(true);
    const turned = moveHandle(round, 0, 1, 'b', [n.p[0] + 3, n.p[1] + 3]);
    const m = turned.paths[0].nodes[1];
    // The other handle points the opposite way.
    const ca = [m.a[0] - m.p[0], m.a[1] - m.p[1]];
    const cb = [m.b[0] - m.p[0], m.b[1] - m.p[1]];
    expect(ca[0] * cb[1] - ca[1] * cb[0]).toBeCloseTo(0, 6);
    expect(ca[0] * cb[0] + ca[1] * cb[1]).toBeLessThan(0);
    expect(setSmooth(round, 0, 1, false).paths[0].nodes[1].a).toEqual([10, 0]);
  });

  it('turns without changing the area', () => {
    const turned = transformForm(sq, rotation(30, 5, 5));
    expect(formArea(turned)).toBeCloseTo(100, 3);
  });

  it('stores and reads back', () => {
    const f: Form = { paths: [circle(3, 4, 5), rect(1, 1, 2, 2)] };
    const back = formFrom(JSON.parse(JSON.stringify(storeForm(f))))!;
    expect(formArea(back)).toBeCloseTo(formArea(f), 2);
    expect(formFrom([{ c: true, n: [1, 2, 3] }])).toBeNull();
    expect(formFrom('x')).toBeNull();
  });
});
