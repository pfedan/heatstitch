import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, normalizeProfile, recommendedSpacing, type Profile } from '../src/validation/profiles';
import { satinMask } from '../src/validation/satin';
import { BASE, classifyDensity, densityLimits, thresholdsFor } from '../src/validation/thresholds';
import {
  CAUTION,
  classify,
  CRITICAL,
  measurePattern,
  normalizeChecks,
  SAFE,
  validatePattern,
  type Level,
  type ValidationResult,
} from '../src/validation/validate';
import { Shape } from './helpers/shapes';

const WOVEN: Profile = DEFAULT_PROFILE;
const LEATHER: Profile = { fabric: 'leather', thread: '40' };

/** Levels of all cells whose centre lies inside the rectangle (x0, y0) .. (x1, y1). */
function levelsIn(r: ValidationResult, x0: number, y0: number, x1: number, y1: number): Level[] {
  const m = r.measurement;
  const out: Level[] = [];
  for (let cy = 0; cy < m.rows; cy++) {
    for (let cx = 0; cx < m.cols; cx++) {
      const x = m.originX + cx + 0.5;
      const y = m.originY + cy + 0.5;
      if (x > x0 && x < x1 && y > y0 && y < y1) out.push(r.level[cy * m.cols + cx] as Level);
    }
  }
  return out;
}

/** Highest measured density of the cells inside the rectangle. */
function peakIn(r: ValidationResult, x0: number, y0: number, x1: number, y1: number): number {
  const m = r.measurement;
  let max = 0;
  for (let cy = 0; cy < m.rows; cy++) {
    for (let cx = 0; cx < m.cols; cx++) {
      const x = m.originX + cx + 0.5;
      const y = m.originY + cy + 0.5;
      if (x > x0 && x < x1 && y > y0 && y < y1) max = Math.max(max, m.density[cy * m.cols + cx]);
    }
  }
  return max;
}

/** Interior of the 20 x 20 mm square centred at (20, 20) used by the fill fixtures. */
const inner = (r: ValidationResult) => levelsIn(r, 14, 14, 26, 26);
const all = (levels: Level[], l: Level) => levels.length > 50 && levels.every((v) => v === l);

/** One fill layer at `angle` with a 2 mm underlay across it. */
const fillWithUnderlay = (s: Shape, angle: number, spacing = 0.4) =>
  s.fillAt(20, 20, 10, angle + Math.PI / 2, 2, 3).fillAt(20, 20, 10, angle, spacing);

/** `n` fill layers at varied angles, without underlay. */
const layers = (n: number, s = new Shape()) => {
  for (let i = 0; i < n; i++) s.fillAt(20, 20, 10, i * 0.8 + 0.2);
  return s;
};

describe('thresholds and profiles', () => {
  it('blends the limits by satin share', () => {
    const th = thresholdsFor(WOVEN);
    expect(densityLimits(th, 0)).toEqual([BASE.caution, BASE.critical]);
    expect(densityLimits(th, 1)).toEqual([BASE.satinCaution, BASE.satinCritical]);
    expect(classifyDensity(6.99, 0, th)).toBe(SAFE);
    expect(classifyDensity(7, 0, th)).toBe(CAUTION);
    expect(classifyDensity(9.5, 0, th)).toBe(CRITICAL);
    expect(classifyDensity(9.5, 1, th)).toBe(SAFE);
    expect(classifyDensity(9.5, 0.5, th)).toBe(CAUTION);
  });

  it('scales the limits with fabric and thread', () => {
    expect(thresholdsFor({ fabric: 'knit', thread: '40' }).caution).toBeCloseTo(7 * 0.85);
    expect(thresholdsFor({ fabric: 'woven', thread: '12' }).critical).toBeCloseTo(9.5 * 0.5);
    expect(thresholdsFor({ fabric: 'terry', thread: '30' }).factor).toBeCloseTo(0.65 * 0.8);
    expect(thresholdsFor(WOVEN).holes).toBeNull();
    expect(thresholdsFor(LEATHER).holes).not.toBeNull();
  });

  it('widens the recommended spacing for thick thread', () => {
    expect(recommendedSpacing(WOVEN)).toEqual([0.4, 0.45]);
    const [a, b] = recommendedSpacing({ fabric: 'woven', thread: '12' });
    expect(a).toBeCloseTo(0.8);
    expect(b).toBeCloseTo(0.9);
  });

  it('falls back to the defaults for unknown ids', () => {
    expect(normalizeProfile({ fabric: 'kevlar' as never, thread: '30' })).toEqual({ fabric: 'woven', thread: '30' });
    expect(normalizeProfile(undefined)).toEqual(DEFAULT_PROFILE);
  });
});

describe('density tiers (40 wt on woven)', () => {
  it('keeps a single fill with underlay and two stacked fills with underlay Safe', () => {
    expect(validatePattern(fillWithUnderlay(new Shape(), 0.3).build(), WOVEN).zones).toEqual([]);
    const two = fillWithUnderlay(fillWithUnderlay(new Shape(), 0.3), 1.1).build();
    const r = validatePattern(two, WOVEN);
    expect(r.zones).toEqual([]);
    expect(peakIn(r, 14, 14, 26, 26)).toBeGreaterThan(5.9);
  });

  it('flags 3 layers as CAUTION and 4 layers as CRITICAL at any angle', () => {
    expect(all(inner(validatePattern(layers(3).build(), WOVEN)), CAUTION)).toBe(true);
    const r = validatePattern(layers(4).build(), WOVEN);
    expect(all(inner(r), CRITICAL)).toBe(true);
    expect(r.zones.filter((z) => z.level === CRITICAL)).toHaveLength(1);
    expect(r.zones[0].reasons).toEqual(['density']);
  });

  it('reports separate zones for separate patches, worst first', () => {
    const s = layers(4);
    for (let i = 0; i < 3; i++) s.fillAt(60, 20, 10, i);
    const r = validatePattern(s.build(), WOVEN);
    expect(r.zones.map((z) => z.level)).toEqual([CRITICAL, CAUTION]);
    expect(r.zones[0].bbox.maxX).toBeLessThan(35);
    expect(r.zones[1].bbox.minX).toBeGreaterThan(45);
    expect(r.worst).toBe(CRITICAL);
    expect(r.criticalCells).toBeGreaterThan(300);
    expect(r.stitchedCells).toBeGreaterThan(r.criticalCells + r.cautionCells);
  });
});

describe('satin', () => {
  it('detects zigzag columns but not fill rows', () => {
    const satin = new Shape().satin(0, 0, 10, 5, 0.4).build();
    const fill = new Shape().fill(0, 0, 10, 10, 'h').build();
    const share = (m: Uint8Array) => m.reduce((s, v) => s + v, 0) / m.length;
    expect(share(satinMask(satin))).toBeGreaterThan(0.85);
    expect(share(satinMask(fill))).toBe(0);
  });

  it('keeps a satin border over a fill (both with underlay) Safe', () => {
    for (const w of [1.2, 2, 4]) {
      const s = fillWithUnderlay(new Shape(), 0.3).satin(12, 18.3, 16, w - 0.6, 4).satin(12, 18, 16, w, 0.4);
      const r = validatePattern(s.build(), WOVEN);
      expect(r.zones, `width ${w}`).toEqual([]);
    }
  });

  it('flags the same density built from fills, and a satin over two fills', () => {
    const satinOverTwo = layers(2).satin(12, 18, 16, 4, 0.4).build();
    expect(levelsIn(validatePattern(satinOverTwo, WOVEN), 14, 18, 26, 22).every((l) => l !== SAFE)).toBe(true);
  });

  it('measures narrow columns at their peak instead of averaging them away', () => {
    // 1.2 mm satin (lettering) over a fill: nominally 5 + 3 = 8 mm/mm². A 1 mm cell mean reads ~5.
    const s = fillWithUnderlay(new Shape(), 0.3).satin(12, 18, 16, 1.2, 0.4);
    expect(peakIn(validatePattern(s.build(), WOVEN), 14, 18, 26, 19.2)).toBeGreaterThan(6.5);
  });
});

describe('profiles change the verdict without re-measuring', () => {
  const m = measurePattern(fillWithUnderlay(fillWithUnderlay(new Shape(), 0.3), 1.1).build());

  it('two stacked fills: Safe on woven, Caution on knit, Critical with 12 wt', () => {
    expect(classify(m, WOVEN).worst).toBe(SAFE);
    expect(classify(m, { fabric: 'knit', thread: '40' }).worst).toBe(CAUTION);
    expect(classify(m, { fabric: 'woven', thread: '12' }).worst).toBe(CRITICAL);
  });

  it('a 60 wt profile tolerates more than 40 wt', () => {
    const three = measurePattern(layers(3).build());
    expect(classify(three, WOVEN).worst).toBe(CAUTION);
    expect(classify(three, { fabric: 'woven', thread: '60' }).worst).toBe(SAFE);
  });
});

describe('perforation (leather)', () => {
  const satin = (spacing: number) => new Shape().satin(10, 18, 20, 4, spacing).build();

  it('accepts satin edges at leather spacing', () => {
    for (const sp of [0.4, 0.5, 0.6]) expect(validatePattern(satin(sp), LEATHER).zones, `spacing ${sp}`).toEqual([]);
  });

  it('flags tight hole rows and stacked edges', () => {
    const tight = validatePattern(satin(0.25), LEATHER);
    expect(tight.worst).toBe(CAUTION);
    expect(tight.zones[0].reasons).toContain('perforation');
    expect(tight.zones[0].maxHoles).toBeGreaterThanOrEqual(6);
    expect(validatePattern(satin(0.15), LEATHER).worst).toBe(CRITICAL);
  });

  it('never checks perforation on woven fabric', () => {
    const r = validatePattern(satin(0.15), WOVEN);
    expect(r.zones.flatMap((z) => z.reasons)).not.toContain('perforation');
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
    return validatePattern(s.build(), WOVEN);
  };

  it('flags 10 short stitches in the middle of a run as CRITICAL', () => {
    const r = line(10, 'middle');
    const crit = r.zones.filter((z) => z.level === CRITICAL);
    expect(crit).toHaveLength(1);
    expect(crit[0].reasons).toContain('shortStitches');
    expect(crit[0].maxShorts).toBe(10);
    expect(crit[0].bbox.minX).toBeCloseTo(9.95, 5); // cells start 0.05 mm before whole millimetres
  });

  it('ignores tie-offs before a trim and tie-ins after a jump', () => {
    expect(line(10, 'beforeTrim').criticalCells).toBe(0);
    expect(line(10, 'afterJump').criticalCells).toBe(0);
  });

  it('only exempts the first 6 stitches of a long run after a jump', () => {
    expect(line(14, 'afterJump').criticalCells).toBe(1);
  });

  it('ignores fewer than 8 short stitches', () => {
    expect(line(7, 'middle').criticalCells).toBe(0);
  });

  it('flags nothing when the short-stitch check is off', () => {
    const off = { density: true, shortStitches: false, perforation: true };
    const r = classify(line(10, 'middle').measurement, WOVEN, off);
    expect(r.criticalCells).toBe(0);
  });
});

describe('switching checks off', () => {
  const four = measurePattern(layers(4).build());
  const satin = measurePattern(new Shape().satin(10, 18, 20, 4, 0.15).build());

  it('defaults every check to on, also for old stored settings', () => {
    expect(normalizeChecks(undefined)).toEqual({ density: true, shortStitches: true, perforation: true });
    const partial = normalizeChecks({ shortStitches: false });
    expect(partial).toEqual({ density: true, shortStitches: false, perforation: true });
  });

  it('drops density zones when the density check is off', () => {
    expect(classify(four, WOVEN).worst).toBe(CRITICAL);
    const r = classify(four, WOVEN, { density: false, shortStitches: true, perforation: true });
    expect(r.zones.flatMap((z) => z.reasons)).not.toContain('density');
  });

  it('drops perforation zones when the perforation check is off', () => {
    expect(classify(satin, LEATHER).zones.flatMap((z) => z.reasons)).toContain('perforation');
    const r = classify(satin, LEATHER, { density: true, shortStitches: true, perforation: false });
    expect(r.zones.flatMap((z) => z.reasons)).not.toContain('perforation');
  });
});
