import { outline, sample, type Region } from '../digitize/region';
import type { Pt } from '../digitize/skeleton';
import { lineSettings } from './line';
import type { SewObject } from './objects';
import { isReadFromFile, STITCH, type Pattern } from './pattern';
import { analyze, measureSatin, penetrationRails, remembered, type BorderSettings } from './restitch';

/**
 * A border read from a file: running or satin stitch sewn along the edge of a fill, as an object
 * of its own. The fill can take it as its border (FillSettings.border, see syncBorders) instead
 * of getting a second one.
 */

/** Most of the line lies this close to the edge (mm; a satin: this much beyond half its width)... */
const NEAR = 0.8;
/** ...this share of its stitches... */
const ON_EDGE = 0.85;
/** ...and it goes along this share of the edge. */
const ALONG = 0.6;
/** The widest satin taken for a border (mm). */
const WIDEST = 8;
/** An offset from the edge smaller than this is none (mm). */
const NO_OFFSET = 0.25;

const median = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

/** Points every half millimetre along the stitches of `o` (not along jumps or trims). */
function pointsOf(p: Pattern, o: SewObject): Pt[] {
  const out: Pt[] = [];
  for (let i = o.first; i <= o.last; i++) {
    if (p.cmd[i] !== STITCH) continue;
    const b: Pt = [p.x[i] / 10, p.y[i] / 10];
    if (i > o.first && p.cmd[i - 1] === STITCH) {
      const a: Pt = [p.x[i - 1] / 10, p.y[i - 1] / 10];
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5);
      for (let k = 1; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    out.push(b);
  }
  return out;
}

/** How a line object read from a file is sewn, as a border (its width: a satin's, read from its rails). */
function settingsOf(p: Pattern, o: SewObject, kinds: Uint8Array): BorderSettings | null {
  if (o.kind === 'run') return lineSettings(p, o, kinds);
  const parts = analyze(p, o, kinds).parts;
  if (parts.length !== 1 || parts[0].kind !== 'satin') return null;
  const rails = penetrationRails(p, parts[0], kinds);
  const widths = rails.flatMap((r) => r.left.map((l, i) => Math.hypot(l[0] - r.right[i][0], l[1] - r.right[i][1])));
  if (!widths.length) return null;
  const s = measureSatin(p, parts[0], kinds);
  return { type: s.type === 'e' ? 'e' : 'satin', width: Math.round(median(widths) * 10) / 10, spacing: s.spacing, ...(s.underlay ? {} : { under: 'off' as const }), ...(s.fringe ? { fringe: s.fringe } : {}) };
}

/** Whether object `o` of a file is still as read: nothing made or kept here. */
function asRead(p: Pattern, o: SewObject): boolean {
  const m = remembered(p, o);
  return !m || !(m.fill || m.satin || m.path || m.line || m.outline || m.border || m.form || m.shape || m.hand || m.free);
}

/**
 * The border of fill `o` sewn in a file from elsewhere: the first run or satin after it that lies
 * along its edge (`area`, the fill's area), with how it is sewn; null when there is none, or the
 * design was not read from a file.
 */
export function readBorder(p: Pattern, objs: SewObject[], o: SewObject, kinds: Uint8Array, area: Region | null = analyze(p, o, kinds).fill): { at: number; border: BorderSettings } | null {
  if (!isReadFromFile(p) || !area || o.kind !== 'fill') return null;
  const edge = outline(area).flatMap((line) => {
    // Points every millimetre along the edge.
    const out: Pt[] = [];
    for (let i = 1; i < line.length; i++) {
      const [a, b] = [line[i - 1], line[i]];
      const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1])));
      for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    return out;
  });
  if (edge.length < 4) return null;
  const pad = 3 * 10;
  for (const b of objs) {
    if (b.index <= o.index || (b.kind !== 'run' && b.kind !== 'satin') || !asRead(p, b)) continue;
    if (b.maxX < o.minX - pad || b.minX > o.maxX + pad || b.maxY < o.minY - pad || b.minY > o.maxY + pad) continue;
    // Most of it near the edge at all (a satin up to WIDEST wide), before it is measured.
    const pts = pointsOf(p, b);
    const dist = pts.map(([x, y]) => sample(area, area.sdfBase, x, y));
    // Along the edge at its own distance from it (a border can lie a little in or out).
    const off = median(dist);
    const within = (tol: number) => Math.abs(off) <= tol && dist.filter((d) => Math.abs(d - off) <= tol).length >= pts.length * ON_EDGE;
    if (!within(NEAR + (b.kind === 'satin' ? WIDEST / 2 : 0))) continue;
    const st = settingsOf(p, b, kinds);
    if (!st) continue;
    const tol = NEAR + (st.type === 'satin' || st.type === 'e' ? st.width / 2 : 0);
    if (!within(tol)) continue;
    // Along the edge: points of the edge with the line close by (on a grid of the tolerance).
    const cell = (x: number, y: number) => `${Math.floor(x / tol)},${Math.floor(y / tol)}`;
    const grid = new Map<string, Pt[]>();
    for (const q of pts) {
      const k = cell(q[0], q[1]);
      grid.set(k, [...(grid.get(k) ?? []), q]);
    }
    const near = (q: Pt) => {
      const cx = Math.floor(q[0] / tol);
      const cy = Math.floor(q[1] / tol);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const r of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (Math.hypot(r[0] - q[0], r[1] - q[1]) <= tol) return true;
      return false;
    };
    if (edge.filter(near).length < edge.length * ALONG) continue;
    const offset = Math.round(off * 10) / 10;
    return { at: b.index, border: { ...st, ...(Math.abs(offset) >= NO_OFFSET ? { offset } : {}), color: { ...b.color } } };
  }
  return null;
}
