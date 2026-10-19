import { core } from '../wasm/core';
import type { Form, Mat } from './path';

/**
 * SVG geometry as forms: path data (all commands, arcs as cubic curves) and the basic shapes, mapped
 * by `m` from the file's user units to world millimetres. Lines and quadratic curves become cubic
 * curves with handles on the line, so every form is edited the same way.
 */

/** Path data as a form, mapped by `m`. Subpaths of a single point are left out. Parsed by the Rust core (core/src/shape/svg_path.rs). */
export function parsePath(d: string, m: Mat): Form {
  return core().parsePath(d, Float64Array.from(m)) as Form;
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
