import { rememberObjects, sewObjects, type SewObject } from './objects';
import { reorder } from './order';
import type { Pattern } from './pattern';
import { measureFill, measureSatin, remembered, restitch, type RestitchResult } from './restitch';
import { recordOfStitch, stitchKinds, stitchNumbers } from './sequence';
import { lineOf, lineSettings, resewLine } from './line';
import type { Form } from '../shape/path';

/**
 * Sewing satins and fills from the other side: start and end swap. A satin column is sewn from
 * its other end (with its underlay going out first, as always), a fill starts where it ended. The
 * stitches are made anew with the settings the object has, so the shape stays; the ways to and
 * from its neighbours are made anew too, so a way that got short loses its trim.
 */

export const reversible = (o: SewObject) => o.kind === 'fill' || o.kind === 'satin';

/** A line: drawn (it remembers its curve) or the running stitch of a file, read as one. Turned by its curve (reverseLines). */
export function isLine(p: Pattern, o: SewObject): boolean {
  const m = remembered(p, o);
  if (m?.path) return true;
  return o.kind === 'run' && !m?.outline && !m?.lettering;
}

/** The same curves, drawn the other way round: the last path first, each from its end (a closed one from the same node). */
export function reversedForm(f: Form): Form {
  return {
    ...f,
    paths: f.paths
      .slice()
      .reverse()
      .map((path) => {
        const nodes = path.nodes.map((n) => ({ ...n, a: n.b, b: n.a })).reverse();
        return { ...path, nodes: path.closed && nodes.length > 1 ? [nodes[nodes.length - 1], ...nodes.slice(0, -1)] : nodes };
      }),
  };
}

/**
 * The lines `which` sewn from their other end: their curves turned around and sewn anew in place,
 * so the next change of their settings keeps the new direction. What lies to one side of a line
 * (the prongs of an E stitch, scallops, hearts) stays on that side. Lines that cannot be read
 * stay as they are and are listed in `failed`.
 */
export function reverseLines(p: Pattern, which: number[], trimMm: number): { pattern: Pattern; failed: number[] } {
  let pattern = p;
  const failed: number[] = [];
  for (const index of which) {
    const kinds = stitchKinds(pattern);
    const o = sewObjects(pattern, kinds)[index];
    const path = o && lineOf(pattern, o, kinds);
    if (!o || !path) {
      failed.push(index);
      continue;
    }
    const st = lineSettings(pattern, o, kinds);
    if (st.type === 'e' || st.type === 'motif') st.flip = !st.flip || undefined;
    if (!st.flip) delete st.flip;
    // Echo copies of an open line lie to one side of its direction: they stay where they are.
    if (st.echo && st.echo.side !== 'both' && !path.paths.some((x) => x.closed)) st.echo = { ...st.echo, side: st.echo.side === 'out' ? 'in' : 'out' };
    const r = resewLine(pattern, index, reversedForm(path), st, trimMm);
    if (r) pattern = r.pattern;
    else failed.push(index);
  }
  return { pattern, failed };
}

/**
 * May "Optimize order" turn it around on its own: a satin (its columns come back as they were),
 * or a fill whose shape is known exactly (made here, not traced from a file's stitches). Never
 * one changed by hand, whose points would be lost.
 */
export function autoReversible(p: Pattern, o: SewObject): boolean {
  if (!reversible(o)) return false;
  const known = remembered(p, o);
  if (known?.hand) return false;
  return o.kind === 'satin' || (!!known?.region && !known.read);
}

/**
 * The objects `which` sewn from the other side, each with its own settings; objects whose stitches
 * do not all lie on their own area (a way out to another part, say) stay as they are and are
 * listed in `failed`. With `order`, the objects are sewn in that order too; then nothing changes
 * (the pattern is `p`) unless all of them could be turned. `starts` and `ends` are as for
 * `restitch`, in the returned pattern.
 */
export function reverseObjects(p: Pattern, objs: SewObject[], which: number[], kinds: Uint8Array, trimMm: number, order?: number[]): RestitchResult {
  const r = restitch(
    p,
    objs,
    which,
    (o, an, known) => {
      if (o.kind === 'fill') return an.fill ? { kind: 'fill', s: known?.fill ?? measureFill(p, an) } : null;
      if (o.kind !== 'satin') return null;
      const part = an.parts.find((pt) => pt.kind === 'satin');
      return part ? { kind: 'satin', s: known?.satin ?? measureSatin(p, part, kinds) } : null;
    },
    kinds,
    trimMm,
    undefined,
    true,
  );
  const unchanged = { ...r, pattern: p, starts: [], ends: [], regions: [], memory: [] };
  if (order && (r.failed.length || r.starts.length !== which.length)) return unchanged;
  if (!r.starts.length) return r;
  // Each object stays one, also where its new stitches are trimmed inside.
  r.starts.forEach((a, k) => rememberObjects(r.pattern, [a], r.ends[k]));
  const after = sewObjects(r.pattern);
  // In the given order only while every object is still the one it was.
  if (order && after.length !== objs.length) return { ...unchanged, failed: [] };
  const numbers = stitchNumbers(r.pattern);
  const at = (n: number) => {
    const rec = recordOfStitch(numbers, n + 1);
    return after.findIndex((o) => o.first <= rec && rec <= o.last);
  };
  const changed = r.starts.map(at);
  const starts: number[] = [];
  const sewn = order ?? after.map((o) => o.index);
  const pattern = reorder(r.pattern, after, sewn, trimMm, starts, { fresh: new Set(changed.filter((o) => o >= 0)) });
  const startOf = new Map(sewn.map((o, k) => [o, starts[k]]));
  return {
    ...r,
    pattern,
    starts: changed.map((o, k) => (o < 0 ? r.starts[k] : startOf.get(o)!)),
    ends: changed.map((o, k) => (o < 0 ? r.ends[k] : r.ends[k] - r.starts[k] + startOf.get(o)!)),
  };
}
