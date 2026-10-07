import { borderStitches, type PathStitch } from './along';
import type { Pt } from '../digitize/skeleton';
import { expandRegion, type Region } from '../digitize/region';
import type { Form } from '../shape/path';
import { rasterize } from '../shape/rasterize';
import { coversOver, type Cover } from './covers';
import { tidyKept, withRecords } from './edit';
import { wholeOf } from './knockout';
import { lineStitches } from './line';
import { setObjects, sewObjects, stitchKey, tableOf, trimmedBetween, type ObjectKind, type PlacedEntry, type SewObject } from './objects';
import { COLOR_CHANGE, END, JUMP, STITCH, TRIM, type Pattern } from './pattern';
import { fillRuns, knownKind, TRAVEL_REACH, lineFillArea, lockAt, remembered, satinRuns, trimBefore, type FillSettings, type Rails, type Remembered, type SatinSettings } from './restitch';
import { stitchKinds } from './sequence';

/**
 * Sewing from the object list (stage C of the object model): what an object is (its shape and
 * how it is stitched) gives its stitches, and the list in order gives the design. sewOne sews one
 * object from what it remembers, sewDesign the whole design. Objects that cannot be sewn from what
 * they remember (stitches set by hand, read from a foreign file, letterings for now) keep the
 * stitches they have.
 */

/** What an object is sewn from: its shape and how it is stitched. */
export type Spec =
  | { kind: 'line'; path: Form; line: PathStitch }
  | { kind: 'fill'; area: Region; fill: FillSettings; memory: Remembered }
  | { kind: 'satin'; columns: Rails[][]; satin: SatinSettings }
  | { kind: 'border'; area: Region; border: PathStitch; memory: Remembered };

/** Where an object is sewn from and to. */
export interface Way {
  /** Where the thread is when the object starts (its stitches start near here). */
  from: Pt;
  /** Where the next object starts, if known: straight fill rows end near it. */
  to?: Pt;
  /** What objects sewn later cover of it (see coversOver): no underlay under it. */
  covers?: Cover[];
}

/** All parts of what it remembers are of one kind (or it does not tell). */
function oneKind(m: Remembered, kind: ObjectKind): boolean {
  return !m.parts || m.parts.every((pt) => pt.kind === kind && !pt.border);
}

/**
 * What object `o` of `p` is sewn from, or null when it can only keep its stitches: loosed from its
 * shape, read from stitches, a lettering, a fill that follows its old rows, or of more than one kind.
 */
export function specOf(p: Pattern, o: SewObject): Spec | null {
  const m = remembered(p, o);
  if (!m || m.free || m.hand || m.read || m.lettering || m.borderAt !== undefined) return null;
  const kind = knownKind(m) ?? o.kind;
  if (kind !== o.kind) return null;
  if (m.outline && m.border && m.region) return { kind: 'border', area: m.region, border: m.border, memory: m };
  if (m.path && m.line && !m.asLine) return { kind: 'line', path: m.path, line: m.line };
  if (kind === 'fill' && m.fill && m.fill.pattern !== 'follow' && oneKind(m, 'fill')) {
    const area = m.asLine ? lineFillArea(m.asLine, m.fill) : (m.region ?? (m.form ? rasterize(m.form) : null));
    if (!area) return null;
    if (m.fill.pattern === 'none' && !m.fill.border) return null;
    return { kind: 'fill', area, fill: m.fill, memory: m };
  }
  if (kind === 'satin' && m.satin && m.columns?.length && oneKind(m, 'satin')) return { kind: 'satin', columns: m.columns, satin: m.satin };
  return null;
}

/** The stitches of an object sewn from `spec` along `way`, and how many of them are underlay. */
export function sewOne(spec: Spec, way: Way): { runs: Pt[][]; under: number } | null {
  const ok = (runs: Pt[][], under = 0) => {
    const out = runs.filter((r) => r.length > 1);
    return out.length ? { runs: out, under } : null;
  };
  switch (spec.kind) {
    case 'line':
      return ok(lineStitches(spec.path, spec.line));
    case 'satin':
      return ok(spec.columns.flatMap((rails) => satinRuns(rails, spec.satin)));
    case 'border':
      return ok(borderStitches(spec.area, spec.border, way.from, wholeOf(spec.area, spec.memory)));
    case 'fill': {
      // An empty fill is its border only, in its thread.
      if (spec.fill.pattern === 'none') return ok(borderStitches(spec.area, spec.fill.border!, way.from, wholeOf(spec.area, spec.memory)));
      // Travel may run where it is hidden: across the whole area where shapes on top left parts
      // out (knockout), and a little beyond the edge where the rows end (as far as travel along
      // an old thread may, TRAVEL_REACH).
      const travel = expandRegion(wholeOf(spec.area, spec.memory) ?? spec.area, TRAVEL_REACH) ?? undefined;
      const f = fillRuns(spec.area, spec.fill, { start: way.from, end: way.to, travel, covers: way.covers });
      return f ? ok(f.runs, f.under) : null;
    }
  }
}

interface Rec {
  x: number;
  y: number;
  cmd: number;
}

const at = (q: Pt, cmd: number): Rec => ({ x: Math.round(q[0] * 10), y: Math.round(q[1] * 10), cmd });

/**
 * The records of one object from its runs, as an object sewn anew is sewn: locked at its start
 * and end, a trim between runs further apart than `trimMm` (or marked to be trimmed), a jump
 * between the others. `under`: points of the runs that are underlay; returns how many stitches
 * of the object are (lock included), as Remembered.under counts them.
 */
function objectRecords(runs: Pt[][], under: number, trimMm: number, out: Rec[]): number {
  let last: Pt | null = null;
  let stitches = 0;
  let underStitches = 0;
  let fed = 0;
  const push = (r: Rec) => {
    out.push(r);
    if (r.cmd === STITCH) stitches++;
  };
  const point = (q: Pt) => {
    if (last && Math.hypot(last[0] - q[0], last[1] - q[1]) < 0.05) return;
    push(at(q, STITCH));
    last = q;
  };
  runs.forEach((run, k) => {
    if (!k) {
      push(at(run[0], JUMP));
      for (const r of lockAt(run, false)) push(r);
      last = run[0];
    } else {
      const d = Math.hypot(run[0][0] - last![0], run[0][1] - last![1]);
      if (d > trimMm || trimBefore.has(run)) {
        for (const r of lockAt(runs[k - 1], true)) push(r);
        push({ ...out[out.length - 1], cmd: TRIM });
        push(at(run[0], JUMP));
        for (const r of lockAt(run, false)) push(r);
        last = run[0];
      } else if (d > 1) {
        push(at(run[0], JUMP));
        point(run[0]);
      } else point(run[0]);
    }
    if (fed + 1 === under) underStitches = stitches;
    for (let j = 1; j < run.length; j++) {
      point(run[j]);
      if (fed + j + 1 === under) underStitches = stitches;
    }
    fed += run.length;
  });
  for (const r of lockAt(runs[runs.length - 1], true)) push(r);
  return underStitches;
}

/** What an object sewn anew remembers: the same, without what counted its old stitches. */
function memoryAfter(m: Remembered, kind: ObjectKind, stitches: number, under: number): Remembered {
  const out: Remembered = { ...m };
  delete out.parts;
  delete out.under;
  delete out.underFrom;
  delete out.borderAt;
  out.parts = [{ kind, end: stitches }];
  if (under > 0) out.under = under;
  return out;
}

/**
 * The design `p` sewn from its object list: each object that can be is sewn from what it
 * remembers (sewOne), starting where the one before ended; the others keep their stitches. Colors,
 * order, the trims between objects and the object ids stay as they are. A new version of `p`.
 */
export function sewDesign(p: Pattern, trimMm: number): Pattern {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const table = tableOf(p);
  const out: Rec[] = [];
  const placed: PlacedEntry[] = [];
  let stitches = 0;
  let here: Pt | null = null;
  // Lines and satins sewn ahead (where they start does not depend on the object before).
  const ahead = new Map<number, ReturnType<typeof sewOne>>();
  const count = (from: number) => {
    for (let k = from; k < out.length; k++) if (out[k].cmd === STITCH) stitches++;
  };
  objs.forEach((o, k) => {
    const prev = objs[k - 1];
    if (prev) {
      if (prev.block !== o.block) out.push({ ...out[out.length - 1], cmd: TRIM }, { ...out[out.length - 1], cmd: COLOR_CHANGE });
      else if (trimmedBetween(p, prev, o)) out.push({ ...out[out.length - 1], cmd: TRIM });
    }
    const first = stitches;
    const mark = out.length;
    const spec = specOf(p, o);
    const next = objs[k + 1];
    // Straight rows end near where the next object starts, when that is known before it is sewn:
    // it keeps its stitches, or it is a line or satin (they start where their shape starts).
    const nextSpec = next && specOf(p, next);
    const fixedStart = next && (!nextSpec || nextSpec.kind === 'line' || nextSpec.kind === 'satin');
    if (fixedStart && nextSpec && !ahead.has(k + 1)) ahead.set(k + 1, sewOne(nextSpec, { from: [0, 0] }));
    const to = !fixedStart ? undefined : nextSpec ? ahead.get(k + 1)?.runs[0][0] : ([p.x[next.first] / 10, p.y[next.first] / 10] as Pt);
    const covers = spec?.kind === 'fill' && spec.fill.underlay && spec.fill.underCover ? coversOver(p, objs, o, spec.area.pxMm, spec.memory.overlapShare) : undefined;
    // The first object starts nearest to the origin: taken from its stitches, the start would
    // creep along its edge each time it is sewn again (they are rounded to 0.1 mm).
    const way: Way = { from: here ?? [0, 0], ...(to ? { to } : {}), ...(covers?.length ? { covers } : {}) };
    const sewn = !spec ? null : ahead.has(k) ? ahead.get(k)! : sewOne(spec, way);
    const m = remembered(p, o);
    let memory = m;
    if (sewn && spec) {
      const under = objectRecords(sewn.runs, sewn.under, trimMm, out);
      count(mark);
      memory = memoryAfter(m!, o.kind, stitches - first, under);
    } else {
      // Kept as it is, with the jumps that lead to it.
      let lead = o.first;
      while (lead > 0 && p.cmd[lead - 1] === JUMP) lead--;
      for (let i = lead; i <= o.last; i++) out.push({ x: p.x[i], y: p.y[i], cmd: p.cmd[i] });
      count(mark);
    }
    const last = out.findLastIndex((r) => r.cmd === STITCH);
    here = [out[last].x / 10, out[last].y / 10];
    placed.push({ id: o.id, first, last: stitches - 1, key: '', at: [0, 0], ...(memory ? { memory } : {}) });
  });
  // Cut at the end, as every design made here is.
  if (out.length) out.push({ ...out[out.length - 1], cmd: TRIM }, { ...out[out.length - 1], cmd: END });
  const raw = withRecords(p, Int32Array.from(out, (r) => r.x), Int32Array.from(out, (r) => r.y), Uint8Array.from(out, (r) => r.cmd));
  const q = tidyKept(raw).pattern;
  // Keys and first stitches on the new stitches, so the list is found where it is.
  const records: number[] = [];
  for (let i = 0; i < q.cmd.length; i++) if (q.cmd[i] === STITCH) records.push(i);
  for (const e of placed) {
    e.key = stitchKey(q, records[e.first], records[e.last]);
    e.at = [q.x[records[e.first]], q.y[records[e.first]]];
  }
  setObjects(q, placed, table.next);
  return q;
}
