import type { Region } from '../digitize/region';
import type { Pt } from '../digitize/skeleton';
import { apply, transformForm, type Mat } from '../shape/path';
import { rasterize } from '../shape/rasterize';
import { vectorize } from '../shape/vectorize';
import { syncMarks, tidy, withRecords } from './edit';
import type { SewObject } from './objects';
import { JUMP, STITCH, type Pattern } from './pattern';
import type { Rails, Remembered } from './restitch';

/** A map that only moves, by whole records (0.1 mm) in both directions. */
export function isShift(m: Mat): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1;
}

/** How much a map scales lengths (1 for moving, turning and mirroring). */
export const scaleOf = (m: Mat): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

/** Whether a map keeps every length (moves, turns, mirrors): the stitches can simply go along. */
export const isRigid = (m: Mat): boolean =>
  Math.abs(m[0] * m[0] + m[1] * m[1] - 1) < 1e-9 && Math.abs(m[2] * m[2] + m[3] * m[3] - 1) < 1e-9 && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-9;

/**
 * The pattern with object `o` mapped by `m` (world mm): its stitches, jumps and trims inside it go
 * along, the jumps that lead to it are laid on the line from where the thread comes to its new
 * start. Without such a jump one is put in. `first` and `last` are the object's records now.
 */
export function transformObject(p: Pattern, o: SewObject, m: Mat): { pattern: Pattern; first: number; last: number } {
  let lead = o.first;
  while (lead - 1 >= 0 && p.cmd[lead - 1] === JUMP) lead--;
  const insert = lead === o.first && o.first > 0 ? 1 : 0;
  const n = p.cmd.length + insert;
  const x = new Int32Array(n);
  const y = new Int32Array(n);
  const cmd = new Uint8Array(n);
  for (let i = 0; i < lead; i++) {
    x[i] = p.x[i];
    y[i] = p.y[i];
    cmd[i] = p.cmd[i];
  }
  const first = o.first + insert;
  const last = o.last + insert;
  for (let i = o.first; i <= o.last; i++) {
    const [wx, wy] = apply(m, [p.x[i] / 10, p.y[i] / 10]);
    x[i + insert] = Math.round(wx * 10);
    y[i + insert] = Math.round(wy * 10);
    cmd[i + insert] = p.cmd[i];
  }
  for (let i = o.last + 1; i < p.cmd.length; i++) {
    x[i + insert] = p.x[i];
    y[i + insert] = p.y[i];
    cmd[i + insert] = p.cmd[i];
  }
  // The way in: from the record before the jumps to the new start, in even steps.
  const from = lead - 1;
  const k = o.first - lead + insert;
  for (let j = 1; j <= k; j++) {
    const i = lead + j - 1;
    x[i] = from >= 0 ? Math.round(x[from] + ((x[first] - x[from]) * j) / k) : x[first];
    y[i] = from >= 0 ? Math.round(y[from] + ((y[first] - y[from]) * j) / k) : y[first];
    cmd[i] = JUMP;
  }
  syncMarks(x, y, cmd);
  const next = tidy(withRecords(p, x, y, cmd));
  // Tidying only drops repeated trims and empty colors, none of which lie before a stitch.
  return { pattern: next, first, last };
}

const mapPts = (m: Mat, pts: Pt[]): Pt[] => pts.map((q) => apply(m, q));

/** The area moved by whole pixels, or null when the map does more than that. */
function shiftRegion(r: Region, m: Mat): Region | null {
  if (!isShift(m)) return null;
  const dx = m[4] / r.pxMm;
  const dy = m[5] / r.pxMm;
  if (Math.abs(dx - Math.round(dx)) > 1e-6 || Math.abs(dy - Math.round(dy)) > 1e-6) return null;
  return { ...r, x0: r.x0 + Math.round(dx), y0: r.y0 + Math.round(dy) };
}

/** A direction of rows (degrees 0 to 180) after the map. */
function mapAngle(m: Mat, deg: number): number {
  if (!Number.isFinite(deg)) return deg;
  const r = (deg * Math.PI) / 180;
  const vx = m[0] * Math.cos(r) + m[2] * Math.sin(r);
  const vy = m[1] * Math.cos(r) + m[3] * Math.sin(r);
  const a = (Math.atan2(vy, vx) * 180) / Math.PI;
  return Math.round((((a % 180) + 180) % 180) * 100) / 100;
}

/**
 * What an object remembers, mapped with it: its area (from the curves when it has them, so the
 * shape never drifts), the rails of its satins, its row direction and guide lines.
 */
export function transformRemembered(r: Remembered, m: Mat): Remembered {
  const out: Remembered = { ...r };
  let form = r.form;
  if (!form && r.region) {
    const shifted = shiftRegion(r.region, m);
    if (shifted) out.region = shifted;
    // Traced once; from now on the curves are the shape.
    else form = vectorize(r.region);
  }
  if (form) {
    out.form = transformForm(form, m);
    out.region = rasterize(out.form, r.region?.pxMm ?? 0.1);
  }
  if (r.path) out.path = transformForm(r.path, m);
  if (r.shape) out.shape = shiftRegion(r.shape, m) ?? rasterize(transformForm(vectorize(r.shape), m), r.shape.pxMm) ?? undefined;
  const s = scaleOf(m);
  if (r.columns) {
    out.columns = r.columns.map((part) =>
      part.map((c): Rails => ({ left: mapPts(m, c.left), right: mapPts(m, c.right), ...(c.rungs ? { rungs: c.rungs.map(([a, b]) => [a * s, b * s]) } : {}) })),
    );
  }
  if (r.asSatin) out.asSatin = r.asSatin.map((c): Rails => ({ left: mapPts(m, c.left), right: mapPts(m, c.right), ...(c.rungs ? { rungs: c.rungs.map(([a, b]) => [a * s, b * s]) } : {}) }));
  if (r.fill) out.fill = { ...r.fill, angle: mapAngle(m, r.fill.angle), ...(r.fill.guides ? { guides: r.fill.guides.map((g) => mapPts(m, g)) } : {}) };
  return out;
}

/** Number of stitches before record `i`, as rememberObjects counts them. */
export function stitchesBefore(p: Pattern, i: number): number {
  let n = 0;
  for (let k = 0; k < i; k++) if (p.cmd[k] === STITCH) n++;
  return n;
}
