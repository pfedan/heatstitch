import { describe, expect, it } from 'vitest';
import { digitize, digitizeDefaults, type DigitizeOptions } from '../src/digitize/digitize';
import { DEFAULT_PREPARE, Preparer, type PrepareOptions } from '../src/image/prepare';
import { COLOR_CHANGE, STITCH, TRIM, type Pattern } from '../src/model/pattern';
import { FILL, SATIN, stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { CRITICAL, validatePattern } from '../src/validation/validate';
import { writePattern } from '../src/writers';
import { BLACK, BLUE, RED, WHITE, shape, type Rgba } from './helpers/images';

const CLEAR: Rgba = [0, 0, 0, 0];

/** Image of `mm` x `mm` at 10 px per mm with a shape test in mm. */
function design(mm: number, test: (x: number, y: number) => Rgba | null, o: Partial<PrepareOptions> = {}, d: Partial<DigitizeOptions> = {}) {
  const px = mm * 10;
  const img = shape(px, px, (x, y) => test(x / 10, y / 10), WHITE);
  const prep = new Preparer(img).run({ ...DEFAULT_PREPARE, widthMm: mm, ...o });
  return { prep, ...digitize(prep, { ...digitizeDefaults(DEFAULT_PROFILE), ...d }, 'test') };
}

function kindShare(p: Pattern): Record<number, number> {
  const kinds = stitchKinds(p);
  const n: Record<number, number> = {};
  let total = 0;
  for (const k of kinds) {
    if (!k) continue;
    n[k] = (n[k] ?? 0) + 1;
    total++;
  }
  for (const k in n) n[k] /= total;
  return n;
}

/** STITCH records in mm (pattern coordinates are centered on the design). */
function stitches(p: Pattern, mm: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < p.cmd.length; i++) if (p.cmd[i] === STITCH) out.push([p.x[i] / 10 + mm / 2, p.y[i] / 10 + mm / 2]);
  return out;
}

function roundTrips(p: Pattern): void {
  for (const format of ['pes', 'dst'] as const) {
    const back = parsePattern(writePattern(p, format), `x.${format}`);
    expect(back.cmd.filter((c) => c === STITCH).length).toBe(p.cmd.filter((c) => c === STITCH).length);
  }
}

const noCritical = (p: Pattern) => validatePattern(p, DEFAULT_PROFILE).zones.filter((z) => z.level === CRITICAL && !z.practice);

describe('digitize', () => {
  it('fills a large shape with tatami and underlay, inside its outline', () => {
    const { pattern, objects } = design(40, (x, y) => (x > 5 && x < 35 && y > 8 && y < 32 ? RED : null));
    expect(objects.map((o) => o.kind)).toEqual(['fill']);
    // The rest is underlay and travel (running stitch).
    expect(kindShare(pattern)[FILL]).toBeGreaterThan(0.5);
    for (const [x, y] of stitches(pattern, 40)) {
      expect(x).toBeGreaterThan(5 - 0.6);
      expect(x).toBeLessThan(35 + 0.6);
      expect(y).toBeGreaterThan(8 - 0.6);
      expect(y).toBeLessThan(32 + 0.6);
    }
    // 30 x 24 mm at 0.4 mm rows and 4 mm stitches: about 1 stitch per 1.6 mm² plus underlay.
    const n = stitches(pattern, 40).length;
    expect(n).toBeGreaterThan(400);
    expect(n).toBeLessThan(1000);
    expect(noCritical(pattern)).toEqual([]);
    roundTrips(pattern);
  });

  it('leaves holes free', () => {
    const { pattern } = design(40, (x, y) => {
      const outer = x > 5 && x < 35 && y > 5 && y < 35;
      // Transparent: a white hole would be sewn in white.
      if (Math.hypot(x - 20, y - 20) < 7) return CLEAR;
      return outer ? BLUE : null;
    });
    // Rows end at the hole's edge, lengthened by the pull compensation (0.2 mm).
    for (const [x, y] of stitches(pattern, 40)) expect(Math.hypot(x - 20, y - 20)).toBeGreaterThan(7 - 0.6);
  });

  it('sews a narrow ring as a satin column', () => {
    const { prep } = design(40, () => null);
    expect(prep.palette.length).toBe(0);
    const ring = (x: number, y: number) => {
      const d = Math.hypot(x - 20, y - 20);
      return d > 12 && d < 15 ? BLACK : null;
    };
    const { pattern, objects } = design(40, ring);
    // The white inside the ring is not connected to the background, so it is sewn (like eyes).
    expect(objects.map((o) => o.kind)).toEqual(['fill', 'satin']);
    expect(pattern.colors.map((c) => c.name)).toEqual(['White', 'Black']);
    // The satin covers the ring: penetrations sit on both edges (plus pull compensation).
    const black = pattern.cmd.indexOf(COLOR_CHANGE);
    const r = stitches({ ...pattern, cmd: pattern.cmd.map((c, i) => (i < black ? 0xff : c)) }, 40).map(([x, y]) => Math.hypot(x - 20, y - 20));
    expect(Math.min(...r)).toBeGreaterThan(11.4);
    expect(Math.max(...r)).toBeLessThan(15.6);
    expect(r.filter((d) => d > 14.5).length).toBeGreaterThan(100);
    expect(r.filter((d) => d < 12.5).length).toBeGreaterThan(100);
    expect(noCritical(pattern)).toEqual([]);
    roundTrips(pattern);
  });

  it('sews a branching stroke (a letter T) in one run without trims', () => {
    const { pattern, objects } = design(40, (x, y) => ((y > 8 && y < 12 && x > 6 && x < 34) || (x > 18 && x < 22 && y > 8 && y < 34) ? BLACK : null));
    expect(objects.map((o) => o.kind)).toEqual(['satin']);
    expect(pattern.cmd.filter((c) => c === TRIM).length).toBe(1); // only the final one
    expect(kindShare(pattern)[SATIN]).toBeGreaterThan(0.6);
    roundTrips(pattern);
  });

  it('fills a triangle, where satin columns would fan out from the middle', () => {
    // Equilateral, 13 mm sides: narrow enough for satin, but its skeleton is a star.
    const inside = (x: number, y: number) => {
      const [ax, ay, bx, by, cx, cy] = [10, 26, 23, 26, 16.5, 14.74];
      const s1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      const s2 = (cx - bx) * (y - by) - (cy - by) * (x - bx);
      const s3 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
      return (s1 <= 0 && s2 <= 0 && s3 <= 0) || (s1 >= 0 && s2 >= 0 && s3 >= 0);
    };
    const { objects } = design(33, (x, y) => (inside(x, y) ? RED : null));
    expect(objects.map((o) => o.kind)).toEqual(['fill']);
  });

  it('does not pile up satin in a tight bend', () => {
    // A hook 5 mm wide around a 1 mm hole: satin would fan out on the inside of the bend.
    const { pattern } = design(30, (x, y) => {
      const d = Math.hypot(x - 15, y - 15);
      return (d > 1 && d < 6 && y < 15) || (Math.abs(x - 18.5) < 2.5 && y >= 15 && y < 25) || (Math.abs(x - 11.5) < 2.5 && y >= 15 && y < 20) ? BLACK : null;
    });
    expect(noCritical(pattern)).toEqual([]);
  });

  it('sews thin lines as running stitch', () => {
    const { pattern, objects } = design(40, (x, y) => (Math.abs(y - 20) < 0.35 && x > 5 && x < 35 ? BLACK : null), { minAreaMm2: 1 });
    // Out and back along the line (the stitch kind detection reads the two passes as fill rows).
    expect(objects.map((o) => o.kind)).toEqual(['run']);
    const ys = stitches(pattern, 40).map((p) => p[1]);
    expect(Math.max(...ys.map((y) => Math.abs(y - 20)))).toBeLessThan(0.3);
    const xs = stitches(pattern, 40).map((p) => p[0]);
    expect(Math.min(...xs)).toBeLessThan(6);
    expect(Math.max(...xs)).toBeGreaterThan(34);
  });

  it('sews colors largest first, with color changes, trims and overlap', () => {
    // Red background square with a black satin ring and a blue disk on top.
    const { pattern, objects } = design(50, (x, y) => {
      const d = Math.hypot(x - 25, y - 25);
      if (d < 6) return BLUE;
      if (d > 14 && d < 17) return BLACK;
      return x > 4 && x < 46 && y > 4 && y < 46 ? RED : null;
    });
    expect(pattern.colors.length).toBe(3);
    expect(pattern.colors[0].r).toBeGreaterThan(150); // red first: the largest area
    expect(pattern.cmd.filter((c) => c === COLOR_CHANGE).length).toBe(2);
    expect(objects.filter((o) => o.kind === 'satin').length).toBe(1);
    expect(noCritical(pattern)).toEqual([]);
    roundTrips(pattern);
  });

  it('fills along the structure of the image', () => {
    // A red rectangle with fine horizontal shading: the rows run horizontally (0° or 180°).
    const shade = (y: number): Rgba => [210 + 15 * Math.sin(y * 4), 30, 40, 255];
    const flat = { maxColors: 2 };
    const { objects } = design(40, (x, y) => (x > 5 && x < 35 && y > 10 && y < 30 ? shade(y) : null), flat);
    const fill = objects.find((o) => o.kind === 'fill')!;
    expect(Math.abs(Math.sin(((fill.angle ?? 90) * Math.PI) / 180))).toBeLessThan(0.15);
    // The same with vertical shading: vertical rows.
    const v = design(40, (x, y) => (x > 5 && x < 35 && y > 10 && y < 30 ? shade(x) : null), flat).objects.find((o) => o.kind === 'fill')!;
    expect(Math.abs(Math.cos(((v.angle ?? 0) * Math.PI) / 180))).toBeLessThan(0.15);
  });

  it('curves the rows of a wide arc along its shape', () => {
    // A half ring 12 mm wide: too wide for satin, filled with rows that follow the arc.
    const { pattern, objects } = design(60, (x, y) => {
      const d = Math.hypot(x - 30, y - 45);
      return d > 14 && d < 26 && y < 45 ? BLUE : null;
    });
    expect(objects.map((o) => [o.kind, o.curved])).toEqual([['fill', true]]);
    expect(noCritical(pattern)).toEqual([]);
    roundTrips(pattern);
  });

  it('is deterministic', () => {
    const make = () => design(30, (x, y) => (Math.hypot(x - 15, y - 15) < 10 ? RED : null)).pattern;
    const a = make();
    const b = make();
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(a.cmd)).toEqual(Array.from(b.cmd));
  });
});
