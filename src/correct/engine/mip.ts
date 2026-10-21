import type { Engine } from '../../wasm/pkg/heatstitch_core';

/**
 * The exact solver for one group: the choice of variants as a mixed integer program, solved by
 * HiGHS (MIT, WebAssembly, loaded only when used). Density is additive (the field in
 * core/src/correct/engine/field.rs), so every sub-cell's density is linear in the choice:
 *
 *   x[u][k] in {0, 1}, one variant per unit;  y[c] in {0, 1}: open cell c is fixed;
 *   per sub-cell s of a fixed cell:           R(s) + sum c[u][k](s) x[u][k] <= crit(c) + M (1 - y[c]);
 *   per sub-cell s of a cell not critical:    R(s) + sum c[u][k](s) x[u][k] <= bound(c)  (hard rule);
 *   maximize 1e6 sum y - 1e3 sum visibility x - sum touched x.
 *
 * The core writes the program (core/src/correct/engine/mip.rs); this module only runs HiGHS on it.
 */

type Solver = { solve(problem: string, options?: Record<string, unknown>): { Status: string; Columns: Record<string, { Primal?: number }> } };
let loading: Promise<Solver> | null = null;

/** HiGHS, loaded once. */
function highs(): Promise<Solver> {
  loading ??= import('highs').then((m) => m.default() as unknown as Promise<Solver>);
  return loading;
}

export interface MipResult {
  choice: number[];
  status: string;
  rows: number;
  cols: number;
}

/**
 * The best choice per unit of group `g` of engine `e` (after beginGroup), or null when the program
 * fixes nothing or HiGHS found no choice in time.
 */
export async function solveMip(e: Engine, g: number, budgetMs: number): Promise<MipResult | null> {
  const m = e.mipProgram(g);
  if (!m) return null;
  let lp: string;
  let vars: Uint32Array;
  let rows: number;
  let ys: number;
  try {
    lp = m.lp;
    vars = m.takeVars();
    rows = m.rows;
    ys = m.ys;
  } finally {
    m.free();
  }
  const n = vars.length / 2;
  const units = n ? Math.max(...Array.from({ length: n }, (_, i) => vars[2 * i])) + 1 : 0;
  const h = await highs();
  const r = h.solve(lp, { time_limit: Math.max(0.05, budgetMs / 1000), output_flag: false, mip_rel_gap: 1e-6 });
  if (!['Optimal', 'Time limit reached'].includes(r.Status) || !r.Columns.x0 || r.Columns.x0.Primal === undefined) return null;
  const choice = new Array<number>(units).fill(-1);
  for (let i = 0; i < n; i++) if ((r.Columns[`x${i}`]?.Primal ?? 0) > 0.5) choice[vars[2 * i]] = vars[2 * i + 1];
  if (choice.some((k) => k < 0)) return null;
  return { choice, status: r.Status, rows, cols: n + ys };
}
