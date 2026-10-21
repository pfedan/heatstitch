//! "Vorschlagen" in the satin tool: a fill made into satin columns the way a digitizer would cut it
//! by hand. First the shape is classified, then the planner of its class sets the cut lines
//! (Trennlinien, where a column ends) and the lines across (Querlinien, the direction of the
//! stitches). The result is what the tool draws by hand, so it can be changed there afterwards.
//!
//! Classes so far:
//! - `strokes`: a drawing of lines, branching and closing into rings (an outline of a figure,
//!   lettering drawn with a pen). Planned like a hand digitizer does:
//!   - at a junction the line that goes on straightest runs through; the others end on its edge
//!     with a cut line along it,
//!   - short spurs (the toe marks of a paw) stay on their column, with a line across along them,
//!   - a line closed into a ring is opened once, square across where it runs straightest,
//!   - lines across where the column bends (every 30°) and a fan of three at sharp corners.
//!
//!   A thick place the lines run into (a nose on the mouth, a pupil on the ring of an eye) is cut
//!   off where the lines start and planned as a compact shape of its own (see satin_shapes).
//! - `dot`: a round area, one column across or (up to 12 mm) two halves (see satin_shapes).
//! - `pointed`: an area with corners (a triangle), lines across fanning from a corner (see satin_shapes).
//! - `leaf`, `drop`: a long round area pointed at both ends or one, sewn as a dot (see satin_shapes).
//! - `crescent`: a line pointed at both ends bending round (a moon), sewn as one column turning.
//! - `spikes`: points standing off a body (a star, the bars of an E), each cut off at its base.
//! - `frame`: a band turning corners (a frame, a block letter), cut on the miter (see satin_forms).
//! - `parts`: any other area cut along its medial axis into arms, hubs and bends (a star too wide
//!   for the spikes planner, a block U, a ring, a blob with holes; see satin_inner).
//! - `wide`: too wide or too blotchy for satin; nothing is suggested.
//!
//! Ported from src/digitize/satinSuggest.ts.

use std::collections::{HashMap, HashSet};
use std::f64::consts::PI;

use serde::{Deserialize, Serialize};

use super::medial::Axis;
use super::region::{Region, outline};
use super::rungs::{
    Cut, InsideTest, Strip, column_from_rungs, cut_lines_between, cut_pieces, rails_from_outline,
    strips_of_areas,
};
use super::satin_forms::{PartPlan, corner_cuts, plan_parts};
use super::satin_inner::plan_inner;
use super::satin_shapes::{
    BlobKind, Material, blob_shape, filled, plan_shape, small_holes, split_blobs, whole_shape,
};
use super::skeleton::{Branch, Graph, Node, skeleton};
use crate::geom::{Pt, add_scaled, dot, norm, polyline_length, sub};
use crate::js::{by, dist, hypot, median, round};
use crate::model::restitch::{Rails, SatinSettings, chained};
use crate::shape::path::inside_poly;
use crate::trig::JsMath;

/// Steps along a column checked for running across a hole (mm, see covers).
const COVER_STEP: f64 = 0.5;
/// A column whose middle runs this far through a hole (mm) covers it.
const COVER_MM: f64 = 2.0;
/// Widest column the strokes planner makes (mm), as the image conversion's satin limit.
pub const STROKE_MAX: f64 = 7.0;
/// Lines at least this wide (mm) are cut on the miter at sharp corners rather than turned there.
const MITER_MIN: f64 = 1.5;
/// An end branch reaching less than this many of its half widths beyond the line it hangs from stays on its column.
const SPUR: f64 = 4.0;
/// A line across every this much turn of the column (degrees).
const TURN_STEP: f64 = 30.0;
/// Bends sharper than this (degrees, within about a column width) get a fan of three lines.
const CORNER: f64 = 40.0;
/// Bends sharper than this (degrees) are cut along their bisector instead (a mitre).
const SHARP: f64 = 110.0;
/// A suggested cut line this near one drawn by hand is the same cut (mm).
const SAME_CUT_MM: f64 = 2.0;

type Line = [Pt; 2];
/// Outlines (outsides or holes) of an area.
type Loops = Vec<Vec<Pt>>;
/// Columns in sewing order, the outsides and holes of their area and its cut lines.
pub type Suggested = (Vec<Rails>, Loops, Loops, Vec<Line>);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShapeClass {
    Strokes,
    Dot,
    Pointed,
    Spikes,
    Frame,
    Leaf,
    Drop,
    Crescent,
    Parts,
    Wide,
}

impl From<BlobKind> for ShapeClass {
    fn from(k: BlobKind) -> ShapeClass {
        match k {
            BlobKind::Dot => ShapeClass::Dot,
            BlobKind::Pointed => ShapeClass::Pointed,
            BlobKind::Leaf => ShapeClass::Leaf,
            BlobKind::Drop => ShapeClass::Drop,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SatinSuggestion {
    pub kind: ShapeClass,
    pub cuts: Vec<Line>,
    pub lines: Vec<Line>,
    /// Whether the lines make columns of every part (else the tool shows which part fails).
    pub ok: bool,
}

/// Cut lines and lines across, and whether they make columns.
struct Planned {
    cuts: Vec<Line>,
    lines: Vec<Line>,
    ok: bool,
}

#[inline]
fn half_way(l: &Line) -> Pt {
    add_scaled(l[0], sub(l[1], l[0]), 0.5)
}
fn min_of(v: impl IntoIterator<Item = f64>) -> f64 {
    v.into_iter().fold(
        f64::INFINITY,
        |a, b| if b < a || b.is_nan() { b } else { a },
    )
}
fn max_of(v: impl IntoIterator<Item = f64>) -> f64 {
    v.into_iter().fold(
        f64::NEG_INFINITY,
        |a, b| if b > a || b.is_nan() { b } else { a },
    )
}
/// Whether segments ab and cd cross away from their ends (two cut lines from one corner meet there).
fn cross(a: Pt, b: Pt, c: Pt, d: Pt) -> bool {
    let r = sub(b, a);
    let q = sub(d, c);
    let den = r[0] * q[1] - r[1] * q[0];
    if den.abs() < 1e-12 {
        return false;
    }
    let w = sub(c, a);
    let t = (w[0] * q[1] - w[1] * q[0]) / den;
    let u = (w[0] * r[1] - w[1] * r[0]) / den;
    let mt = 0.6 / hypot(r[0], r[1]);
    let mu = 0.6 / hypot(q[0], q[1]);
    t > mt && t < 1.0 - mt && u > mu && u < 1.0 - mu
}
fn side(p: Pt, q: Pt, r: Pt) -> f64 {
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
}
/// Whether segments ab and cd cross at all (not only touch at an end).
fn meets(a: Pt, b: Pt, c: Pt, d: Pt) -> bool {
    side(a, b, c) * side(a, b, d) < 0.0 && side(c, d, a) * side(c, d, b) < 0.0
}
/// Distance from q to the segment from a to b.
fn to_segment(q: Pt, a: Pt, b: Pt) -> f64 {
    let v = sub(b, a);
    let l2 = dot(v, v);
    let t = if l2 != 0.0 {
        (dot(sub(q, a), v) / l2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    dist(q, add_scaled(a, v, t))
}
fn area2(ring: &[Pt]) -> f64 {
    let n = ring.len();
    let mut a = 0.0;
    for i in 0..n {
        let p = ring[i];
        let q = ring[(i + 1) % n];
        a += p[0] * q[1] - q[0] * p[1];
    }
    a
}
fn radii(g: &Graph) -> Vec<f64> {
    g.branches
        .iter()
        .flat_map(|b| b.r.iter().copied())
        .collect()
}
/// A JavaScript `cum.findIndex(c => c >= s)`, -1 as None.
fn first_at(cum: &[f64], s: f64) -> Option<usize> {
    cum.iter().position(|&c| c >= s)
}
fn as_cuts(cuts: &[Line]) -> Vec<Cut> {
    cuts.iter().map(|c| c.to_vec()).collect()
}

/// The outsides and holes of an area (tiny specks left out), as the satin tool reads them.
pub fn area_loops(area: &Region) -> (Vec<Vec<Pt>>, Vec<Vec<Pt>>) {
    let loops: Vec<Vec<Pt>> = outline(area, 0.0, &area.sdf_base)
        .into_iter()
        .filter(|l| l.len() > 2 && area2(l).abs() > 0.5)
        .collect();
    // Inside an even number of others: an outside; an odd number: a hole.
    let depth = |k: usize| {
        (0..loops.len())
            .filter(|&o| o != k && inside_poly(&loops[o], loops[k][0]))
            .count()
    };
    let (mut outsides, mut holes) = (vec![], vec![]);
    for k in 0..loops.len() {
        if depth(k) % 2 == 0 {
            outsides.push(loops[k].clone());
        } else {
            holes.push(loops[k].clone());
        }
    }
    (outsides, holes)
}

/// The class of a shape by its skeleton: lines of about even width, or anything else.
pub fn classify(g: &Graph, max: f64) -> ShapeClass {
    if g.branches.is_empty() {
        return ShapeClass::Wide;
    }
    let rs = radii(g);
    let len: f64 = g
        .branches
        .iter()
        .fold(0.0, |a, b| a + polyline_length(&b.pts));
    let w = 2.0 * median(&rs);
    // A stroke: narrow enough for satin, much longer than wide.
    let wide = rs.iter().filter(|&&r| 2.0 * r > max).count() as f64 > rs.len() as f64 * 0.05;
    if !wide && len > 3.0 * w {
        ShapeClass::Strokes
    } else {
        ShapeClass::Wide
    }
}

/// A suggestion for the fill area (None when the area is empty); `max` is the longest stitch of a
/// shape's columns (mm); `columns`: a compact shape as a column where one fits, not a fan;
/// `crossings`: a thick place where three lines meet planned as a shape too, not only a blot.
pub fn suggest_satin(
    area: &Region,
    graph: Option<&Graph>,
    max: f64,
    columns: bool,
    crossings: bool,
) -> Result<Option<SatinSuggestion>, String> {
    let (outsides, holes) = area_loops(area);
    if outsides.is_empty() {
        return Ok(None);
    }
    let own;
    let g = match graph {
        Some(g) => g,
        None => {
            own = skeleton(area);
            &own
        }
    };
    suggest_on(area, g, &outsides, &holes, max, columns, crossings).map(Some)
}

fn suggest_on(
    area: &Region,
    g: &Graph,
    outsides: &[Vec<Pt>],
    holes: &[Vec<Pt>],
    max: f64,
    columns: bool,
    crossings: bool,
) -> Result<SatinSuggestion, String> {
    let kind = classify(g, max);
    let material = Material::new(outsides, holes);
    let mat = |q: Pt| material.test(q);
    let finish = |kind: ShapeClass, cuts: Vec<Line>, lines: Vec<Line>| {
        let p = columns_of(g, cuts, lines, outsides, holes);
        SatinSuggestion {
            kind,
            cuts: p.cuts,
            lines: p.lines,
            ok: p.ok,
        }
    };
    // Corners to cut at (spikes, miters): on an area, or on lines wide enough that a turn would pile up.
    if (kind != ShapeClass::Strokes || 2.0 * median(&radii(g)) >= MITER_MIN)
        && let Some(made) = at_corners(g, outsides, holes, &material, max)
    {
        return Ok(made);
    }
    if kind != ShapeClass::Strokes {
        // No lines: the area as a whole may be a dot or a pointed shape.
        let plan = if outsides.len() == 1 {
            plan_shape(
                &whole_shape(outsides, holes, &material),
                &mat,
                max,
                true,
                columns,
            )
        } else {
            None
        };
        let made = plan.map(|p| finish(p.kind.into(), p.cuts, p.lines));
        if let Some(m) = &made
            && m.ok
        {
            return Ok(made.unwrap());
        }
        return Ok(along_axis(outsides, holes, max)?
            .or(made)
            .unwrap_or(SatinSuggestion {
                kind: ShapeClass::Wide,
                cuts: vec![],
                lines: vec![],
                ok: false,
            }));
    }
    // Thick places in the lines planned on their own, the lines without them.
    let small: Vec<Vec<Pt>> = small_holes(g, holes)
        .into_iter()
        .map(|k| holes[k].clone())
        .collect();
    let blots = if small.is_empty() {
        split_blobs(g)
    } else {
        split_blobs(&skeleton(&filled(area, &small)))
    };
    // Unless asked for, a thick place where three lines or more meet is a crossing, its lines sewn
    // through it (see plan_strokes); a blot sits at the end of a line or between two.
    let split = blots.filter(|b| crossings || b.blobs.iter().all(|b| b.attach.len() < 3));
    if let Some(split) = &split {
        let plans: Vec<_> = split
            .blobs
            .iter()
            .map(|b| {
                plan_shape(
                    &blob_shape(b, &split.strokes, outsides, holes, &material),
                    &mat,
                    max,
                    true,
                    columns,
                )
            })
            .collect();
        if plans.iter().all(|p| p.is_some()) {
            let plans: Vec<_> = plans.into_iter().flatten().collect();
            let rings: Vec<Vec<Pt>> = outsides.iter().chain(holes).cloned().collect();
            let (s_cuts, s_lines) = if split.strokes.branches.is_empty() {
                (vec![], vec![])
            } else {
                plan_strokes(&split.strokes, &rings, false)
            };
            let only = if split.strokes.branches.is_empty() && plans.len() == 1 {
                plans[0].kind.into()
            } else {
                kind
            };
            let mut cuts = split.cuts.clone();
            cuts.extend(plans.iter().flat_map(|p| p.cuts.iter().copied()));
            cuts.extend(s_cuts);
            let mut lines: Vec<Line> = plans.iter().flat_map(|p| p.lines.iter().copied()).collect();
            lines.extend(s_lines);
            let made = finish(only, cuts, lines);
            if made.ok {
                return Ok(made);
            }
        }
    }
    // Cut lines that cross are kept first (each forks off a line of its own); if that makes no
    // columns, the later of two is left out (a crossing seen as two forks, a sliver between them).
    let first = plan(g, outsides, holes, false);
    let chosen = if first.ok {
        first
    } else {
        let second = plan(g, outsides, holes, true);
        if second.ok { second } else { first }
    };
    let made = SatinSuggestion {
        kind: if crescent(g) {
            ShapeClass::Crescent
        } else {
            kind
        },
        cuts: chosen.cuts,
        lines: chosen.lines,
        ok: chosen.ok,
    };
    if outsides.len() != 1 || !compact(g, &outsides[0]) {
        return Ok(made);
    }
    // Lines round a hole in a compact shape: a shape after all (a dot with a highlight off its middle).
    let whole = plan_shape(
        &whole_shape(outsides, holes, &material),
        &mat,
        max,
        true,
        columns,
    );
    let other = whole.map(|w| finish(w.kind.into(), w.cuts, w.lines));
    let other_ok = other.as_ref().is_some_and(|o| o.ok);
    if other_ok || made.ok {
        return Ok(if other_ok { other.unwrap() } else { made });
    }
    Ok(along_axis(outsides, holes, max)?.unwrap_or(made))
}

/// The axis of the medial axis planner as a graph (for opening a hole still closed).
fn axis_graph(axis: &Axis) -> Graph {
    Graph {
        nodes: axis.nodes.iter().map(|n| Node { p: n.p, r: n.r }).collect(),
        branches: axis
            .branches
            .iter()
            .map(|b| Branch {
                a: b.a,
                b: b.b,
                pts: b.pts.clone(),
                r: b.r.clone(),
            })
            .collect(),
    }
}

/// The area cut along its medial axis (see satin_inner), when that makes columns of every part.
fn along_axis(
    outsides: &[Vec<Pt>],
    holes: &[Vec<Pt>],
    max: f64,
) -> Result<Option<SatinSuggestion>, String> {
    let Some(plan) = plan_inner(outsides, holes, max)? else {
        return Ok(None);
    };
    let p = columns_of(
        &axis_graph(&plan.axis),
        plan.cuts,
        plan.lines,
        outsides,
        holes,
    );
    Ok(p.ok.then_some(SatinSuggestion {
        kind: ShapeClass::Parts,
        cuts: p.cuts,
        lines: p.lines,
        ok: true,
    }))
}

/// The area cut at its corners (see satin_forms), or None when it has none to cut at or makes no columns so.
fn at_corners(
    g: &Graph,
    outsides: &[Vec<Pt>],
    holes: &[Vec<Pt>],
    material: &Material,
    max: f64,
) -> Option<SatinSuggestion> {
    let c = corner_cuts(outsides, holes, material, max);
    if c.cuts.is_empty() {
        return None;
    }
    let plans = plan_parts(outsides, holes, &c.cuts, &c.tips, g, max)?;
    let mut lines: Vec<Line> = vec![];
    let mut cuts = c.cuts.clone();
    for p in plans {
        let (more, l) = match p {
            PartPlan::Lines { cuts, lines } => (cuts, lines),
            PartPlan::Strokes { graph, ring } => plan_strokes(&graph, &[ring], false),
        };
        lines.extend(l);
        cuts.extend(more);
    }
    let kind = if c.spikes >= c.miters {
        ShapeClass::Spikes
    } else {
        ShapeClass::Frame
    };
    let p = columns_of(g, cuts, lines, outsides, holes);
    p.ok.then_some(SatinSuggestion {
        kind,
        cuts: p.cuts,
        lines: p.lines,
        ok: true,
    })
}

/// One line pointed at both ends, bending round by more than a quarter turn: a crescent (a moon).
fn crescent(g: &Graph) -> bool {
    if g.branches.len() != 1 || g.branches[0].a == g.branches[0].b {
        return false;
    }
    let Branch { pts, r, .. } = &g.branches[0];
    if pts.len() < 20 {
        return false;
    }
    let n = pts.len();
    let half = median(r);
    let k = 3f64.max(round(n as f64 / 8.0)) as usize;
    let t0 = norm(sub(pts[k], pts[0]));
    let t1 = norm(sub(pts[n - 1], pts[n - 1 - k]));
    let pointed = |rs: &[f64]| min_of(rs.iter().copied()) < 0.5 * half;
    pointed(&r[..k.min(r.len())])
        && pointed(&r[r.len().saturating_sub(k)..])
        && dot(t0, t1) < ((100.0 * PI) / 180.0).js_cos()
}

/// Thick against its size (a dot with a hole), not a drawing of thin lines.
fn compact(g: &Graph, outside: &[Pt]) -> bool {
    let xs = || outside.iter().map(|p| p[0]);
    let ys = || outside.iter().map(|p| p[1]);
    let size = (max_of(xs()) - min_of(xs())).max(max_of(ys()) - min_of(ys()));
    median(&radii(g)) >= 0.15 * size
}

/// Lines across the strokes of the centerline; `apart`: of two cut lines that cross, the later left out.
fn plan(g: &Graph, outsides: &[Vec<Pt>], holes: &[Vec<Pt>], apart: bool) -> Planned {
    let rings: Vec<Vec<Pt>> = outsides.iter().chain(holes).cloned().collect();
    let (cuts, mut lines) = plan_strokes(g, &rings, apart);
    // A dot apart from the rest (its centerline hardly a line): one line across its narrow way.
    for o in outsides {
        if lines.iter().any(|l| inside_poly(o, half_way(l))) {
            continue;
        }
        if let Some(line) = across(o) {
            lines.push(line);
        }
    }
    columns_of(g, cuts, lines, outsides, holes)
}

/// The cut lines in the order that opens the holes, a hole still closed opened, lines that mislead
/// left out, and whether all make columns.
fn columns_of(
    g: &Graph,
    cuts: Vec<Line>,
    mut lines: Vec<Line>,
    outsides: &[Vec<Pt>],
    holes: &[Vec<Pt>],
) -> Planned {
    let strips =
        |lines: &[Line], cuts: &[Line]| strips_of_areas(outsides, lines, &as_cuts(cuts), holes);
    let mut ordered = bridge_order(&cuts, outsides, holes);
    let mut made = strips(&lines, &ordered);
    // A hole still closed (a ring of one line with a ring inside, say): opened where it comes closest.
    let mut tries = 0;
    while made.hole >= 0 && {
        let t = tries;
        tries += 1;
        t < holes.len()
    } {
        let Some(cut) = open_hole(g, &holes[made.hole as usize]) else {
            break;
        };
        ordered.push(cut);
        made = strips(&lines, &bridge_order(&ordered, outsides, holes));
    }
    // A part that makes no column: a line across it that misleads (one through the tip of a hole,
    // say) is left out, as long as that helps.
    let cuts_now = bridge_order(&ordered, outsides, holes);
    let mut guard = 0;
    while let Some(bad) = made.bad.clone() {
        if guard >= 8 {
            break;
        }
        guard += 1;
        let same = |b: &Option<Vec<Pt>>| {
            b.as_ref()
                .is_some_and(|b| b.len() == bad.len() && dist(b[0], bad[0]) < 1e-6)
        };
        let mine = |l: &Line| inside_poly(&bad, half_way(l));
        let k = (0..lines.len()).find(|&k| {
            mine(&lines[k]) && {
                let rest: Vec<Line> = lines
                    .iter()
                    .enumerate()
                    .filter(|&(j, _)| j != k)
                    .map(|(_, l)| *l)
                    .collect();
                !same(&strips(&rest, &cuts_now).bad)
            }
        });
        if let Some(k) = k {
            lines.remove(k);
        } else {
            // Several that do not go together: the part's lines taken one by one, each kept that fits.
            let rest: Vec<Line> = lines.iter().filter(|l| !mine(l)).copied().collect();
            let mut kept: Vec<Line> = vec![];
            for l in lines.iter().filter(|l| mine(l)) {
                let mut with = rest.clone();
                with.extend(kept.iter().copied());
                with.push(*l);
                if !same(&strips(&with, &cuts_now).bad) {
                    kept.push(*l);
                }
            }
            if kept.is_empty() {
                break;
            }
            lines = rest;
            lines.extend(kept);
        }
        made = strips(&lines, &cuts_now);
    }
    // A ring opened by one cut line that goes on beyond (into a line it meets, say) can make a part
    // whose column runs across the hole, its rails the outside of the ring either side: it would
    // cover the hole, no columns.
    let flat: Vec<Strip> = made.areas.concat();
    let ok = made.hole < 0 && made.bad.is_none() && !covers(&flat, holes);
    Planned {
        cuts: cuts_now,
        lines,
        ok,
    }
}

/// Whether a column runs across a hole (its middle through the hole for COVER_MM, not round it).
pub fn covers(strips: &[Strip], holes: &[Vec<Pt>]) -> bool {
    let tests: Vec<InsideTest> = holes.iter().map(|h| InsideTest::new(h)).collect();
    strips.iter().any(|s| {
        let c = column_from_rungs(&s.left, &s.right, &s.rungs, COVER_STEP);
        let n = c
            .center
            .iter()
            .filter(|&&m| tests.iter().any(|t| t.test(m)))
            .count();
        n as f64 * COVER_STEP >= COVER_MM
    })
}

/// A line across a small outline through its middle, its narrow way (along its least spread).
fn across(ring: &[Pt]) -> Option<Line> {
    if ring.len() < 3 {
        return None;
    }
    let n = ring.len() as f64;
    let mut c: Pt = [0.0, 0.0];
    for p in ring {
        c = [c[0] + p[0] / n, c[1] + p[1] / n];
    }
    let (mut xx, mut xy, mut yy) = (0.0, 0.0, 0.0);
    for &p in ring {
        let [dx, dy] = sub(p, c);
        xx += dx * dx;
        xy += dx * dy;
        yy += dy * dy;
    }
    // The direction of least spread (the eigenvector of the smaller eigenvalue).
    let a = 0.5 * (2.0 * xy).atan2(xx - yy) + PI / 2.0;
    let d: Pt = [a.js_cos(), a.js_sin()];
    let reach = max_of(ring.iter().map(|&p| dist(p, c))) + 0.5;
    Some([add_scaled(c, d, -reach), add_scaled(c, d, reach)])
}

/// A branch end at a junction: the branch and whether it leaves from its end b.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct End {
    br: usize,
    at_b: bool,
}

/// Points of a branch walked away from the end given.
fn away(b: &Branch, at_b: bool) -> Vec<Pt> {
    if at_b {
        b.pts.iter().rev().copied().collect()
    } else {
        b.pts.clone()
    }
}
fn radii_away(b: &Branch, at_b: bool) -> Vec<f64> {
    if at_b {
        b.r.iter().rev().copied().collect()
    } else {
        b.r.clone()
    }
}

/// The point `s` mm along the line.
fn point_along(pts: &[Pt], s: f64) -> Pt {
    let mut acc = 0.0;
    for i in 1..pts.len() {
        let l = dist(pts[i - 1], pts[i]);
        if acc + l >= s {
            let k = if l != 0.0 { (s - acc) / l } else { 0.0 };
            return add_scaled(pts[i - 1], sub(pts[i], pts[i - 1]), k);
        }
        acc += l;
    }
    pts[pts.len() - 1]
}

/// Nearest point of a line to q: the distance (and the direction of the line there).
fn nearest(pts: &[Pt], q: Pt) -> f64 {
    let mut best = f64::INFINITY;
    for i in 1..pts.len() {
        let a = pts[i - 1];
        let v = sub(pts[i], a);
        let l2 = dot(v, v);
        let t = if l2 != 0.0 {
            1f64.min(0f64.max(dot(sub(q, a), v) / l2))
        } else {
            0.0
        };
        let d = dist(add_scaled(a, v, t), q);
        if d < best {
            best = d;
        }
    }
    best
}

/// A point of one of the rings (the outline corners cut lines run between): it stands for itself,
/// as the TypeScript compares these points by identity.
#[derive(Clone, Copy, Debug)]
struct RingPt {
    p: Pt,
    ring: usize,
    at: usize,
}

impl RingPt {
    fn same(&self, o: &RingPt) -> bool {
        self.ring == o.ring && self.at == o.at
    }
}

/// A map that keeps its keys in the order they were first set, as a JavaScript Map.
struct Ordered<K, V> {
    items: Vec<(K, V)>,
}

impl<K: PartialEq + Copy, V> Ordered<K, V> {
    fn new() -> Self {
        Ordered { items: vec![] }
    }
    fn get(&self, k: K) -> Option<&V> {
        self.items.iter().find(|(x, _)| *x == k).map(|(_, v)| v)
    }
    fn set(&mut self, k: K, v: V) {
        match self.items.iter_mut().find(|(x, _)| *x == k) {
            Some(e) => e.1 = v,
            None => self.items.push((k, v)),
        }
    }
}

struct Stroke {
    pts: Vec<Pt>,
    r: Vec<f64>,
    closed: bool,
    from: f64,
    to: f64,
}

/// Cut lines and lines across for a drawing of lines (see the class `strokes`). Junctions closer
/// together than their widths are one (two whiskers crossing a cheek a little apart).
pub fn plan_strokes(g: &Graph, rings: &[Vec<Pt>], apart: bool) -> (Vec<Line>, Vec<Line>) {
    let bs = &g.branches;
    let nodes = &g.nodes;
    // Junctions joined by a branch shorter than their widths are one junction.
    let mut root: Vec<usize> = (0..nodes.len()).collect();
    fn find(root: &mut [usize], i: usize) -> usize {
        if root[i] == i {
            return i;
        }
        let r = find(root, root[i]);
        root[i] = r;
        r
    }
    let mut inner: HashSet<usize> = HashSet::new();
    for (k, b) in bs.iter().enumerate() {
        if b.a != b.b && polyline_length(&b.pts) < 0.75 * (nodes[b.a].r + nodes[b.b].r) {
            let i = find(&mut root, b.a);
            let j = find(&mut root, b.b);
            root[i] = j;
            inner.insert(k);
        }
    }
    let len_of: Vec<f64> = bs.iter().map(|b| polyline_length(&b.pts)).collect();
    let half_of: Vec<f64> = bs.iter().map(|b| median(&b.r)).collect();
    // Direction a branch leaves its junction in, over a stretch about as long as the junction is wide.
    let leaving = |e: End| -> Pt {
        let pts = away(&bs[e.br], e.at_b);
        let s = (len_of[e.br] * 0.5).min(1.5f64.max(2.5 * half_of[e.br]));
        norm(sub(point_along(&pts, s), pts[0]))
    };
    let ends_of = |root: &mut Vec<usize>, inner: &HashSet<usize>| {
        let mut m: Ordered<usize, Vec<End>> = Ordered::new();
        for (k, b) in bs.iter().enumerate() {
            if inner.contains(&k) {
                continue;
            }
            for at_b in [false, true] {
                let n = find(root, if at_b { b.b } else { b.a });
                let mut v = m.get(n).cloned().unwrap_or_default();
                v.push(End { br: k, at_b });
                m.set(n, v);
            }
        }
        m
    };
    let mut ends = ends_of(&mut root, &inner);
    // Two forks of three a little further apart that make a crossing (each line going on straight
    // through the other fork) are one junction too: one line runs through, the other is cut.
    let straight = |a: End, b: End| dot(leaving(a), leaving(b)) < -0.8;
    for (k, b) in bs.iter().enumerate() {
        let u = find(&mut root, b.a);
        let v = find(&mut root, b.b);
        if inner.contains(&k) || u == v || len_of[k] > 2.0 * (nodes[b.a].r + nodes[b.b].r) {
            continue;
        }
        let uu: Vec<End> = ends.get(u).map_or(vec![], |es| {
            es.iter().filter(|e| e.br != k).copied().collect()
        });
        let vv: Vec<End> = ends.get(v).map_or(vec![], |es| {
            es.iter().filter(|e| e.br != k).copied().collect()
        });
        // (Not when another branch joins the two as well: that is a ring, not a crossing.)
        if uu.len() != 2 || vv.len() != 2 || uu.iter().any(|e| vv.iter().any(|f| f.br == e.br)) {
            continue;
        }
        // (Each line going on along the link between the forks, not turning back into it.)
        let along = |e: End, at_a: bool| dot(leaving(e), leaving(End { br: k, at_b: !at_a })) < 0.2;
        let through = |x: End, y: End| straight(x, y) && along(x, true) && along(y, false);
        if (through(uu[0], vv[0]) && through(uu[1], vv[1]))
            || (through(uu[0], vv[1]) && through(uu[1], vv[0]))
        {
            root[u] = v;
            inner.insert(k);
            ends = ends_of(&mut root, &inner);
        }
    }
    let mut root_of = |n: usize| find(&mut root, n);
    let roots: Vec<usize> = (0..nodes.len()).map(&mut root_of).collect();
    let degree = |n: usize| ends.get(roots[n]).map_or(0, |es| es.len());
    let is_loop = |e: End| roots[bs[e.br].a] == roots[bs[e.br].b];
    // A cut line just past a hole it does not end on pinches off the line round the hole.
    let pinch = |p: (Pt, Option<usize>), q: (Pt, Option<usize>)| {
        rings.iter().enumerate().any(|(ri, r)| {
            p.1 != Some(ri) && q.1 != Some(ri) && r.iter().any(|&h| to_segment(h, p.0, q.0) < 0.4)
        })
    };
    let mut partner: HashMap<End, End> = HashMap::new();
    let mut cuts: Vec<Line> = vec![];
    let mut lines: Vec<Line> = vec![];
    let mut spurs: HashSet<usize> = HashSet::new();
    // Where a stroke is cut short of its junction end: the distance along it from that end.
    let mut trimmed: HashMap<End, f64> = HashMap::new();
    // Places along strokes that already have a line across (spur bases).
    let mut taken: Vec<Pt> = vec![];
    let angle = |d: Pt| d[1].atan2(d[0]);

    for (n, es) in &ends.items {
        let n = *n;
        if es.len() < 2 {
            continue;
        }
        // The two ends that go on straightest run through.
        let mut best: Option<(usize, usize)> = None;
        let mut best_cos = f64::INFINITY;
        let dirs: Vec<Pt> = es.iter().map(|&e| leaving(e)).collect();
        for i in 0..es.len() {
            for j in i + 1..es.len() {
                // A loop's ends never run through (round the loop the line would come back against
                // its own side): both are cut where they leave, the loop a piece of its own.
                if es.len() > 2 && (is_loop(es[i]) || is_loop(es[j])) {
                    continue;
                }
                // (Of two lines crossing, both going on about straight, the wider runs through.)
                let d = dot(dirs[i], dirs[j]);
                let c = if es.len() > 3 && d < -0.8 {
                    -2.0 - half_of[es[i].br].min(half_of[es[j].br])
                } else {
                    d
                };
                if c < best_cos {
                    best_cos = c;
                    best = Some((i, j));
                }
            }
        }
        // A loop and a single line: the loop closes on itself into a ring, the line cut off at it.
        if best.is_none()
            && let Some(a) = es.iter().position(|&e| is_loop(e))
            && let Some(b) = (0..es.len()).find(|&k| k != a && es[k].br == es[a].br)
        {
            best = Some((a, b));
        }
        if let Some((i, j)) = best {
            partner.insert(
                End {
                    br: es[i].br,
                    at_b: es[i].at_b,
                },
                es[j],
            );
            partner.insert(es[j], es[i]);
        }
        if es.len() == 2 {
            continue;
        }
        let is_through = |k: usize| best.is_some_and(|(i, j)| k == i || k == j);
        let through: Vec<End> = match best {
            Some((i, j)) => vec![es[i], es[j]],
            None => es.clone(),
        };
        // (Its half width along it: near a junction the skeleton's radius swells.)
        let r_through = median(
            &through
                .iter()
                .flat_map(|e| radii_away(&bs[e.br], e.at_b).into_iter().take(20))
                .collect::<Vec<f64>>(),
        )
        .min(max_of(through.iter().map(|e| half_of[e.br])));
        // Short spurs stay on the column: a line across along each, from its tip.
        let mut kept: Vec<usize> = vec![];
        for (k, e) in es.iter().enumerate() {
            let b = &bs[e.br];
            let far = if e.at_b { b.a } else { b.b };
            // A spur: a free end, short beyond the edge of the through line (at most about three
            // times its half width), not a line crossing it (one going on straight on the other
            // side, as a whisker over a cheek).
            let crossing = (0..es.len()).any(|x| x != k && dot(dirs[x], dirs[k]) < -0.94);
            if !is_through(k)
                && b.a != b.b
                && degree(far) == 1
                && !crossing
                && len_of[e.br] - r_through < (SPUR * half_of[e.br]).min(3.0 * r_through)
            {
                spurs.insert(e.br);
                let pts = away(b, e.at_b);
                let tip = pts[pts.len() - 1];
                let base = pts[0];
                lines.push([tip, add_scaled(base, norm(sub(base, tip)), r_through * 0.8)]);
                taken.push(base);
            } else {
                kept.push(k);
            }
        }
        // The others end on the edge of the through line: a cut line between the inner corners of
        // the outline either side of them (where the edge of the line turns into the next one).
        let mut round_: Vec<usize> = kept.clone();
        round_.sort_by(|&x, &y| by(angle(dirs[x]) - angle(dirs[y]), 0.0));
        let index_in_round =
            |k: usize| round_.iter().position(|&x| x == k).map_or(-1, |p| p as i64);
        // The outline point nearest `center` between the directions of ends x and y
        // (counterclockwise from x). Seen from where the end being cut leaves (in junctions merged
        // from a few, the merged middle can lie off to the side).
        let corner = |center: Pt, reach: f64, x: usize, y: usize, k: usize| -> Option<RingPt> {
            // Between the two ends of a loop: the nearest point of the hole it goes round (a little
            // toward the end being cut, so the cuts of both ends do not meet in one point).
            if es[x].br == es[y].br {
                let lp = &bs[es[x].br].pts;
                if let Some(ri) = rings.iter().position(|r| inside_poly(lp, r[0])) {
                    let hole = &rings[ri];
                    let near = min_of(hole.iter().map(|&q| dist(q, center)));
                    let toward = point_along(&away(&bs[es[k].br], es[k].at_b), 1.5);
                    let mut best = 0;
                    for (qi, &q) in hole.iter().enumerate() {
                        if dist(q, center) < near + 0.5
                            && dist(q, toward) < dist(hole[best], toward)
                        {
                            best = qi;
                        }
                    }
                    return Some(RingPt {
                        p: hole[best],
                        ring: ri,
                        at: best,
                    });
                }
            }
            // The ends' directions as seen from `center` (in a merged junction they leave elsewhere).
            let seen = |z: usize| {
                let e = es[z];
                let pts = away(&bs[e.br], e.at_b);
                let s = (len_of[e.br] * 0.5).min(1.5f64.max(2.5 * half_of[e.br]));
                angle(sub(point_along(&pts, s), center))
            };
            let a0 = seen(x);
            // (Not on the hole of a loop here: that lies between the loop's own two ends.)
            let loops: Vec<&Vec<Pt>> = es
                .iter()
                .filter(|&&e| is_loop(e))
                .map(|e| &bs[e.br].pts)
                .collect();
            let mut span = seen(y) - a0;
            while span <= 0.0 {
                span += 2.0 * PI;
            }
            let mut best: Option<RingPt> = None;
            for (ri, r) in rings.iter().enumerate() {
                if loops.iter().any(|l| inside_poly(l, r[0])) {
                    continue;
                }
                for (qi, &q) in r.iter().enumerate() {
                    if dist(q, center) >= reach {
                        continue;
                    }
                    let mut u = angle(sub(q, center)) - a0;
                    while u < 0.0 {
                        u += 2.0 * PI;
                    }
                    if u <= 0.02 || u >= span - 0.02 {
                        continue;
                    }
                    if best.is_none_or(|b| dist(q, center) < dist(b.p, center)) {
                        best = Some(RingPt {
                            p: q,
                            ring: ri,
                            at: qi,
                        });
                    }
                }
            }
            best
        };
        // A cut between corners stays on the area (not across a hole or a notch between them).
        let within = |p: Pt, q: Pt| {
            let mut t = 0.1;
            while t < 0.95 {
                let m = add_scaled(p, sub(q, p), t);
                if rings.iter().filter(|r| inside_poly(r, m)).count() % 2 == 0 {
                    return false;
                }
                t += 0.1;
            }
            true
        };
        // The corners each cut end got, and where along it the cut lies.
        let mut cornered: Ordered<usize, (RingPt, RingPt)> = Ordered::new();
        let place_cut = |trimmed: &mut HashMap<End, f64>, k: usize, cut: Line| {
            let pts = away(&bs[es[k].br], es[k].at_b);
            let m = half_way(&cut);
            let mut s = 0.0;
            let mut best_s = 0.0;
            let mut best_d = f64::INFINITY;
            for q2 in 0..pts.len() {
                if q2 > 0 {
                    s += dist(pts[q2], pts[q2 - 1]);
                }
                let d2 = dist(pts[q2], m);
                if d2 < best_d {
                    best_d = d2;
                    best_s = s;
                }
            }
            trimmed.insert(es[k], best_s);
        };
        let mut mine: HashMap<usize, usize> = HashMap::new();
        for &k in &kept {
            if is_through(k) {
                continue;
            }
            let e = es[k];
            let pts = away(&bs[e.br], e.at_b);
            // A short link already cut at its other junction: its rest stays on this one's column
            // (a second cut would leave a sliver between the two).
            let b = &bs[e.br];
            if trimmed.contains_key(&End {
                br: e.br,
                at_b: !e.at_b,
            }) && len_of[e.br] < 1.5 * (nodes[b.a].r + nodes[b.b].r)
            {
                spurs.insert(e.br);
                continue;
            }
            let at = index_in_round(k) as usize;
            let rl = round_.len();
            let cw = round_[(at + rl - 1) % rl];
            let ccw = round_[(at + 1) % rl];
            let own = &nodes[if e.at_b { b.b } else { b.a }];
            let p = corner(own.p, 3.0 * own.r + 1.5, cw, k, k);
            let q = corner(own.p, 3.0 * own.r + 1.5, k, ccw, k);
            let cut: Line = match (p, q) {
                (Some(p), Some(q))
                    if dist(p.p, q.p) > 0.2
                        && within(p.p, q.p)
                        && !pinch((p.p, Some(p.ring)), (q.p, Some(q.ring))) =>
                {
                    let d = norm(sub(q.p, p.p));
                    cornered.set(k, (p, q));
                    [add_scaled(p.p, d, -0.3), add_scaled(q.p, d, 0.3)]
                }
                _ => {
                    // No corners found: square across the branch a junction's width out.
                    let c = point_along(
                        &pts,
                        (len_of[e.br] * 0.5).min((nodes[n].r + 0.2).max(own.r + half_of[e.br])),
                    );
                    let d = dirs[k];
                    let w = half_of[e.br] * 1.2 + 0.3;
                    [
                        add_scaled(c, [-d[1], d[0]], -w),
                        add_scaled(c, [-d[1], d[0]], w),
                    ]
                }
            };
            // Two junctions close together can find the same corners: one cut is enough.
            // (With `apart`, also one crossing it: between them would be a sliver.)
            let twin = cuts.iter().any(|&[a, b]| {
                (dist(a, cut[0]) + dist(b, cut[1])).min(dist(a, cut[1]) + dist(b, cut[0])) < 1.0
                    || (apart && cross(a, b, cut[0], cut[1]))
            });
            if !twin {
                mine.insert(k, cuts.len());
                cuts.push(cut);
            }
            // Where along the branch the cut lies (lines across keep clear of it).
            place_cut(&mut trimmed, k, cut);
        }
        // Two lines cut side by side from the same notch between them: the through line would
        // reach out into the notch in a spike, its stitches fanning into the tip. The wedge goes to
        // one of the two instead, cut straight across from corner to corner.
        for (k1, (a, n1)) in &cornered.items {
            let k1 = *k1;
            let rl = round_.len();
            let k2 = round_[((index_in_round(k1) + 1) as usize) % rl];
            let Some(other) = cornered.get(k2) else {
                continue;
            };
            if k2 == k1 || !other.0.same(n1) || !mine.contains_key(&k1) || !mine.contains_key(&k2) {
                continue;
            }
            let b = other.1;
            if to_segment(n1.p, a.p, b.p) < r_through * 0.5
                || !within(a.p, b.p)
                || pinch((a.p, Some(a.ring)), (b.p, Some(b.ring)))
            {
                continue;
            }
            let d = norm(sub(b.p, a.p));
            let k = if dot(d, dirs[k1]).abs() <= dot(d, dirs[k2]).abs() {
                k1
            } else {
                k2
            };
            let cut: Line = [add_scaled(a.p, d, -0.3), add_scaled(b.p, d, 0.3)];
            cuts[mine[&k]] = cut;
            place_cut(&mut trimmed, k, cut);
        }
    }

    // The strokes: branches joined where they run through a junction.
    let mut used: HashSet<usize> = inner.iter().chain(spurs.iter()).copied().collect();
    let mut strokes: Vec<Stroke> = vec![];
    let mut walk = |used: &mut HashSet<usize>, start: End| {
        let mut pts: Vec<Pt> = vec![];
        let mut r: Vec<f64> = vec![];
        let mut e = Some(start);
        let from = trimmed.get(&start).copied().unwrap_or(0.0);
        let mut to = 0.0;
        let mut closed = false;
        while let Some(cur) = e {
            if used.contains(&cur.br) {
                break;
            }
            used.insert(cur.br);
            let b = &bs[cur.br];
            pts.extend(away(b, cur.at_b));
            r.extend(radii_away(b, cur.at_b));
            let out = End {
                br: cur.br,
                at_b: !cur.at_b,
            };
            to = trimmed.get(&out).copied().unwrap_or(0.0);
            e = partner.get(&out).copied();
            if e == Some(start) {
                closed = true;
            }
        }
        if pts.len() > 1 {
            strokes.push(Stroke {
                pts,
                r,
                closed,
                from,
                to,
            });
        }
    };
    // From the ends first (free or cut), then what is left: closed rings.
    for k in 0..bs.len() {
        if used.contains(&k) {
            continue;
        }
        for at_b in [false, true] {
            let e = End { br: k, at_b };
            if !partner.contains_key(&e) && !used.contains(&k) {
                walk(&mut used, e);
            }
        }
    }
    for k in 0..bs.len() {
        if !used.contains(&k) {
            walk(&mut used, End { br: k, at_b: false });
        }
    }

    let forks: Vec<&Node> = (0..nodes.len())
        .filter(|&x| degree(x) > 2)
        .map(|x| &nodes[x])
        .collect();
    let mut si = 0;
    while si < strokes.len() {
        let (pts, st_r, closed, from, to) = {
            let st = &strokes[si];
            (st.pts.clone(), st.r.clone(), st.closed, st.from, st.to)
        };
        si += 1;
        let half = median(&st_r);
        let w = 2.0 * half;
        let n = pts.len();
        // Only the stretch the column covers: from where it starts after a cut to where it ends.
        let mut cum = vec![0.0];
        for i in 1..n {
            cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
        }
        let total = cum[n - 1];
        let lo = from + half + 0.4;
        let hi = total - to - half - 0.4;
        let span = |i: usize, h: f64| {
            let (mut a, mut b) = (i, i);
            while a > 0 && cum[i] - cum[a] < h {
                a -= 1;
            }
            while b < n - 1 && cum[b] - cum[i] < h {
                b += 1;
            }
            (a, b)
        };
        let heading = |i: usize, h: f64| {
            let (a, b) = span(i, h);
            norm(sub(pts[b], pts[a]))
        };
        let turn_at = |i: usize, h: f64| {
            let (a, b) = span(i, h);
            let din = norm(sub(pts[i], pts[a]));
            let dout = norm(sub(pts[b], pts[i]));
            let deg = (dot(din, dout).clamp(-1.0, 1.0).acos() * 180.0) / PI;
            (deg, din, dout)
        };
        let across = |p: Pt, d: Pt| -> Line {
            [add_scaled(p, d, -half * 0.6), add_scaled(p, d, half * 0.6)]
        };
        let mut placed: Vec<f64> = vec![];
        let free = |placed: &[f64], s: f64, gap: f64| {
            placed.iter().all(|&x| (x - s).abs() >= gap)
                && taken
                    .iter()
                    .all(|&q| dist(q, point_along(&pts, s)) >= w * 1.2)
        };
        // A closed ring is opened once, square across where it runs straightest (its corners then
        // lie inside the column, fanned like any other).
        if closed {
            let mut k = 0;
            let mut least = f64::INFINITY;
            // Not at a junction on it (where a line leaves, cut off there already).
            let clear: Vec<bool> = pts
                .iter()
                .map(|&q| forks.iter().all(|f| dist(q, f.p) >= f.r + w))
                .collect();
            let any_clear = clear.iter().any(|&c| c);
            for i in 0..n {
                if !clear[i] && any_clear {
                    continue;
                }
                let t = turn_at(i, 1f64.max(1.5 * w)).0;
                if t < least {
                    least = t;
                    k = i;
                }
            }
            let (_, din, dout) = turn_at(k, 0.6f64.max(w));
            let d = norm(add_scaled(din, dout, 1.0));
            let nrm: Pt = [-d[1], d[0]];
            cuts.push([
                add_scaled(pts[k], nrm, -(half * 1.2 + 0.3)),
                add_scaled(pts[k], nrm, half * 1.2 + 0.3),
            ]);
            // Lines across measured from the opening.
            let mut rot: Vec<Pt> = pts[k..].to_vec();
            rot.extend_from_slice(&pts[1.min(k + 1)..k + 1]);
            let mut rr: Vec<f64> = st_r[k..].to_vec();
            rr.extend_from_slice(&st_r[1.min(k + 1)..(k + 1).min(st_r.len())]);
            strokes.push(Stroke {
                pts: rot,
                r: rr,
                closed: false,
                from: half + 0.1,
                to: half + 0.1,
            });
            continue;
        }
        if hi <= lo {
            // Too short for more: one line across in the middle.
            let k = first_at(&cum, (from + total - to) / 2.0)
                .unwrap_or(0)
                .min(n - 1);
            let h = heading(k, 0.3f64.max(half));
            lines.push(across(pts[k], [-h[1], h[0]]));
            continue;
        }
        // Sharp bends: a line along the bisector and one square to the column about a width either side.
        let hc = 0.6f64.max(w * 0.6);
        let mut corners: Vec<usize> = vec![];
        for i in 1..n.saturating_sub(1) {
            if cum[i] < lo || cum[i] > hi {
                continue;
            }
            let t = turn_at(i, hc).0;
            if t < CORNER {
                continue;
            }
            if t >= turn_at(i - 1, hc).0 && t >= turn_at(i + 1, hc).0 {
                match corners.last().copied() {
                    Some(last) if cum[i] - cum[last] < w * 1.5 => {
                        if t > turn_at(last, hc).0 {
                            *corners.last_mut().unwrap() = i;
                        }
                    }
                    _ => corners.push(i),
                }
            }
        }
        for &i in &corners {
            let (deg, din, dout) = turn_at(i, hc);
            let bis = norm(sub(din, dout));
            let l =
                (5.0 * half).min((half / 0.3f64.max(((deg * PI) / 360.0).js_cos())) * 1.1 + 0.3);
            if deg >= SHARP
                && hypot(bis[0], bis[1]) > 0.1
                && !pinch(
                    (add_scaled(pts[i], bis, -l), None),
                    (add_scaled(pts[i], bis, l), None),
                )
            {
                // Too sharp to fan (the stitches would pile up in the inner corner): cut along the
                // bisector, a mitre, with a line across either side.
                cuts.push([add_scaled(pts[i], bis, -l), add_scaled(pts[i], bis, l)]);
                placed.push(cum[i]);
            } else if free(&placed, cum[i], w * 0.8) {
                let d = if hypot(bis[0], bis[1]) > 0.1 {
                    bis
                } else {
                    [-din[1], din[0]]
                };
                lines.push(across(pts[i], d));
                placed.push(cum[i]);
            }
            for side in [-1.0, 1.0] {
                let s = cum[i] + side * w * 1.1;
                if s < lo || s > hi || !free(&placed, s, w * 0.8) {
                    continue;
                }
                let Some(k) = first_at(&cum, s) else { continue };
                let h = heading(k, 0.3f64.max(half));
                lines.push(across(pts[k], [-h[1], h[0]]));
                placed.push(s);
            }
        }
        // Where a line joins its side, square across: the side jogs there, and the stitches would
        // otherwise fan toward the cut.
        for f in &forks {
            let mut k = 0;
            let mut least = f64::INFINITY;
            for (i, &q) in pts.iter().enumerate() {
                let d = dist(q, f.p);
                if d < least {
                    least = d;
                    k = i;
                }
            }
            if least > f.r * 0.5 || cum[k] < lo || cum[k] > hi || !free(&placed, cum[k], w * 0.8) {
                continue;
            }
            let h = heading(k, 0.3f64.max(w));
            lines.push(across(pts[k], [-h[1], h[0]]));
            placed.push(cum[k]);
        }
        // Along the rest: a line each time the column has turned by TURN_STEP since the last one.
        let mut last_dir: Option<Pt> = None;
        let mut last_s = f64::NEG_INFINITY;
        for i in 0..n {
            let s = cum[i];
            if s < lo || s > hi {
                continue;
            }
            let h = heading(i, 0.3f64.max(w));
            let Some(mut ld) = last_dir else {
                last_dir = Some(h);
                last_s = s;
                continue;
            };
            // A corner's lines count as lines along the way.
            if let Some(&pc) = placed.iter().find(|&&x| x <= s && x > last_s)
                && let Some(at) = first_at(&cum, pc)
            {
                ld = heading(at, 0.3f64.max(w));
                last_dir = Some(ld);
                last_s = pc;
            }
            let turned = (dot(h, ld).clamp(-1.0, 1.0).acos() * 180.0) / PI;
            if turned >= TURN_STEP && s - last_s >= w * 1.5 && free(&placed, s, w * 1.5) {
                lines.push(across(pts[i], [-h[1], h[0]]));
                placed.push(s);
                last_dir = Some(h);
                last_s = s;
            }
        }
        // Every column needs a line across: one in the middle if none.
        if placed.is_empty() {
            // In the middle, or where it keeps farthest from the lines along spurs.
            let mut mid = (lo + hi) / 2.0;
            let near_spurs: Vec<Pt> = taken
                .iter()
                .filter(|&&q| nearest(&pts, q) < w)
                .copied()
                .collect();
            if !near_spurs.is_empty() {
                let mut far = -1.0;
                let mut x = lo;
                while x <= hi {
                    let p = point_along(&pts, x);
                    let d = min_of(near_spurs.iter().map(|&q| dist(p, q)));
                    if d > far {
                        far = d;
                        mid = x;
                    }
                    x += 0.2;
                }
                if far < w * 1.2 {
                    continue;
                }
            }
            if let Some(k) = first_at(&cum, mid) {
                let h = heading(k, 0.3f64.max(w));
                lines.push(across(pts[k], [-h[1], h[0]]));
            }
        }
    }
    (cuts, lines)
}

/// Which ring a cut line reaches first either side of its middle: -1 the outside, else a hole.
fn cut_ends(cut: &Line, outsides: &[Vec<Pt>], holes: &[Vec<Pt>]) -> [i64; 2] {
    let [a, b] = *cut;
    let m = add_scaled(a, sub(b, a), 0.5);
    let d = norm(sub(b, a));
    let hit = |dir: f64| {
        let mut best = (-1i64, f64::INFINITY);
        let rings = outsides
            .iter()
            .map(|r| (r, -1i64))
            .chain(holes.iter().enumerate().map(|(k, r)| (r, k as i64)));
        for (r, k) in rings {
            for i in 1..r.len() {
                let p = r[i - 1];
                let q = sub(r[i], p);
                let den = d[0] * dir * q[1] - d[1] * dir * q[0];
                if den.abs() < 1e-12 {
                    continue;
                }
                let w = sub(p, m);
                let t = (w[0] * q[1] - w[1] * q[0]) / den;
                let u = (w[0] * d[1] * dir - w[1] * d[0] * dir) / den;
                if t > 0.0 && (0.0..=1.0).contains(&u) && t < best.1 {
                    best = (k, t);
                }
            }
        }
        best.0
    };
    [hit(-1.0), hit(1.0)]
}

/// The cut lines in an order that opens the holes one after another: a cut from the edge into a
/// hole first, then from that hole into the next (strips_of_outline opens holes in the order given).
pub fn bridge_order(cuts: &[Line], outsides: &[Vec<Pt>], holes: &[Vec<Pt>]) -> Vec<Line> {
    bridge_indices(cuts, outsides, holes)
        .into_iter()
        .map(|k| cuts[k])
        .collect()
}

/// The order of bridge_order, by index in `cuts`.
pub fn bridge_indices(cuts: &[Line], outsides: &[Vec<Pt>], holes: &[Vec<Pt>]) -> Vec<usize> {
    let ends: Vec<[i64; 2]> = cuts.iter().map(|c| cut_ends(c, outsides, holes)).collect();
    let mut open: HashSet<i64> = HashSet::from([-1]);
    let mut done = vec![false; cuts.len()];
    let mut out: Vec<usize> = vec![];
    // A cut line that another crosses (two from one junction) opens a hole only when no other does:
    // the one crossing it would cut through the opening, and a part would close round the hole again.
    let crossed: Vec<bool> = (0..cuts.len())
        .map(|k| {
            let [a, b] = cuts[k];
            (0..cuts.len()).any(|j| j != k && meets(a, b, cuts[j][0], cuts[j][1]))
        })
        .collect();
    loop {
        let opens = |[x, y]: [i64; 2]| {
            (open.contains(&x) && !open.contains(&y)) || (open.contains(&y) && !open.contains(&x))
        };
        let k = (0..cuts.len())
            .find(|&k| !done[k] && !crossed[k] && opens(ends[k]))
            .or_else(|| (0..cuts.len()).find(|&k| !done[k] && opens(ends[k])));
        let Some(k) = k else { break };
        out.push(k);
        done[k] = true;
        open.insert(ends[k][0]);
        open.insert(ends[k][1]);
    }
    for k in 0..cuts.len() {
        if !done[k] {
            out.push(k);
        }
    }
    out
}

/// A cut line across the line nearest to a hole that is still closed.
fn open_hole(g: &Graph, hole: &[Pt]) -> Option<Line> {
    let mut best: Option<(usize, usize, f64)> = None;
    for (bi, b) in g.branches.iter().enumerate() {
        for i in 1..b.pts.len().saturating_sub(1) {
            let d = nearest(hole, b.pts[i]) - b.r[i];
            if best.is_none_or(|x| d < x.2) {
                best = Some((bi, i, d));
            }
        }
    }
    let (bi, i, _) = best?;
    let b = &g.branches[bi];
    let t = norm(sub(
        b.pts[(b.pts.len() - 1).min(i + 3)],
        b.pts[i.saturating_sub(3)],
    ));
    let n: Pt = [-t[1], t[0]];
    let w = b.r[i] * 1.2 + 0.3;
    Some([add_scaled(b.pts[i], n, -w), add_scaled(b.pts[i], n, w)])
}

/// Where a satin that does not know how it was cut (see Rails.split in restitch.ts) gets its area:
/// the part that is the area (`part`, or the first whose columns lie in it, one in ten may miss),
/// its outsides and holes, and the cut lines where its columns end inside it. None when no part is.
pub fn split_of(
    columns: &[Vec<(Vec<Pt>, Vec<Pt>)>],
    area: &Region,
    part: Option<usize>,
) -> Option<(usize, Loops, Loops, Vec<Line>)> {
    let (outsides, holes) = area_loops(area);
    if outsides.is_empty() {
        return None;
    }
    let within = |q: Pt| {
        outsides.iter().any(|o| inside_poly(o, q)) && !holes.iter().any(|h| inside_poly(h, q))
    };
    // Between the rails at a share of the way along: a short or twisted column (read from an
    // image) can have its middle just outside its own area, so a quarter or three on is as good.
    let at = |(l, r): &(Vec<Pt>, Vec<Pt>), share: f64| -> Pt {
        let i = round((l.len() - 1) as f64 * share) as usize;
        let j = i.min(r.len() - 1);
        [(l[i][0] + r[j][0]) / 2.0, (l[i][1] + r[j][1]) / 2.0]
    };
    // The part that is the area: its columns lie in it (one in ten may miss, read from an image a
    // tiny column can lie across its own edge).
    let in_area = |c: &(Vec<Pt>, Vec<Pt>)| {
        c.0.len() > 1 && c.1.len() > 1 && [0.5, 0.25, 0.75].iter().any(|&sh| within(at(c, sh)))
    };
    let k = match part {
        Some(k) => k,
        None => columns.iter().position(|pt| {
            !pt.is_empty() && pt.iter().filter(|c| !in_area(c)).count() <= pt.len() / 10
        })?,
    };
    let cuts = cut_lines_between(columns.get(k)?, &outsides, &holes);
    Some((k, outsides, holes, cuts))
}

/// Nearest distance between two segments (0 when they cross).
fn seg_gap([a, b]: Line, [c, d]: Line) -> f64 {
    if side(a, b, c) * side(a, b, d) < 0.0 && side(c, d, a) * side(c, d, b) < 0.0 {
        return 0.0;
    }
    let to = |p: Pt, q: Pt, r: Pt| {
        let vx = r[0] - q[0];
        let vy = r[1] - q[1];
        let l2 = vx * vx + vy * vy;
        let u = if l2 != 0.0 {
            (((p[0] - q[0]) * vx + (p[1] - q[1]) * vy) / l2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        hypot(p[0] - q[0] - u * vx, p[1] - q[1] - u * vy)
    };
    to(a, c, d)
        .min(to(b, c, d))
        .min(to(c, a, b))
        .min(to(d, a, b))
}

/// What around_cuts makes: the lines across, the cut lines, whether they make columns.
#[derive(Clone, Debug, Serialize)]
pub struct AroundCuts {
    pub lines: Vec<Line>,
    pub cuts: Vec<Cut>,
    pub ok: bool,
}

/// A suggestion around cut lines drawn by hand: those stay; a suggested cut line that crosses one
/// or comes near it goes, as does a line across that crosses one. When the parts then make no
/// columns, the cut lines by hand alone with the lines across, if they do.
pub fn around_cuts(
    s_lines: &[Line],
    s_cuts: &[Line],
    own: &[Cut],
    outsides: &[Vec<Pt>],
    holes: &[Vec<Pt>],
) -> AroundCuts {
    // A cut line by hand may bend: as near as its nearest piece.
    let gap = |l: Line, c: &Cut| min_of(cut_pieces(c).into_iter().map(|p| seg_gap(l, p)));
    let lines: Vec<Line> = s_lines
        .iter()
        .filter(|&&l| !own.iter().any(|c| gap(l, c) == 0.0))
        .copied()
        .collect();
    let mut merged: Vec<Cut> = own.to_vec();
    merged.extend(
        s_cuts
            .iter()
            .filter(|&&c| !own.iter().any(|o| gap(c, o) < SAME_CUT_MM))
            .map(|c| c.to_vec()),
    );
    let fits = |cuts: &[Cut]| {
        let made = strips_of_areas(outsides, &lines, cuts, holes);
        made.hole < 0 && made.bad.is_none()
    };
    if fits(&merged) {
        return AroundCuts {
            lines,
            cuts: merged,
            ok: true,
        };
    }
    if merged.len() > own.len() && fits(own) {
        return AroundCuts {
            lines,
            cuts: own.to_vec(),
            ok: true,
        };
    }
    AroundCuts {
        lines,
        cuts: merged,
        ok: false,
    }
}

/// The columns a fill makes along lines across it and cut lines (see columns_along).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Along {
    /// Each strip with the chain (area apart) it is sewn in; the area's loops, for its split.
    Columns {
        columns: Vec<Rails>,
        outsides: Vec<Vec<Pt>>,
        holes: Vec<Vec<Pt>>,
    },
    Hole(Vec<Pt>),
    Bad(Vec<Pt>),
    NotStrip,
}

fn rails_of(s: Strip, chain: usize) -> Rails {
    Rails {
        rungs: Some(s.rungs),
        chain: Some(chain as f64),
        ..Rails::new(s.left, s.right)
    }
}

/// The columns a fill makes along lines across it and cut lines (see strips_of_areas): parts cut
/// apart each a column, sewn on one into the next; areas apart each a chain of their own. Or what
/// stops it: a hole no cut line opens, a part no line crosses, lines that make no strip.
pub fn columns_along(area: &Region, lines: &[Line], cuts: &[Cut]) -> Option<Along> {
    let (outsides, holes) = area_loops(area);
    columns_along_loops(outsides, holes, lines, cuts)
}

fn columns_along_loops(
    outsides: Vec<Vec<Pt>>,
    holes: Vec<Vec<Pt>>,
    lines: &[Line],
    cuts: &[Cut],
) -> Option<Along> {
    if outsides.is_empty() {
        return None;
    }
    if !cuts.is_empty() || !holes.is_empty() || outsides.len() > 1 {
        let made = strips_of_areas(&outsides, lines, cuts, &holes);
        if made.hole >= 0 {
            return Some(Along::Hole(holes[made.hole as usize].clone()));
        }
        if let Some(bad) = made.bad {
            return Some(Along::Bad(bad));
        }
        let columns = made
            .areas
            .into_iter()
            .enumerate()
            .flat_map(|(a, strips)| strips.into_iter().map(move |s| rails_of(s, a)))
            .collect();
        return Some(Along::Columns {
            columns,
            outsides,
            holes,
        });
    }
    let Some(rails) = rails_from_outline(&outsides[0], lines) else {
        return Some(Along::NotStrip);
    };
    Some(Along::Columns {
        columns: vec![rails_of(rails, 0)],
        outsides,
        holes,
    })
}

/// Columns of chains, each chain in the order that hides the ways between its parts best (see
/// inChainOrder in reshape.ts).
pub fn in_chain_order(columns: Vec<Rails>, s: &SatinSettings) -> Vec<Rails> {
    if !columns.iter().all(|c| c.chain.is_some()) {
        return columns;
    }
    let mut chains: Vec<(u64, Vec<Rails>)> = vec![];
    for c in columns {
        let key = c.chain.unwrap_or(0.0).to_bits();
        match chains.iter_mut().find(|(k, _)| *k == key) {
            Some(e) => e.1.push(c),
            None => chains.push((key, vec![c])),
        }
    }
    chains
        .into_iter()
        .flat_map(|(_, g)| if g.len() > 1 { chained(&g, s) } else { g })
        .collect()
}

/// The columns "Vorschlagen" makes of an area for a satin with settings `s`, in sewing order (the
/// kind switch and a line made into satin take these), with the area's loops and cut lines for its
/// split. None when no suggestion makes columns.
pub fn suggested_columns(area: &Region, s: &SatinSettings) -> Result<Option<Suggested>, String> {
    let Some(sug) = suggest_satin(area, None, STROKE_MAX, false, true)? else {
        return Ok(None);
    };
    if sug.kind == ShapeClass::Wide || !sug.ok {
        return Ok(None);
    }
    let (outsides, holes) = area_loops(area);
    match columns_along_loops(outsides, holes, &sug.lines, &as_cuts(&sug.cuts)) {
        Some(Along::Columns {
            columns,
            outsides,
            holes,
        }) => Ok(Some((
            in_chain_order(columns, s),
            outsides,
            holes,
            sug.cuts,
        ))),
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digitize::region::{Bbox, build_region};

    const PX: f64 = 0.1;
    const W: usize = 400;

    fn region(f: impl Fn(f64, f64) -> bool) -> Region {
        let mut comp = vec![0i32; W * W];
        let (mut x0, mut y0, mut x1, mut y1) = (W as i32, W as i32, 0, 0);
        for y in 0..W {
            for x in 0..W {
                if f((x as f64 + 0.5) * PX, (y as f64 + 0.5) * PX) {
                    comp[y * W + x] = 1;
                    x0 = x0.min(x as i32);
                    y0 = y0.min(y as i32);
                    x1 = x1.max(x as i32);
                    y1 = y1.max(y as i32);
                }
            }
        }
        let bbox = Bbox {
            min_x: x0,
            min_y: y0,
            max_x: x1,
            max_y: y1,
        };
        build_region(&comp, &vec![0u8; W * W], W, 1, 1, bbox, W, PX, 0.0, |_| {
            false
        })
    }

    fn ring() -> Region {
        region(|x, y| {
            let d = hypot(x - 20.0, y - 20.0);
            d < 12.0 && d > 8.0
        })
    }

    #[test]
    fn a_ring_is_one_outside_and_one_hole() {
        let (o, h) = area_loops(&ring());
        assert_eq!((o.len(), h.len()), (1, 1));
    }

    #[test]
    fn a_ring_is_opened_into_columns() {
        let s = suggest_satin(&ring(), None, STROKE_MAX, false, true)
            .unwrap()
            .unwrap();
        assert!(s.ok);
        assert!(!s.cuts.is_empty());
        assert!(!s.lines.is_empty());
    }

    #[test]
    fn a_cross_is_strokes_with_a_junction() {
        let near = |a: Pt, b: Pt, w: f64| {
            move |x: f64, y: f64| {
                let q = [x, y];
                to_segment(q, a, b) < w / 2.0
            }
        };
        let h = near([5.0, 20.0], [35.0, 20.0], 2.0);
        let v = near([20.0, 5.0], [20.0, 35.0], 2.0);
        let r = region(move |x, y| h(x, y) || v(x, y));
        let g = skeleton(&r);
        assert_eq!(classify(&g, STROKE_MAX), ShapeClass::Strokes);
        let s = suggest_satin(&r, Some(&g), STROKE_MAX, false, true)
            .unwrap()
            .unwrap();
        assert_eq!(s.kind, ShapeClass::Strokes);
        assert!(s.ok);
        assert!(s.cuts.len() >= 2);
        let (o, h) = area_loops(&r);
        match columns_along(&r, &s.lines, &as_cuts(&s.cuts)).unwrap() {
            Along::Columns { columns, .. } => assert!(columns.len() >= 3),
            _ => panic!("no columns"),
        }
        let a = around_cuts(&s.lines, &s.cuts, &[], &o, &h);
        assert!(a.ok);
    }

    #[test]
    fn bridges_open_the_hole_first() {
        let (o, h) = area_loops(&ring());
        // A cut along the band (from the edge to the edge) and one from the edge into the hole.
        let inner: Line = [[17.0, 30.0], [23.0, 30.0]];
        let bridge: Line = [[7.0, 20.0], [13.0, 20.0]];
        let order = bridge_order(&[inner, bridge], &o, &h);
        assert_eq!(order[0], bridge);
    }

    #[test]
    fn a_strip_across_a_hole_covers_it() {
        let hole = vec![[14.0, 14.0], [20.0, 14.0], [20.0, 20.0], [14.0, 20.0]];
        let thin = Strip {
            left: vec![[10.0, 10.0], [24.0, 10.0]],
            right: vec![[10.0, 12.0], [24.0, 12.0]],
            ..Default::default()
        };
        let wide = Strip {
            left: vec![[10.0, 11.0], [24.0, 11.0]],
            right: vec![[10.0, 23.0], [24.0, 23.0]],
            ..Default::default()
        };
        assert!(!covers(&[thin], std::slice::from_ref(&hole)));
        assert!(covers(&[wide], &[hole]));
    }
}
