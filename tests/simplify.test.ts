import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/digitize/skeleton';
import { flatten, nearestOnForm, type Form, type Node } from '../src/shape/path';
import { nodeCount, simplifyForm, simplifyMore } from '../src/shape/simplify';

const corner = (p: Pt): Node => ({ p, a: [...p] as Pt, b: [...p] as Pt, smooth: false });

/** A round blob traced as many little straight-ish smooth curves, as a vectorized photo area comes. */
function wobbly(n: number, r: number, jitter: number): Form {
  const nodes: Node[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    const rr = r + jitter * Math.sin(i * 7.3);
    const p: Pt = [rr * Math.cos(t), rr * Math.sin(t)];
    const d = (2 * Math.PI * rr) / n / 3;
    nodes.push({ p, a: [p[0] + d * Math.sin(t), p[1] - d * Math.cos(t)], b: [p[0] - d * Math.sin(t), p[1] + d * Math.cos(t)], smooth: true });
  }
  return { paths: [{ closed: true, nodes }] };
}

/** Largest distance of the points of `a` from the outline of `b` (mm). */
function maxOff(a: Form, b: Form): number {
  let max = 0;
  for (const p of a.paths) for (const q of flatten(p, 0.05)) max = Math.max(max, nearestOnForm(b, q)!.d);
  return max;
}

describe('simplify a form', () => {
  it('fits a busy round outline with far fewer nodes, close to where it was', () => {
    const f = wobbly(80, 10, 0.05);
    const s = simplifyForm(f, 0.3)!;
    expect(s).not.toBeNull();
    expect(nodeCount(s)).toBeLessThan(20);
    expect(maxOff(f, s)).toBeLessThan(0.35);
    expect(maxOff(s, f)).toBeLessThan(0.35);
  });

  it('keeps corners where they are, as corners', () => {
    // A square with extra nodes on its sides.
    const pts: Pt[] = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10], [0, 5]];
    const f: Form = { paths: [{ closed: true, nodes: pts.map((p, i) => ({ ...corner(p), smooth: i % 2 === 1 })) }] };
    const s = simplifyForm(f, 0.3)!;
    expect(nodeCount(s)).toBe(4);
    expect(s.paths[0].nodes.map((n) => n.p)).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(s.paths[0].nodes.every((n) => !n.smooth)).toBe(true);
  });

  it('keeps the ends of an open line', () => {
    const nodes: Node[] = [];
    for (let i = 0; i <= 30; i++) nodes.push({ ...corner([i, Math.sin(i / 5) * 3]), smooth: i > 0 && i < 30 });
    const f: Form = { paths: [{ closed: false, nodes }] };
    const s = simplifyForm(f, 0.3)!;
    expect(nodeCount(s)).toBeLessThan(10);
    expect(s.paths[0].closed).toBe(false);
    expect(s.paths[0].nodes[0].p).toEqual([0, 0]);
    expect(s.paths[0].nodes[s.paths[0].nodes.length - 1].p).toEqual(nodes[30].p);
  });

  it('says so when nothing gets simpler, and goes further when pressed again', () => {
    const square: Form = { paths: [{ closed: true, nodes: [corner([0, 0]), corner([10, 0]), corner([10, 10]), corner([0, 10])] }] };
    expect(simplifyMore(square)).toBeNull();
    const f = wobbly(80, 10, 0.5);
    const once = simplifyMore(f)!;
    const twice = simplifyMore(once);
    expect(nodeCount(once)).toBeLessThan(80);
    if (twice) expect(nodeCount(twice)).toBeLessThan(nodeCount(once));
  });
});
