//! Motif stitch: a small figure repeated along a line, sewn as one running stitch (a motif or
//! pattern line). The figures follow the line's curve; their size is the width across the line,
//! their period the distance from one to the next along it, stretched a little so a whole number of
//! them fits the line.

use serde::{Deserialize, Serialize};

use super::run::run_stitch;
use crate::geom::Pt;
use crate::js::{hypot, round};
use crate::trig::JsMath;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineMotif {
    Waves,
    Scallops,
    Hearts,
    Chain,
    Stem,
    Feather,
    Cretan,
    Chevron,
}

impl LineMotif {
    fn is_hand(self) -> bool {
        matches!(
            self,
            LineMotif::Stem | LineMotif::Feather | LineMotif::Cretan | LineMotif::Chevron
        )
    }
}

/// The step of a cord lies in this range (mm): denser crowds the holes, more open shows the fabric.
const CORD_STEP_MIN: f64 = 0.25;
/// Steps of the fine path a motif is drawn as before it gets its needle points (mm).
const FINE: f64 = 0.1;
/// Shortest stitch of a motif (mm): the figures are small, the needle needs room.
const MIN_STITCH: f64 = 0.6;
const MOTIF_TOLERANCE: f64 = 0.05;
/// Longest stitch of a hand stitch (mm): longer arms are split, the same holes in every pass.
const HAND_STITCH_MAX: f64 = 4.5;
/// Longest stitch of a cord (mm): it covers like a satin column, so it splits where a satin would.
const CORD_STITCH_MAX: f64 = 7.0;
/// A line turns at least this much at one point (degrees) to count as a corner the figures start afresh at.
const CORNER: f64 = 50.0;
/// How far a straight stitch of a hand stitch may lie from the curve it follows (mm).
const HAND_BOW: f64 = 0.5;

/// The largest size a heart takes with figures `period` mm apart (no wider than 90 % of the period;
/// a heart is 32 parts wide for 22 from notch to tip).
fn hearts_max(period: f64) -> f64 {
    ((period * 0.9) / 32.0) * 22.0
}

/// A line by arc length: the point at `s` mm and the unit normal there (to the right on screen, y down).
struct Frame<'a> {
    line: &'a [Pt],
    closed: bool,
    cum: Vec<f64>,
    total: f64,
}

impl Frame<'_> {
    fn new(line: &[Pt], closed: bool) -> Frame<'_> {
        let mut cum = vec![0.0];
        for i in 1..line.len() {
            cum.push(cum[i - 1] + hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
        }
        let total = cum[cum.len() - 1];
        Frame {
            line,
            closed,
            cum,
            total,
        }
    }

    fn point(&self, s: f64) -> Pt {
        let total = self.total;
        let s = if self.closed && total > 0.0 {
            ((s % total) + total) % total
        } else {
            0f64.max(total.min(s))
        };
        let mut lo = 0;
        let mut hi = self.cum.len() - 1;
        while hi - lo > 1 {
            let mid = (lo + hi) >> 1;
            if self.cum[mid] <= s {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        let den = self.cum[hi] - self.cum[lo];
        let den = if den == 0.0 || den.is_nan() { 1.0 } else { den };
        let t = (s - self.cum[lo]) / den;
        let (a, b) = (self.line[lo], self.line[hi]);
        [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }

    /// The normal from the line a little before and after, so a node does not kink the figures.
    fn normal(&self, s: f64) -> Pt {
        let a = self.point(if self.closed {
            s - 0.5
        } else {
            0f64.max(s - 0.5)
        });
        let b = self.point(if self.closed {
            s + 0.5
        } else {
            self.total.min(s + 0.5)
        });
        let l = hypot(b[0] - a[0], b[1] - a[1]);
        let l = if l == 0.0 || l.is_nan() { 1.0 } else { l };
        [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]
    }

    /// The point `off` mm out along the normal at `s`.
    fn at(&self, s: f64, off: f64) -> Pt {
        let p = self.point(s);
        if off == 0.0 || off.is_nan() {
            return p;
        }
        let n = self.normal(s);
        [p[0] + n[0] * off, p[1] + n[1] * off]
    }
}

/// The needle points of `motif` along `line` (closed: first point repeated at the end): `width` mm
/// across, one figure every `period` mm, on the side `side` (1: the normal's, -1: the other).
/// `shift`: the figures start this share of a period later (0 to 1; an open line then begins and
/// ends with part of a figure).
#[allow(clippy::too_many_arguments)]
pub fn motif_stitches(
    line: &[Pt],
    closed: bool,
    motif: LineMotif,
    width: f64,
    period: f64,
    side: f64,
    shift: f64,
    stitch: f64,
    layers: f64,
    cord: bool,
) -> Vec<Pt> {
    let f = Frame::new(line, closed);
    if f.total < 0.5 {
        return Vec::new();
    }
    if motif.is_hand() {
        return hand_stitches(
            &f,
            line,
            closed,
            motif,
            width,
            period,
            side,
            shift,
            layers,
            cord && motif == LineMotif::Stem,
        );
    }
    let count = 1f64.max(round(f.total / 0.5f64.max(period)));
    let d = f.total / count;
    let o = (((shift % 1.0) + 1.0) % 1.0) * d;
    let mut fine: Vec<Pt> = Vec::new();
    let run = |fine: &mut Vec<Pt>, a: f64, b: f64| {
        let mut s = a;
        while s < b {
            fine.push(f.at(s, 0.0));
            s += FINE;
        }
        fine.push(f.at(b, 0.0));
    };
    // A figure that is an offset from the line, sampled finely along it.
    let along = |fine: &mut Vec<Pt>, off: &dyn Fn(f64) -> f64| {
        let n = (f.total / FINE).ceil() as usize;
        for i in 0..=n {
            let s = (f.total * i as f64) / n as f64;
            fine.push(f.at(s, off(s)));
        }
    };
    let pi = std::f64::consts::PI;
    let open_start = closed || o == 0.0 || o.is_nan();
    match motif {
        LineMotif::Waves => along(&mut fine, &|s| {
            (width / 2.0) * ((2.0 * pi * (s - o)) / d).js_sin()
        }),
        LineMotif::Scallops if o > 0.0 => along(&mut fine, &|s| {
            width * side * ((pi * (s - o)) / d).js_sin().abs()
        }),
        LineMotif::Scallops => {
            let h = width * side;
            for k in 0..count as usize {
                let steps = 8f64.max((d / FINE).ceil()) as usize;
                for i in (if k > 0 { 1 } else { 0 })..=steps {
                    let t = i as f64 / steps as f64;
                    fine.push(f.at(k as f64 * d + t * d, h * (pi * t).js_sin()));
                }
            }
        }
        LineMotif::Hearts => {
            // A heart on the line every period, hanging from it; a running stitch between them.
            let size = width.min(hearts_max(d));
            let mut s = 0.0;
            // Shifted on an open line: the hearts that still hang on it.
            let k0: i64 = if open_start { 0 } else { -1 };
            for k in k0..count as i64 {
                let at = o + k as f64 * d + d / 2.0;
                if !closed && (at < 0.0 || at > f.total) {
                    continue;
                }
                run(&mut fine, s, at);
                fine.extend(heart(&f, at, size, side));
                s = at;
            }
            run(&mut fine, s, f.total);
        }
        _ => {
            // Chain stitch look: a teardrop loop forward from each point, the next starting inside it.
            let link = d * 1.35;
            let k0: i64 = if open_start { 0 } else { -1 };
            for k in k0..count as i64 {
                let s0 = o + k as f64 * d;
                let steps = 12f64.max(((2.0 * link) / FINE).ceil()) as usize;
                for i in 0..=steps {
                    let t = (2.0 * pi * i as f64) / steps as f64;
                    let u = (1.0 - t.js_cos()) / 2.0;
                    let along_s = if closed {
                        s0 + u * link
                    } else {
                        (s0 + u * link).min(f.total)
                    };
                    fine.push(f.at(along_s, (t.js_sin() * width * (0.5 + 0.5 * u)) / 2.0));
                }
                run(&mut fine, s0, f.total.min(s0 + d));
            }
        }
    }
    let pts = run_stitch(&fine, MIN_STITCH.max(stitch), MOTIF_TOLERANCE);
    drop_short(pts)
}

/// Where `line` turns sharply: arc lengths of its corners. The line is flattened finely (0.1 mm), so
/// a smooth curve turns by a few degrees from point to point and only a corner node by much.
fn corners(line: &[Pt], closed: bool) -> Vec<f64> {
    let n = line.len() - usize::from(closed);
    let mut out: Vec<f64> = Vec::new();
    let mut s = 0.0;
    let cos = ((CORNER * std::f64::consts::PI) / 180.0).js_cos();
    for i in 0..n {
        if i > 0 {
            s += hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
        }
        if !closed && (i == 0 || i == n - 1) {
            continue;
        }
        let a = line[(i + n - 1) % n];
        let b = line[i];
        let c = line[(i + 1) % n];
        let (ux, uy, vx, vy) = (b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]);
        let (lu, lv) = (hypot(ux, uy), hypot(vx, vy));
        if lu < 1e-6 || lv < 1e-6 {
            continue;
        }
        if (ux * vx + uy * vy) / (lu * lv) < cos && out.last().is_none_or(|&l| s - l > 1.0) {
            out.push(s);
        }
    }
    out
}

/// Whether a straight stitch from the line `span` steps of `d` long, at any of the `m` steps from
/// `s0`, lies further than HAND_BOW from the line in its middle (the sagitta of a chord, L^2 / 8R).
fn bows(f: &Frame, s0: f64, d: f64, m: f64, span: f64, ring: bool) -> bool {
    let mut k = 0.0;
    while k + (if ring { 0.0 } else { span }) <= m - (if ring { 1.0 } else { 0.0 }) {
        let a = f.at(s0 + k * d, 0.0);
        let b = f.at(s0 + (k + span) * d, 0.0);
        let c = f.at(s0 + (k + span / 2.0) * d, 0.0);
        if hypot((a[0] + b[0]) / 2.0 - c[0], (a[1] + b[1]) / 2.0 - c[1]) > HAND_BOW {
            return true;
        }
        k += 1.0;
    }
    false
}

/// Hand stitches as a machine sews them: each stitch of the hand stitch a straight stitch sewn
/// `layers` times over the same two holes, so it lies thick like stranded floss (the bean or triple
/// run of machine embroidery). The figures after the hand stitches as stitch dictionaries draw them
/// (e.g. the TRC Leiden stitch pages); the idea of bundled straight stitches after stitch_generator
/// (MIT, collection/stitch_effects/decorative_stitches.py), written anew:
/// - stem: slanted stitches, each twice as long as the step, every one half over the last: a cord.
///   As a dense cord (`cord`): each once, at 45°, over as many steps as the cord is wide.
/// - feather: V's opening backwards, alternately left and right, the bottom of one the top of the next.
/// - cretan: a zigzag near the middle, from each of its points a straight stitch out to the side.
/// - chevron: a zigzag with a short bar along the line at each point, the diagonals meeting its middle.
///
/// The line is cut at its corners and each piece gets a whole number of figures, so none is cut off
/// at a corner or an end; a closed line without corners an even number, so left and right alternate
/// all round. In tight curves the figures get closer, so no straight stitch strays from the curve.
#[allow(clippy::too_many_arguments)]
fn hand_stitches(
    f: &Frame,
    line: &[Pt],
    closed: bool,
    motif: LineMotif,
    width: f64,
    period: f64,
    side: f64,
    shift: f64,
    layers: f64,
    cord: bool,
) -> Vec<Pt> {
    let n = 1f64.max(round(layers)) as usize;
    let w = width * side;
    let mut out: Vec<Pt> = Vec::new();
    let max = if cord {
        CORD_STITCH_MAX
    } else {
        HAND_STITCH_MAX
    };
    // A straight stitch to `p`, split into equal parts where it is long (the same holes both ways).
    let go = |out: &mut Vec<Pt>, p: Pt| {
        let Some(&q) = out.last() else {
            out.push(p);
            return;
        };
        let l = hypot(p[0] - q[0], p[1] - q[1]);
        if l < 1e-6 {
            return;
        }
        let k = (l / max - 1e-9).ceil() as usize;
        for i in 1..=k {
            out.push([
                q[0] + ((p[0] - q[0]) * i as f64) / k as f64,
                q[1] + ((p[1] - q[1]) * i as f64) / k as f64,
            ]);
        }
    };
    // From `a` (where the needle is) to `b` and back, `times` stitches in all: ends at b when odd.
    let bundle = |out: &mut Vec<Pt>, a: Pt, b: Pt, times: usize| {
        for i in 1..=times {
            go(out, if i % 2 == 1 { b } else { a });
        }
    };
    // Feather arms, Cretan spurs and chevron bars go out and back: an even number, one less than
    // asked (two at least), since the hub they leave from takes the stitches of both sides.
    let odd = if n % 2 == 1 { n } else { n + 1 };
    let even = 2.max(if n % 2 == 1 { n - 1 } else { n });
    let cs = corners(line, closed);
    let ring = closed && cs.is_empty();
    // Pieces between corners; a closed line with corners starts at its first one.
    let mut pieces: Vec<(f64, f64)> = Vec::new();
    if ring {
        pieces.push((0.0, f.total));
    } else {
        let cuts: Vec<f64> = if closed {
            let mut c = cs.clone();
            c.push(cs[0] + f.total);
            c
        } else {
            let mut c = vec![0.0];
            c.extend_from_slice(&cs);
            c.push(f.total);
            c
        };
        for i in 1..cuts.len() {
            if cuts[i] - cuts[i - 1] > 1e-6 {
                pieces.push((cuts[i - 1], cuts[i]));
            }
        }
    }
    let sg = |j: i64| if j % 2 != 0 { -1.0 } else { 1.0 };
    for (piece, &(s0, s1)) in pieces.iter().enumerate() {
        let len = s1 - s0;
        let mut m = 1f64.max(round(
            len / (if cord { CORD_STEP_MIN } else { 0.5 }).max(period),
        ));
        let step = if ring && motif != LineMotif::Stem {
            2.0
        } else {
            1.0
        };
        if step == 2.0 {
            m = 2f64.max(2.0 * round(m / 2.0));
        }
        let lead = |k: f64| {
            if ring {
                (((shift % 1.0) + 1.0) % 1.0) * (len / k)
            } else {
                0.0
            }
        };
        // How many steps a stem stitch spans: two by hand (each half over the last); as a cord as many
        // as make it as long along the line as the cord is wide, so it lies at 45°.
        let steps = if cord {
            2f64.max(round(width / (len / m)))
        } else {
            2.0
        };
        // Shorter stitches in tight curves, as by hand: more figures until no stitch bows from the line.
        while m + step <= len / 0.8
            && bows(
                f,
                s0 + lead(m),
                len / m,
                m,
                if motif == LineMotif::Stem && m > 1.0 {
                    steps
                } else {
                    1.0
                },
                ring,
            )
        {
            m += step;
        }
        let d = len / m;
        let o = lead(m);
        let at = |u: f64, v: f64| f.at(s0 + o + u, v);
        let mi = m as i64;
        match motif {
            LineMotif::Stem => {
                // Stitch k from (k d, -w/2) to ((k + steps) d, w/2): by hand each one half over the one before.
                let k1 = if ring { m } else { 1f64.max(m - steps + 1.0) };
                let span = if ring || m >= steps { steps * d } else { len };
                let mut from_start = true;
                let mut k = 0.0;
                while k < k1 {
                    let a = at(k * d, -w / 2.0);
                    let b = at(k * d + span, w / 2.0);
                    go(&mut out, if from_start { a } else { b });
                    bundle(
                        &mut out,
                        if from_start { a } else { b },
                        if from_start { b } else { a },
                        n,
                    );
                    if n % 2 == 1 {
                        from_start = !from_start;
                    }
                    k += 1.0;
                }
            }
            LineMotif::Feather => {
                // Bottoms B_j a sixth of the width out, alternately; each V's outer arm back to the side.
                let b_at = |j: i64| at(j as f64 * d, (sg(j) * w) / 6.0);
                go(&mut out, b_at(0));
                for j in 1..=mi {
                    bundle(&mut out, b_at(j - 1), b_at(j), odd);
                    bundle(
                        &mut out,
                        b_at(j),
                        at((j - 1) as f64 * d, (sg(j) * w) / 2.0),
                        even,
                    );
                }
            }
            LineMotif::Cretan => {
                // A zigzag between points a sixth of the width out, alternately; from each a straight
                // stitch out to the side (the thread held under the needle pulls the hand stitch so).
                let inner = |j: i64| at(j as f64 * d, (sg(j) * w) / 6.0);
                let spur = |out: &mut Vec<Pt>, j: i64| {
                    bundle(out, inner(j), at(j as f64 * d, (sg(j) * w) / 2.0), even)
                };
                go(&mut out, inner(0));
                if !ring {
                    spur(&mut out, 0);
                }
                for j in 1..=mi {
                    bundle(&mut out, inner(j - 1), inner(j), odd);
                    spur(&mut out, j);
                }
            }
            _ => {
                // Points a half step in from the ends, so the bars end on them; each bar d long.
                let off = if ring { 0.0 } else { d / 2.0 };
                let mid = |j: i64| at(off + j as f64 * d, (sg(j) * w) / 2.0);
                let end =
                    |j: i64, e: f64| at(off + j as f64 * d + (e * d) / 2.0, (sg(j) * w) / 2.0);
                let bar = |out: &mut Vec<Pt>, j: i64| {
                    let c = mid(j);
                    for _ in 0..even / 2 {
                        bundle(out, c, end(j, 1.0), 2);
                        bundle(out, c, end(j, -1.0), 2);
                    }
                };
                // From the piece before (cut at a corner): over the bars that end at the corner, not
                // straight from point to point, which cut across the inside of the corner far from the line.
                if !out.is_empty() {
                    go(&mut out, end(0, -1.0));
                }
                go(&mut out, mid(0));
                bar(&mut out, 0);
                for j in 1..mi + i64::from(ring) {
                    bundle(&mut out, mid(j - 1), mid(j), odd);
                    if j < mi {
                        bar(&mut out, j);
                    }
                }
                if piece + 1 < pieces.len() {
                    go(&mut out, end(mi - 1, 1.0));
                }
            }
        }
    }
    out
}

/// A heart hanging from the line at `s` by the notch between its lobes, its tip `size` mm out to the
/// side (upright below a line drawn left to right), drawn around once from the notch. Its lobes
/// reach a third of that over the line.
fn heart(f: &Frame, s: f64, size: f64, side: f64) -> Vec<Pt> {
    let o = f.point(s);
    let n = f.normal(s);
    let tdir = [n[1], -n[0]];
    // The classic heart curve: notch at t = 0 (y 5), tip at t = pi (y -17), lobes up to y 12, 32 wide.
    (0..=60)
        .map(|i| {
            let t = (2.0 * std::f64::consts::PI * f64::from(i)) / 60.0;
            let x = 16.0 * t.js_sin().js_pow(3.0);
            let y = 13.0 * t.js_cos()
                - 5.0 * (2.0 * t).js_cos()
                - 2.0 * (3.0 * t).js_cos()
                - (4.0 * t).js_cos();
            let a = (x / 22.0) * size;
            let b = ((5.0 - y) / 22.0) * size * side;
            [o[0] + tdir[0] * a + n[0] * b, o[1] + tdir[1] * a + n[1] * b]
        })
        .collect()
}

/// Needle points without stitches shorter than MIN_STITCH (the ends stay).
fn drop_short(pts: Vec<Pt>) -> Vec<Pt> {
    if pts.len() < 3 {
        return pts;
    }
    let mut out: Vec<Pt> = vec![pts[0]];
    for &p in &pts[1..pts.len() - 1] {
        let q = out[out.len() - 1];
        if hypot(p[0] - q[0], p[1] - q[1]) >= MIN_STITCH {
            out.push(p);
        }
    }
    let last = pts[pts.len() - 1];
    if out.len() > 1 {
        let q = out[out.len() - 1];
        if hypot(last[0] - q[0], last[1] - q[1]) < MIN_STITCH {
            out.pop();
        }
    }
    out.push(last);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_motif_sews_along_a_line() {
        let line = vec![[0.0, 0.0], [30.0, 0.0]];
        for m in [
            LineMotif::Waves,
            LineMotif::Scallops,
            LineMotif::Hearts,
            LineMotif::Chain,
            LineMotif::Stem,
            LineMotif::Feather,
            LineMotif::Cretan,
            LineMotif::Chevron,
        ] {
            let pts = motif_stitches(&line, false, m, 3.0, 4.0, 1.0, 0.0, 1.2, 3.0, false);
            assert!(pts.len() > 10, "{m:?}");
            assert!(pts.iter().all(|p| p[1].abs() <= 3.5), "{m:?}");
        }
    }
}
