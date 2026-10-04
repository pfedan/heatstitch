import { type Pattern, type ThreadColor } from '../../src/model/pattern';
import { fill, letterDesign, satinBorder, Writer, type Pt } from './designs';

/**
 * Small demo files for the guide (public/examples/demos), each showing one thing the check finds.
 * tests/demos.test.ts writes them with the app's own writers and keeps them in sync.
 */

const circle = (cx: number, cy: number, r: number, n = 64): Pt[] =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)] as Pt);

const RED: ThreadColor = { r: 210, g: 40, b: 50 };
const BLUE: ThreadColor = { r: 30, g: 90, b: 180 };
const YELLOW: ThreadColor = { r: 240, g: 200, b: 30 };
const BLACK: ThreadColor = { r: 20, g: 20, b: 20 };
const WHITE: ThreadColor = { r: 240, g: 240, b: 240 };
const BROWN: ThreadColor = { r: 120, g: 70, b: 30 };

/** Three overlapping fill circles: one layer is fine, where two meet it gets thick, the middle has three plus underlay. */
export function overlapDesign(): Pattern {
  const w = new Writer();
  const centres: Pt[] = [
    [20, 16],
    [32, 16],
    [26, 26.4],
  ];
  centres.forEach((c, i) => {
    if (i) w.color();
    fill(w, circle(c[0], c[1], 11), { angle: 0.3 + i * 1.05 });
  });
  // A dot on top of the middle: four layers there.
  w.color();
  fill(w, circle(26, 19.5, 4.5), { angle: 2.6 });
  return w.b.build('overlap', 'pes', [RED, BLUE, YELLOW, WHITE]);
}

/** Fill letters that reach almost to the outer edge of their satin border, so the border sits on a full fill layer. */
export function satinOverlapDesign(): Pattern {
  return letterDesign({ overlap: 0.85 });
}

/** A sun: satin ring with rays, its middle a tight spiral of 0.3 mm stitches, as a too small detail digitizes. */
export function shortStitchDesign(): Pattern {
  const w = new Writer();
  const c: Pt = [20, 20];
  fill(w, circle(c[0], c[1], 9), { angle: 0.2 });
  w.color();
  // Spiral of tiny stitches in the middle.
  w.start([c[0] + 0.3, c[1]]);
  for (let a = 0, r = 0.3; r < 3.5; ) {
    const step = 0.25;
    a += step / r;
    r = 0.3 + a * 0.07;
    w.to([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  w.color();
  satinBorder(w, circle(c[0], c[1], 10), { width: 2.4 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 2 * Math.PI;
    const u: Pt = [Math.cos(a), Math.sin(a)];
    const n: Pt = [-u[1], u[0]];
    const at = (d: number, s: number): Pt => [c[0] + u[0] * d + n[0] * s, c[1] + u[1] * d + n[1] * s];
    // Satin ray, narrowing outwards.
    w.start(at(12, 0));
    const len = 6;
    const steps = Math.round(len / 0.2);
    for (let k = 1; k <= steps; k++) {
      const d = 12 + (k / steps) * len;
      const half = 0.9 * (1 - k / steps) + 0.15;
      w.to(at(d, k % 2 ? half : -half));
    }
  }
  return w.b.build('sun', 'dst', [YELLOW, BROWN, RED]);
}

/** A leather patch: satin frame and lettering-like bars at 0.25 mm, fine on cotton, too many holes for leather. */
export function leatherDesign(): Pattern {
  const w = new Writer();
  const frame: Pt[] = [
    [2, 2],
    [48, 2],
    [48, 28],
    [2, 28],
  ];
  satinBorder(w, frame, { width: 3, spacing: 0.25 });
  w.color();
  const bar = (x0: number, y0: number, x1: number, y1: number, width: number, spacing: number) => {
    const d: Pt = [x1 - x0, y1 - y0];
    const l = Math.hypot(d[0], d[1]);
    const u: Pt = [d[0] / l, d[1] / l];
    const n: Pt = [-u[1], u[0]];
    const steps = Math.round(l / (spacing / 2));
    w.start([x0 - (n[0] * width) / 2, y0 - (n[1] * width) / 2]);
    for (let k = 1; k <= steps; k++) {
      const t = (k / steps) * l;
      const s = ((k % 2 ? 1 : -1) * width) / 2;
      w.to([x0 + u[0] * t + n[0] * s, y0 + u[1] * t + n[1] * s]);
    }
  };
  // "HI" in block satin bars, one leg spaced for leather to compare.
  bar(12, 8, 12, 22, 2.4, 0.25);
  bar(12, 15, 22, 15, 2, 0.25);
  bar(22, 8, 22, 22, 2.4, 0.25);
  bar(30, 8, 30, 22, 2.4, 0.5);
  bar(38, 8, 38, 22, 2.4, 0.5);
  return w.b.build('patch', 'dst', [BLACK, WHITE]);
}

export const DEMOS: { file: string; build: () => Pattern }[] = [
  { file: 'overlap.pes', build: overlapDesign },
  { file: 'letters.pes', build: satinOverlapDesign },
  { file: 'sun.dst', build: shortStitchDesign },
  { file: 'leather-patch.dst', build: leatherDesign },
];
