import { autoUnder, spacingOf } from '../../model/along';
import { syncBorders } from '../../model/border';
import { sewObjects, stitchKey, type SewObject } from '../../model/objects';
import { COLOR_CHANGE, JUMP, STITCH, TRIM, type Pattern } from '../../model/pattern';
import { remembered, underlayRanges, type Fixed, type Settings } from '../../model/restitch';
import { stitchKinds } from '../../model/sequence';
import { fontNow, type Font } from '../../lettering/font';
import type { Lettering } from '../../lettering/layout';
import { letteringObjects, placeLettering } from '../../lettering/place';
import { sewLettering } from '../../lettering/sew';
import { recommendedSpacing, type Profile } from '../../validation/profiles';
import type { FixKind } from './cells';
import { roleOf, sewWith, type Tool } from './variants';

/**
 * What the engine adjusts: a unit is one set of settings and the objects sewn from it. Mostly one
 * object; a border in its own thread is set on its fill (the border settings live there, the
 * fill's own stitches stay); a lettering is set as a whole (its density and
 * underlay, the same controls the lettering panel has).
 */
export type Unit =
  | { kind: 'object'; owner: number; objects: number[]; settings: Settings }
  | { kind: 'border'; owner: number; objects: number[]; settings: Settings & { kind: 'fill' } }
  | { kind: 'lettering'; owner: number; objects: number[]; lettering: Lettering; font: Font };

const round2 = (v: number) => Math.round(v * 100) / 100;
const fix = (field: string, from: Fixed['from'] | undefined, to: Fixed['to']): Fixed => ({ field, from: from ?? '', to });
const SPACING_FULL = 0.15;

/** Whether fill `index` has a border in a thread of its own. */
function hasBorder(p: Pattern, index: number): boolean {
  const objs = objectsOf(p);
  const link = remembered(p, objs[index])?.fill?.border?.link;
  return !!link && objs.some((x) => remembered(p, x)?.outline === link);
}

/**
 * The unit object `o` is adjusted in, or the reason it is left as it is (locked, changed by hand,
 * shape only guessed, sewn from something else that cannot be set here).
 */
export function unitOf(p: Pattern, objs: SewObject[], o: SewObject, kinds: Uint8Array, allowHand = false): Unit | { why: string } {
  const known = remembered(p, o);
  if (known?.lock) return { why: 'lock' };
  if (known?.hand && !allowHand) return { why: 'hand' };
  if (known?.free) return { why: 'free' };
  if (known?.lettering) {
    const font = fontNow(known.lettering.font);
    if (!font) return { why: 'font' };
    const list = letteringObjects(p, objs, known.lettering.id);
    if (list.some((x) => remembered(p, x)?.lock || (remembered(p, x)?.hand && !allowHand))) return { why: 'hand' };
    return { kind: 'lettering', owner: list[0].index, objects: list.map((x) => x.index), lettering: known.lettering, font };
  }
  if (known?.outline) {
    const fill = objs.find((x) => remembered(p, x)?.fill?.border?.link === known.outline);
    if (!fill) return { why: 'derived' };
    const r = roleOf(p, objs, fill, kinds, allowHand);
    if (r.role !== 'settings' || r.settings?.kind !== 'fill' || !r.settings.s.border) return { why: r.why ?? 'derived' };
    return { kind: 'border', owner: fill.index, objects: [o.index], settings: r.settings as Settings & { kind: 'fill' } };
  }
  if (known?.blendOf || known?.shadowOf || known?.echoOf) return { why: 'derived' };
  const r = roleOf(p, objs, o, kinds, allowHand);
  if (r.role !== 'settings' || !r.settings) return { why: r.why ?? 'unknown' };
  return { kind: 'object', owner: o.index, objects: [o.index], settings: r.settings };
}

export const unitKey = (u: Unit): string => `${u.kind}:${u.owner}`;

const objectsCache = new WeakMap<Pattern, SewObject[]>();
/**
 * The objects of `p`, worked out once per design version: the engine asks for them again and again
 * while trying variants. Designs are not changed in place, so a version keeps its objects.
 */
export function objectsOf(p: Pattern): SewObject[] {
  let o = objectsCache.get(p);
  if (!o) objectsCache.set(p, (o = sewObjects(p)));
  return o;
}

/** A key for a design's records (fixes are worked out for one exact design). */
export function designKey(p: Pattern): string {
  return `${p.cmd.length}:${stitchKey(p, 0, p.cmd.length - 1)}`;
}

/** Tools on a border sewn in a thread of its own (set on its fill). */
export function borderTools(u: Unit & { kind: 'border' }, want: Set<FixKind>, profile: Profile): Tool[] {
  const b = u.settings.s.border!;
  const out: Tool[] = [];
  if (b.type !== 'satin') return out;
  const [, recMax] = recommendedSpacing(profile);
  const sp = spacingOf(b);
  if (want.has('density') || want.has('holes')) {
    const under = autoUnder(b);
    if (under !== 'off' && b.width < 2) out.push({ id: 'border.underOff', changes: [fix('border.under', under, 'off')], strength: 0, kinds: ['density', 'holes'] });
    else if (under !== 'off' && under !== 'center') out.push({ id: 'border.underCenter', changes: [fix('border.under', under, 'center')], strength: 0, kinds: ['density', 'holes'] });
    for (const to of [round2(sp * 1.05), round2(sp * 1.1), round2(recMax)].filter((v, i, a) => v > sp + 0.005 && v <= recMax + 0.005 && a.indexOf(v) === i)) {
      out.push({ id: `border.spacing:${to}`, changes: [fix('border.spacing', sp, to)], strength: Math.min(1.5, (to / sp - 1) / SPACING_FULL), kinds: ['density', 'holes'] });
    }
  }
  if (want.has('gap') && (b.pull ?? 0) < 0.3) {
    const to = round2((b.pull ?? 0) + 0.1);
    out.push({ id: `border.pull:${to}`, changes: [fix('border.pull', b.pull ?? 0, to)], strength: 0.1, kinds: ['gap'] });
  }
  return out.sort((a, c) => a.strength - c.strength);
}

/** Tools on a lettering: its density (spacing in times the font's) and underlay. */
export function letteringTools(u: Unit & { kind: 'lettering' }, want: Set<FixKind>): Tool[] {
  const l = u.lettering;
  const out: Tool[] = [];
  if (!(want.has('density') || want.has('holes'))) return out;
  if (l.underlay) out.push({ id: 'lettering.underlayOff', changes: [fix('lettering.underlay', true, false)], strength: 0.2, kinds: ['density', 'holes'] });
  for (const to of [round2(l.density * 1.05), round2(l.density * 1.1), round2(l.density * 1.2)]) {
    if (to <= 1.25 + 1e-9) out.push({ id: `lettering.density:${to}`, changes: [fix('lettering.density', l.density, to)], strength: Math.min(1.5, (to / l.density - 1) / SPACING_FULL), kinds: ['density', 'holes'] });
  }
  return out.sort((a, c) => a.strength - c.strength);
}

/** `s` with dotted fields set ("border.spacing"). */
export function withChanges<T extends object>(s: T, changes: Fixed[]): T {
  const out = structuredClone(s) as Record<string, unknown>;
  for (const c of changes) {
    const path = c.field.split('.');
    let at = out;
    for (const k of path.slice(0, -1)) at = (at[k] ??= {}) as Record<string, unknown>;
    at[path[path.length - 1]] = c.to;
  }
  return out as T;
}

/**
 * The design with unit `u` sewn with `changes` (and leaving out what lies on top); null when that
 * did not work or the objects came out different in number.
 */
export function sewUnit(p: Pattern, u: Unit, changes: Fixed[], knockout: boolean, trimMm: number, force = false): Pattern | null {
  const n = objectsOf(p).length;
  let next: Pattern | null;
  if (u.kind === 'lettering') {
    const l = withChanges({ lettering: u.lettering }, changes).lettering;
    const objs = objectsOf(p);
    const sewn = sewLettering(u.font, l, trimMm);
    next = placeLettering(p, u.objects.map((i) => objs[i]), sewn, l)?.pattern ?? null;
  } else {
    const s = changes.length || force ? ({ kind: u.settings.kind, s: withChanges(u.settings.s, changes) } as Settings) : null;
    next = sewWith(p, u.owner, s, knockout, trimMm);
    // The border follows the fill's shape and its own settings: sewn anew only when those change.
    if (next && (u.kind === 'border' || (knockout && hasBorder(p, u.owner)))) next = syncBorders(next, trimMm);
  }
  return next && objectsOf(next).length === n ? next : null;
}

/** Moves from a stitch to the next one over jumps or a trim, and how many of them are trimmed (as Sprünge und Schnitte counts them). */
export function movesOf(p: Pattern): { moves: number; trims: number } {
  let moves = 0;
  let trims = 0;
  let moved = false;
  let cut = false;
  let stitched = false;
  for (let i = 0; i < p.cmd.length; i++) {
    const c = p.cmd[i];
    if (c === JUMP) moved = true;
    else if (c === TRIM) cut = true;
    // A new color starts anew (see transitions).
    else if (c === COLOR_CHANGE) stitched = moved = cut = false;
    else if (c === STITCH) {
      if (stitched && (moved || cut)) {
        moves++;
        if (cut) trims++;
      }
      stitched = true;
      moved = cut = false;
    }
  }
  return { moves, trims };
}

/**
 * The stitches of objects `which` of `p` as one pattern, separated by jumps (no thread between),
 * and which of its records are underlay.
 */
export function stitchesOf(p: Pattern, which: number[]): Pattern & { under: Uint8Array } {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const under: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const cs: number[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of which) {
    const o = objs[i];
    if (!o) continue;
    if (cs.length) {
      xs.push(p.x[o.first]);
      ys.push(p.y[o.first]);
      cs.push(JUMP);
      under.push(0);
    }
    const ranges = underlayRanges(p, o, kinds);
    for (let r = o.first; r <= o.last; r++) {
      xs.push(p.x[r]);
      ys.push(p.y[r]);
      cs.push(p.cmd[r]);
      under.push(ranges.some(([a, b]) => r >= a && r <= b) ? 1 : 0);
      if (p.cmd[r] === STITCH) {
        minX = Math.min(minX, p.x[r]);
        maxX = Math.max(maxX, p.x[r]);
        minY = Math.min(minY, p.y[r]);
        maxY = Math.max(maxY, p.y[r]);
      }
    }
  }
  if (minX === Infinity) minX = minY = maxX = maxY = 0;
  return { name: p.name, format: p.format, x: Int32Array.from(xs), y: Int32Array.from(ys), cmd: Uint8Array.from(cs), colors: p.colors, bounds: { minX, minY, maxX, maxY }, under: Uint8Array.from(under) };
}

/**
 * How a tool changes the thread of a unit, when that can be told without sewing: rows looser by a
 * factor (`scale`: thread of the top stitches times it), or the underlay gone, halved or left out
 * where covered. Null: it has to be sewn to know.
 */
export function predictable(t: { id: string; changes: Fixed[] }): { scale?: number; under?: number | 'covered' } | null {
  const id = t.id.split(':')[0];
  if (id === 'spacing' || id === 'border.spacing' || id === 'lettering.density') {
    const c = t.changes[0];
    return { scale: Number(c.from) / Number(c.to) };
  }
  if (id === 'underlayOff' || id === 'border.underOff' || id === 'lettering.underlayOff') return { under: 0 };
  if (id === 'underCross') return { under: 0.5 };
  if (id === 'underCover') return { under: 'covered' };
  return null;
}
