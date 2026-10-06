import type { Pt } from '../digitize/skeleton';
import { transformForm, type Form } from '../shape/path';
import type { PathStitch } from './along';
import type { ThreadColor } from './pattern';
import type { Remembered } from './restitch';

/**
 * The shadow of a line: the line once more, a little beside it in a thread of its own, sewn before
 * it so the line lies on top. Like the border of a fill it is an object of its own linked to its
 * line (`LineShadow.link`, the object's `shadowOf`); syncShadows (border.ts) keeps it fitting the
 * line. Its offset is a direction on screen, so it stays where the light puts it when the line is
 * turned or mirrored.
 */

/** Where the shadow falls: down right, down left, up right, up left. */
export type ShadowDir = 'se' | 'sw' | 'ne' | 'nw';
export const SHADOW_DIRS: ShadowDir[] = ['se', 'sw', 'ne', 'nw'];

export interface LineShadow {
  color: ThreadColor;
  link: string;
  dir: ShadowDir;
  /** How far it lies from the line (mm), along both axes. */
  dist: number;
}

export const SHADOW_DIST: [number, number] = [0.3, 3];
export const SHADOW_DEFAULT_DIST = 0.8;
/** The thread a new shadow starts with: dark grey. */
export const SHADOW_COLOR: ThreadColor = { r: 64, g: 64, b: 64 };

export function shadowOffset(s: LineShadow): Pt {
  return [s.dir === 'se' || s.dir === 'ne' ? s.dist : -s.dist, s.dir === 'se' || s.dir === 'sw' ? s.dist : -s.dist];
}

/** The curve the shadow of line `path` is sewn along. */
export function shadowPath(path: Form, s: LineShadow): Form {
  const [dx, dy] = shadowOffset(s);
  return transformForm(path, [1, 0, 0, 1, dx, dy]);
}

/** How the shadow is sewn: as its line with all its echo in one thread, without a shadow of its own. */
export function shadowStitch(st: PathStitch): PathStitch {
  const { shadow: _s, ...rest } = st;
  if (!rest.echo) return rest;
  const { colors: _c, link: _l, only: _o, ...echo } = rest.echo;
  return { ...rest, echo };
}

export const hex = (c: ThreadColor) => [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');

/** A part of a line in a thread of its own: what its object remembers, its link and thread, and whether it is sewn after the line. */
export interface LinePart {
  link: string;
  color: ThreadColor;
  after: boolean;
  memory: Remembered;
}

/** The link of the line part object `m` is (shadow or echo copies), if it is one. */
export const partOf = (m: Remembered | undefined): string | undefined => m?.shadowOf ?? m?.echoOf;

/** Whether line `m` has the part linked by `link`. */
export const hasPart = (m: Remembered | undefined, link: string): boolean =>
  !!m?.path && !partOf(m) && (m.line?.shadow?.link === link || (!!m.line?.echo?.link && link.startsWith(`${m.line.echo.link}:`)));

/** Line `m` with its part `link` in thread `color` from now on. */
export function partInThread(m: Remembered, link: string, color: ThreadColor): Remembered {
  const st = m.line!;
  if (st.shadow?.link === link) return { ...m, line: { ...st, shadow: { ...st.shadow, color: { ...color } } } };
  const e = st.echo;
  if (!e?.colors) return m;
  const first = Number(link.slice(link.lastIndexOf(':') + 1));
  const was = e.colors[first - 1];
  const colors = e.colors.map((c) => (c && was && hex(c) === hex(was) ? { ...color } : c));
  return { ...m, line: { ...st, echo: { ...e, colors } } };
}

/** Line `m` without its part `link` (it goes its own way, or is gone). */
export function withoutPart(m: Remembered, link: string): Remembered {
  const st = m.line!;
  if (st.shadow?.link === link) return { ...m, line: { ...st, shadow: undefined } };
  const e = st.echo;
  if (!e?.colors) return m;
  const first = Number(link.slice(link.lastIndexOf(':') + 1));
  const was = e.colors[first - 1];
  // Its copies are not the line's any more: left out by the line, the others keep their places.
  const gone: number[] = [];
  const colors = e.colors.map((c, i) => {
    if (!(c && was && hex(c) === hex(was))) return c;
    gone.push(i + 1);
    return null;
  });
  return { ...m, line: { ...st, echo: { ...e, colors, skip: [...(e.skip ?? []), ...gone].sort((a, b) => a - b) } } };
}

/** The parts of line `m` in threads of their own: its shadow, and its echo copies by thread. */
export function lineParts(m: Remembered): LinePart[] {
  const st = m.line!;
  const out: LinePart[] = [];
  if (st.shadow) {
    const s = st.shadow;
    out.push({ link: s.link, color: s.color, after: false, memory: { region: null, path: shadowPath(m.path!, s), line: shadowStitch(st), shadowOf: s.link } });
  }
  const e = st.echo;
  if (e?.link && e.colors) {
    const n = Math.max(1, Math.round(e.count));
    const groups = new Map<string, { color: ThreadColor; rings: number[] }>();
    for (let k = 1; k <= n; k++) {
      const c = e.colors[k - 1];
      if (!c) continue;
      const g = groups.get(hex(c)) ?? { color: c, rings: [] };
      g.rings.push(k);
      groups.set(hex(c), g);
    }
    const { shadow: _s, ...plain } = st;
    for (const g of groups.values()) {
      // Named by its nearest copy, so it keeps its link when its thread changes.
      const link = `${e.link}:${g.rings[0]}`;
      const echo = { side: e.side, count: e.count, gap: e.gap, ...(e.cut ? { cut: true } : {}), only: g.rings };
      out.push({ link, color: g.color, after: true, memory: { region: null, path: m.path, line: { ...plain, echo }, echoOf: link } });
    }
  }
  return out;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const byte = (v: unknown) => finite(v) && v >= 0 && v <= 255;

export function isShadow(x: unknown): x is LineShadow {
  const s = x as LineShadow | null;
  return !!s && typeof s.link === 'string' && SHADOW_DIRS.includes(s.dir) && finite(s.dist) && s.dist >= SHADOW_DIST[0] && s.dist <= SHADOW_DIST[1] && !!s.color && byte(s.color.r) && byte(s.color.g) && byte(s.color.b);
}
