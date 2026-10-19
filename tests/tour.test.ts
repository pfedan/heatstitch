import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/digitize/skeleton';
import { tour, tourPart, type Step, type Touch, type TourInput } from '../src/digitize/tour';

/** A small seeded random source, so a failing case can be replayed. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * An area cut into `parts` parts, each a chain of sections (some with a branch), spread over the
 * hoop, entered at two points per side. The way inside is longer than the straight line, as the
 * travel grid's is.
 */
function area(seed: number, parts: number): { input: TourInput<number>; start: Pt } {
  const rnd = random(seed);
  const touches: Touch[][] = [];
  const centre: Pt[] = [];
  for (let k = 0; k < parts; k++) {
    const at: Pt = [rnd() * 100, rnd() * 100];
    const n = 1 + Math.floor(rnd() * 5);
    const first = touches.length;
    for (let i = 0; i < n; i++) {
      touches.push([]);
      centre.push([at[0] + i * 3, at[1] + rnd() * 2]);
    }
    for (let i = 1; i < n; i++) {
      const a = first + (i > 2 && rnd() < 0.3 ? i - 2 : i - 1);
      const b = first + i;
      const mid: Pt = [(centre[a][0] + centre[b][0]) / 2, (centre[a][1] + centre[b][1]) / 2];
      const width = 1 + rnd() * 4;
      touches[a].push({ to: b, side: 1, at: mid, width });
      touches[b].push({ to: a, side: 0, at: mid, width });
    }
  }
  const ends = centre.map((c) => [0, 1].map((side) => [0, 1].map((e): Pt => [c[0] + (side ? 1.5 : -1.5), c[1] + (e ? 1 : -1) * rnd() * 2])));
  const input: TourInput<number> = {
    touches,
    dist: (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) * 1.2,
    ways: (i, from) => ends[i][from].map((p, e) => ({ w: e, p, exit: ends[i][1 - from][e] })),
  };
  return { input, start: [0, 0] };
}

/** The order of several parts as it was chosen before the bound: every part toured at every step. */
function everyPart(input: TourInput<number>, start: Pt): Step<number>[] {
  const seen = new Uint8Array(input.touches.length);
  const ps: number[][] = [];
  for (let i = 0; i < input.touches.length; i++) {
    if (seen[i]) continue;
    const part = [i];
    seen[i] = 1;
    for (let j = 0; j < part.length; j++) for (const t of input.touches[part[j]]) if (!seen[t.to]) (seen[t.to] = 1), part.push(t.to);
    ps.push(part);
  }
  const left = ps.slice();
  const order: number[][] = [];
  let pos = start;
  while (left.length) {
    let bi = 0;
    let bt: ReturnType<typeof tourPart<number>> | null = null;
    left.forEach((part, i) => {
      const t = tourPart(part, input, pos);
      if (!bt || t.cost < bt.cost) {
        bt = t;
        bi = i;
      }
    });
    order.push(left.splice(bi, 1)[0]);
    pos = bt!.pos;
  }
  let at = start;
  return order.flatMap((part) => {
    const t = tourPart(part, input, at);
    at = t.pos;
    return t.steps;
  });
}

describe('tour of an area in many parts', () => {
  it('picks the same order as touring every part at every step', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { input, start } = area(seed, 6 + (seed % 30));
      expect(tour(input, start), `seed ${seed}`).toEqual(everyPart(input, start));
    }
  });

  it('tours far fewer parts than all of them at every step', () => {
    const { input, start } = area(7, 80);
    let calls = 0;
    const ways = input.ways;
    const counted: TourInput<number> = { ...input, ways: (i, from) => (calls++, ways(i, from)) };
    tour(counted, start);
    const bounded = calls;
    calls = 0;
    everyPart(counted, start);
    expect(bounded).toBeLessThan(calls / 5);
  });
});
