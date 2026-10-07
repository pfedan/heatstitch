import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyProposals, planCorrection } from '../src/correct/plan';
import { assess } from '../src/correct/engine/ampel';
import { ampelOf, cellDiff, FIX_KINDS } from '../src/correct/engine/cells';
import { solveMip } from '../src/correct/engine/mip';
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
/**
 * Time the search may take per group (ms). The app gives it 0.8 s; here it gets enough to settle
 * (it stops when nothing improves), so the result does not depend on how fast the machine is.
 */
const BUDGET_MS = Number(process.env.BENCH_BUDGET_MS ?? 8000);

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
        const r = await planFix(c.pattern, c.profile, 'all', { trimMm: 2, budgetMs: BUDGET_MS, solver: (process.env.BENCH_SOLVER as 'lns' | 'mip' | 'both' | undefined) ?? undefined, exact: solveMip, log: process.env.BENCH_LOG ? (s: string) => (globalThis as any).process.stderr.write(`${c.name}: ${s}\n`) : undefined });
        after = r.pattern;
        objects = r.objects.length;
      }
      const ms = performance.now() - t0;
      const va = validateDesign(after, c.profile);
      const d = cellDiff(v, va);
      let assessMs: number | undefined;
      let buttons: number | undefined;
      if (process.env.BENCH_ASSESS) {
        // Time until every button of the Ampel is worked out (each kind direct and rest, all together).
        const t1 = performance.now();
        const r = await assess(c.pattern, c.profile, { trimMm: 2 });
        assessMs = Math.round(performance.now() - t1);
        buttons = r.kinds.reduce((a, k) => a + +!!k.direct + +!!k.rest, 0) + +!!r.all;
      }
      rows.push({ assessMs, buttons, name: c.name, ampel: ampelOf(v).color, ampelAfter: ampelOf(va).color, crit: d.criticalBefore, critAfter: d.criticalAfter, newCrit: d.newCritical, newCaution: d.newCaution, newGapSparse: d.newGapSparse, open: d.open, objects, ms: Math.round(ms) });
    }
    mkdirSync(new URL('./bench/', import.meta.url), { recursive: true });
    if (process.env.BENCH_CHECK) {
      // The hard rule everywhere, and no case left with more critical cells than the reference (1 cell slack:
      // sewing differs by a hair between machines' floating point).
      const ref = new Map<string, { critAfter: number }>((JSON.parse(new TextDecoder().decode(readFileSync(new URL('./bench/korrektur.json', import.meta.url)))) as { name: string; critAfter: number }[]).map((r) => [r.name, r]));
      for (const r of rows) {
        expect(r.newCrit, `${r.name}: new critical cells`).toBe(0);
        const was = ref.get(r.name);
        if (was) expect(r.critAfter, `${r.name}: critical after`).toBeLessThanOrEqual(was.critAfter + 1);
      }
    }
    const file = process.env.BENCH_OUT ?? (process.env.BENCH_BASELINE ? 'korrektur-baseline.json' : 'korrektur.json');
    writeFileSync(new URL(`./bench/${file}`, import.meta.url), new TextEncoder().encode(JSON.stringify(rows, null, 1)));
    expect(FIX_KINDS.length).toBe(5);
  }, 3_600_000);
});
