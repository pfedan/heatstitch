import { describe, expect, it } from 'vitest';
import { satinMask } from '../src/validation/satin';
import {
  CAUTION,
  classify,
  CRITICAL,
  SAFE,
  validatePattern,
  type Level,
  type ValidationResult,
} from '../src/validation/validate';
import { Shape } from './helpers/shapes';

/** Levels of all cells whose centre lies inside the rectangle shrunk by `inset` mm. */
function interior(r: ValidationResult, x0: number, y0: number, w: number, h: number, inset = 2): Level[] {
  const out: Level[] = [];
  for (let cy = 0; cy < r.rows; cy++) {
    for (let cx = 0; cx < r.cols; cx++) {
      const x = r.originX + cx + 0.5;
      const y = r.originY + cy + 0.5;
      if (x > x0 + inset && x < x0 + w - inset && y > y0 + inset && y < y0 + h - inset) {
        out.push(r.level[cy * r.cols + cx] as Level);
      }
    }
  }
  return out;
}

const layers = (n: number, x0 = 5, y0 = 5, s = new Shape()) => {
  for (let i = 0; i < n; i++) s.fill(x0, y0, 20, 20, i % 2 ? 'v' : 'h');
  return s;
};

describe('classify', () => {
  it('applies the thread length boundaries', () => {
    expect(classify(5.99, false)).toBe(SAFE);
    expect(classify(6.0, false)).toBe(CAUTION);
    expect(classify(9.99, false)).toBe(CAUTION);
    expect(classify(10.0, false)).toBe(CRITICAL);
    expect(classify(25, false)).toBe(CRITICAL);
  });

  it('lets satin cells stay safe up to 7.5', () => {
    expect(classify(6.5, true)).toBe(SAFE);
    expect(classify(7.49, true)).toBe(SAFE);
    expect(classify(7.5, true)).toBe(CAUTION);
    expect(classify(10, true)).toBe(CRITICAL);
  });
});

describe('density tiers', () => {
  it('flags 4 stacked layers at 0.4 mm as CRITICAL', () => {
    const r = validatePattern(layers(4).build());
    const lv = interior(r, 5, 5, 20, 20);
    expect(lv.length).toBeGreaterThan(200);
    expect(lv.every((l) => l === CRITICAL)).toBe(true);
    expect(r.zones.filter((z) => z.level === CRITICAL)).toHaveLength(1);
    expect(r.critical.length).toBeGreaterThan(0);
  });

  it('flags 3 layers as CAUTION, never CRITICAL', () => {
    const r = validatePattern(layers(3).build());
    expect(interior(r, 5, 5, 20, 20).every((l) => l === CAUTION)).toBe(true);
    expect(r.critical.length).toBe(0);
    expect(r.zones.map((z) => z.level)).toEqual([CAUTION]);
  });

  it('does not warn for 2 layers, same or crossed direction', () => {
    const same = new Shape().fill(5, 5, 20, 20, 'h').fill(5, 5, 20, 20, 'h').build();
    const crossed = layers(2).build();
    for (const p of [same, crossed]) {
      const r = validatePattern(p);
      expect(r.zones).toEqual([]);
      expect(r.maxDensity).toBeLessThan(6);
    }
  });

  it('reports separate zones for separate patches', () => {
    const s = layers(4, 5, 5);
    layers(4, 40, 5, s);
    const r = validatePattern(s.build());
    expect(r.zones.filter((z) => z.level === CRITICAL)).toHaveLength(2);
    const [a, b] = r.zones.map((z) => z.bbox.minX).sort((m, n) => m - n);
    expect(a).toBeLessThan(10);
    expect(b).toBeGreaterThan(35);
  });
});

describe('satin exception', () => {
  it('detects zigzag columns but not fill rows', () => {
    const satin = new Shape().satin(0, 0, 10, 5, 0.4).build();
    const fill = new Shape().fill(0, 0, 10, 10, 'h').build();
    const share = (m: Uint8Array) => m.reduce((s, v) => s + v, 0) / m.length;
    expect(share(satinMask(satin))).toBeGreaterThan(0.85);
    expect(share(satinMask(fill))).toBe(0);
  });

  it('keeps a dense satin over one base layer safe, but not the same density from fills', () => {
    const satinOverFill = new Shape().fill(5, 5, 20, 6, 'h').satin(5, 5, 20, 6, 0.25).build();
    const r1 = validatePattern(satinOverFill);
    const inner1 = interior(r1, 5, 5, 20, 6, 1.5);
    expect(inner1.length).toBeGreaterThan(30);
    expect(r1.maxDensity).toBeGreaterThan(6);
    expect(inner1.every((l) => l === SAFE)).toBe(true);

    const fillOverFill = new Shape().fill(5, 5, 20, 6, 'h').fill(5, 5, 20, 6, 'v', 0.25).build();
    const r2 = validatePattern(fillOverFill);
    expect(interior(r2, 5, 5, 20, 6, 1.5).every((l) => l === CAUTION)).toBe(true);
  });
});

describe('short-stitch clusters', () => {
  /** Running stitch along y = 10.5 with `n` 0.4 mm back-and-forth stitches at x ~ 10.5. */
  const line = (n: number, mode: 'middle' | 'beforeTrim' | 'afterJump') => {
    const s = new Shape().to(0, 10.5);
    for (let x = 3; x <= 9; x += 3) s.to(x, 10.5);
    if (mode === 'afterJump') s.jump(10.2, 10.5).to(10.2, 10.5);
    else s.to(10.2, 10.5);
    for (let k = 1; k <= n; k++) s.to(k % 2 ? 10.6 : 10.2, 10.5);
    if (mode === 'beforeTrim') s.trim().jump(30, 10.5).to(30, 10.5);
    for (let x = 13; x <= 25; x += 3) s.to(x, 10.5);
    return validatePattern(s.build());
  };

  it('flags 10 short stitches in the middle of a run as CRITICAL', () => {
    const r = line(10, 'middle');
    const crit = r.zones.filter((z) => z.level === CRITICAL);
    expect(crit).toHaveLength(1);
    expect(crit[0].reasons).toContain('shortStitches');
    expect(crit[0].bbox.minX).toBeCloseTo(9.95, 5); // cells start 0.05 mm before whole millimetres
  });

  it('ignores tie-offs before a trim and tie-ins after a jump', () => {
    expect(line(10, 'beforeTrim').critical.length).toBe(0);
    expect(line(10, 'afterJump').critical.length).toBe(0);
  });

  it('ignores fewer than 8 short stitches', () => {
    expect(line(7, 'middle').critical.length).toBe(0);
  });
});
