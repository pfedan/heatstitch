import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyProposals, planCorrection } from '../src/correct/plan';
import { cellDiff, ampelOf } from '../src/correct/engine/cells';
import { validateDesign } from '../src/correct/engine/validate';
import { ALL_CHECKS } from '../src/validation/validate';
import { corpus } from './helpers/korrekturCorpus';

/**
 * Benchmark of the correction engine on the fixed test set. Run with BENCH=1; writes
 * tests/bench/korrektur.json and prints a table.
 */
const run = process.env.BENCH ? describe : describe.skip;

run('correction benchmark', () => {
  it('measures today\'s engine', async () => {
    const rows = [];
    for (const c of corpus()) {
      const v = validateDesign(c.pattern, c.profile);
      const t0 = performance.now();
      const plan = await planCorrection(c.pattern, v, c.profile, ALL_CHECKS, { goal: 'critical', focus: 'both', trimMm: 2 });
      const chosen = plan.proposals.filter((x) => x.checked);
      const after = chosen.length ? applyProposals(c.pattern, chosen, 2)?.pattern ?? c.pattern : c.pattern;
      const ms = performance.now() - t0;
      const va = validateDesign(after, c.profile);
      const d = cellDiff(v, va);
      rows.push({ name: c.name, ampel: ampelOf(v).color, ampelAfter: ampelOf(va).color, crit: d.criticalBefore, critAfter: d.criticalAfter, newCrit: d.newCritical, newCaution: d.newCaution, newGapSparse: d.newGapSparse, open: d.open, ms: Math.round(ms) });
    }
    console.table(rows.map((r) => ({ ...r, open: Object.entries(r.open).map(([k, [a, b]]) => `${k}:${a}>${b}`).join(' ') })));
    mkdirSync(new URL('./bench/', import.meta.url), { recursive: true });
    writeFileSync(new URL('./bench/korrektur-baseline.json', import.meta.url), JSON.stringify(rows, null, 1));
    expect(rows.length).toBeGreaterThan(0);
  }, 1_800_000);
});
