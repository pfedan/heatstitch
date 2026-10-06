import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyProposals, planCorrection } from '../src/correct/plan';
import { ampelOf, cellDiff, FIX_KINDS } from '../src/correct/engine/cells';
import { planFix } from '../src/correct/engine/solve';
import { validateDesign } from '../src/correct/engine/validate';
import { ALL_CHECKS } from '../src/validation/validate';
import { corpus } from './helpers/korrekturCorpus';

/**
 * Benchmark of the correction engine on the fixed test set (BENCH=1). Writes tests/bench/korrektur.json
 * (BENCH_BASELINE=1: today's proposals card instead, to korrektur-baseline.json).
 */
const run = process.env.BENCH ? describe : describe.skip;
const ONLY = process.env.BENCH_ONLY;

run('correction benchmark', () => {
  it('fixes the test set', async () => {
    const rows = [];
    for (const c of corpus()) {
      if (ONLY && !c.name.includes(ONLY)) continue;
      const v = validateDesign(c.pattern, c.profile);
      const t0 = performance.now();
      let after = c.pattern;
      let objects = 0;
      if (process.env.BENCH_BASELINE) {
        const plan = await planCorrection(c.pattern, v, c.profile, ALL_CHECKS, { goal: 'critical', focus: 'both', trimMm: 2 });
        const chosen = plan.proposals.filter((x) => x.checked);
        after = chosen.length ? (applyProposals(c.pattern, chosen, 2)?.pattern ?? c.pattern) : c.pattern;
        objects = chosen.length;
      } else {
        const r = await planFix(c.pattern, c.profile, 'all', { trimMm: 2, log: process.env.BENCH_LOG ? (s: string) => (globalThis as any).process.stderr.write(`${c.name}: ${s}\n`) : undefined });
        after = r.pattern;
        objects = r.objects.length;
      }
      const ms = performance.now() - t0;
      const va = validateDesign(after, c.profile);
      const d = cellDiff(v, va);
      rows.push({ name: c.name, ampel: ampelOf(v).color, ampelAfter: ampelOf(va).color, crit: d.criticalBefore, critAfter: d.criticalAfter, newCrit: d.newCritical, newCaution: d.newCaution, newGapSparse: d.newGapSparse, open: d.open, objects, ms: Math.round(ms) });
    }
    mkdirSync(new URL('./bench/', import.meta.url), { recursive: true });
    const file = process.env.BENCH_OUT ?? (process.env.BENCH_BASELINE ? 'korrektur-baseline.json' : 'korrektur.json');
    writeFileSync(new URL(`./bench/${file}`, import.meta.url), new TextEncoder().encode(JSON.stringify(rows, null, 1)));
    expect(FIX_KINDS.length).toBe(5);
  }, 3_600_000);
});
