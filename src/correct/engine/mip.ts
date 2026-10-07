import { CRITICAL } from '../../validation/thresholds';
import type { Contribution, Field } from './field';
import { RISK, SUB } from './field';

/**
 * The exact solver for one group: the choice of variants as a mixed integer program, solved by
 * HiGHS (MIT, WebAssembly, loaded only when used). Density is additive (field.ts), so every
 * sub-cell's density is linear in the choice:
 *
 *   x[u][k] in {0, 1}, one variant per unit;  y[c] in {0, 1}: open cell c is fixed;
 *   per sub-cell s of a fixed cell:           R(s) + sum c[u][k](s) x[u][k] <= crit(c) + M (1 - y[c]);
 *   per sub-cell s of a cell not critical:    R(s) + sum c[u][k](s) x[u][k] <= bound(c)  (hard rule);
 *   maximize 1e6 sum y - 1e3 sum visibility x - sum touched x.
 *
 * R is the rest of the design, crit(c) uses the cell's satin share as it is, bound(c) keeps the
 * risk margin of the fast measure. Only density is modelled: penetrations and short stitches are
 * not linear and stay with the search and the real check after it. Sub-cells that no choice can
 * push over their limit are left out, which keeps the program small.
 */

export interface MipUnit {
  contributions: Contribution[];
  /** Variants that may be chosen. */
  allowed: number[];
  chosen: number;
  visibility: number[];
}

type Solver = { solve(problem: string, options?: Record<string, unknown>): { Status: string; Columns: Record<string, { Primal?: number }> } };
let loading: Promise<Solver> | null = null;

/** HiGHS, loaded once. */
function highs(): Promise<Solver> {
  loading ??= import('highs').then((m) => m.default() as unknown as Promise<Solver>);
  return loading;
}

/** Coefficients rounded for the LP text (density values are mm/mm²). */
const num = (v: number) => (Math.abs(v) < 1e-9 ? '0' : Number(v.toPrecision(7)).toString());

export interface MipResult {
  choice: number[];
  status: string;
  rows: number;
  cols: number;
}

/**
 * The best choice per unit for group `units` (the field holds their current choice), or null when
 * HiGHS found none in time. `target`: cells open by density that count.
 */
export async function solveMip(f: Field, units: MipUnit[], target: Uint8Array, budgetMs: number): Promise<MipResult | null> {
  // Terms per sub-cell: variable index and coefficient.
  const vars: { u: number; k: number }[] = [];
  const terms = new Map<number, Map<number, number>>();
  /** Sum of the current choice per sub-cell (R = field - this). */
  const current = new Map<number, number>();
  /** Per unit and sub-cell: largest and smallest over the allowed variants. */
  const hi = new Map<number, number>();
  const lo = new Map<number, number>();
  units.forEach((g, u) => {
    const seen = new Map<number, { max: number; min: number; n: number }>();
    for (const k of g.allowed) {
      const vi = vars.length;
      vars.push({ u, k });
      const m = g.contributions[k].map;
      for (let y = 0; y < m.rows; y++) {
        const sy = m.oy + y;
        if (sy < 0 || sy >= f.srows) continue;
        for (let x = 0; x < m.cols; x++) {
          const sx = m.ox + x;
          if (sx < 0 || sx >= f.scols) continue;
          const v = m.total[y * m.cols + x];
          if (!v) continue;
          const s = sy * f.scols + sx;
          let t = terms.get(s);
          if (!t) terms.set(s, (t = new Map()));
          t.set(vi, v);
          const e = seen.get(s);
          if (e) {
            e.max = Math.max(e.max, v);
            e.min = Math.min(e.min, v);
            e.n++;
          } else seen.set(s, { max: v, min: v, n: 1 });
          if (k === g.chosen) current.set(s, (current.get(s) ?? 0) + v);
        }
      }
    }
    // A variant without thread at s contributes 0 there.
    for (const [s, e] of seen) {
      hi.set(s, (hi.get(s) ?? 0) + e.max);
      lo.set(s, (lo.get(s) ?? 0) + (e.n < g.allowed.length ? 0 : e.min));
    }
  });
  const th = f.th;
  const critOf = (c: number) => {
    const { share } = f.densityOf(c);
    return th.critical + share * (th.satinCritical - th.critical);
  };
  const crit = new Map<number, number>();
  const rows: string[] = [];
  const ys = new Map<number, number>();
  const impossible = new Set<number>();
  const pending: { s: number; c: number; rest: number }[] = [];
  for (const [s] of terms) {
    const c = Math.floor(s / f.scols / SUB) * f.cols + Math.floor((s % f.scols) / SUB);
    if (!crit.has(c)) crit.set(c, critOf(c));
    const cr = crit.get(c)!;
    const rest = f.total[s] - (current.get(s) ?? 0);
    const max = rest + (hi.get(s) ?? 0);
    const min = rest + (lo.get(s) ?? 0);
    if (f.base[c] === CRITICAL) {
      if (!target[c] || f.criticalBy(c, 'holes')) continue;
      if (min > cr) impossible.add(c);
      else if (max > cr) pending.push({ s, c, rest });
    } else {
      const bound = Math.min(cr * (1 - 1e-4), Math.max(cr * (1 - RISK), f.basePeak[c] + 0.05));
      if (max <= bound) continue;
      const t = terms.get(s)!;
      rows.push(`${[...t].map(([vi, v]) => `${num(v)} x${vi}`).join(' + ')} <= ${num(bound - rest)}`);
    }
  }
  // Open cells whose sub-cells all fit whatever the choice are fixed already (counted as such).
  for (const { s, c, rest } of pending) {
    if (impossible.has(c)) continue;
    let y = ys.get(c);
    if (y === undefined) ys.set(c, (y = ys.size));
    const t = terms.get(s)!;
    const big = Math.max(0, rest + (hi.get(s) ?? 0) - crit.get(c)!);
    rows.push(`${[...t].map(([vi, v]) => `${num(v)} x${vi}`).join(' + ')} + ${num(big)} y${y} <= ${num(crit.get(c)! + big - rest)}`);
  }
  if (!ys.size) return null;
  units.forEach((_, u) => {
    const own = vars.map((v, i) => (v.u === u ? `x${i}` : '')).filter(Boolean);
    rows.push(`${own.join(' + ')} = 1`);
  });
  const objTerms: [number, string][] = [...[...ys.values()].map((y): [number, string] => [1e6, `y${y}`]), ...vars.map((v, i): [number, string] => [-(1e3 * units[v.u].visibility[v.k] + (v.k ? 1 : 0)), `x${i}`])].filter(([w]) => w !== 0);
  const obj = objTerms.map(([w, n], i) => `${w < 0 ? '- ' : i ? '+ ' : ''}${num(Math.abs(w))} ${n}`).join(' ');
  const lp = [
    'Maximize',
    ` obj: ${obj}`,
    'Subject To',
    ...rows.map((r, i) => ` r${i}: ${r}`),
    'Binary',
    ...vars.map((_, i) => ` x${i}`),
    ...[...ys.values()].map((y) => ` y${y}`),
    'End',
  ].join('\n');
  const h = await highs();
  const r = h.solve(lp, { time_limit: Math.max(0.05, budgetMs / 1000), output_flag: false, mip_rel_gap: 1e-6 });
  if (!['Optimal', 'Time limit reached'].includes(r.Status) || !r.Columns.x0 || r.Columns.x0.Primal === undefined) return null;
  const choice = units.map(() => -1);
  vars.forEach((v, i) => {
    if ((r.Columns[`x${i}`]?.Primal ?? 0) > 0.5) choice[v.u] = v.k;
  });
  if (choice.some((k) => k < 0)) return null;
  return { choice, status: r.Status, rows: rows.length, cols: vars.length + ys.size };
}
