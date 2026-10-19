//! The exact program for one group (src/correct/engine/mip.ts): the choice of variants as a mixed
//! integer program in LP text. Density is additive (field.rs), so every sub-cell's density is
//! linear in the choice:
//!
//!   x[u][k] in {0, 1}, one variant per unit;  y[c] in {0, 1}: open cell c is fixed;
//!   per sub-cell s of a fixed cell:           R(s) + sum c[u][k](s) x[u][k] <= crit(c) + M (1 - y[c]);
//!   per sub-cell s of a cell not critical:    R(s) + sum c[u][k](s) x[u][k] <= bound(c)  (hard rule);
//!   maximize 1e6 sum y - 1e3 sum visibility x - sum touched x.
//!
//! R is the rest of the design, crit(c) uses the cell's satin share as it is, bound(c) keeps the
//! risk margin of the fast measure. Only density is modelled: penetrations and short stitches are
//! not linear and stay with the search and the real check after it. Sub-cells that no choice can
//! push over their limit are left out, which keeps the program small. HiGHS (MIT, WebAssembly)
//! solves it on the TypeScript side.

use super::field::{Field, RISK, SUB};
use super::levels::{CRITICAL, density_limits};
use super::search::MipUnit;
use crate::js::IdMap;

pub struct MipProgram {
    pub lp: String,
    /// Unit and variant of each x column.
    pub vars: Vec<(usize, usize)>,
    pub rows: usize,
    pub ys: usize,
}

/// A number as `Number(v.toPrecision(7)).toString()` writes it in JavaScript.
fn num(v: f64) -> String {
    if v.abs() < 1e-9 {
        return "0".into();
    }
    let rounded: f64 = format!("{v:.6e}").parse().unwrap_or(v);
    js_string(rounded)
}

/// Number::toString of JavaScript (shortest digits; exponent below 1e-6 and from 1e21).
fn js_string(v: f64) -> String {
    if v == 0.0 {
        return "0".into();
    }
    let sci = format!("{:e}", v.abs());
    let (mant, exp) = sci.split_once('e').unwrap();
    let exp: i32 = exp.parse().unwrap();
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exp + 1;
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let sign = if e < 0 { '-' } else { '+' };
        if k == 1 {
            format!("{digits}e{sign}{}", e.abs())
        } else {
            format!("{}.{}e{sign}{}", &digits[..1], &digits[1..], e.abs())
        }
    };
    if v < 0.0 { format!("-{body}") } else { body }
}

/// The program of `units` (the field holds their current choice), or None when no open cell can
/// be fixed by them. `target`: cells open by density that count.
pub fn mip_program(f: &Field, units: &[MipUnit], target: &[u8]) -> Option<MipProgram> {
    // Terms per sub-cell, in the order they come up: variable index and coefficient.
    let mut vars: Vec<(usize, usize)> = vec![];
    let mut order: Vec<i64> = vec![];
    let mut terms: IdMap<i64, Vec<(usize, f64)>> = IdMap::default();
    // Sum of the current choice per sub-cell (R = field - this).
    let mut current: IdMap<i64, f64> = IdMap::default();
    // Per sub-cell: the sum over units of their largest and smallest allowed variant.
    let mut hi: IdMap<i64, f64> = IdMap::default();
    let mut lo: IdMap<i64, f64> = IdMap::default();
    for (u, g) in units.iter().enumerate() {
        let mut seen_order: Vec<i64> = vec![];
        let mut seen: IdMap<i64, (f64, f64, usize)> = IdMap::default();
        for &k in &g.allowed {
            let vi = vars.len();
            vars.push((u, k));
            let m = &g.contributions[k].map;
            for y in 0..m.rows {
                let sy = m.oy + y;
                if sy < 0 || sy >= f.srows {
                    continue;
                }
                for x in 0..m.cols {
                    let sx = m.ox + x;
                    if sx < 0 || sx >= f.scols {
                        continue;
                    }
                    let v = m.total[(y * m.cols + x) as usize] as f64;
                    if v == 0.0 {
                        continue;
                    }
                    let s = sy * f.scols + sx;
                    let t = terms.entry(s).or_insert_with(|| {
                        order.push(s);
                        vec![]
                    });
                    match t.iter_mut().find(|(i, _)| *i == vi) {
                        Some(e) => e.1 = v,
                        None => t.push((vi, v)),
                    }
                    match seen.get_mut(&s) {
                        Some(e) => {
                            e.0 = e.0.max(v);
                            e.1 = e.1.min(v);
                            e.2 += 1;
                        }
                        None => {
                            seen.insert(s, (v, v, 1));
                            seen_order.push(s);
                        }
                    }
                    if k == g.chosen {
                        *current.entry(s).or_insert(0.0) += v;
                    }
                }
            }
        }
        // A variant without thread at s contributes 0 there.
        for s in seen_order {
            let (max, min, n) = seen[&s];
            *hi.entry(s).or_insert(0.0) += max;
            *lo.entry(s).or_insert(0.0) += if n < g.allowed.len() { 0.0 } else { min };
        }
    }
    let mut crit: IdMap<usize, f64> = IdMap::default();
    let mut rows: Vec<String> = vec![];
    let mut ys: IdMap<usize, usize> = IdMap::default();
    let mut ys_order: Vec<usize> = vec![];
    let mut impossible: IdMap<usize, ()> = IdMap::default();
    let mut pending: Vec<(i64, usize, f64)> = vec![];
    let line = |t: &[(usize, f64)]| {
        t.iter()
            .map(|(vi, v)| format!("{} x{vi}", num(*v)))
            .collect::<Vec<_>>()
            .join(" + ")
    };
    for &s in &order {
        let c = ((s / f.scols / SUB) * f.cols + (s % f.scols) / SUB) as usize;
        let cr = *crit
            .entry(c)
            .or_insert_with(|| density_limits(&f.th, f.density_of(c).1)[1]);
        let rest = f.total[s as usize] as f64 - current.get(&s).copied().unwrap_or(0.0);
        let max = rest + hi.get(&s).copied().unwrap_or(0.0);
        let min = rest + lo.get(&s).copied().unwrap_or(0.0);
        if f.base[c] == CRITICAL {
            if target[c] == 0 || f.critical_by_holes(c) {
                continue;
            }
            if min > cr {
                impossible.insert(c, ());
            } else if max > cr {
                pending.push((s, c, rest));
            }
        } else {
            let bound =
                (cr * (1.0 - 1e-4)).min((cr * (1.0 - RISK)).max(f.base_peak[c] as f64 + 0.05));
            if max <= bound {
                continue;
            }
            rows.push(format!("{} <= {}", line(&terms[&s]), num(bound - rest)));
        }
    }
    // Open cells whose sub-cells all fit whatever the choice are fixed already (counted as such).
    for (s, c, rest) in pending {
        if impossible.contains_key(&c) {
            continue;
        }
        let y = *ys.entry(c).or_insert_with(|| {
            ys_order.push(c);
            ys_order.len() - 1
        });
        let cr = crit[&c];
        let big = (rest + hi.get(&s).copied().unwrap_or(0.0) - cr).max(0.0);
        rows.push(format!(
            "{} + {} y{y} <= {}",
            line(&terms[&s]),
            num(big),
            num(cr + big - rest)
        ));
    }
    if ys_order.is_empty() {
        return None;
    }
    for u in 0..units.len() {
        let own: Vec<String> = vars
            .iter()
            .enumerate()
            .filter(|(_, v)| v.0 == u)
            .map(|(i, _)| format!("x{i}"))
            .collect();
        rows.push(format!("{} = 1", own.join(" + ")));
    }
    let mut obj_terms: Vec<(f64, String)> = (0..ys_order.len())
        .map(|y| (1e6, format!("y{y}")))
        .collect();
    for (i, &(u, k)) in vars.iter().enumerate() {
        let w = -(1e3 * units[u].visibility[k] + if k != 0 { 1.0 } else { 0.0 });
        obj_terms.push((w, format!("x{i}")));
    }
    obj_terms.retain(|(w, _)| *w != 0.0);
    let obj = obj_terms
        .iter()
        .enumerate()
        .map(|(i, (w, n))| {
            let sign = if *w < 0.0 {
                "- "
            } else if i > 0 {
                "+ "
            } else {
                ""
            };
            format!("{sign}{} {n}", num(w.abs()))
        })
        .collect::<Vec<_>>()
        .join(" ");
    let mut lp = vec![
        "Maximize".to_string(),
        format!(" obj: {obj}"),
        "Subject To".to_string(),
    ];
    for (i, r) in rows.iter().enumerate() {
        lp.push(format!(" r{i}: {r}"));
    }
    lp.push("Binary".into());
    for i in 0..vars.len() {
        lp.push(format!(" x{i}"));
    }
    for y in 0..ys_order.len() {
        lp.push(format!(" y{y}"));
    }
    lp.push("End".into());
    Some(MipProgram {
        lp: lp.join("\n"),
        vars,
        rows: rows.len(),
        ys: ys_order.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_as_javascript_writes_them() {
        assert_eq!(num(0.0), "0");
        assert_eq!(num(1e6), "1000000");
        assert_eq!(num(2.5), "2.5");
        assert_eq!(num(-2.71234567), "-2.712346");
        assert_eq!(num(1.23456789e-7), "1.234568e-7");
        assert_eq!(num(0.000123456789), "0.0001234568");
        assert_eq!(num(1234567.89), "1234568");
        assert_eq!(js_string(1e21), "1e+21");
    }
}
