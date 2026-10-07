import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/digitize/skeleton';
import { sewObjects } from '../src/model/objects';
import { STITCH, type Pattern } from '../src/model/pattern';
import { analyze, measureSatin, restitch, satinRuns, type Rails, type SatinSettings } from '../src/model/restitch';
import { SATIN as SATIN_STITCH, stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';
import { writePattern } from '../src/writers';
import { Writer } from './helpers/designs';

const SATIN: SatinSettings = { spacing: 0.4, edge: 0, short: true, underlay: false, tolerance: 0.15 };

/** Points every 0.5 mm from a to b. */
const line = (a: Pt, b: Pt): Pt[] => {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
  return Array.from({ length: n + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n] as Pt);
};
/** Half a ring around (30, 30) with radius `r` (mm). */
const arc = (r: number): Pt[] => Array.from({ length: 61 }, (_, k) => [30 + r * Math.cos((k / 60) * Math.PI), 30 - r * Math.sin((k / 60) * Math.PI)] as Pt);

const STRAIGHT: Rails = { left: line([0, 0], [30, 0]), right: line([0, 6], [30, 6]), rungs: [] };
const CURVED: Rails = { left: arc(20), right: arc(26), rungs: [] };

/** A satin sewn with `s` along `r`, saved as a PES file from elsewhere and read again. */
function fromFile(r: Rails, s: SatinSettings): Pattern {
  const run = satinRuns([r], s)[0];
  const w = new Writer();
  w.start(run[0]);
  for (const q of run.slice(1)) w.to(q);
  return parsePattern(writePattern(w.b.build('t', 'pes', [{ r: 0, g: 0, b: 0 }]), 'pes'), 'f.pes');
}

function read(p: Pattern) {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  expect(objs.map((o) => o.kind)).toEqual(['satin']);
  const part = analyze(p, objs[0], kinds).parts.find((x) => x.kind === 'satin')!;
  return { kinds, objs, s: measureSatin(p, part, kinds) };
}

/** How far each satin needle point lies in from the line y = 0 and y = 6 (straight column), by side. */
function edges(p: Pattern) {
  const near: number[] = [];
  const far: number[] = [];
  const kinds = stitchKinds(p);
  for (let i = 0; i < p.cmd.length; i++) if (p.cmd[i] === STITCH && kinds[i] === SATIN_STITCH) (p.y[i] < 30 ? near : far).push(p.y[i] < 30 ? p.y[i] / 10 : 6 - p.y[i] / 10);
  return { near, far };
}
const spread = (v: number[]) => Math.max(...v) - Math.min(...v);

describe('a fringe read from a file', () => {
  it('reads how deep a frayed side is, and which side', () => {
    const { s } = read(fromFile(STRAIGHT, { ...SATIN, fringe: 1.5, fringeSide: 'right' }));
    expect(s.fringe).toBeGreaterThan(1.2);
    expect(s.fringe).toBeLessThan(1.8);
    expect(s.fringeSide).toBeDefined();
    // The spacing along the column, not from point to point of the frayed side.
    expect(s.spacing).toBeCloseTo(0.4, 1);
    const both = read(fromFile(STRAIGHT, { ...SATIN, fringe: 1 })).s;
    expect(both.fringe).toBeGreaterThan(0.7);
    expect(both.fringeSide).toBeUndefined();
    expect(read(fromFile(STRAIGHT, { ...SATIN, fringe: 0.5, fringeSide: 'left' })).s.fringe).toBeGreaterThan(0.3);
  });

  it('finds none on a smooth satin, nor on the short stitches of a curve', () => {
    expect(read(fromFile(STRAIGHT, SATIN)).s.fringe).toBeUndefined();
    expect(read(fromFile(CURVED, SATIN)).s.fringe).toBeUndefined();
  });

  it('sews it anew frayed on the same side, out to the edge it fell short of', () => {
    const p = fromFile(STRAIGHT, { ...SATIN, fringe: 1.5, fringeSide: 'right' });
    const was = edges(p);
    const frayedNear = spread(was.near) > spread(was.far);
    const { kinds, objs, s } = read(p);
    const r = restitch(p, objs, [0], { kind: 'satin', s: { ...s, spacing: 0.5 } }, kinds, 3);
    expect(r.failed).toEqual([]);
    const now = edges(r.pattern);
    const [frayed, smooth] = frayedNear ? [now.near, now.far] : [now.far, now.near];
    expect(spread(frayed)).toBeGreaterThan(1);
    expect(spread(smooth)).toBeLessThan(0.3);
    // The column keeps its width: the fringe reaches out to the edge as before.
    expect(Math.min(...frayed)).toBeLessThan(0.3);
  });
});
