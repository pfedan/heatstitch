//! Drawn lines sewn along their curves (lineStitches in src/model/line.ts): path by path with the
//! stitches of along.rs, as redwork (all paths in one go, each line there and back), or with an
//! echo (copies beside the line). What a line object remembers stays TypeScript.

use std::collections::HashSet;

use super::along::{
    BorderType, EchoSide, LineEcho, PathStitch, has_phase, is_redwork, is_run_type, passes_of,
    sew_along, spacing_of,
};
use super::line_order::turned_order;
use super::runs::Run;
use crate::digitize::border::{BORDER_STITCH, border_run};
use crate::digitize::echo::{self, EchoLine, EchoSpec, echo_lines};
use crate::digitize::redwork::{RedworkLine, redwork_graph, redwork_walks};
use crate::geom::Pt;
use crate::js::{dist, hypot, round};
use crate::shape::path::{Form, flatten};

/// Gaps between paths up to this are bridged by redwork (mm; JOIN_SNAP_MM).
const REDWORK_GAP: f64 = 0.5;

fn same_pt(a: Pt, b: Pt) -> bool {
    hypot(a[0] - b[0], a[1] - b[1]) < 1e-6
}

fn length_of(l: &[Pt]) -> f64 {
    let mut s = 0.0;
    for i in 1..l.len() {
        s += hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
    }
    s
}

/// The stitches along the paths of `form`, one after the other, each from the end nearest the
/// one before (the first from `from` when given).
pub fn line_stitches(form: &Form, st: &PathStitch, reverse: bool, from: Option<Pt>) -> Vec<Run> {
    let mut paths: Vec<(Vec<Pt>, bool)> = form
        .paths
        .iter()
        .map(|p| (flatten(p, 0.1), p.closed))
        .filter(|x| x.0.len() >= 2)
        .collect();
    if is_redwork(st) {
        // All paths in one go where they touch, each line there and back over the same needle points.
        let lines: Vec<RedworkLine> = paths
            .into_iter()
            .map(|(pts, closed)| RedworkLine { pts, closed })
            .collect();
        let tol = st.tol();
        let len = st.length.unwrap_or(BORDER_STITCH);
        let runs = redwork_runs(
            &lines,
            |pts| border_run(pts, 1, tol, len),
            from,
            st.redwork_gap.unwrap_or(REDWORK_GAP),
            st.kind == BorderType::Triple,
        );
        return if reverse {
            runs.into_iter()
                .rev()
                .map(|mut r| {
                    r.reverse();
                    Run::new(r)
                })
                .collect()
        } else {
            runs.into_iter().map(Run::new).collect()
        };
    }
    if reverse {
        paths.reverse();
        for p in &mut paths {
            p.0.reverse();
        }
    }
    let n = paths.len();
    let mut out = vec![];
    let mut at = from;
    for (k, (pts, closed)) in paths.into_iter().enumerate() {
        let pts = if closed && pts.len() > 2 && !same_pt(pts[0], pts[pts.len() - 1]) {
            let mut p = pts;
            p.push(p[0]);
            p
        } else {
            pts
        };
        // A satin line's order set by hand, for this path (counted as drawn).
        let own = if st.kind == BorderType::Satin && st.echo.is_none() {
            st.order
                .as_ref()
                .and_then(|o| o.get(if reverse { n - 1 - k } else { k }))
                .and_then(Option::as_ref)
        } else {
            None
        };
        let runs = if let Some(own) = own {
            let mut s = st.clone();
            s.own = Some(if reverse {
                turned_order(own)
            } else {
                own.clone()
            });
            let line: Vec<Pt> = if reverse {
                pts.iter().rev().copied().collect()
            } else {
                pts
            };
            sew_along(&line, closed, &s, None, None, false, 0.0)
        } else if let Some(e) = &st.echo {
            echo_stitches(&pts, closed, st, e, at, reverse)
        } else {
            sew_along(&pts, closed, st, at, None, reverse, 0.0)
        };
        if let Some(q) = runs.last().and_then(Run::last) {
            at = Some(q);
        }
        out.extend(runs);
    }
    out
}

/// Redwork stitches along `lines` (see redworkRuns in digitize/redwork.ts): one run per connected
/// part, each edge stitched once and sewn there and back over the same needle points; with `bean`
/// the pass on top is a bean stitch.
pub fn redwork_runs(
    lines: &[RedworkLine],
    stitch: impl Fn(&[Pt]) -> Vec<Pt>,
    from: Option<Pt>,
    snap: f64,
    bean: bool,
) -> Vec<Vec<Pt>> {
    let g = redwork_graph(lines, snap);
    let walks = redwork_walks(&g, from);
    let sewn: Vec<Vec<Pt>> = g.edges.iter().map(|e| stitch(&e.pts)).collect();
    let mut passed: HashSet<usize> = HashSet::new();
    walks
        .iter()
        .map(|walk| {
            let mut run: Vec<Pt> = vec![];
            for step in walk {
                let s = &sewn[step.edge];
                if s.len() < 2 {
                    continue;
                }
                let dir: Vec<Pt> = if step.back {
                    s.iter().rev().copied().collect()
                } else {
                    s.clone()
                };
                let top = !passed.insert(step.edge);
                let pts = if bean && top { beaned(&dir) } else { dir };
                for q in pts {
                    if run.last().is_none_or(|&l| dist(l, q) > 1e-6) {
                        run.push(q);
                    }
                }
            }
            run
        })
        .filter(|r| r.len() > 1)
        .collect()
}

/// Bean stitch along `pts`: each stitch forward, back, forward over the same two needle points.
fn beaned(pts: &[Pt]) -> Vec<Pt> {
    let mut out = vec![pts[0]];
    for i in 1..pts.len() {
        out.extend([pts[i], pts[i - 1], pts[i]]);
    }
    out
}

/// The copies a line sews itself: not those in a thread of their own or left out.
fn own_copies(e: &LineEcho) -> Vec<i64> {
    let n = 1f64.max(round(e.count)) as i64;
    (1..=n)
        .filter(|&k| {
            !e.colors
                .as_ref()
                .is_some_and(|c| c.get((k - 1) as usize).copied().unwrap_or(false))
                && !e.skip.as_ref().is_some_and(|s| s.contains(&k))
        })
        .collect()
}

fn spec_of(e: &LineEcho) -> EchoSpec {
    EchoSpec {
        side: match e.side {
            EchoSide::Out => echo::EchoSide::Out,
            EchoSide::In => echo::EchoSide::In,
            EchoSide::Both => echo::EchoSide::Both,
        },
        count: e.count,
        gap: e.gap,
        reverse: e.reverse,
        rings: e.only.clone().unwrap_or_else(|| own_copies(e)),
        with_line: e.only.is_none(),
    }
}

fn frac(v: f64) -> f64 {
    ((v % 1.0) + 1.0) % 1.0
}

/// A line with its echo (see echoStitches in line.ts): the line and its copies one after the other.
fn echo_stitches(
    line: &[Pt],
    closed: bool,
    st: &PathStitch,
    e: &LineEcho,
    from: Option<Pt>,
    reverse: bool,
) -> Vec<Run> {
    let passes = passes_of(st);
    let mut lines: Vec<EchoLine> = if line.len() < 2 {
        vec![EchoLine {
            line: line.to_vec(),
            closed,
            back: false,
            k: 0,
        }]
    } else {
        echo_lines(
            line,
            closed,
            &spec_of(e),
            0.0,
            !closed && passes % 2.0 == 0.0,
        )
    };
    if lines.is_empty() {
        return vec![];
    }
    // From the end nearest the needle, where the order allows it.
    let first = lines[0].line[0];
    let last_l = &lines[lines.len() - 1].line;
    let last = last_l[last_l.len() - 1];
    let free = !closed && e.side == EchoSide::Both;
    if let (true, Some(f)) = (free, from)
        && hypot(last[0] - f[0], last[1] - f[1]) < hypot(first[0] - f[0], first[1] - f[1])
    {
        lines.reverse();
        for l in &mut lines {
            l.line.reverse();
            l.back = !l.back;
        }
    }
    let mut plain = st.clone();
    plain.echo = None;
    let motif = st.kind == BorderType::Motif;
    let spacing = spacing_of(st);
    let line_len = length_of(line);
    let figures = 1f64.max(round(line_len / 0.5f64.max(spacing)));
    let period_of = |l: &EchoLine| -> f64 {
        if !motif {
            return spacing;
        }
        let d = line_len / figures;
        let len = length_of(&l.line);
        if l.closed {
            len / 1f64.max(round(len / d))
        } else {
            len / figures
        }
    };
    let stitch_of = |l: &EchoLine| -> PathStitch {
        let mut s = plain.clone();
        if motif {
            s.spacing = Some(period_of(l));
        }
        s
    };
    let shift_of = |l: &EchoLine| -> f64 {
        if !has_phase(st.kind) {
            return 0.0;
        }
        let turns = ((l.k.abs() as f64) * e.phase.unwrap_or(0.0)) / 360.0;
        if !l.back || l.closed {
            return frac(turns);
        }
        // Sewn against the way it was drawn: the figures counted from its far end.
        frac(length_of(&l.line) / period_of(l) - turns)
    };
    if !is_run_type(st.kind) || e.cut {
        let mut runs: Vec<Run> = vec![];
        for l in &lines {
            let end = runs.last().and_then(Run::last);
            let start = if has_phase(st.kind) { None } else { end };
            runs.extend(sew_along(
                &l.line,
                l.closed,
                &stitch_of(l),
                start,
                None,
                l.back != reverse,
                shift_of(l),
            ));
        }
        // Cut: a trim from copy to copy, however near they are.
        if e.cut {
            for r in runs.iter_mut().skip(1) {
                r.trim = true;
            }
        }
        return runs;
    }
    let mut all: Vec<Pt> = vec![];
    let add = |q: Pt, all: &mut Vec<Pt>| {
        if all.last().is_none_or(|&l| !same_pt(l, q)) {
            all.push(q);
        }
    };
    if passes > 1.0 {
        // Each copy there and back on its own, then on to the next.
        for l in &lines {
            for run in sew_along(&l.line, l.closed, &plain, None, None, false, 0.0) {
                for q in run.pts {
                    add(q, &mut all);
                }
            }
        }
        return if all.len() > 1 {
            vec![Run::new(all)]
        } else {
            vec![]
        };
    }
    for l in &lines {
        for &q in &l.line {
            add(q, &mut all);
        }
    }
    sew_along(&all, false, &plain, None, None, false, 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shape::path::{Node, Path};

    fn node(x: f64, y: f64) -> Node {
        Node {
            p: [x, y],
            a: [x, y],
            b: [x, y],
            smooth: false,
        }
    }

    #[test]
    fn paths_follow_on_from_the_nearer_end() {
        let form = Form {
            paths: vec![
                Path {
                    nodes: vec![node(0.0, 0.0), node(10.0, 0.0)],
                    closed: false,
                },
                Path {
                    nodes: vec![node(20.0, 5.0), node(10.0, 5.0)],
                    closed: false,
                },
            ],
            nonzero: false,
        };
        let runs = line_stitches(&form, &PathStitch::run(2.5), false, None);
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[1].pts[0], [10.0, 5.0]);
    }
}
