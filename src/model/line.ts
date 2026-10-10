import { BORDER_STITCH, BORDER_WIDTH } from '../digitize/border';
import { TOLERANCE } from '../digitize/run';
import { echoLines, type EchoLine } from '../digitize/echo';
import type { Pt } from '../digitize/skeleton';
import { flatten, type Form, type Node } from '../shape/path';
import { fitCubic } from '../shape/vectorize';
import { rasterize } from '../shape/rasterize';
import { hasPhase, isRunType, passesOf, sewAlong, spacingOf, type PathStitch } from './along';
import { runRecords } from './border';
import { tidy, withRecords } from './edit';
import { rememberObjects, sewObjects, stitchKey, type SewObject } from './objects';
import { JUMP, STITCH, type Pattern } from './pattern';
import { analyze, borderOf, measureFill, objectKey, remember, remembered, restitch, trimBefore, type BorderSettings, type FillSettings, type Rec, type Remembered, type RestitchResult, type RunSettings } from './restitch';
import { stitchKinds, TIE_STITCH } from './sequence';
import { bandArea, fits, geoOf, geoUse, guessArea, lineGeoOf } from './geo';
import { partOf } from './shadow';

/**
 * Lines: sewn along their curves with the same stitches as the border of a fill (along.ts), so
 * they stay exactly where they were drawn and follow every change of their nodes. The object
 * remembers its paths as its form (`geo`) and how it is sewn along them as `line` (running or bean
 * stitch, satin, zigzag or E stitch).
 * Running stitches without curves (from a PES or DST file) get one traced through their stitches
 * the first time they are changed as a line.
 */

/** Running stitch of a drawn line when nothing else is set. */
export const LINE_RUN: RunSettings = { stitch: BORDER_STITCH, triple: false, tolerance: TOLERANCE };

/** Lines from this wide (mm) are sewn as satin, thinner ones in running stitch. */
export const LINE_SATIN = 1;

/** How a line of `width` (mm, as drawn or in an SVG) is sewn to begin with. */
export function lineStitchFor(width: number, tolerance = TOLERANCE): PathStitch {
  return width >= LINE_SATIN ? { type: 'satin', width, tolerance } : { type: 'run', width: BORDER_WIDTH, length: BORDER_STITCH, tolerance };
}

/** The settings of running stitch as those of a line. */
export const runAsLine = (s: RunSettings, width = BORDER_WIDTH): PathStitch => ({ type: s.triple ? 'triple' : 'run', width, length: s.stitch, tolerance: s.tolerance });

/** The stitches along the paths of `form`, one after the other, each from the end nearest the one before (the first from `from` when given). */
export function lineStitches(form: Form, st: PathStitch, reverse = false, from?: Pt): Pt[][] {
  let paths = form.paths.map((p) => ({ pts: flatten(p), closed: p.closed })).filter((x) => x.pts.length >= 2);
  if (reverse) paths = paths.reverse().map((x) => ({ ...x, pts: x.pts.slice().reverse() }));
  const out: Pt[][] = [];
  let at: Pt | undefined = from;
  for (const x of paths) {
    const pts = x.closed && x.pts.length > 2 && !samePt(x.pts[0], x.pts[x.pts.length - 1]) ? [...x.pts, x.pts[0]] : x.pts;
    const runs = st.echo ? echoStitches(pts, x.closed, st, at, reverse) : sewAlong(pts, x.closed, st, at, undefined, reverse);
    out.push(...runs);
    const last = runs[runs.length - 1];
    if (last) at = last[last.length - 1];
  }
  return out;
}

/** Running stitch along the paths of `form` (see lineStitches). */
export const lineRuns = (form: Form, s: RunSettings, reverse = false): Pt[][] => lineStitches(form, runAsLine(s), reverse);

/**
 * A line with its echo (see digitize/echo.ts): the line and its copies one after the other, in the
 * order the echo asks for. Running and triple stitch go from one to the next in a single run, a
 * short stitch across; other stitches are sewn copy by copy, each with what lies to one side of the
 * line on that same side. A zigzag, E stitch or motif keeps its figures in step from copy to copy,
 * counted from where the line was drawn to start, each copy the echo's phase on from the one before.
 */
function echoStitches(line: Pt[], closed: boolean, st: PathStitch, from?: Pt, reverse = false): Pt[][] {
  const e = st.echo!;
  const passes = passesOf(st);
  let lines = echoLines(line, closed, e, 0, !closed && passes % 2 === 0);
  if (!lines.length) return [];
  // From the end nearest the needle, where the order allows it: copies on both sides of an open line
  // have no inside or outside.
  const first = lines[0].line[0];
  const last = lines[lines.length - 1].line[lines[lines.length - 1].line.length - 1];
  const free = !closed && e.side === 'both';
  if (free && from && Math.hypot(last[0] - from[0], last[1] - from[1]) < Math.hypot(first[0] - from[0], first[1] - from[1])) {
    lines = lines.reverse().map((l) => ({ ...l, line: l.line.slice().reverse(), back: !l.back }));
  }
  // A motif fits whole figures into each line. The copies of an open line get as many as the line
  // itself, stretched a little where a copy is longer, so none gets a figure more and runs out of
  // step; the rings of a loop fit their own, as many as the line's figure length gives.
  const plain = { ...st, echo: undefined };
  const figures = Math.max(1, Math.round(lengthOf(line) / Math.max(0.5, spacingOf(st))));
  const periodOf = (l: EchoLine): number => {
    if (st.type !== 'motif') return spacingOf(st);
    const d = lengthOf(line) / figures;
    return l.closed ? lengthOf(l.line) / Math.max(1, Math.round(lengthOf(l.line) / d)) : lengthOf(l.line) / figures;
  };
  const stitchOf = (l: EchoLine): PathStitch => (st.type === 'motif' ? { ...plain, spacing: periodOf(l) } : plain);
  const shiftOf = (l: EchoLine): number => {
    if (!hasPhase(st.type)) return 0;
    const turns = (Math.abs(l.k) * (e.phase ?? 0)) / 360;
    if (!l.back || l.closed) return frac(turns);
    // Sewn against the way it was drawn: the figures counted from its far end.
    return frac(lengthOf(l.line) / periodOf(l) - turns);
  };
  if (!isRunType(st.type) || e.cut) {
    // A copy that ends where it began (a satin over its underlay) has the next begin at its nearer
    // end; figures in step keep their way.
    const runs: Pt[][] = [];
    for (const l of lines) {
      const end = runs.at(-1)?.at(-1);
      runs.push(...sewAlong(l.line, l.closed, stitchOf(l), hasPhase(st.type) ? undefined : end, undefined, l.back !== reverse, shiftOf(l)));
    }
    // Cut: a trim from copy to copy, however near they are.
    if (e.cut) runs.forEach((run, k) => k && trimBefore.add(run));
    return runs;
  }
  if (passes > 1) {
    // Each copy there and back on its own, then on to the next.
    const all: Pt[] = [];
    for (const l of lines) for (const run of sewAlong(l.line, l.closed, plain)) for (const q of run) if (!all.length || !samePt(all[all.length - 1], q)) all.push(q);
    return all.length > 1 ? [all] : [];
  }
  const all: Pt[] = [];
  for (const l of lines) for (const q of l.line) if (!all.length || !samePt(all[all.length - 1], q)) all.push(q);
  return sewAlong(all, false, plain);
}

const frac = (v: number) => ((v % 1) + 1) % 1;

/** The lines the echo of a line along `form` lies on, each with its copy number (see EchoLine.k). */
export function echoCopyLines(form: Form, st: PathStitch): EchoLine[] {
  if (!st.echo) return [];
  return form.paths.flatMap((p) => {
    const pts = flatten(p);
    if (pts.length < 2) return [];
    const loop = p.closed && pts.length > 2 && !samePt(pts[0], pts[pts.length - 1]) ? [...pts, pts[0]] : pts;
    return echoLines(loop, p.closed, st.echo!);
  });
}

/** For each point (mm), the copy number of the echo line nearest to it (0: the line itself). */
export function nearestCopy(lines: EchoLine[], pts: Pt[]): Int8Array {
  const out = new Int8Array(pts.length);
  pts.forEach((q, i) => {
    let best = Infinity;
    for (const l of lines) {
      for (let j = 1; j < l.line.length; j++) {
        const a = l.line[j - 1];
        const b = l.line[j];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
        const d = (q[0] - a[0] - t * dx) ** 2 + (q[1] - a[1] - t * dy) ** 2;
        if (d < best) {
          best = d;
          out[i] = l.k;
        }
      }
    }
  });
  return out;
}

function lengthOf(l: Pt[]): number {
  let s = 0;
  for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
  return s;
}

const samePt = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

/** Turns sharper than this (degrees) are corners of a traced line. */
const CORNER = 40;
/** Traced curves keep this close to the stitches (mm). */
const TRACE_TOLERANCE = 0.2;

/** A jump inside a line longer than this (mm) is a jump in its new stitches too, not sewn over. */
export const RUN_JUMP = 1;

/**
 * The ways a running stitch follows, read from its penetrations, one for each stretch between
 * jumps (the needle does not sew where the line jumped): without lock stitches and without the
 * way back of a triple stitch. A line sewn there and back (to get to where the next one starts)
 * stays there and back.
 */
export function runWays(p: Pattern, first: number, last: number, kinds?: Uint8Array): Pt[][] {
  const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const raws: Pt[][] = [];
  let raw: Pt[] = [];
  let jumped = false;
  for (let i = first; i <= last; i++) {
    if (p.cmd[i] !== STITCH) {
      jumped = true;
      continue;
    }
    if (kinds && kinds[i] === TIE_STITCH && i > first) continue;
    const q: Pt = [p.x[i] / 10, p.y[i] / 10];
    if (jumped && raw.length && d(q, raw[raw.length - 1]) > RUN_JUMP) {
      raws.push(raw);
      raw = [];
    }
    jumped = false;
    if (!raw.length || d(q, raw[raw.length - 1]) > 0.05) raw.push(q);
  }
  raws.push(raw);
  const ways: Pt[][] = [];
  for (const r of raws) {
    // A triple stitch goes a, b, a, b: once along it is enough.
    const way: Pt[] = [];
    for (let k = 0; k < r.length; k++) {
      const n = way.length;
      if (n >= 2 && k + 1 < r.length && d(r[k], way[n - 2]) < 0.05 && d(r[k + 1], way[n - 1]) < 0.05) k++;
      else way.push(r[k]);
    }
    if (way.length >= 2) ways.push(way);
  }
  return ways;
}

/** A line of curves through points: corners where it turns sharply, smooth curves between them. */
export function traceLine(pts: Pt[]): Form | null {
  if (pts.length < 2) return null;
  const closed = pts.length > 3 && samePt(pts[0], pts[pts.length - 1]);
  const turn = (i: number) => {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const u = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const v = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let t = Math.abs(v - u);
    if (t > Math.PI) t = 2 * Math.PI - t;
    return (t * 180) / Math.PI;
  };
  const cut = [0];
  for (let i = 1; i < pts.length - 1; i++) if (turn(i) > CORNER) cut.push(i);
  cut.push(pts.length - 1);
  const unit = (a: Pt, b: Pt): [number, number] => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const nodes: Node[] = [];
  for (let k = 0; k + 1 < cut.length; k++) {
    const part = pts.slice(cut[k], cut[k + 1] + 1);
    const curves = part.length === 2 ? [[part[0], part[0], part[1], part[1]] as [Pt, Pt, Pt, Pt]] : fitCubic(part, unit(part[0], part[1]), unit(part[part.length - 1], part[part.length - 2]), TRACE_TOLERANCE);
    for (const [p0, c1, c2, p3] of curves) {
      if (!nodes.length) nodes.push({ p: p0, a: p0, b: c1, smooth: false });
      else nodes[nodes.length - 1].b = c1;
      nodes.push({ p: p3, a: c2, b: p3, smooth: true });
    }
    // Where two parts meet is a corner.
    nodes[nodes.length - 1].smooth = false;
  }
  if (closed && nodes.length > 2) {
    // The last node is the first one again.
    const end = nodes.pop()!;
    nodes[0].a = end.a;
  }
  return { paths: [{ closed, nodes }] };
}

/** How a line object is sewn now. */
export function lineSettings(p: Pattern, o: SewObject, kinds?: Uint8Array): PathStitch {
  const known = remembered(p, o);
  if (known?.line) return { ...known.line };
  const ways = runWays(p, o.first, o.last, kinds ?? stitchKinds(p));
  // Measured: the usual length of its stitches, and triple when it goes back and forth.
  const lens: number[] = [];
  for (const w of ways) for (let i = 1; i < w.length; i++) lens.push(Math.hypot(w[i][0] - w[i - 1][0], w[i][1] - w[i - 1][1]));
  lens.sort((a, b) => a - b);
  const length = lens.length ? Math.round(lens[Math.floor(lens.length * 0.75)] * 10) / 10 : BORDER_STITCH;
  let stitches = 0;
  for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) stitches++;
  const points = ways.reduce((n, w) => n + w.length, 0);
  const triple = stitches > points * 2.4;
  return { type: triple ? 'triple' : 'run', width: BORDER_WIDTH, length: Math.min(6, Math.max(1, length)), tolerance: TOLERANCE };
}

/**
 * Object `index` sewn anew along `path` with `st`, in its place and thread; what it remembers
 * otherwise stays. Null when nothing could be sewn.
 */
export function resewLine(p: Pattern, index: number, path: Form, st: PathStitch, trimMm: number, reverse = false): { pattern: Pattern; first: number; last: number } | null {
  const r = resewOnce(p, index, path, st, trimMm, reverse);
  if (!r) return r;
  // New stitches that are the very stitches of another object (a copy lying exactly on its
  // original): sewn from the other end, so each remembers its own (memory is keyed by stitches).
  const keys = sewObjects(r.pattern).filter((x) => x.first !== r.first).map((x) => objectKey(r.pattern, x));
  if (!keys.includes(stitchKey(r.pattern, r.first, r.last))) return r;
  return resewOnce(p, index, path, st, trimMm, !reverse) ?? r;
}

function resewOnce(p: Pattern, index: number, path: Form, st: PathStitch, trimMm: number, reverse: boolean): { pattern: Pattern; first: number; last: number } | null {
  const objs = sewObjects(p);
  const o = objs[index];
  if (!o) return null;
  const runs = lineStitches(path, st, reverse);
  if (!runs.length) return null;
  const recs = runRecords(runs, trimMm);
  let lead = o.first;
  while (lead - 1 >= 0 && p.cmd[lead - 1] === JUMP) lead--;
  const out: Rec[] = [];
  const copy = (a: number, b: number) => {
    for (let i = a; i <= b; i++) out.push({ x: p.x[i], y: p.y[i], cmd: p.cmd[i] });
  };
  copy(0, lead - 1);
  const before = out.reduce((n, r) => n + (r.cmd === STITCH ? 1 : 0), 0);
  out.push(...recs);
  const after = before + recs.reduce((n, r) => n + (r.cmd === STITCH ? 1 : 0), 0);
  copy(o.last + 1, p.cmd.length - 1);
  const next = tidy(
    withRecords(
      p,
      Int32Array.from(out, (r) => r.x),
      Int32Array.from(out, (r) => r.y),
      Uint8Array.from(out, (r) => r.cmd),
    ),
  );
  // This object stays one, also where its new stitches are trimmed inside.
  rememberObjects(next, [before], after);
  const fresh = sewObjects(next).find((x) => stitchesUpTo(next, x.first) === before);
  if (!fresh) return null;
  const known = remembered(p, o);
  const memory: Remembered = { ...(known ?? { region: null }), region: null, geo: path, line: { ...st }, id: o.id };
  // Stitches set by hand are gone with the old ones.
  delete memory.hand;
  delete memory.free;
  remember(next, fresh, memory);
  return { pattern: next, first: fresh.first, last: fresh.last };
}

function stitchesUpTo(p: Pattern, record: number): number {
  let n = 0;
  for (let i = 0; i < record; i++) if (p.cmd[i] === STITCH) n++;
  return n;
}

/**
 * A line sewn as a fill, its paths staying its form and its stitch kept to switch back (see
 * fillToLine): the area its closed paths enclose, the line staying on its edge as the fill's
 * border (`area`), or the band along its paths in its width (`band`, a wide line or one with open
 * paths). A line that was a fill is filled as it was. Null when there is nothing to fill.
 */
export function lineToFill(p: Pattern, index: number, s: FillSettings, trimMm: number, how: 'area' | 'band' = fillOfLine(p, index) ?? 'band'): RestitchResult | null {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const o = objs[index];
  const known = o && remembered(p, o);
  const geo = lineGeoOf(known);
  if (!o || !known?.line || !geo || known.free) return null;
  const line = known.line;
  const was = known.kept?.fill;
  let fill: FillSettings;
  let border: BorderSettings | null = null;
  if (how === 'band') fill = { ...(was ?? s), lineWidth: was?.lineWidth ?? line.width, lineCap: was?.lineCap ?? 'flat' };
  else {
    if (!fits(geo, 'fill')) return null;
    // The line stays beside the fill as its border, as it is sewn now with its echo, shadow and
    // fringe (a fill that had none gets none again); the side of a fringe was the drawn line's, a
    // border's is inside or outside: frayed on both.
    const { fringeSide: _fs, ...edge } = line;
    const { lineWidth: _w, lineCap: _c, ...rest } = was ?? s;
    fill = rest;
    if (!was || !known.kept?.unbordered) border = edge;
  }
  const area = how === 'band' ? bandArea(geo, fill) : rasterize(geo);
  if (!area) return null;
  const r = restitch(p, objs, [index], { kind: 'fill', s: fill, line: border }, kinds, trimMm, o.kind, false, undefined, new Map([[index, area]]));
  r.memory.forEach((m) => {
    m.geo = geo;
    const { fill: _k, unbordered: _u, ...kept } = m.kept ?? {};
    m.kept = { ...kept, line: structuredClone(line) };
  });
  return r;
}

/** How line `index` is filled (see lineToFill): as it was, else inside when it is closed all round, else in its width. Null for no line. */
export function fillOfLine(p: Pattern, index: number): 'area' | 'band' | null {
  const o = sewObjects(p)[index];
  const known = o && remembered(p, o);
  const geo = lineGeoOf(known);
  if (!geo) return null;
  if (known!.kept?.fill) return known!.kept.fill.lineWidth !== undefined ? 'band' : 'area';
  return fits(geo, 'fill') ? 'area' : 'band';
}

/** A band sewn along `path` now (its paths edited on the level Form, or scaled with `width`). */
export function reshapeLineFill(p: Pattern, objs: SewObject[], o: SewObject, kinds: Uint8Array, path: Form, trimMm: number, width?: number): RestitchResult | null {
  const known = remembered(p, o);
  if (geoUse(known) !== 'band') return null;
  const fill: FillSettings = width === undefined ? known!.fill! : { ...known!.fill!, lineWidth: width };
  const area = bandArea(path, fill);
  if (!area) return null;
  const r = restitch(p, objs, [o.index], { kind: 'fill', s: fill }, kinds, trimMm, undefined, false, undefined, new Map([[o.index, area]]));
  r.memory.forEach((m) => (m.geo = path));
  return r;
}

/**
 * A fill sewn as a line along its paths (`geo` when its form changes with it), its fill kept to
 * fill it again as it was (see lineToFill): a band in its width, with the stitch it had as a line;
 * an area along its edge, with its border's stitch (a running stitch without one). A fill of a file
 * is sewn along the outline of its area, which is its form from now on. Null when it has no area
 * or nothing is sewn.
 */
export function fillToLine(p: Pattern, index: number, trimMm: number, geo?: Form): { pattern: Pattern; first: number; last: number } | null {
  const kinds = stitchKinds(p);
  const o = sewObjects(p, kinds)[index];
  const known = o && remembered(p, o);
  if (!o || known?.free || known?.outline || known?.blendOf || known?.lettering || partOf(known)) return null;
  const an = known?.fill ? null : analyze(p, o, kinds, known);
  const fill = known?.fill ?? (an?.fill && an.parts.some((pt) => pt.kind === 'fill') ? measureFill(p, an) : null);
  geo ??= (fill && (geoOf(known) ?? guessArea(p, o, kinds))) ?? undefined;
  if (!fill || !geo) return null;
  const was = known?.kept?.line;
  const edge = borderOf(known);
  let st: PathStitch;
  if (fill.lineWidth !== undefined) st = { ...(was ?? lineStitchFor(fill.lineWidth)), width: fill.lineWidth };
  else if (edge) {
    const { color: _c, link: _l, seams: _s, ...border } = edge;
    st = { ...was, ...border };
  } else st = was ? { ...was } : runAsLine(LINE_RUN);
  const r = resewLine(p, index, geo, st, trimMm);
  if (!r) return null;
  // A line only: its fill is kept, everything it was sewn as a fill goes.
  const fresh = sewObjects(r.pattern).find((x) => x.first === r.first);
  if (fresh) {
    const { line: _l, unbordered: _u, ...kept } = known?.kept ?? {};
    remember(r.pattern, fresh, {
      region: null,
      geo,
      line: st,
      kept: { ...kept, fill: structuredClone(fill), ...(edge || fill.lineWidth !== undefined ? {} : { unbordered: true as const }) },
      id: o.id,
      ...(known?.lock ? { lock: true } : {}),
    });
  }
  return r;
}
