import { setKnockout, isCovered, takeOver } from '../model/knockout';
import { sewObjects, type ObjectKind, type SewObject } from '../model/objects';
import { STITCH, TRIM, type Pattern } from '../model/pattern';
import {
  analyze,
  holdMemory,
  measureFill,
  measureRun,
  measureSatin,
  objectKey,
  openOnPurpose,
  remember,
  remembered,
  restitch,
  shapeTrust,
  SATIN_SPLIT,
  type Fixed,
  type Remembered,
  type Settings,
} from '../model/restitch';
import { stitchKinds } from '../model/sequence';
import { withRecords } from '../model/edit';
import { settledBy, type Acknowledgement } from '../validation/acks';
import { measurePattern } from '../validation/measure';
import { fabricOf, recommendedSpacing, type Profile } from '../validation/profiles';
import { classify, CRITICAL, type Checks, type Reason, type ValidationResult, type Zone } from '../validation/validate';
import type { CorrectionFocus } from './auto';

/**
 * Korrektur 2.0: the correction as a digitizer would do it. Instead of moving stitches it changes
 * the settings of the objects (row spacing, underlay, pull compensation, leaving out what lies on
 * top) and sews them anew from their shape. The result is a list of proposals the user ticks and
 * takes over; nothing changes before that.
 *
 * Guardrails: the kind of stitch and the fill pattern stay, the shape stays, invisible changes come
 * before visible ones, the lower object before the upper one, locked objects stay as they are.
 * Objects whose shape could not be read reliably are not sewn anew: they get the fine correction
 * on their stitches. Every change made here is one the stitch card offers by hand as well.
 */

export type Visibility = 'invisible' | 'slight' | 'visible';
const VIS_RANK: Record<Visibility, number> = { invisible: 0, slight: 1, visible: 2 };

export interface Proposal {
  id: number;
  /** The object in sewing order, and its key in the pattern planned on. */
  index: number;
  key: string;
  kind: ObjectKind;
  /** Settings changed, with their values before and after. */
  changes: Fixed[];
  /** Leave out what lies on top. */
  knockout?: boolean;
  visibility: Visibility;
  /** The findings it helps against. */
  reasons: Reason[];
  /** Changes by hand it would replace. */
  hand: number;
  /** Ticked: taken over with "Ausgewählte übernehmen". */
  checked: boolean;
  /** The object's stitches (mm, world), to show where it is. */
  box: Box;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Plan {
  proposals: Proposal[];
  /** Zones on objects whose shape is not certain: only the fine correction there. */
  fine: Box[];
  /** Objects left as they are because they are locked. */
  locked: number;
  /** The pattern with all proposals taken over (for the before and after figures). */
  pattern: Pattern;
}

export interface PlanOptions {
  goal: 'caution' | 'critical';
  focus: CorrectionFocus;
  region?: Box;
  acks?: Acknowledgement[];
  trimMm: number;
  /** Called between tries, so the page stays responsive and shows how far it got. */
  progress?: (done: number, total: number) => Promise<void> | void;
  /** True when the plan is no longer wanted (the file changed): it stops early. */
  stale?: () => boolean;
}

/** Fills smaller than this (mm²) need no underlay. */
const SMALL_FILL_MM2 = 40;
/** Satin narrower than this (mm) needs no underlay, up to the next a centre run only. */
const NARROW_SATIN = 2;
const MEDIUM_SATIN = 4;
/** Most a fill's rows reach further, and a satin grows per side, against gaps (mm). */
const MAX_FILL_EDGE = 0.5;
const MAX_SATIN_EDGE = 0.3;
/** Around the area looked at, measured too (mm), so the edges are measured as in the whole. */
const MARGIN_MM = 3;
/** At most this many objects are tried (lowest first). */
const MAX_OBJECTS = 60;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Reasons the plan answers for a zone, by goal and focus; lower limits always. */
export function wanted(z: Zone, o: Pick<PlanOptions, 'goal' | 'focus'>): Reason[] {
  const out: Reason[] = [];
  const upper = o.goal === 'caution' || z.level === CRITICAL;
  for (const r of z.reasons) {
    if (r === 'sparse' || r === 'gap' || r === 'long') out.push(r);
    else if (!upper) continue;
    else if (r === 'density' && o.focus !== 'holes') out.push(r);
    else if (r === 'perforation' && o.focus !== 'thread') out.push(r);
    else if (r === 'shortStitches') out.push(r);
  }
  return out;
}

const overlaps = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
const boxOf = (o: SewObject): Box => ({ minX: o.minX / 10, minY: o.minY / 10, maxX: o.maxX / 10, maxY: o.maxY / 10 });
const grow = (b: Box, d: number): Box => ({ minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d });
const join = (a: Box, b: Box): Box => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) });

/** Whether object `o` has a stitch inside `b`. */
function sewsIn(p: Pattern, o: SewObject, b: Box): boolean {
  if (!overlaps(boxOf(o), b)) return false;
  for (let i = o.first; i <= o.last; i++) {
    if (p.cmd[i] !== STITCH) continue;
    const x = p.x[i] / 10;
    const y = p.y[i] / 10;
    if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) return true;
  }
  return false;
}

/**
 * The stitches of `p` inside `b` only (mm), with their own records, so a part of a design can be
 * measured quickly. Thread leaving the window is cut there (a trim), `skip` follows the records.
 */
export function crop(p: Pattern, b: Box, skip?: Uint8Array): { pattern: Pattern; skip?: Uint8Array } {
  const x0 = b.minX * 10;
  const y0 = b.minY * 10;
  const x1 = b.maxX * 10;
  const y1 = b.maxY * 10;
  const xs: number[] = [];
  const ys: number[] = [];
  const cs: number[] = [];
  const sk: number[] = [];
  let cut = true;
  for (let i = 0; i < p.cmd.length; i++) {
    if (p.cmd[i] !== STITCH) {
      cut = true;
      continue;
    }
    const x = p.x[i];
    const y = p.y[i];
    if (x < x0 || x > x1 || y < y0 || y > y1) {
      cut = true;
      continue;
    }
    if (cut && xs.length) {
      xs.push(x);
      ys.push(y);
      cs.push(TRIM);
      sk.push(0);
    }
    xs.push(x);
    ys.push(y);
    cs.push(STITCH);
    sk.push(skip?.[i] ?? 0);
    cut = false;
  }
  const pattern = withRecords(p, Int32Array.from(xs), Int32Array.from(ys), Uint8Array.from(cs));
  return { pattern, skip: skip ? Uint8Array.from(sk) : undefined };
}

interface Score {
  critical: number;
  total: number;
}

/** Findings inside `b` (mm): critical cells count four times, caution cells once. */
function score(p: Pattern, b: Box, profile: Profile, checks: Checks): Score {
  const open = openOnPurpose(p, sewObjects(p));
  const c = crop(p, grow(b, MARGIN_MM), open ?? undefined);
  if (!c.pattern.cmd.length) return { critical: 0, total: 0 };
  const v = classify(measurePattern(c.pattern, c.skip), profile, checks);
  const m = v.measurement;
  let critical = 0;
  let total = 0;
  for (let r = 0; r < m.rows; r++) {
    const y = m.originY + (r + 0.5) * m.cellMm;
    if (y < b.minY || y > b.maxY) continue;
    for (let q = 0; q < m.cols; q++) {
      const x = m.originX + (q + 0.5) * m.cellMm;
      if (x < b.minX || x > b.maxX) continue;
      const l = v.level[r * m.cols + q];
      if (l === CRITICAL) critical++;
      total += l === CRITICAL ? 4 : l;
    }
  }
  return { critical, total };
}

/** The settings an object is sewn with now: what it remembers, else as measured from its stitches. */
export function currentSettings(p: Pattern, o: SewObject, kinds: Uint8Array): Settings | null {
  const known = remembered(p, o);
  const an = analyze(p, o, kinds, known);
  const part = an.parts.find((pt) => pt.kind === o.kind && !pt.border);
  if (!part) return null;
  if (o.kind === 'fill') return { kind: 'fill', s: structuredClone(known?.fill ?? measureFill(p, an)) };
  if (o.kind === 'satin') return { kind: 'satin', s: structuredClone(known?.satin ?? measureSatin(p, part, kinds)) };
  return { kind: 'run', s: measureRun(p, part) };
}

/** Settings with `changes` made (field by field). */
function changed(s: Settings, changes: Fixed[]): Settings {
  const out = structuredClone(s) as Settings;
  for (const c of changes) (out.s as unknown as Record<string, unknown>)[c.field] = c.to;
  return out;
}

/** A thing to try on one object: settings to change, or leaving out what lies on top. */
interface Candidate {
  changes: Fixed[];
  knockout?: boolean;
  visibility: Visibility;
  reason: Reason;
  /** Kept apart as a proposal of its own (unticked): a visible change the user decides on. */
  apart?: boolean;
}

const fix = (field: string, from: Fixed['from'] | undefined, to: Fixed['to']): Fixed => ({ field, from: from ?? '', to });

/** Median length (mm) of an object's stitches over 1 mm: about the width of a satin. */
function satinWidth(p: Pattern, o: SewObject): number {
  const ls: number[] = [];
  for (let i = o.first + 1; i <= o.last; i++) {
    if (p.cmd[i] !== STITCH || p.cmd[i - 1] !== STITCH) continue;
    const l = Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) / 10;
    if (l > 1) ls.push(l);
  }
  ls.sort((a, b) => a - b);
  return ls.length ? ls[ls.length >> 1] : 0;
}

/**
 * What a digitizer would try on object `o` against `reasons`, in order: invisible first. Built
 * from its settings now, so a step already taken is not offered again.
 */
function candidates(p: Pattern, objs: SewObject[], o: SewObject, s: Settings, reasons: Set<Reason>, profile: Profile, areaMm2: number): Candidate[] {
  const out: Candidate[] = [];
  const [, recMax] = recommendedSpacing(profile);
  const longMm = fabricOf(profile).longMm;
  const tooMuch = reasons.has('density') || reasons.has('perforation');
  const known = remembered(p, o);
  if (s.kind === 'fill') {
    const f = s.s;
    if (tooMuch) {
      if (known?.form && !known.knockout && isCovered(p, objs, o)) out.push({ changes: [], knockout: true, visibility: 'invisible', reason: 'density' });
      if (f.underlay && f.underCross) out.push({ changes: [fix('underCross', true, false)], visibility: 'invisible', reason: 'density' });
      if (f.underlay && areaMm2 < SMALL_FILL_MM2) out.push({ changes: [fix('underlay', true, false)], visibility: 'invisible', reason: 'density' });
      if (f.pattern !== 'gradient') {
        for (const to of [round2(Math.min(recMax, f.spacing * 1.08)), round2(recMax)]) {
          if (to > f.spacing + 0.005) out.push({ changes: [fix('spacing', f.spacing, to)], visibility: 'slight', reason: 'density' });
        }
      }
      if (f.pattern === 'tatami' && Number.isFinite(f.angle)) {
        out.push({ changes: [fix('angle', f.angle, (f.angle + 90) % 180)], visibility: 'visible', reason: 'density', apart: true });
      }
    }
    if (reasons.has('sparse')) {
      if (f.pattern !== 'gradient' && f.spacing > recMax + 0.005) out.push({ changes: [fix('spacing', f.spacing, round2(recMax))], visibility: 'slight', reason: 'sparse' });
      if (!f.underlay && areaMm2 >= SMALL_FILL_MM2) out.push({ changes: [fix('underlay', false, true)], visibility: 'invisible', reason: 'sparse' });
    }
    if (reasons.has('gap') && f.edge < MAX_FILL_EDGE - 0.01) {
      out.push({ changes: [fix('edge', f.edge, round2(Math.min(MAX_FILL_EDGE, f.edge + 0.2)))], visibility: 'slight', reason: 'gap' });
    }
  } else if (s.kind === 'satin') {
    const t = s.s;
    const w = satinWidth(p, o);
    if (tooMuch || reasons.has('shortStitches')) {
      if (!t.short) out.push({ changes: [fix('short', false, true)], visibility: 'invisible', reason: tooMuch ? 'density' : 'shortStitches' });
    }
    if (tooMuch) {
      if (t.underlay && w > 0 && w < NARROW_SATIN) out.push({ changes: [fix('underlay', true, false)], visibility: 'invisible', reason: 'density' });
      else if (t.underlay && w < MEDIUM_SATIN && (t.under ?? 'auto') !== 'center') out.push({ changes: [fix('under', t.under ?? 'auto', 'center')], visibility: 'invisible', reason: 'density' });
      // Narrow parts are densest: spacing by width loosens them first.
      if (!t.byWidth && t.type !== 'e') out.push({ changes: [fix('byWidth', false, true)], visibility: 'slight', reason: 'density' });
      for (const to of [round2(Math.min(recMax, t.spacing * 1.08)), round2(recMax)]) {
        if (to > t.spacing + 0.005) out.push({ changes: [fix('spacing', t.spacing, to)], visibility: 'slight', reason: 'density' });
      }
    }
    if (reasons.has('sparse') && t.spacing > recMax + 0.005) out.push({ changes: [fix('spacing', t.spacing, round2(recMax))], visibility: 'slight', reason: 'sparse' });
    if (reasons.has('gap') && t.edge < MAX_SATIN_EDGE - 0.01) {
      out.push({ changes: [fix('edge', t.edge, round2(Math.min(MAX_SATIN_EDGE, t.edge + 0.1)))], visibility: 'slight', reason: 'gap' });
      out.push({ changes: [fix('edge', t.edge, round2(MAX_SATIN_EDGE))], visibility: 'slight', reason: 'gap' });
    }
    if (reasons.has('long') && (t.split ?? SATIN_SPLIT) > longMm) {
      out.push({ changes: [fix('split', t.split ?? SATIN_SPLIT, longMm), ...(t.stagger === false ? [fix('stagger', false, true)] : [])], visibility: 'slight', reason: 'long' });
    }
  } else {
    const r = s.s;
    if (reasons.has('shortStitches') && r.stitch < 2) out.push({ changes: [fix('stitch', r.stitch, 2.5)], visibility: 'slight', reason: 'shortStitches' });
    if (reasons.has('long') && r.stitch > longMm) out.push({ changes: [fix('stitch', r.stitch, Math.min(4, longMm))], visibility: 'slight', reason: 'long' });
  }
  return out;
}

/** Object `index` of `p` sewn with `s` (and leaving out what lies on top); null when that did not work. */
function sewWith(p: Pattern, index: number, s: Settings | null, knockout: boolean, trimMm: number): Pattern | null {
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

/** Merges a change into a list: the first value stays, the last one wins. */
function mergeChanges(list: Fixed[], add: Fixed[]): Fixed[] {
  const out = list.map((c) => ({ ...c }));
  for (const c of add) {
    const had = out.find((x) => x.field === c.field);
    if (had) had.to = c.to;
    else out.push({ ...c });
  }
  return out.filter((c) => c.from !== c.to);
}

/**
 * Proposals for the findings of `v` (the validation of `p`). Tries each candidate on its object,
 * measures the area around it again and keeps it when the findings there get fewer and none gets
 * critical. Memory is put back afterwards: planning changes nothing.
 */
export async function planCorrection(p: Pattern, v: ValidationResult, profile: Profile, checks: Checks, opt: PlanOptions): Promise<Plan> {
  const release = holdMemory();
  try {
    return await plan(p, v, profile, checks, opt);
  } finally {
    release();
  }
}

async function plan(p: Pattern, v: ValidationResult, profile: Profile, checks: Checks, opt: PlanOptions): Promise<Plan> {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const zones = v.zones.filter((z) => !z.practice && !settledBy(z, opt.acks) && (!opt.region || overlaps(z.bbox, opt.region)));
  // Per object: the reasons it is tried for, and the zones it takes part in.
  const need = new Map<number, { reasons: Set<Reason>; box: Box }>();
  for (const z of zones) {
    const rs = wanted(z, opt);
    if (!rs.length) continue;
    const zb = grow(z.bbox, 0.5);
    for (const o of objs) {
      if (!sewsIn(p, o, zb)) continue;
      const n = need.get(o.index) ?? { reasons: new Set<Reason>(), box: boxOf(o) };
      rs.forEach((r) => n.reasons.add(r));
      n.box = join(n.box, z.bbox);
      need.set(o.index, n);
    }
  }
  const order = [...need.keys()].sort((a, b) => a - b).slice(0, MAX_OBJECTS);
  const proposals: Proposal[] = [];
  const fine: Box[] = [];
  let locked = 0;
  let cur = p;
  let id = 0;
  for (const [done, index] of order.entries()) {
    await opt.progress?.(done, order.length);
    if (opt.stale?.()) break;
    const o0 = objs[index];
    const known = remembered(p, o0);
    if (known?.lock) {
      locked++;
      continue;
    }
    // Borders follow their fill, lettering is sewn from its text.
    if (known?.outline || known?.lettering) continue;
    const { reasons, box } = need.get(index)!;
    const an = analyze(p, o0, kinds, known);
    const base = currentSettings(p, o0, kinds);
    if (!base) continue;
    // A fill whose shape was only guessed is not sewn anew: fine correction only.
    if (base.kind === 'fill' && shapeTrust(p, o0, an, base.s.spacing) === 'approximate') {
      fine.push(box);
      continue;
    }
    if (known?.read) {
      fine.push(box);
      continue;
    }
    const area = an.fill?.areaMm2 ?? 0;
    const where = grow(box, 1);
    let best = score(cur, where, profile, checks);
    let settings = base;
    let knockout = false;
    let taken: Fixed[] = [];
    let vis: Visibility = 'invisible';
    const why = new Set<Reason>();
    const tried = new Set<string>();
    const apart: Candidate[] = [];
    // Again and again from the settings reached, until nothing more helps.
    for (let round = 0; round < 6; round++) {
      const list = candidates(cur, sewObjects(cur), sewObjects(cur)[index], settings, reasons, profile, area).filter((c) => {
        const k = JSON.stringify([c.changes.map((x) => [x.field, x.to]), c.knockout]);
        if (tried.has(k)) return false;
        tried.add(k);
        return true;
      });
      if (!list.length) break;
      let moved = false;
      for (const c of list) {
        if (opt.stale?.()) break;
        if (c.apart) {
          apart.push(c);
          continue;
        }
        if (c.knockout && knockout) continue;
        const s = c.changes.length ? changed(settings, c.changes) : null;
        const next = sewWith(cur, index, s, !!c.knockout, opt.trimMm);
        if (!next || sewObjects(next).length !== objs.length) continue;
        const sc = score(next, where, profile, checks);
        await opt.progress?.(done, order.length);
        if (sc.critical > best.critical || sc.total >= best.total) continue;
        cur = next;
        best = sc;
        if (s) settings = s;
        if (c.knockout) knockout = true;
        taken = mergeChanges(taken, c.changes);
        if (VIS_RANK[c.visibility] > VIS_RANK[vis]) vis = c.visibility;
        why.add(c.reason);
        moved = true;
        break;
      }
      if (!moved) break;
    }
    const hand = known?.hand ?? 0;
    const key = objectKey(p, o0);
    if (taken.length || knockout) {
      proposals.push({ id: id++, index, key, kind: o0.kind, changes: taken, ...(knockout ? { knockout } : {}), visibility: vis, reasons: [...why], hand, checked: !hand && vis !== 'visible', box: boxOf(o0) });
    }
    // A visible change only when it helps on top of the rest; it stays unticked.
    for (const c of apart) {
      const s = changed(settings, c.changes);
      const next = sewWith(cur, index, s, false, opt.trimMm);
      if (!next || sewObjects(next).length !== objs.length) continue;
      const sc = score(next, where, profile, checks);
      if (sc.critical > best.critical || sc.total >= best.total) continue;
      proposals.push({ id: id++, index, key, kind: o0.kind, changes: c.changes, visibility: 'visible', reasons: [c.reason], hand, checked: false, box: boxOf(o0) });
    }
  }
  await opt.progress?.(order.length, order.length);
  return { proposals, fine, locked, pattern: cur };
}

/**
 * Takes over the proposals `chosen` (all from one plan on `p`): each object sewn anew with its
 * changes, remembering what the correction changed. Null when nothing could be taken over.
 */
export function applyProposals(p: Pattern, chosen: Proposal[], trimMm: number): { pattern: Pattern; done: number } | null {
  const byKey = new Map<string, Proposal[]>();
  for (const x of [...chosen].sort((a, b) => a.index - b.index)) byKey.set(x.key, [...(byKey.get(x.key) ?? []), x]);
  let cur = p;
  let done = 0;
  for (const [key, list] of byKey) {
    const kinds = stitchKinds(cur);
    const objs = sewObjects(cur, kinds);
    const o = objs.find((x) => objectKey(cur, x) === key);
    if (!o) continue;
    const base = currentSettings(cur, o, kinds);
    const changes = list.reduce<Fixed[]>((a, x) => mergeChanges(a, x.changes), []);
    const knockout = list.some((x) => x.knockout);
    const next = sewWith(cur, o.index, changes.length && base ? changed(base, changes) : null, knockout, trimMm);
    if (!next) continue;
    cur = next;
    done += list.length;
    const after = sewObjects(cur)[o.index];
    const mem = after && remembered(cur, after);
    if (mem) remember(cur, after, { ...mem, fixed: [...changes, ...(knockout ? [fix('knockout', false, true)] : [])] });
  }
  return done ? { pattern: cur, done } : null;
}

/** An object that remembers its shape exactly (moving its stitches would lose that). */
const keepsShape = (m: Remembered | undefined) => !!m && !m.read && !!(m.region || m.fill || m.satin || m.form || m.path || m.columns);

/**
 * Where the fine correction on the stitches is left to do after the proposals (`after`: the
 * validation with them): open findings on objects that no proposal changes and that remember no
 * shape of their own (moving their stitches would lose it). Boxes in mm.
 */
export function fineZones(p: Pattern, after: ValidationResult, proposals: Proposal[], opt: Omit<PlanOptions, 'trimMm'>): Box[] {
  const objs = sewObjects(p);
  const changing = new Set(proposals.map((x) => x.index));
  const out: Box[] = [];
  for (const z of after.zones) {
    if (z.practice || settledBy(z, opt.acks) || (opt.region && !overlaps(z.bbox, opt.region))) continue;
    if (!wanted(z, opt).length) continue;
    const zb = grow(z.bbox, 0.5);
    const involved = objs.filter((o) => sewsIn(p, o, zb));
    if (!involved.length || involved.some((o) => changing.has(o.index) || keepsShape(remembered(p, o)) || remembered(p, o)?.lock)) continue;
    out.push(z.bbox);
  }
  return out;
}
