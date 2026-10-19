//! SVG path data as forms (src/shape/svgPath.ts): all commands, arcs as cubic curves, mapped by `m`
//! from the file's user units to world millimetres. Lines and quadratic curves become cubic curves
//! with handles on the line, so every form is edited the same way.

use crate::geom::Pt;
use crate::js::hypot;
use crate::shape::path::{Form, Mat, Node, Path, apply};

struct Cmd {
    cmd: u8,
    args: Vec<f64>,
}

/// Length of a number at the start of `s` (`[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?`), 0 for none.
fn number_len(s: &[u8]) -> usize {
    let mut i = 0;
    if i < s.len() && (s[i] == b'+' || s[i] == b'-') {
        i += 1;
    }
    let digits = |i: &mut usize| {
        let from = *i;
        while *i < s.len() && s[*i].is_ascii_digit() {
            *i += 1;
        }
        *i - from
    };
    if digits(&mut i) > 0 {
        if i < s.len() && s[i] == b'.' {
            i += 1;
            digits(&mut i);
        }
    } else if i < s.len() && s[i] == b'.' {
        i += 1;
        if digits(&mut i) == 0 {
            return 0;
        }
    } else {
        return 0;
    }
    if i < s.len() && (s[i] == b'e' || s[i] == b'E') {
        let mut j = i + 1;
        if j < s.len() && (s[j] == b'+' || s[j] == b'-') {
            j += 1;
        }
        let from = j;
        while j < s.len() && s[j].is_ascii_digit() {
            j += 1;
        }
        if j > from {
            i = j;
        }
    }
    i
}

/// JavaScript's `\s` (ASCII part and the common Unicode spaces), as path data may hold them.
fn is_space(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}'
}

/// The commands of path data with their numbers, up to the first malformed part (as browsers do).
fn tokens(d: &str) -> Vec<Cmd> {
    let mut out: Vec<Cmd> = vec![];
    let b = d.as_bytes();
    let mut i = 0;
    while i < b.len() {
        let ch = d[i..].chars().next().unwrap_or(' ');
        if is_space(ch) || ch == ',' {
            i += ch.len_utf8();
            continue;
        }
        if "MmZzLlHhVvCcSsQqTtAa".contains(ch) {
            out.push(Cmd {
                cmd: ch as u8,
                args: vec![],
            });
            i += 1;
            continue;
        }
        let Some(cur) = out.last_mut() else { break };
        let k = cur.args.len() % 7;
        // Arc flags may be written without separators ("a1 1 0 01 2 3").
        if (cur.cmd == b'A' || cur.cmd == b'a') && (k == 3 || k == 4) && (ch == '0' || ch == '1') {
            cur.args.push(if ch == '1' { 1.0 } else { 0.0 });
            i += 1;
            continue;
        }
        let n = number_len(&b[i..]);
        if n == 0 {
            break;
        }
        match d[i..i + n].parse::<f64>() {
            Ok(v) => cur.args.push(v),
            Err(_) => break,
        }
        i += n;
    }
    out
}

type Seg = [Pt; 4];

/// Cubic curves for an elliptical arc (SVG implementation notes F.6), in user units.
#[allow(clippy::too_many_arguments)]
fn arc(p0: Pt, rx: f64, ry: f64, phi_deg: f64, large: f64, sweep: f64, p1: Pt) -> Vec<Seg> {
    if p0 == p1 {
        return vec![];
    }
    let (mut rx, mut ry) = (rx.abs(), ry.abs());
    // (`!rx` in JavaScript: zero or NaN.)
    if rx == 0.0 || rx.is_nan() || ry == 0.0 || ry.is_nan() {
        return vec![[p0, p0, p1, p1]];
    }
    let phi = (phi_deg * std::f64::consts::PI) / 180.0;
    let (cos, sin) = (phi.cos(), phi.sin());
    let dx = (p0[0] - p1[0]) / 2.0;
    let dy = (p0[1] - p1[1]) / 2.0;
    let x1 = cos * dx + sin * dy;
    let y1 = -sin * dx + cos * dy;
    let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if lambda > 1.0 {
        rx *= lambda.sqrt();
        ry *= lambda.sqrt();
    }
    let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    let den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    // Math.max(0, NaN) is NaN in JavaScript.
    let q = num / den;
    let mut co = if q.is_nan() { f64::NAN } else { q.max(0.0) }.sqrt();
    if large == sweep {
        co = -co;
    }
    let cx1 = (co * rx * y1) / ry;
    let cy1 = (-co * ry * x1) / rx;
    let cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2.0;
    let cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2.0;
    let ang = |ux: f64, uy: f64, vx: f64, vy: f64| (ux * vy - uy * vx).atan2(ux * vx + uy * vy);
    let t1 = ang(1.0, 0.0, (x1 - cx1) / rx, (y1 - cy1) / ry);
    let mut dt = ang(
        (x1 - cx1) / rx,
        (y1 - cy1) / ry,
        (-x1 - cx1) / rx,
        (-y1 - cy1) / ry,
    );
    let tau = 2.0 * std::f64::consts::PI;
    if sweep == 0.0 && dt > 0.0 {
        dt -= tau;
    } else if sweep != 0.0 && dt < 0.0 {
        dt += tau;
    }
    let n = (dt.abs() / (std::f64::consts::PI / 2.0) - 1e-9)
        .ceil()
        .max(1.0) as usize;
    let step = dt / n as f64;
    let k = (4.0 / 3.0) * (step / 4.0).tan();
    let at = |t: f64| -> Pt {
        [
            cx + rx * t.cos() * cos - ry * t.sin() * sin,
            cy + rx * t.cos() * sin + ry * t.sin() * cos,
        ]
    };
    let der = |t: f64| -> Pt {
        [
            -rx * t.sin() * cos - ry * t.cos() * sin,
            -rx * t.sin() * sin + ry * t.cos() * cos,
        ]
    };
    (0..n)
        .map(|i| {
            let a = t1 + i as f64 * step;
            let b = a + step;
            let pa = if i == 0 { p0 } else { at(a) };
            let pb = if i == n - 1 { p1 } else { at(b) };
            let (da, db) = (der(a), der(b));
            [
                pa,
                [pa[0] + k * da[0], pa[1] + k * da[1]],
                [pb[0] - k * db[0], pb[1] - k * db[1]],
                pb,
            ]
        })
        .collect()
}

fn near(a: Pt, b: Pt) -> bool {
    (a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() < 1e-9
}

/// Curves of one subpath as nodes; a closing curve back to the start is folded into the first node.
fn to_path(mut segs: Vec<Seg>, closed: bool, m: &Mat) -> Option<Path> {
    let start = segs.first()?[0];
    let end = segs[segs.len() - 1][3];
    // A closed subpath gets its closing line when it does not end where it began.
    if closed && !near(start, end) {
        segs.push([end, end, start, start]);
    }
    let mut nodes: Vec<Node> = vec![];
    for [p0, c1, c2, p3] in segs {
        match nodes.last_mut() {
            None => nodes.push(Node {
                p: p0,
                a: p0,
                b: c1,
                smooth: false,
            }),
            Some(l) => l.b = c1,
        }
        nodes.push(Node {
            p: p3,
            a: c2,
            b: p3,
            smooth: false,
        });
    }
    if closed && nodes.len() > 1 && near(nodes[0].p, nodes[nodes.len() - 1].p) {
        let last = nodes.pop()?;
        nodes[0].a = last.a;
    }
    let cnt = nodes.len();
    let mapped: Vec<Node> = nodes
        .iter()
        .enumerate()
        .map(|(i, n)| {
            let mut o = Node {
                p: apply(m, n.p),
                a: apply(m, n.a),
                b: apply(m, n.b),
                smooth: false,
            };
            // A node is round when its handles lie on one line through it.
            if closed || (i != 0 && i != cnt - 1) {
                let (ax, ay) = (o.a[0] - o.p[0], o.a[1] - o.p[1]);
                let (bx, by) = (o.b[0] - o.p[0], o.b[1] - o.p[1]);
                let (la, lb) = (hypot(ax, ay), hypot(bx, by));
                if !(la < 1e-6 || lb < 1e-6) {
                    o.smooth =
                        (ax * by - ay * bx).abs() / (la * lb) < 0.02 && ax * bx + ay * by < 0.0;
                }
            }
            o
        })
        .collect();
    (mapped.len() >= 2).then_some(Path {
        closed,
        nodes: mapped,
    })
}

/// Path data as a form, mapped by `m`. Subpaths of a single point are left out.
pub fn parse_path(d: &str, m: &Mat) -> Form {
    let mut paths: Vec<Path> = vec![];
    let mut segs: Vec<Seg> = vec![];
    let mut cur: Pt = [0.0, 0.0];
    let mut start: Pt = [0.0, 0.0];
    let mut last_ctrl: Option<Pt> = None;
    let mut last_quad: Option<Pt> = None;
    let flush = |segs: &mut Vec<Seg>, closed: bool, paths: &mut Vec<Path>| {
        if let Some(p) = to_path(std::mem::take(segs), closed, m) {
            paths.push(p);
        }
    };
    for Cmd { cmd, args } in tokens(d) {
        let rel = cmd.is_ascii_lowercase();
        let c = cmd.to_ascii_uppercase();
        if c == b'Z' {
            flush(&mut segs, true, &mut paths);
            cur = start;
            last_ctrl = None;
            last_quad = None;
            continue;
        }
        let n = match c {
            b'M' | b'L' | b'T' => 2,
            b'H' | b'V' => 1,
            b'C' => 6,
            b'S' | b'Q' => 4,
            b'A' => 7,
            _ => continue,
        };
        let mut i = 0;
        while i + n <= args.len() {
            let a = &args[i..i + n];
            let off = |cur: Pt, x: f64, y: f64| -> Pt {
                if rel {
                    [cur[0] + x, cur[1] + y]
                } else {
                    [x, y]
                }
            };
            let mut ctrl: Option<Pt> = None;
            let mut quad: Option<Pt> = None;
            let line = |segs: &mut Vec<Seg>, cur: &mut Pt, to: Pt| {
                segs.push([*cur, *cur, to, to]);
                *cur = to;
            };
            match c {
                b'M' => {
                    if i == 0 {
                        if !segs.is_empty() {
                            flush(&mut segs, false, &mut paths);
                        }
                        cur = off(cur, a[0], a[1]);
                        start = cur;
                    } else {
                        let to = off(cur, a[0], a[1]);
                        line(&mut segs, &mut cur, to);
                    }
                }
                b'L' => {
                    let to = off(cur, a[0], a[1]);
                    line(&mut segs, &mut cur, to);
                }
                b'H' => {
                    let to = [if rel { cur[0] + a[0] } else { a[0] }, cur[1]];
                    line(&mut segs, &mut cur, to);
                }
                b'V' => {
                    let to = [cur[0], if rel { cur[1] + a[0] } else { a[0] }];
                    line(&mut segs, &mut cur, to);
                }
                b'C' => {
                    let (c1, c2, to) = (
                        off(cur, a[0], a[1]),
                        off(cur, a[2], a[3]),
                        off(cur, a[4], a[5]),
                    );
                    segs.push([cur, c1, c2, to]);
                    ctrl = Some(c2);
                    cur = to;
                }
                b'S' => {
                    let c1 = last_ctrl.map_or(cur, |l| [2.0 * cur[0] - l[0], 2.0 * cur[1] - l[1]]);
                    let (c2, to) = (off(cur, a[0], a[1]), off(cur, a[2], a[3]));
                    segs.push([cur, c1, c2, to]);
                    ctrl = Some(c2);
                    cur = to;
                }
                b'Q' | b'T' => {
                    let q = if c == b'Q' {
                        off(cur, a[0], a[1])
                    } else {
                        last_quad.map_or(cur, |l| [2.0 * cur[0] - l[0], 2.0 * cur[1] - l[1]])
                    };
                    let to = if c == b'Q' {
                        off(cur, a[2], a[3])
                    } else {
                        off(cur, a[0], a[1])
                    };
                    segs.push([
                        cur,
                        [
                            cur[0] + (2.0 / 3.0) * (q[0] - cur[0]),
                            cur[1] + (2.0 / 3.0) * (q[1] - cur[1]),
                        ],
                        [
                            to[0] + (2.0 / 3.0) * (q[0] - to[0]),
                            to[1] + (2.0 / 3.0) * (q[1] - to[1]),
                        ],
                        to,
                    ]);
                    quad = Some(q);
                    cur = to;
                }
                _ => {
                    let to = off(cur, a[5], a[6]);
                    segs.extend(arc(cur, a[0], a[1], a[2], a[3], a[4], to));
                    cur = to;
                }
            }
            last_ctrl = ctrl;
            last_quad = quad;
            i += n;
        }
    }
    if !segs.is_empty() {
        flush(&mut segs, false, &mut paths);
    }
    Form {
        paths,
        nonzero: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shape::path::{IDENTITY, form_area};

    #[test]
    fn closed_square_folds_its_last_node() {
        let f = parse_path("M0 0H10V10H0Z", &IDENTITY);
        assert_eq!(f.paths.len(), 1);
        assert!(f.paths[0].closed);
        assert_eq!(f.paths[0].nodes.len(), 4);
        assert!((form_area(&f) - 100.0).abs() < 1e-9);
    }

    #[test]
    fn arcs_and_packed_flags() {
        // A circle of radius 5 from two arcs, the flags written without separators.
        let f = parse_path("M0 5a5 5 0 1010 0 5 5 0 10-10 0z", &IDENTITY);
        assert_eq!(f.paths.len(), 1);
        assert!(f.paths[0].nodes.iter().all(|n| n.smooth));
        assert!((form_area(&f) - std::f64::consts::PI * 25.0).abs() < 0.2);
    }

    #[test]
    fn stops_at_malformed_data_and_skips_points() {
        let f = parse_path("M0 0L10 0L10 10 x 20 20", &IDENTITY);
        assert_eq!(f.paths[0].nodes.len(), 3);
        assert!(parse_path("M5 5", &IDENTITY).paths.is_empty());
        let rel = parse_path("m1 1l2 0 0 2", &IDENTITY);
        assert_eq!(rel.paths[0].nodes[2].p, [3.0, 3.0]);
    }
}
