import { COLOR_CHANGE, JUMP, PatternBuilder, STITCH, TRIM, type Command, type Pattern, type ThreadColor } from '../../src/model/pattern';

/**
 * Synthetic designs built the way digitizing software builds them: tatami fills with an edge-run
 * underlay, satin borders with a centre-run underlay, objects joined by trims and jumps. Coordinates
 * in mm, y down.
 */
export type Pt = [number, number];

export class Writer {
  b = new PatternBuilder();
  x = 0;
  y = 0;
  to(p: Pt, cmd: Command = STITCH): void {
    const X = Math.round(p[0] * 10);
    const Y = Math.round(p[1] * 10);
    this.b.add(X - this.x, Y - this.y, cmd);
    this.x = X;
    this.y = Y;
  }
  start(p: Pt): void {
    if (this.b.length) {
      this.b.mark(TRIM);
      this.to(p, JUMP);
    }
    this.to(p);
  }
  color(): void {
    this.b.mark(TRIM);
    this.b.mark(COLOR_CHANGE);
  }
}

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const len = (a: Pt) => Math.hypot(a[0], a[1]);

/** Signed area: positive for clockwise polygons in y-down coordinates. */
function area(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Points every `step` mm along the closed polygon, with the outward normal smoothed over `smooth` mm. */
function perimeter(poly: Pt[], step: number, smooth: number): { p: Pt; n: Pt }[] {
  const pts: Pt[] = [];
  const normals: Pt[] = [];
  const sign = area(poly) > 0 ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const d = sub(b, a);
    const l = len(d);
    const k = Math.max(1, Math.round(l / step));
    for (let j = 0; j < k; j++) {
      pts.push([a[0] + (d[0] * j) / k, a[1] + (d[1] * j) / k]);
      // Outward normal of a clockwise (y-down) polygon edge.
      normals.push([(-d[1] / l) * sign * -1, (d[0] / l) * sign * -1]);
    }
  }
  const w = Math.max(0, Math.round(smooth / step));
  return pts.map((p, i) => {
    let nx = 0;
    let ny = 0;
    for (let j = -w; j <= w; j++) {
      const q = normals[(i + j + normals.length) % normals.length];
      nx += q[0];
      ny += q[1];
    }
    const l = Math.hypot(nx, ny) || 1;
    return { p, n: [nx / l, ny / l] as Pt };
  });
}

/** Polygon offset by `d` mm outwards (negative: inwards), using smoothed vertex normals. */
export function offset(poly: Pt[], d: number): Pt[] {
  return perimeter(poly, 0.5, 0.5).map(({ p, n }) => [p[0] + n[0] * d, p[1] + n[1] * d] as Pt);
}

export function runAround(w: Writer, poly: Pt[], stitch: number): void {
  const pts = perimeter(poly, stitch, 0).map((q) => q.p);
  w.start(pts[0]);
  for (let i = 1; i < pts.length; i++) w.to(pts[i]);
  w.to(pts[0]);
}

export interface FillOpts {
  angle?: number;
  spacing?: number;
  stitch?: number;
  /** Edge-run underlay inset (mm), or null for none. */
  underlay?: number | null;
}

/** Tatami fill of a polygon: boustrophedon rows split into sweeps wherever the shape branches. */
export function fill(w: Writer, poly: Pt[], o: FillOpts = {}): void {
  const angle = o.angle ?? 0;
  const spacing = o.spacing ?? 0.4;
  const L = o.stitch ?? 3.5;
  if (o.underlay !== null) runAround(w, offset(poly, -(o.underlay ?? 0.6)), 2);
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const toUV = (p: Pt): Pt => [p[0] * ca + p[1] * sa, -p[0] * sa + p[1] * ca];
  const toXY = (u: number, v: number): Pt => [u * ca - v * sa, u * sa + v * ca];
  const uv = poly.map(toUV);
  const vMin = Math.min(...uv.map((p) => p[1]));
  const vMax = Math.max(...uv.map((p) => p[1]));
  // Segments per scanline.
  const lines: { v: number; segs: [number, number][] }[] = [];
  for (let v = vMin + spacing / 2; v < vMax; v += spacing) {
    const xs: number[] = [];
    for (let i = 0; i < uv.length; i++) {
      const a = uv[i];
      const b = uv[(i + 1) % uv.length];
      if ((a[1] <= v && b[1] > v) || (b[1] <= v && a[1] > v)) xs.push(a[0] + ((v - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    const segs: [number, number][] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) segs.push([xs[i], xs[i + 1]]);
    lines.push({ v, segs });
  }
  // Greedy sweeps: follow the segment overlapping the previous one, consume it.
  const used = lines.map((l) => l.segs.map(() => false));
  for (;;) {
    let li = -1;
    let si = -1;
    for (let i = 0; i < lines.length && li < 0; i++) {
      const k = used[i].indexOf(false);
      if (k >= 0) {
        li = i;
        si = k;
      }
    }
    if (li < 0) break;
    let row = 0;
    let first = true;
    while (li < lines.length) {
      used[li][si] = true;
      const [u0, u1] = lines[li].segs[si];
      const v = lines[li].v;
      const fwd = row % 2 === 0;
      const a = fwd ? u0 : u1;
      const b = fwd ? u1 : u0;
      if (first) w.start(toXY(a, v));
      else w.to(toXY(a, v));
      first = false;
      const phase = ((row % 3) / 3) * L;
      const inner: number[] = [];
      for (let k = Math.ceil((Math.min(a, b) - phase) / L); k * L + phase < Math.max(a, b); k++) {
        const u = k * L + phase;
        if (u - Math.min(a, b) > 0.8 && Math.max(a, b) - u > 0.8) inner.push(u);
      }
      if (!fwd) inner.reverse();
      for (const u of inner) w.to(toXY(u, v));
      w.to(toXY(b, v));
      row++;
      // Next segment on the following scanline that overlaps this one.
      const next = li + 1;
      if (next >= lines.length) break;
      const k = lines[next].segs.findIndex((s, j) => !used[next][j] && s[0] < u1 && s[1] > u0);
      if (k < 0) break;
      li = next;
      si = k;
    }
  }
}

export interface SatinOpts {
  width?: number;
  spacing?: number;
  underlay?: boolean;
}

/** Satin border centred on a closed polygon outline. */
export function satinBorder(w: Writer, poly: Pt[], o: SatinOpts = {}): void {
  const width = o.width ?? 2.5;
  const spacing = o.spacing ?? 0.4;
  if (o.underlay !== false) runAround(w, poly, 2);
  const pts = perimeter(poly, spacing / 2, width * 0.75);
  const at = (i: number, out: boolean): Pt => {
    const { p, n } = pts[i % pts.length];
    const d = (out ? 1 : -1) * (width / 2);
    return [p[0] + n[0] * d, p[1] + n[1] * d];
  };
  w.start(at(0, false));
  for (let i = 1; i <= pts.length; i++) w.to(at(i, i % 2 === 1));
}

export interface LetterDesignOpts {
  fill?: FillOpts;
  border?: SatinOpts;
  /** How far the fill reaches under the border: 0 = to its inner edge, 0.5 = to its centre, 1 = outer edge. */
  overlap?: number;
}

const GREEN: ThreadColor = { r: 70, g: 140, b: 50 };
const BLACK: ThreadColor = { r: 20, g: 20, b: 20 };

/** Letter-like shapes (about 60 x 22 mm) filled and outlined, like an applique-style lettering logo. */
export const LETTERS: Pt[][] = [
  // M
  [[0, 22], [2, 0], [6, 0], [9, 10], [12, 0], [16, 0], [18, 22], [14, 22], [13, 9], [10.5, 17], [7.5, 17], [5, 9], [4, 22]],
  // A (no counter)
  [[20, 22], [26, 0], [31, 0], [37, 22], [32.5, 22], [31.5, 18], [25.5, 18], [24.5, 22]],
  // K
  [[39, 0], [43, 0], [43, 8.5], [49, 0], [54, 0], [46.5, 10.5], [54.5, 22], [49.5, 22], [43, 12.5], [43, 22], [39, 22]],
  // E
  [[57, 0], [70, 0], [70, 4], [61, 4], [61, 9], [68, 9], [68, 13], [61, 13], [61, 18], [70, 18], [70, 22], [57, 22]],
];

export function letterDesign(o: LetterDesignOpts = {}): Pattern {
  const w = new Writer();
  const bw = o.border?.width ?? 2.5;
  const ov = o.overlap ?? 0.5;
  for (const poly of LETTERS) fill(w, offset(poly, (ov - 0.5) * bw), { angle: 0.6, ...o.fill });
  w.color();
  for (const poly of LETTERS) satinBorder(w, poly, o.border);
  return w.b.build('letters', 'pes', [GREEN, BLACK]);
}

/** A round badge: background fill, a fill circle on top of it and a satin ring around both. */
export function badgeDesign(): Pattern {
  const w = new Writer();
  const circle = (cx: number, cy: number, r: number, n = 48): Pt[] =>
    Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)] as Pt);
  fill(w, circle(25, 25, 22), { angle: 0.3 });
  w.color();
  fill(w, circle(25, 25, 12), { angle: 1.9 });
  fill(w, [[10, 30], [40, 30], [40, 36], [10, 36]], { angle: 1.2 });
  w.color();
  satinBorder(w, circle(25, 25, 22), { width: 3 });
  return w.b.build('badge', 'pes', [{ r: 30, g: 60, b: 150 }, { r: 240, g: 200, b: 40 }, { r: 240, g: 240, b: 240 }]);
}
