import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareStitches, fidelity, type Fidelity } from '../src/model/fidelity';
import { sewObjects, type ObjectKind } from '../src/model/objects';
import { stitchKinds } from '../src/model/sequence';
import { parsePattern } from '../src/parsers';

/**
 * Bench of how true recognized objects are to their stitches (see fidelity.ts). The lower bounds
 * hold today; better recognition should raise them. FIDELITY_FILES (absolute paths, comma
 * separated) adds files that are not in the repo, printed only.
 */
interface Sum {
  n: number;
  measured: number;
  mean: number;
  good: number;
}

const GOOD = 0.8;

function bench(path: URL, name: string): Sum {
  const p = parsePattern(readFileSync(path), name);
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const t = performance.now();
  const scores: { kind: ObjectKind; f: Fidelity | null }[] = objs.map((o) => ({ kind: o.kind, f: fidelity(p, objs, o, kinds) }));
  const ms = performance.now() - t;
  const sum = (list: typeof scores): Sum => {
    const ok = list.filter((x) => x.f);
    const mean = ok.length ? ok.reduce((s, x) => s + x.f!.score, 0) / ok.length : 0;
    // Objects that cannot be sewn anew count as not good.
    const good = list.length ? list.filter((x) => x.f && x.f.score >= GOOD).length / list.length : 0;
    return { n: list.length, measured: ok.length, mean, good };
  };
  const avg = (list: typeof scores, f: (x: Fidelity) => number | null) => {
    const v = list.map((x) => x.f && f(x.f)).filter((x): x is number => x !== null && Number.isFinite(x));
    return v.length ? (v.reduce((s, x) => s + x, 0) / v.length).toFixed(2) : '-';
  };
  const fmt = (x: Sum, list: typeof scores) =>
    `${x.n} objects (${x.n - x.measured} not sewn anew), mean ${x.mean.toFixed(3)}, >=${GOOD}: ${(x.good * 100).toFixed(0)}%` +
    ` [area ${avg(list, (f) => f.area)}, density ${avg(list, (f) => f.density)}, direction ${avg(list, (f) => f.direction)}]`;
  const all = sum(scores);
  console.log(`fidelity ${name}: ${fmt(all, scores)} in ${Math.round(ms)} ms`);
  for (const k of ['fill', 'satin', 'run'] as ObjectKind[]) {
    const list = scores.filter((x) => x.kind === k);
    if (list.length) console.log(`  ${k}: ${fmt(sum(list), list)}`);
  }
  return all;
}

const at = (f: string) => new URL(`../public/examples/${f}`, import.meta.url);

/** Lower bounds per file, a little under today's: mean score and share of objects scoring at least GOOD. */
const FILES: { file: string; mean: number; good: number }[] = [
  { file: 'cat-60mm.pes', mean: 0.8, good: 0.55 },
  { file: 'demos/confetti.pes', mean: 0.92, good: 0.85 },
  { file: 'demos/leather-patch.dst', mean: 0.93, good: 0.85 },
  { file: 'demos/letters.pes', mean: 0.93, good: 0.85 },
  { file: 'demos/overlap.pes', mean: 0.9, good: 0.75 },
  { file: 'demos/sun.dst', mean: 0.88, good: 0.9 },
];

describe('fidelity of recognized objects', () => {
  it('is 1 for the same stitches and falls for others', () => {
    // Rows 0.4 mm apart over 10 mm, as a fill sews them.
    const rows = (turned: boolean, step = 4) => {
      const out: number[] = [];
      for (let y = 0; y <= 100; y += step) out.push(...(turned ? [y, 0, y, 100] : [0, y, 100, y]));
      return out;
    };
    const same = compareStitches(rows(false), rows(false), 0.4);
    expect(same.score).toBeCloseTo(1, 5);
    const crossed = compareStitches(rows(false), rows(true), 0.4);
    expect(crossed.area).toBeGreaterThan(0.9);
    expect(crossed.direction!).toBeLessThan(0.75);
    const sparse = compareStitches(rows(false), rows(false, 8), 0.8);
    expect(sparse.ratio).toBeLessThan(0.6);
    expect(sparse.score).toBeLessThan(same.score);
  });

  it.each(FILES)('$file', ({ file, mean, good }) => {
    const b = bench(at(file), file);
    expect(b.n).toBeGreaterThan(0);
    expect(b.mean).toBeGreaterThanOrEqual(mean);
    expect(b.good).toBeGreaterThanOrEqual(good);
  });

  const extra = (process.env.FIDELITY_FILES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  it.skipIf(!extra.length)('extra files from FIDELITY_FILES', () => {
    for (const f of extra) bench(new URL(`file://${f}`), f.split('/').pop()!);
  }, 600_000);
});
