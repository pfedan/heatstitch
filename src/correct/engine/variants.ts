import { coversOver } from '../../model/covers';
import { setKnockout, takeOver } from '../../model/knockout';
import { sewObjects, stitchKey, type SewObject } from '../../model/objects';
import { STITCH, type Pattern } from '../../model/pattern';
import { analyze, isGradient, isOpenPattern, remembered, restitch, SATIN_SPLIT, shapeTrust, type Fixed, type Settings } from '../../model/restitch';
import { stitchKinds } from '../../model/sequence';
import { currentSettings } from '../plan';
import { fabricOf, recommendedSpacing, type Profile } from '../../validation/profiles';
import type { FixKind } from './cells';
import { areaOf } from '../../model/geo';

/**
 * What the engine may change on one object, as variants: each a set of settings changes (the same
 * ones the stitch card offers by hand) plus leaving out what lies on top, sewn anew from the
 * object's shape. Which tools are tried follows the cause found for the object (see diagnose.ts).
 */

/** How an object takes part in the correction. */
export type Role =
  /** Sewn anew from its shape with other settings. */
  | 'settings'
  /** Not sewn anew: shape only guessed, changed by hand, or locked / derived. */
  | 'fixed';

/** A tool: one change a digitizer would make, and how strongly it shows where the object is visible. */
export interface Tool {
  id: string;
  changes: Fixed[];
  knockout?: boolean;
  /** 0: never visible (underlay, leaving out under cover), 1: a change you see where it lies on top. */
  strength: number;
  /** Visible on any account (fill angle): only ever a proposal. */
  visible?: boolean;
  kinds: FixKind[];
}

/** One sewn variant of an object. */
export interface Variant {
  tools: Tool[];
  changes: Fixed[];
  knockout: boolean;
  /** Stitch records of the object alone, as sewn with the variant (index 0: as it is now); none when predicted. */
  stitches?: Pattern;
  strength: number;
  visible: boolean;
  /** Its thread was predicted from a sewn variant (looser rows, less underlay), not sewn. */
  predicted?: boolean;
  /** How much more it is sewn apart than now (trims and jumps it adds), in the measure of visibility. */
  apart?: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const fix = (field: string, from: Fixed['from'] | undefined, to: Fixed['to']): Fixed => ({ field, from: from ?? '', to });
const SMALL_FILL_MM2 = 40;
const NARROW_SATIN = 2;
const MEDIUM_SATIN = 4;
const MAX_FILL_EDGE = 0.5;
const MAX_SATIN_EDGE = 0.3;
/** Spacing as a share of itself that counts as a full-strength change where visible. */
const SPACING_FULL = 0.15;

/** Records first..last of `p` as a pattern of their own (for measuring one object). */
export function slice(p: Pattern, first: number, last: number): Pattern {
  const x = p.x.slice(first, last + 1);
  const y = p.y.slice(first, last + 1);
  const cmd = p.cmd.slice(first, last + 1);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < cmd.length; i++) {
    if (cmd[i] !== STITCH) continue;
    if (x[i] < minX) minX = x[i];
    if (x[i] > maxX) maxX = x[i];
    if (y[i] < minY) minY = y[i];
    if (y[i] > maxY) maxY = y[i];
  }
  if (minX === Infinity) minX = minY = maxX = maxY = 0;
  return { name: p.name, format: p.format, x, y, cmd, colors: p.colors, bounds: { minX, minY, maxX, maxY } };
}

/** Median length (mm) of an object's stitches over 1 mm: about the width of a satin. */
export function satinWidth(p: Pattern, o: SewObject): number {
  const ls: number[] = [];
  for (let i = o.first + 1; i <= o.last; i++) {
    if (p.cmd[i] !== STITCH || p.cmd[i - 1] !== STITCH) continue;
    const l = Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) / 10;
    if (l > 1) ls.push(l);
  }
  ls.sort((a, b) => a - b);
  return ls.length ? ls[ls.length >> 1] : 0;
}

/** Whether the object may be sewn anew, and its settings now. */
export function roleOf(p: Pattern, _objs: SewObject[], o: SewObject, kinds: Uint8Array, allowHand = false): { role: Role; settings: Settings | null; why?: string } {
  const known = remembered(p, o);
  if (known?.lock) return { role: 'fixed', settings: null, why: 'lock' };
  if (known?.outline || known?.blendOf || known?.shadowOf || known?.echoOf) return { role: 'fixed', settings: null, why: 'derived' };
  if (known?.lettering) return { role: 'fixed', settings: null, why: 'lettering' };
  if (known?.free) return { role: 'fixed', settings: null, why: 'free' };
  if (known?.hand && !allowHand) return { role: 'fixed', settings: null, why: 'hand' };
  if (known?.read) return { role: 'fixed', settings: null, why: 'guessed' };
  // Stitches from elsewhere are measured, which is slow; the same stitches measure the same.
  const key = known ? null : stitchKey(p, o.first, o.last);
  const had = key ? measured.get(key) : undefined;
  if (had) return had;
  const r = roleNow(p, o, kinds, known);
  if (key) {
    measured.set(key, r);
    if (measured.size > 200) measured.delete(measured.keys().next().value!);
  }
  return r;
}

const measured = new Map<string, { role: Role; settings: Settings | null; why?: string }>();

function roleNow(p: Pattern, o: SewObject, kinds: Uint8Array, known: ReturnType<typeof remembered>): { role: Role; settings: Settings | null; why?: string } {
  const s = currentSettings(p, o, kinds);
  if (!s) return { role: 'fixed', settings: null, why: 'unknown' };
  // A line of a kind of its own (motif, zigzag, E stitch...) read as running stitch: sewn anew as one
  // it would lose its look.
  if (s.kind === 'run' && known?.line && known.line.type !== 'run' && known.line.type !== 'triple') return { role: 'fixed', settings: null, why: 'line' };
  if (s.kind === 'fill') {
    if (isOpenPattern(s.s.pattern) || s.s.pattern === 'none') return { role: 'fixed', settings: null, why: 'open' };
    const an = analyze(p, o, kinds, known);
    if (shapeTrust(p, o, an, s.s.spacing) === 'approximate') return { role: 'fixed', settings: null, why: 'guessed' };
  }
  return { role: 'settings', settings: s };
}

/**
 * The tools for object `o` against the kinds `want`; `covered`: later objects lie on part of it.
 * Ordered from least to most visible.
 */
export function toolsFor(p: Pattern, objs: SewObject[], o: SewObject, s: Settings, want: Set<FixKind>, profile: Profile, areaMm2: number): Tool[] {
  const out: Tool[] = [];
  const [, recMax] = recommendedSpacing(profile);
  const longMm = fabricOf(profile).longMm;
  const known = remembered(p, o);
  const dense = want.has('density') || want.has('holes');
  const steps = (from: number, kinds: FixKind[]) => {
    const list = [round2(from * 1.05), round2(from * 1.1), round2(recMax)].filter((v, i, a) => v > from + 0.005 && v <= recMax + 0.005 && a.indexOf(v) === i);
    for (const to of list) out.push({ id: `spacing:${to}`, changes: [fix('spacing', from, to)], strength: Math.min(1.5, (to / from - 1) / SPACING_FULL), kinds });
  };
  if (s.kind === 'fill') {
    const f = s.s;
    const covered = dense ? coversOver(p, objs, o, 0.1).length > 0 : false;
    if (dense) {
      if (covered && areaOf(known) && !known!.knockout) out.push({ id: 'knockout', changes: [], knockout: true, strength: 0, kinds: ['density', 'holes'] });
      if (covered && f.underlay && !f.underCover) out.push({ id: 'underCover', changes: [fix('underCover', false, true)], strength: 0, kinds: ['density', 'holes'] });
      if (f.underlay && f.underCross) out.push({ id: 'underCross', changes: [fix('underCross', true, false)], strength: 0, kinds: ['density', 'holes'] });
      if (f.underlay && areaMm2 < SMALL_FILL_MM2 * 2) out.push({ id: 'underlayOff', changes: [fix('underlay', true, false)], strength: areaMm2 < SMALL_FILL_MM2 ? 0 : 0.3, kinds: ['density', 'holes'] });
      if (!isGradient(f)) steps(f.spacing, ['density', 'holes']);
      if (f.pattern === 'tatami' && Number.isFinite(f.angle)) out.push({ id: 'angle', changes: [fix('angle', f.angle, (f.angle + 90) % 180)], strength: 1, visible: true, kinds: ['density'] });
    }
    if (want.has('sparse')) {
      if (!isGradient(f) && f.spacing > recMax + 0.005) out.push({ id: `spacing:${round2(recMax)}`, changes: [fix('spacing', f.spacing, round2(recMax))], strength: Math.min(1.5, (1 - recMax / f.spacing) / SPACING_FULL), kinds: ['sparse'] });
      if (!f.underlay && areaMm2 >= SMALL_FILL_MM2) out.push({ id: 'underlayOn', changes: [fix('underlay', false, true)], strength: 0, kinds: ['sparse'] });
    }
    if (want.has('gap') && f.edge < MAX_FILL_EDGE - 0.01) {
      for (const d of [0.1, 0.2]) {
        const to = round2(Math.min(MAX_FILL_EDGE, f.edge + d));
        if (to > f.edge + 0.005) out.push({ id: `edge:${to}`, changes: [fix('edge', f.edge, to)], strength: d, kinds: ['gap'] });
      }
    }
  } else if (s.kind === 'satin') {
    const t = s.s;
    const w = satinWidth(p, o);
    if (dense) {
      if (!t.short) out.push({ id: 'short', changes: [fix('short', false, true)], strength: 0.1, kinds: ['density', 'holes'] });
      if (t.underlay && w > 0 && w < NARROW_SATIN) out.push({ id: 'underlayOff', changes: [fix('underlay', true, false)], strength: 0, kinds: ['density', 'holes'] });
      else if (t.underlay && w < MEDIUM_SATIN && (t.under ?? 'auto') !== 'center') out.push({ id: 'underCenter', changes: [fix('under', t.under ?? 'auto', 'center')], strength: 0, kinds: ['density', 'holes'] });
      if (!t.byWidth && t.type !== 'e') out.push({ id: 'byWidth', changes: [fix('byWidth', false, true)], strength: 0.4, kinds: ['density', 'holes'] });
      steps(t.spacing, ['density', 'holes']);
    }
    if (want.has('sparse') && t.spacing > recMax + 0.005) out.push({ id: `spacing:${round2(recMax)}`, changes: [fix('spacing', t.spacing, round2(recMax))], strength: Math.min(1.5, (1 - recMax / t.spacing) / SPACING_FULL), kinds: ['sparse'] });
    if (want.has('gap') && t.edge < MAX_SATIN_EDGE - 0.01) {
      for (const d of [0.1, 0.2]) {
        const to = round2(Math.min(MAX_SATIN_EDGE, t.edge + d));
        if (to > t.edge + 0.005) out.push({ id: `edge:${to}`, changes: [fix('edge', t.edge, to)], strength: d, kinds: ['gap'] });
      }
    }
    if (want.has('long') && (t.split ?? SATIN_SPLIT) > longMm) {
      out.push({ id: 'split', changes: [fix('split', t.split ?? SATIN_SPLIT, longMm), ...(t.stagger === false ? [fix('stagger', false, true)] : [])], strength: 0.3, kinds: ['long'] });
    }
  } else {
    const r = s.s;
    if (want.has('holes') && r.stitch < 2) out.push({ id: 'stitch:2.5', changes: [fix('stitch', r.stitch, 2.5)], strength: 0.3, kinds: ['holes'] });
    if (want.has('long') && r.stitch > longMm) out.push({ id: `stitch:${Math.min(4, longMm)}`, changes: [fix('stitch', r.stitch, Math.min(4, longMm))], strength: 0.3, kinds: ['long'] });
  }
  return out.sort((a, b) => a.strength - b.strength);
}

/**
 * Tool sets to sew: each tool alone, and the ladder of the invisible ones taken together with each
 * visible one on top (a digitizer first does what does not show, then adds the least visible step).
 * Spacing steps exclude each other.
 */
export function toolSets(tools: Tool[], max = 10): Tool[][] {
  const group = (t: Tool) => t.id.split(':')[0];
  const out: Tool[][] = [];
  const seen = new Set<string>();
  const add = (set: Tool[]) => {
    const key = set.map((t) => t.id).sort().join('|');
    if (!set.length || seen.has(key)) return;
    seen.add(key);
    out.push(set);
  };
  const quiet = tools.filter((t) => t.strength === 0);
  const loud = tools.filter((t) => t.strength > 0);
  for (const t of tools) add([t]);
  for (let k = 2; k <= quiet.length; k++) add(quiet.slice(0, k));
  for (const t of loud) {
    if (quiet.length) add([...quiet, t]);
    // The least visible other kinds of change with it.
    const other = loud.find((u) => group(u) !== group(t) && u.strength <= t.strength);
    if (other) add([...quiet, other, t]);
  }
  return out.slice(0, max);
}

/** Object `index` of `p` sewn with `s` (and leaving out what lies on top); null when that did not work. */
export function sewWith(p: Pattern, index: number, s: Settings | null, knockout: boolean, trimMm: number): Pattern | null {
  let cur = p;
  if (s) {
    const kinds = stitchKinds(cur);
    const objs = sewObjects(cur, kinds);
    const r = restitch(cur, objs, [index], s, kinds, trimMm);
    if (r.failed.length || !r.starts.length) return null;
    const next = takeOver(r);
    if (!next) return null;
    cur = next;
  }
  if (knockout) {
    const k = setKnockout(cur, [index], true, trimMm);
    if (!k) return null;
    cur = k.pattern;
  }
  return cur;
}

/** Settings with `changes` made (field by field). */
export function changed(s: Settings, changes: Fixed[]): Settings {
  const out = structuredClone(s) as Settings;
  for (const c of changes) (out.s as unknown as Record<string, unknown>)[c.field] = c.to;
  return out;
}

/** The changes of a tool set in one list (the last value of a field wins). */
export function merged(set: Tool[]): Fixed[] {
  const out: Fixed[] = [];
  for (const t of set) {
    for (const c of t.changes) {
      const had = out.find((x) => x.field === c.field);
      if (had) had.to = c.to;
      else out.push({ ...c });
    }
  }
  return out;
}

/**
 * Sews the variants of object `index`: the current one first, then one per tool set. A variant that
 * fails, or changes how many objects there are, is dropped.
 */
export function sewVariants(p: Pattern, index: number, s: Settings, sets: Tool[][], trimMm: number): Variant[] {
  const objs = sewObjects(p);
  const o = objs[index];
  const out: Variant[] = [{ tools: [], changes: [], knockout: false, stitches: slice(p, o.first, o.last), strength: 0, visible: false }];
  for (const set of sets) {
    const changes = merged(set);
    const knockout = set.some((t) => t.knockout);
    const next = sewWith(p, index, changes.length ? changed(s, changes) : null, knockout, trimMm);
    if (!next) continue;
    const no = sewObjects(next);
    if (no.length !== objs.length) continue;
    const x = no[index];
    out.push({
      tools: set,
      changes,
      knockout,
      stitches: slice(next, x.first, x.last),
      strength: Math.max(0, ...set.map((t) => t.strength)),
      visible: set.some((t) => t.visible),
    });
  }
  return out;
}
