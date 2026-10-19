//! Echo of a line: copies of it at the same distance, one beside the other, like echo quilting
//! along a line. The copies are the level lines of the distance to the line, so they stay smooth
//! where the line bends sharply (no loops at inner corners, round outer corners) and a ring inside
//! a closed line can part into several rings where the shape gets narrow.
//!
//! The settings of an echo (colors, links, which copies) stay in TypeScript (digitize/echo.ts);
//! this side gets the side, count and gap, and which copies to sew.

use serde::{Deserialize, Serialize};

use super::region::{Region, outline};
use crate::geom::Pt;
use crate::image::edt::distance_to_seeds;
use crate::js::{dist, round};
use crate::shape::path::inside_poly;

/// Which side the copies lie on. Closed lines: outside, inside or both. Open lines: `Out` is the
/// left of the line's drawing direction as seen on screen (y down), `In` the right.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EchoSide {
    Out,
    In,
    Both,
}

/// What echo_lines needs of an echo: its side, count and gap, the copies to sew (1 nearest), whether
/// the line itself is sewn too, and whether the order is turned round.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EchoSpec {
    pub side: EchoSide,
    pub count: f64,
    pub gap: f64,
    #[serde(default)]
    pub reverse: bool,
    pub rings: Vec<i64>,
    pub with_line: bool,
}

/// Pieces of copies shorter than this are left out (mm).
const MIN_PIECE: f64 = 1.5;
/// At most this many pixels for the distance field; larger lines get coarser pixels.
const MAX_PIXELS: f64 = 3e6;
/// Copies nearer the line than this (mm) lie on it.
const ON_LINE: f64 = 0.05;

fn length_of(l: &[Pt]) -> f64 {
    let mut s = 0.0;
    for i in 1..l.len() {
        s += dist(l[i - 1], l[i]);
    }
    s
}

/// Math.sign: 0 stays 0, NaN stays NaN.
fn sign(x: f64) -> f64 {
    if x > 0.0 {
        1.0
    } else if x < 0.0 {
        -1.0
    } else {
        x
    }
}

/// A line to sew: `back` when it runs against the drawn direction of the line it echoes (what lies
/// to one side of it stays there).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EchoLine {
    pub line: Vec<Pt>,
    pub closed: bool,
    pub back: bool,
    /// Which copy: 1 nearest, negative on the inner (right) side, 0 the line itself.
    pub k: i64,
}

/// The lines an echo of `line` is sewn along, in the order to sew them, each from the end nearest
/// where the one before ended: the line itself first when the copies lie on one side, or the
/// farthest copy on the inner (right) side first when they lie on both; `e.reverse` turns that
/// round. `closed`: the line is a loop (its first point repeated at the end); its copies are loops
/// too. `gap` is at least `min_gap`. `returns`: each line is sewn back to where it started (an even
/// number of passes), so the next starts near there.
pub fn echo_lines(
    line: &[Pt],
    closed: bool,
    e: &EchoSpec,
    min_gap: f64,
    returns: bool,
) -> Vec<EchoLine> {
    let base = EchoLine {
        line: line.to_vec(),
        closed,
        back: false,
        k: 0,
    };
    if line.len() < 2 {
        return vec![base];
    }
    let gap = e.gap.max(min_gap);
    let n = 1f64.max(round(e.count)) as i64;
    // The line with its copies in its own thread, or only the copies asked for.
    let has = |k: i64| e.rings.contains(&k);
    let mut levels: Vec<i64> = Vec::new();
    if e.side == EchoSide::Both {
        for k in (1..=n).rev() {
            if has(k) {
                levels.push(-k);
            }
        }
    }
    if e.with_line {
        levels.push(0);
    }
    for k in 1..=n {
        if has(k) {
            levels.push(if e.side == EchoSide::In { -k } else { k });
        }
    }
    if levels.is_empty() {
        return Vec::new();
    }
    if e.reverse {
        levels.reverse();
    }
    // The copies are found on pixels laid from the line's own corner, not from the origin: moved, the
    // line gets the same copies moved with it (the same stitches, also where a copy starts). The corner
    // a quarter pixel off the line, so points of the design grid fall between pixel borders, where
    // rounding does not flip with the last bit of a coordinate.
    let reach = n as f64 * gap + 1.0;
    let px = pixel_of(line, reach, gap);
    let (mut ox, mut oy) = (f64::INFINITY, f64::INFINITY);
    for q in line {
        ox = ox.min(q[0] - px / 4.0);
        oy = oy.min(q[1] - px / 4.0);
    }
    let local: Vec<Pt> = line.iter().map(|q| [q[0] - ox, q[1] - oy]).collect();
    let field = (gap >= ON_LINE).then(|| distance_field(&local, reach, px));
    let mut out = Vec::new();
    let turn = if closed { sign(area(line)) } else { 0.0 };
    let mut at: Option<Pt> = None;
    for &k in &levels {
        // No gap: each copy lies on the line.
        let pieces: Vec<EchoLine> = if k == 0 {
            vec![base.clone()]
        } else if let Some(f) = &field {
            copies_at(f, &local, closed, k as f64 * gap)
                .into_iter()
                .map(|(pl, pc)| {
                    let l: Vec<Pt> = pl.iter().map(|q| [q[0] + ox, q[1] + oy]).collect();
                    let back = pc && sign(area(&l)) != turn;
                    EchoLine {
                        line: l,
                        closed: pc,
                        back,
                        k,
                    }
                })
                .collect()
        } else {
            vec![EchoLine { k, ..base.clone() }]
        };
        for pc in order(pieces, at, returns) {
            at = Some(if returns && !pc.closed {
                pc.line[0]
            } else {
                pc.line[pc.line.len() - 1]
            });
            out.push(pc);
        }
    }
    out
}

/// Twice the signed area of a loop: its sign tells which way round it goes.
fn area(l: &[Pt]) -> f64 {
    let mut a = 0.0;
    for i in 1..l.len() {
        a += l[i - 1][0] * l[i][1] - l[i][0] * l[i - 1][1];
    }
    a
}

struct Field {
    r: Region,
}

/// The box around the points of `line`.
fn box_of(line: &[Pt]) -> (f64, f64, f64, f64) {
    let (mut min_x, mut min_y) = (f64::INFINITY, f64::INFINITY);
    let (mut max_x, mut max_y) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    for &[x, y] in line {
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
    }
    (min_x, min_y, max_x, max_y)
}

/// The pixel size (mm) of the distance field out to `reach` mm around the line: fine enough for
/// copies `gap` apart.
fn pixel_of(line: &[Pt], reach: f64, gap: f64) -> f64 {
    let (min_x, min_y, max_x, max_y) = box_of(line);
    let span = (max_x - min_x + 2.0 * reach) * (max_y - min_y + 2.0 * reach);
    // A few pixels from copy to copy at least, so near copies stay smooth.
    0.1f64
        .min(0.02f64.max(gap / 4.0))
        .max((span / MAX_PIXELS).sqrt())
}

/// Distance (mm) of each pixel `px` mm wide to the line, out to `reach` mm around it (see pixel_of).
fn distance_field(line: &[Pt], reach: f64, px: f64) -> Field {
    let (min_x, min_y, max_x, max_y) = box_of(line);
    let x0 = ((min_x - reach) / px).floor() - 2.0;
    let y0 = ((min_y - reach) / px).floor() - 2.0;
    let w = (((max_x + reach) / px).ceil() + 2.0 - x0) as usize;
    let h = (((max_y + reach) / px).ceil() + 2.0 - y0) as usize;
    let mut seed = vec![0u8; w * h];
    let mut mark = |q: Pt| {
        let x = round(q[0] / px - x0 - 0.5);
        let y = round(q[1] / px - y0 - 0.5);
        if x >= 0.0 && y >= 0.0 && x < w as f64 && y < h as f64 {
            seed[y as usize * w + x as usize] = 1;
        }
    };
    for i in 1..line.len() {
        let (a, b) = (line[i - 1], line[i]);
        let steps = 1f64.max(((dist(a, b) / px) * 3.0).ceil());
        let mut k = 0.0;
        while k <= steps {
            mark([
                a[0] + ((b[0] - a[0]) * k) / steps,
                a[1] + ((b[1] - a[1]) * k) / steps,
            ]);
            k += 1.0;
        }
    }
    let mut d = distance_to_seeds(&seed, w, h, false);
    for v in &mut d {
        *v = (f64::from(*v) * px) as f32;
    }
    let r = Region {
        label: 0,
        x0: x0 as i32,
        y0: y0 as i32,
        w,
        h,
        px_mm: px,
        mask: seed,
        inside: d.clone(),
        sdf_base: d,
        sdf_grown: None,
        area_mm2: 0.0,
    };
    Field { r }
}

struct Near {
    s: f64,
    end: bool,
    side: i32,
}

/// Nearest point of the line to q: arc length there, whether it is an end, and which side q lies on (+1 left).
fn nearest(line: &[Pt], cum: &[f64], q: Pt) -> Near {
    let mut best = f64::INFINITY;
    let mut out = Near {
        s: 0.0,
        end: false,
        side: 1,
    };
    for i in 1..line.len() {
        let (a, b) = (line[i - 1], line[i]);
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let l2 = dx * dx + dy * dy;
        let raw = if l2 > 0.0 {
            ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2
        } else {
            0.0
        };
        let t = 0f64.max(1f64.min(raw));
        let ex = q[0] - (a[0] + t * dx);
        let ey = q[1] - (a[1] + t * dy);
        let d2 = ex * ex + ey * ey;
        if d2 < best {
            best = d2;
            out.s = cum[i - 1] + t * l2.sqrt();
            out.end = (i == 1 && raw < 0.0) || (i == line.len() - 1 && raw > 1.0);
            // On screen (y down) the left of the direction (dx, dy) is (dy, -dx).
            let cross = dx * ey - dy * ex;
            out.side = if cross < 0.0 { 1 } else { -1 };
            // Nearest to a corner of the line (not an end): q lies in the wedge outside the corner,
            // as near to both its sides, so the way the line turns there tells the side (taken from
            // either side alone it would flip with the smallest shift of the line).
            let k = if raw <= 0.0 && i > 1 {
                i - 1
            } else if raw >= 1.0 && i < line.len() - 1 {
                i
            } else {
                0
            };
            if k > 0 {
                let turn = (line[k][0] - line[k - 1][0]) * (line[k + 1][1] - line[k][1])
                    - (line[k][1] - line[k - 1][1]) * (line[k + 1][0] - line[k][0]);
                // Turning left (on screen) the outside of the corner is on the right.
                if turn.abs() > 1e-9 {
                    out.side = if turn < 0.0 { -1 } else { 1 };
                }
            }
        }
    }
    out
}

/// The copies `level` mm beside the line (left or outside when positive): closed lines give
/// loops, open lines the pieces of the level line on that side, along the line's direction,
/// without the round ends around the line's ends.
fn copies_at(f: &Field, line: &[Pt], closed: bool, level: f64) -> Vec<(Vec<Pt>, bool)> {
    let d = level.abs();
    let loops = outline(&f.r, d, &f.r.sdf_base);
    if closed {
        let want = level > 0.0;
        return loops
            .into_iter()
            .filter(|l| length_of(l) >= MIN_PIECE)
            .filter(|l| {
                // A ring is outside or inside the line as a whole; its middle point tells.
                let q = l[l.len() / 2];
                !inside_poly(line, q) == want
            })
            .map(|l| (l, true))
            .collect();
    }
    let mut cum = vec![0.0];
    for i in 1..line.len() {
        cum.push(cum[i - 1] + dist(line[i - 1], line[i]));
    }
    let want = if level > 0.0 { 1 } else { -1 };
    let mut out: Vec<(Vec<Pt>, f64)> = Vec::new();
    for lp in &loops {
        let ring = &lp[..lp.len() - 1];
        let info: Vec<Near> = ring.iter().map(|&q| nearest(line, &cum, q)).collect();
        let keep: Vec<bool> = info.iter().map(|x| !x.end && x.side == want).collect();
        if !keep.iter().any(|&k| k) {
            continue;
        }
        // Start where a kept stretch begins, so no piece is cut in two by the start of the ring.
        let n = keep.len();
        let start = (0..n)
            .find(|&i| keep[i] && !keep[(i + n - 1) % n])
            .unwrap_or(0);
        let mut pts: Vec<Pt> = Vec::new();
        let mut ss: Vec<f64> = Vec::new();
        let mut flush = |pts: &mut Vec<Pt>, ss: &mut Vec<f64>| {
            if pts.len() >= 2 && length_of(pts) >= MIN_PIECE {
                // Along the line's direction.
                let forward = ss[ss.len() - 1] >= ss[0];
                let mut p = std::mem::take(pts);
                if !forward {
                    p.reverse();
                }
                out.push((p, ss[0].min(ss[ss.len() - 1])));
            }
            pts.clear();
            ss.clear();
        };
        for k in 0..n {
            let i = (start + k) % n;
            if keep[i] {
                pts.push(ring[i]);
                ss.push(info[i].s);
            } else {
                flush(&mut pts, &mut ss);
            }
        }
        flush(&mut pts, &mut ss);
    }
    out.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    out.into_iter().map(|(l, _)| (l, false)).collect()
}

/// The pieces of one copy, each from its end (or for loops, its point) nearest where the needle is;
/// the first stays as it is when nothing was sewn yet.
fn order(pieces: Vec<EchoLine>, from: Option<Pt>, returns: bool) -> Vec<EchoLine> {
    let Some(from) = from else { return pieces };
    let mut todo = pieces;
    let mut out = Vec::new();
    let mut at = from;
    while !todo.is_empty() {
        let (mut best, mut best_k, mut best_d) = (0, 0, f64::INFINITY);
        for (j, pc) in todo.iter().enumerate() {
            let last = pc.line.len() - 1;
            let mut check = |k: usize| {
                let dd = dist(pc.line[k], at);
                if dd < best_d {
                    best_d = dd;
                    best = j;
                    best_k = k;
                }
            };
            if pc.closed {
                (0..=last).for_each(&mut check);
            } else {
                check(0);
                check(last);
            }
        }
        let pc = todo.remove(best);
        let mut l = pc.line;
        let mut back = pc.back;
        if pc.closed {
            let open = &l[..l.len() - 1];
            let k = best_k % open.len();
            let mut m: Vec<Pt> = open[k..].to_vec();
            m.extend_from_slice(&open[..k]);
            m.push(open[k]);
            l = m;
        } else if best_k != 0 {
            l.reverse();
            back = !back;
        }
        at = if returns && !pc.closed {
            l[0]
        } else {
            l[l.len() - 1]
        };
        out.push(EchoLine {
            line: l,
            closed: pc.closed,
            back,
            k: pc.k,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_of_a_square_both_ways() {
        let sq = vec![
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 10.0],
            [0.0, 10.0],
            [0.0, 0.0],
        ];
        let e = EchoSpec {
            side: EchoSide::Both,
            count: 2.0,
            gap: 1.0,
            reverse: false,
            rings: vec![1, 2],
            with_line: true,
        };
        let lines = echo_lines(&sq, true, &e, 0.0, false);
        let ks: Vec<i64> = lines.iter().map(|l| l.k).collect();
        assert_eq!(ks, vec![-2, -1, 0, 1, 2]);
        // The outer copy 2 mm out: about 40 + 2π·2 long.
        let outer = &lines[4];
        assert!((length_of(&outer.line) - (40.0 + 4.0 * std::f64::consts::PI)).abs() < 1.0);
    }

    #[test]
    fn copies_of_an_open_line_lie_on_its_left() {
        let l = vec![[0.0, 0.0], [10.0, 0.0]];
        let e = EchoSpec {
            side: EchoSide::Out,
            count: 1.0,
            gap: 1.0,
            reverse: false,
            rings: vec![1],
            with_line: false,
        };
        let lines = echo_lines(&l, false, &e, 0.0, false);
        assert_eq!(lines.len(), 1);
        // Left on screen (y down) is negative y.
        assert!(lines[0].line.iter().all(|q| q[1] < 0.0));
        assert!(lines[0].line[0][0] < lines[0].line[lines[0].line.len() - 1][0]);
    }
}
