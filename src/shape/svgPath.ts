import type { Pt } from '../digitize/skeleton';
import { apply, type Form, type Mat, type Node, type Path } from './path';

/**
 * SVG geometry as forms: path data (all commands, arcs as cubic curves) and the basic shapes, mapped
 * by `m` from the file's user units to world millimetres. Lines and quadratic curves become cubic
 * curves with handles on the line, so every form is edited the same way.
 */

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

/** The commands of path data with their numbers, up to the first malformed part (as browsers do). */
function tokens(d: string): { cmd: string; args: number[] }[] {
  const out: { cmd: string; args: number[] }[] = [];
  let i = 0;
  let cur: { cmd: string; args: number[] } | null = null;
  while (i < d.length) {
    const ch = d[i];
    if (/[\s,]/.test(ch)) {
      i++;
      continue;
    }
    if (/[MmZzLlHhVvCcSsQqTtAa]/.test(ch)) {
      cur = { cmd: ch, args: [] };
      out.push(cur);
      i++;
      continue;
    }
    if (!cur) break;
    const k = cur.args.length % 7;
    // Arc flags may be written without separators ("a1 1 0 01 2 3").
    if ((cur.cmd === 'A' || cur.cmd === 'a') && (k === 3 || k === 4) && (ch === '0' || ch === '1')) {
      cur.args.push(ch === '1' ? 1 : 0);
      i++;
      continue;
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(d);
    if (!m) break;
    cur.args.push(parseFloat(m[0]));
    i = NUMBER.lastIndex;
  }
  return out;
}

type Seg = [Pt, Pt, Pt, Pt];

/** Cubic curves for an elliptical arc (SVG implementation notes F.6), in user units. */
function arc(p0: Pt, rx: number, ry: number, phiDeg: number, large: number, sweep: number, p1: Pt): Seg[] {
  if (p0[0] === p1[0] && p0[1] === p1[1]) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) return [[p0, p0, p1, p1]];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cx1 = (co * rx * y1) / ry;
  const cy1 = (-co * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const at = (t: number): Pt => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const der = (t: number): Pt => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * step;
    const b = a + step;
    const pa = i === 0 ? p0 : at(a);
    const pb = i === n - 1 ? p1 : at(b);
    const da = der(a);
    const db = der(b);
    out.push([pa, [pa[0] + k * da[0], pa[1] + k * da[1]], [pb[0] - k * db[0], pb[1] - k * db[1]], pb]);
  }
  return out;
}

const near = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/** Curves of one subpath as nodes; a closing curve back to the start is folded into the first node. */
function toPath(segs: Seg[], closed: boolean, m: Mat): Path | null {
  if (!segs.length) return null;
  const start = segs[0][0];
  const end = segs[segs.length - 1][3];
  // A closed subpath gets its closing line when it does not end where it began.
  if (closed && !near(start, end)) segs = [...segs, [end, end, start, start]];
  const nodes: Node[] = [];
  for (const [p0, c1, c2, p3] of segs) {
    if (!nodes.length) nodes.push({ p: p0, a: p0, b: c1, smooth: false });
    else nodes[nodes.length - 1].b = c1;
    nodes.push({ p: p3, a: c2, b: p3, smooth: false });
  }
  if (closed && nodes.length > 1 && near(nodes[0].p, nodes[nodes.length - 1].p)) {
    const last = nodes.pop()!;
    nodes[0].a = last.a;
  }
  const mapped = nodes.map((n) => ({ p: apply(m, n.p), a: apply(m, n.a), b: apply(m, n.b), smooth: false }));
  // A node is round when its handles lie on one line through it.
  const cnt = mapped.length;
  mapped.forEach((n, i) => {
    if (!closed && (i === 0 || i === cnt - 1)) return;
    const ax = n.a[0] - n.p[0];
    const ay = n.a[1] - n.p[1];
    const bx = n.b[0] - n.p[0];
    const by = n.b[1] - n.p[1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) return;
    n.smooth = Math.abs(ax * by - ay * bx) / (la * lb) < 0.02 && ax * bx + ay * by < 0;
  });
  if (mapped.length < 2) return null;
  return { closed, nodes: mapped };
}

/** Path data as a form, mapped by `m`. Subpaths of a single point are left out. */
export function parsePath(d: string, m: Mat): Form {
  const paths: Path[] = [];
  let segs: Seg[] = [];
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  let lastCtrl: Pt | null = null;
  let lastQuad: Pt | null = null;
  const flush = (closed: boolean) => {
    const p = toPath(segs, closed, m);
    if (p) paths.push(p);
    segs = [];
  };
  const line = (to: Pt) => {
    segs.push([cur, cur, to, to]);
    cur = to;
  };
  for (const { cmd, args } of tokens(d)) {
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const off = (x: number, y: number): Pt => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    if (C === 'Z') {
      flush(true);
      cur = start;
      lastCtrl = lastQuad = null;
      continue;
    }
    const n = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }[C] ?? 0;
    if (!n) continue;
    for (let i = 0; i + n <= args.length; i += n) {
      const a = args.slice(i, i + n);
      let ctrl: Pt | null = null;
      let quad: Pt | null = null;
      if (C === 'M') {
        if (i === 0) {
          if (segs.length) flush(false);
          cur = start = off(a[0], a[1]);
        } else line(off(a[0], a[1]));
      } else if (C === 'L') line(off(a[0], a[1]));
      else if (C === 'H') line([rel ? cur[0] + a[0] : a[0], cur[1]]);
      else if (C === 'V') line([cur[0], rel ? cur[1] + a[0] : a[0]]);
      else if (C === 'C') {
        const c1 = off(a[0], a[1]);
        const c2 = off(a[2], a[3]);
        const to = off(a[4], a[5]);
        segs.push([cur, c1, c2, to]);
        ctrl = c2;
        cur = to;
      } else if (C === 'S') {
        const c1: Pt = lastCtrl ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
        const c2 = off(a[0], a[1]);
        const to = off(a[2], a[3]);
        segs.push([cur, c1, c2, to]);
        ctrl = c2;
        cur = to;
      } else if (C === 'Q' || C === 'T') {
        const q: Pt = C === 'Q' ? off(a[0], a[1]) : lastQuad ? [2 * cur[0] - lastQuad[0], 2 * cur[1] - lastQuad[1]] : cur;
        const to = C === 'Q' ? off(a[2], a[3]) : off(a[0], a[1]);
        segs.push([cur, [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])], [to[0] + (2 / 3) * (q[0] - to[0]), to[1] + (2 / 3) * (q[1] - to[1])], to]);
        quad = q;
        cur = to;
      } else if (C === 'A') {
        const to = off(a[5], a[6]);
        segs.push(...arc(cur, a[0], a[1], a[2], a[3], a[4], to));
        cur = to;
      }
      lastCtrl = ctrl;
      lastQuad = quad;
    }
  }
  if (segs.length) flush(false);
  return { paths };
}

const K = 0.5522847498;

/** An ellipse as four curves (a circle when rx = ry). */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  if (!(rx > 0 && ry > 0)) return '';
  const ox = rx * K;
  const oy = ry * K;
  return `M${cx + rx} ${cy}C${cx + rx} ${cy + oy} ${cx + ox} ${cy + ry} ${cx} ${cy + ry}C${cx - ox} ${cy + ry} ${cx - rx} ${cy + oy} ${cx - rx} ${cy}C${cx - rx} ${cy - oy} ${cx - ox} ${cy - ry} ${cx} ${cy - ry}C${cx + ox} ${cy - ry} ${cx + rx} ${cy - oy} ${cx + rx} ${cy}Z`;
}

/** A rectangle, with rounded corners when rx or ry is given (as SVG clamps them). */
export function rectPath(x: number, y: number, w: number, h: number, rx: number, ry: number): string {
  if (!(w > 0 && h > 0)) return '';
  if (!(rx > 0) && ry > 0) rx = ry;
  if (!(ry > 0) && rx > 0) ry = rx;
  rx = Math.min(Math.max(0, rx || 0), w / 2);
  ry = Math.min(Math.max(0, ry || 0), h / 2);
  if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  const ox = rx * (1 - K);
  const oy = ry * (1 - K);
  return (
    `M${x + rx} ${y}H${x + w - rx}C${x + w - ox} ${y} ${x + w} ${y + oy} ${x + w} ${y + ry}V${y + h - ry}` +
    `C${x + w} ${y + h - oy} ${x + w - ox} ${y + h} ${x + w - rx} ${y + h}H${x + rx}C${x + ox} ${y + h} ${x} ${y + h - oy} ${x} ${y + h - ry}` +
    `V${y + ry}C${x} ${y + oy} ${x + ox} ${y} ${x + rx} ${y}Z`
  );
}

/** Points of a polyline or polygon (`points` attribute) as path data. */
export function pointsPath(points: string, closed: boolean): string {
  const v = (points.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
  if (v.length < 4) return '';
  let d = `M${v[0]} ${v[1]}`;
  for (let i = 2; i + 1 < v.length; i += 2) d += `L${v[i]} ${v[i + 1]}`;
  return closed ? d + 'Z' : d;
}
