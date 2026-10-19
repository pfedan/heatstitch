//! Stitches along a line (src/model/along.ts): the border of a fill on the edge of its area and a
//! drawn line of its own. Running stitch (once, or as bean stitch), a satin or an open zigzag of a
//! set width centered on the line, an E stitch with its edge on the line, or a motif; the same
//! settings and the same stitches for both.

use serde::{Deserialize, Serialize};

use super::line_order::{LineOrder, with_order};
use super::restitch::{FringeSide, Rails, SatinSettings, SatinType, satin_runs, yes};
use super::runs::Run;
use crate::digitize::border::{
    self, BORDER_STITCH, KeptLine, border_loops, border_rails, border_run, kept_lines, kept_open,
    kept_rails, line_rails, order_loops,
};
use crate::digitize::motif::{LineMotif, motif_stitches};
use crate::digitize::region::{Region, sample};
use crate::digitize::run::TOLERANCE;
use crate::digitize::satin::UnderlayKind;
use crate::digitize::satin_joins::{SatinCorner, SatinEnd, stroke_rails};
use crate::geom::Pt;
use crate::js::{hypot, round};
use crate::material::rules::SATIN_UNDER_MIN;
use crate::shape::path::{Form, flatten};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BorderType {
    Run,
    Triple,
    Satin,
    Zigzag,
    E,
    Motif,
}

/// A satin's underlay as a line asks for it: a kind, or none.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineUnder {
    Off,
    Auto,
    Center,
    Contour,
    Zigzag,
    Both,
}

impl LineUnder {
    fn kind(self) -> Option<UnderlayKind> {
        match self {
            LineUnder::Off => None,
            LineUnder::Auto => Some(UnderlayKind::Auto),
            LineUnder::Center => Some(UnderlayKind::Center),
            LineUnder::Contour => Some(UnderlayKind::Contour),
            LineUnder::Zigzag => Some(UnderlayKind::Zigzag),
            LineUnder::Both => Some(UnderlayKind::Both),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EchoSide {
    Out,
    In,
    Both,
}

/// LineEcho of digitize/echo.ts: copies of a line beside it. Of `colors` only whether a copy has
/// a thread of its own counts here.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct LineEcho {
    pub side: EchoSide,
    pub count: f64,
    pub gap: f64,
    #[serde(default, deserialize_with = "truthy")]
    pub cut: bool,
    #[serde(default, deserialize_with = "own_thread")]
    pub colors: Option<Vec<bool>>,
    #[serde(default)]
    pub only: Option<Vec<i64>>,
    #[serde(default)]
    pub skip: Option<Vec<i64>>,
    #[serde(default)]
    pub phase: Option<f64>,
    #[serde(default, deserialize_with = "truthy")]
    pub reverse: bool,
}

/// PathStitch of along.ts; what only the records need (a shadow) is left out.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathStitch {
    #[serde(rename = "type")]
    pub kind: BorderType,
    #[serde(default = "super::restitch::nan")]
    pub width: f64,
    #[serde(default)]
    pub length: Option<f64>,
    #[serde(default)]
    pub repeat: Option<f64>,
    #[serde(default, deserialize_with = "truthy")]
    pub whole: bool,
    #[serde(default)]
    pub motif: Option<LineMotif>,
    #[serde(default, deserialize_with = "truthy")]
    pub cord: bool,
    #[serde(default)]
    pub stitch: Option<f64>,
    #[serde(default)]
    pub tolerance: Option<f64>,
    #[serde(default)]
    pub offset: Option<f64>,
    #[serde(default)]
    pub spacing: Option<f64>,
    #[serde(default, deserialize_with = "truthy")]
    pub flip: bool,
    #[serde(default)]
    pub pull: Option<f64>,
    #[serde(default)]
    pub under: Option<LineUnder>,
    #[serde(default, deserialize_with = "truthy")]
    pub under_cross: bool,
    #[serde(default)]
    pub corner: Option<SatinCorner>,
    #[serde(default)]
    pub ends: Option<SatinEnd>,
    #[serde(default)]
    pub fringe: Option<f64>,
    #[serde(default)]
    pub fringe_side: Option<FringeSide>,
    #[serde(default)]
    pub order: Option<Vec<Option<LineOrder>>>,
    #[serde(default)]
    pub own: Option<LineOrder>,
    #[serde(default)]
    pub echo: Option<LineEcho>,
    #[serde(default, deserialize_with = "truthy")]
    pub redwork: bool,
    #[serde(default)]
    pub redwork_gap: Option<f64>,
}

impl PathStitch {
    /// A running stitch `length` mm long.
    pub fn run(length: f64) -> PathStitch {
        PathStitch {
            kind: BorderType::Run,
            width: 0.0,
            length: Some(length),
            repeat: None,
            whole: false,
            motif: None,
            cord: false,
            stitch: None,
            tolerance: None,
            offset: None,
            spacing: None,
            flip: false,
            pull: None,
            under: None,
            under_cross: false,
            corner: None,
            ends: None,
            fringe: None,
            fringe_side: None,
            order: None,
            own: None,
            echo: None,
            redwork: false,
            redwork_gap: None,
        }
    }

    pub fn tol(&self) -> f64 {
        self.tolerance.unwrap_or(TOLERANCE)
    }
}

fn truthy<'de, D: serde::Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    Ok(Option::<bool>::deserialize(d)?.unwrap_or(false))
}

/// For each copy, whether it has a thread of its own (a color, not null).
fn own_thread<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Vec<bool>>, D::Error> {
    let v = Option::<Vec<Option<serde::de::IgnoredAny>>>::deserialize(d)?;
    Ok(v.map(|v| v.iter().map(Option::is_some).collect()))
}

/// Sewn as a running stitch (once or more often), not across a band.
pub fn is_run_type(t: BorderType) -> bool {
    matches!(t, BorderType::Run | BorderType::Triple)
}

/// As Math.min(hi, Math.max(lo, v)), NaN kept.
fn clamp_js(v: f64, lo: f64, hi: f64) -> f64 {
    if v.is_nan() { v } else { v.clamp(lo, hi) }
}

fn repeat_of(s: &PathStitch) -> f64 {
    clamp_js(round(s.repeat.unwrap_or(1.0)), 1.0, 5.0)
}

fn is_hand_motif(m: Option<LineMotif>) -> bool {
    matches!(
        m,
        Some(LineMotif::Stem | LineMotif::Feather | LineMotif::Cretan | LineMotif::Chevron)
    )
}

/// A motif that imitates a hand stitch.
pub fn is_hand(s: &PathStitch) -> bool {
    s.kind == BorderType::Motif && is_hand_motif(s.motif)
}

/// How often each stitch of a hand stitch is sewn when nothing is set.
const HAND_LAYERS: f64 = 3.0;

fn is_cord(s: &PathStitch) -> bool {
    s.kind == BorderType::Motif && s.motif == Some(LineMotif::Stem) && s.cord
}

/// How often each stitch of a hand stitch is sewn: 1, 3 or 5.
pub fn layers_of(s: &PathStitch) -> f64 {
    if is_cord(s) || s.repeat == Some(1.0) {
        1.0
    } else if s.repeat == Some(5.0) {
        5.0
    } else {
        HAND_LAYERS
    }
}

/// How often each stitch of a running stitch is sewn (bean stitch): an odd number.
pub fn times_of(s: &PathStitch) -> f64 {
    if s.kind == BorderType::Triple {
        return if s.repeat == Some(5.0) { 5.0 } else { 3.0 };
    }
    let r = repeat_of(s);
    if s.kind == BorderType::Motif && !is_hand(s) && !s.whole && r % 2.0 != 0.0 && !r.is_nan() {
        r
    } else {
        1.0
    }
}

/// How often the whole line is sewn, there and back.
pub fn passes_of(s: &PathStitch) -> f64 {
    if s.kind == BorderType::Triple || is_hand(s) || times_of(s) > 1.0 {
        1.0
    } else {
        repeat_of(s)
    }
}

/// Sewn as redwork: a running or triple stitch without echo.
pub fn is_redwork(s: &PathStitch) -> bool {
    s.redwork && is_run_type(s.kind) && s.echo.is_none()
}

/// Kinds of stitch whose figures repeat along the line.
pub fn has_phase(t: BorderType) -> bool {
    matches!(t, BorderType::Motif | BorderType::Zigzag | BorderType::E)
}

const ZIGZAG_SPACING: f64 = 1.5;
const E_SPACING: f64 = 2.5;
/// The step of a stem stitch sewn as a cord (mm).
const CORD_STEP: f64 = 0.4;
/// Longest stitch of a motif when none is set (mm).
const MOTIF_STITCH: f64 = 1.2;

fn motif_period(m: LineMotif) -> f64 {
    match m {
        LineMotif::Waves => 5.0,
        LineMotif::Scallops => 4.0,
        LineMotif::Hearts => 8.0,
        LineMotif::Chain => 2.2,
        LineMotif::Stem => 2.0,
        LineMotif::Feather | LineMotif::Cretan | LineMotif::Chevron => 3.0,
    }
}

/// Distance between penetrations on one side (mm).
pub fn spacing_of(s: &PathStitch) -> f64 {
    s.spacing.unwrap_or(match s.kind {
        BorderType::Zigzag => ZIGZAG_SPACING,
        BorderType::E => E_SPACING,
        BorderType::Motif if is_cord(s) => CORD_STEP,
        BorderType::Motif => motif_period(s.motif.unwrap_or(LineMotif::Waves)),
        _ => 0.4,
    })
}

/// The satin's underlay when none is chosen: by width (a zigzag and an E stitch have none).
pub fn auto_under(s: &PathStitch) -> LineUnder {
    if s.kind != BorderType::Satin {
        return LineUnder::Off;
    }
    s.under.unwrap_or(if s.width >= SATIN_UNDER_MIN {
        LineUnder::Auto
    } else {
        LineUnder::Off
    })
}

/// The satin of a line (see satinOf in along.ts).
pub fn satin_of(s: &PathStitch, line: bool, back: bool) -> SatinSettings {
    let under = auto_under(s);
    let satin = s.kind == BorderType::Satin;
    let fringe = line && satin && yes(s.fringe);
    SatinSettings {
        spacing: spacing_of(s),
        edge: if satin { s.pull.unwrap_or(0.0) } else { 0.0 },
        short: satin,
        underlay: under != LineUnder::Off,
        tolerance: s.tol(),
        under: Some(under.kind().unwrap_or(UnderlayKind::Center)),
        under_cross: satin && s.under_cross,
        stagger: Some(true),
        edge_share: Some(0.0),
        kind: (s.kind == BorderType::E).then_some(SatinType::E),
        fringe: if fringe { s.fringe } else { None },
        fringe_side: if fringe {
            s.fringe_side.map(|f| if back { f.other() } else { f })
        } else {
            None
        },
        ..Default::default()
    }
}

fn rails_of(b: border::Rails) -> Rails {
    Rails::new(b.left, b.right)
}

/// The rails of a line sewn with `s` along `line`.
pub fn line_rails_of(line: &[Pt], closed: bool, s: &PathStitch) -> Rails {
    rails_of(if s.kind == BorderType::Satin {
        stroke_rails(
            line,
            closed,
            s.width,
            s.corner.unwrap_or(SatinCorner::Miter),
            s.ends.unwrap_or(SatinEnd::Flat),
        )
    } else {
        line_rails(line, closed, s.width)
    })
}

/// The rails an E stitch is sewn between: its edge on the line, its prongs out to one side.
fn e_rails(b: Rails, to_left: bool) -> Rails {
    let mid: Vec<Pt> = b
        .left
        .iter()
        .zip(&b.right)
        .map(|(q, r)| [(q[0] + r[0]) / 2.0, (q[1] + r[1]) / 2.0])
        .collect();
    let side = if to_left { &b.left } else { &b.right };
    let right = side
        .iter()
        .zip(&mid)
        .map(|(q, m)| [2.0 * q[0] - m[0], 2.0 * q[1] - m[1]])
        .collect();
    Rails {
        left: mid,
        right,
        ..b
    }
}

fn at(r: &Region, q: Pt) -> f64 {
    sample(r, &r.sdf_base, q[0], q[1])
}

/// Whether the normal of `line` (right of its direction on screen) points into the area.
fn right_inside(r: &Region, line: &[Pt]) -> bool {
    let mut d = 0.0;
    let mut i = 1;
    while i < line.len() {
        let (a, b) = (line[i - 1], line[i]);
        let l = hypot(b[0] - a[0], b[1] - a[1]);
        let l = if l == 0.0 || l.is_nan() { 1.0 } else { l };
        let n = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
        d += at(r, [a[0] + n[0] * 0.5, a[1] + n[1] * 0.5])
            - at(r, [a[0] - n[0] * 0.5, a[1] - n[1] * 0.5]);
        i += 3;
    }
    d < 0.0
}

/// Whether the left rail of a band on the edge of `r` lies inside the area.
fn left_inside(r: &Region, b: &Rails) -> bool {
    let mut d = 0.0;
    let mut i = 0;
    while i < b.left.len() {
        d += at(r, b.left[i]) - at(r, b.right[i]);
        i += 5;
    }
    d < 0.0
}

/// A band on the edge of `r`: an E stitch's prongs inward (outward with flip).
fn on_edge(r: &Region, b: Rails, s: &PathStitch) -> Rails {
    if s.kind == BorderType::E {
        let to_left = left_inside(r, &b) != s.flip;
        e_rails(b, to_left)
    } else {
        b
    }
}

/// Each stitch of a running stitch sewn `times` times: there, back, there ...
fn repeated(pts: Vec<Pt>, times: f64) -> Vec<Pt> {
    if times < 3.0 || pts.len() < 2 {
        return pts;
    }
    let mut out = vec![pts[0]];
    let back = ((times - 1.0) / 2.0).ceil() as usize;
    for i in 1..pts.len() {
        for _ in 0..back {
            out.push(pts[i]);
            out.push(pts[i - 1]);
        }
        out.push(pts[i]);
    }
    out
}

/// The stitches along `line` (closed: its first point repeated at the end), from its end nearest
/// `start` (see sewAlong in along.ts). Sewn again (passes), the runs are copies without marks.
pub fn sew_along(
    line: &[Pt],
    closed: bool,
    s: &PathStitch,
    start: Option<Pt>,
    area: Option<&Region>,
    reversed: bool,
    shift: f64,
) -> Vec<Run> {
    let passes = if area.is_some() { 1.0 } else { passes_of(s) };
    let once = sew_once(line, closed, s, start, area, reversed, shift);
    if passes < 2.0 || once.is_empty() {
        return once;
    }
    // Sewn again: back over the same needle points, the satin without its underlay.
    let again = if auto_under(s) == LineUnder::Off {
        once.clone()
    } else {
        let mut bare = s.clone();
        bare.under = Some(LineUnder::Off);
        sew_once(line, closed, &bare, start, area, reversed, shift)
    };
    let pass: Vec<Pt> = again.iter().flat_map(|r| r.pts.iter().copied()).collect();
    let back: Vec<Pt> = if closed {
        pass.clone()
    } else {
        pass.iter().rev().copied().collect()
    };
    let mut out: Vec<Run> = once.into_iter().map(|r| Run::new(r.pts)).collect();
    let last = out.len() - 1;
    let mut k = 1.0;
    while k < passes {
        let src = if k % 2.0 != 0.0 { &back } else { &pass };
        out[last].pts.extend_from_slice(src.get(1..).unwrap_or(&[]));
        k += 1.0;
    }
    out
}

fn one(run: Vec<Pt>) -> Vec<Run> {
    if run.len() > 1 {
        vec![Run::new(run)]
    } else {
        vec![]
    }
}

/// The stitches along `line` sewn once (see sewOnce in along.ts).
fn sew_once(
    line: &[Pt],
    closed: bool,
    s: &PathStitch,
    start: Option<Pt>,
    area: Option<&Region>,
    reversed: bool,
    shift: f64,
) -> Vec<Run> {
    if line.len() < 2 {
        return vec![];
    }
    let mut l: Vec<Pt> = line.to_vec();
    let mut back = reversed;
    if let Some(st) = start {
        if closed {
            l = order_loops(&[line.to_vec()], st).swap_remove(0);
        } else {
            let d = |q: Pt| hypot(q[0] - st[0], q[1] - st[1]);
            if d(line[line.len() - 1]) < d(line[0]) {
                l.reverse();
                back = !back;
            }
        }
    }
    if is_run_type(s.kind) {
        let times = times_of(s);
        return one(border_run(
            &l,
            times as u32,
            s.tol(),
            s.length.unwrap_or(BORDER_STITCH),
        ));
    }
    if s.kind == BorderType::Motif {
        // Like the prongs of an E stitch: on a border inward (outward with flip), on a line to its right.
        let right = match area {
            Some(r) => right_inside(r, &l) != s.flip,
            None => back == s.flip,
        };
        let pts = motif_stitches(
            &l,
            closed,
            s.motif.unwrap_or(LineMotif::Waves),
            s.width,
            spacing_of(s),
            if right { 1.0 } else { -1.0 },
            shift,
            s.stitch.unwrap_or(MOTIF_STITCH),
            layers_of(s),
            is_cord(s),
        );
        return one(repeated(pts, times_of(s)));
    }
    if let (Some(r), true) = (area, closed) {
        let band = rails_of(border_rails(r, &l, s.width, s.offset.unwrap_or(0.0)));
        return satin_runs(&[on_edge(r, band, s)], &satin_of(s, false, false), None);
    }
    // Its own order set by hand: on the line as drawn, from the end it was set to start at.
    if let (BorderType::Satin, Some(own), None) = (s.kind, &s.own, area) {
        let rails = with_order(line_rails_of(line, closed, s), Some(own));
        return satin_runs(&[rails], &satin_of(s, true, own.turned), None);
    }
    let rails = line_rails_of(&l, closed, s);
    let lead = if shift > 0.0 && s.kind != BorderType::Satin {
        shift * spacing_of(s)
    } else {
        0.0
    };
    let mut settings = satin_of(s, true, back);
    if yes(Some(lead)) {
        settings.lead = Some(lead);
    }
    // Prongs of an E stitch on the right of the drawn line (the left rail is on the right on screen, y down).
    let band = if s.kind == BorderType::E {
        e_rails(rails, back == s.flip)
    } else {
        rails
    };
    satin_runs(&[band], &settings, None)
}

/// Cut edges lie this far inside the whole shape at least before they lose their border (mm).
pub const CUT_EDGE: f64 = 0.3;

/// The lines a border on the edge of `r` (or `offset` from it) lies on, without the edges that
/// shapes on top cut (with `whole`, the area before they were left out).
pub fn border_lines(r: &Region, offset: f64, whole: Option<&Region>) -> Vec<KeptLine> {
    let loops = border_loops(r, offset);
    match whole {
        Some(w) => loops
            .iter()
            .flat_map(|l| kept_lines(l, |q| at(w, q) >= offset - CUT_EDGE))
            .collect(),
        None => loops
            .into_iter()
            .map(|line| KeptLine { line, closed: true })
            .collect(),
    }
}

/// The stitches of a border on the edge of `r` (or `s.offset` from it), loop by loop, starting
/// near `from`. With `whole`, edges that shapes on top cut get none.
pub fn border_stitches(r: &Region, s: &PathStitch, from: Pt, whole: Option<&Region>) -> Vec<Run> {
    let off = s.offset.unwrap_or(0.0);
    let loops = order_loops(&border_loops(r, off), from);
    let keep = |q: Pt| whole.is_none_or(|w| at(w, q) >= off - CUT_EDGE);
    if is_run_type(s.kind) || s.kind == BorderType::Motif {
        if whole.is_none() {
            return loops
                .iter()
                .flat_map(|l| sew_along(l, true, s, None, Some(r), false, 0.0))
                .collect();
        }
        let mut out = vec![];
        let mut at_pt = from;
        for l in &loops {
            for k in kept_lines(l, keep) {
                let runs = sew_along(
                    &k.line,
                    k.closed,
                    s,
                    if k.closed { None } else { Some(at_pt) },
                    Some(r),
                    false,
                    0.0,
                );
                if let Some(q) = runs.last().and_then(Run::last) {
                    at_pt = q;
                }
                out.extend(runs);
            }
        }
        return out;
    }
    // One satin (zigzag, E stitch) over all loops: its underlay first, then the satin.
    let bands: Vec<Rails> = loops
        .iter()
        .flat_map(|l| {
            if whole.is_some() {
                kept_rails(r, l, s.width, off, keep)
            } else {
                vec![border_rails(r, l, s.width, off)]
            }
        })
        .map(|b| on_edge(r, rails_of(b), s))
        .collect();
    if !(s.kind == BorderType::Satin && yes(s.fringe)) {
        return satin_runs(&bands, &satin_of(s, false, false), None);
    }
    // Frayed: every band with its left rail inside, so the fringe is on the side asked for.
    let inward: Vec<Rails> = bands
        .into_iter()
        .map(|b| {
            if left_inside(r, &b) {
                b
            } else {
                Rails {
                    left: b.right,
                    right: b.left,
                    ..b
                }
            }
        })
        .collect();
    let mut settings = satin_of(s, false, false);
    settings.fringe = s.fringe;
    if let Some(f) = s.fringe_side {
        settings.fringe_side = Some(f.other());
    }
    satin_runs(&inward, &settings, None)
}

/// Where the needle is after `runs`, or `or`.
fn end_or(runs: &[Run], or: Pt) -> Pt {
    runs.last().and_then(Run::last).unwrap_or(or)
}

/// The stitches of a fill's border along the open paths of its form, each from the end nearest
/// the needle, starting near `from`; left out where shapes on top cover the fill.
pub fn open_stitches(
    open: &Form,
    s: &PathStitch,
    from: Pt,
    r: &Region,
    whole: Option<&Region>,
) -> Vec<Run> {
    // An open path has no inside or outside: frayed on both sides.
    let mut st = s.clone();
    st.offset = None;
    st.fringe_side = None;
    let covered = |q: Pt| whole.is_some_and(|w| at(w, q) < 0.0 && at(r, q) > CUT_EDGE);
    let mut todo: Vec<Vec<Pt>> = open
        .paths
        .iter()
        .filter(|p| !p.closed)
        .flat_map(|p| {
            let pts = flatten(p, 0.1);
            if pts.len() < 2 {
                vec![]
            } else if whole.is_some() {
                kept_open(&pts, |q| !covered(q))
            } else {
                vec![pts]
            }
        })
        .collect();
    let mut out = vec![];
    let mut at_pt = from;
    while !todo.is_empty() {
        // The nearest end next.
        let (mut best, mut flip, mut best_d) = (0, false, f64::INFINITY);
        for (k, l) in todo.iter().enumerate() {
            let a = hypot(l[0][0] - at_pt[0], l[0][1] - at_pt[1]);
            let e = l[l.len() - 1];
            let b = hypot(e[0] - at_pt[0], e[1] - at_pt[1]);
            if a < best_d {
                (best_d, best, flip) = (a, k, false);
            }
            if b < best_d {
                (best_d, best, flip) = (b, k, true);
            }
        }
        let mut line = todo.remove(best);
        if flip {
            line.reverse();
        }
        let runs = sew_along(&line, false, &st, Some(at_pt), None, false, 0.0);
        at_pt = end_or(&runs, at_pt);
        out.extend(runs);
    }
    out
}

/// An edge counts as lying on another part up to this far outside it (mm).
const SEAM_NEAR: f64 = 0.15;

/// The lines along the cuts between the parts of a fill cut apart (in sewing order).
pub fn seam_lines(parts: &[&Region], area: &Region) -> Vec<Vec<Pt>> {
    let mut out = vec![];
    for k in 1..parts.len() {
        let before = &parts[..k];
        let keep = |q: Pt| at(area, q) < -CUT_EDGE && before.iter().any(|r| at(r, q) < SEAM_NEAR);
        for l in border_loops(parts[k], 0.0) {
            for k2 in kept_lines(&l, keep) {
                if !k2.closed && k2.line.len() > 1 {
                    out.push(k2.line);
                }
            }
        }
    }
    out
}

/// The stitches along the cuts between parts, each line from its end nearest the last stitch.
pub fn seam_stitches(parts: &[&Region], area: &Region, s: &PathStitch, from: Pt) -> Vec<Run> {
    let mut out = vec![];
    let mut at_pt = from;
    for line in ordered_lines(seam_lines(parts, area), from) {
        let runs = sew_along(&line, false, s, Some(at_pt), None, false, 0.0);
        at_pt = end_or(&runs, at_pt);
        out.extend(runs);
    }
    out
}

/// Open lines, each next the one with an end nearest where the one before ended.
fn ordered_lines(mut left: Vec<Vec<Pt>>, from: Pt) -> Vec<Vec<Pt>> {
    let mut out = vec![];
    let mut at_pt = from;
    while !left.is_empty() {
        let d = |q: Pt| hypot(q[0] - at_pt[0], q[1] - at_pt[1]);
        let near = |l: &Vec<Pt>| {
            let (a, b) = (d(l[0]), d(l[l.len() - 1]));
            if a.is_nan() || b.is_nan() {
                f64::NAN
            } else {
                a.min(b)
            }
        };
        let mut best = 0;
        for i in 1..left.len() {
            if near(&left[i]) < near(&left[best]) {
                best = i;
            }
        }
        let mut l = left.remove(best);
        if d(l[l.len() - 1]) < d(l[0]) {
            l.reverse();
        }
        at_pt = l[l.len() - 1];
        out.push(l);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(a: Pt, b: Pt, n: usize) -> Vec<Pt> {
        (0..=n)
            .map(|i| {
                let t = i as f64 / n as f64;
                [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
            })
            .collect()
    }

    #[test]
    fn a_run_goes_from_the_nearer_end() {
        let s = PathStitch::run(2.5);
        let runs = sew_along(
            &line([0.0, 0.0], [20.0, 0.0], 4),
            false,
            &s,
            Some([21.0, 0.0]),
            None,
            false,
            0.0,
        );
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].pts[0], [20.0, 0.0]);
        assert_eq!(*runs[0].pts.last().unwrap(), [0.0, 0.0]);
    }

    #[test]
    fn passes_go_there_and_back() {
        let mut s = PathStitch::run(2.5);
        s.repeat = Some(3.0);
        let once = sew_along(
            &line([0.0, 0.0], [20.0, 0.0], 4),
            false,
            &PathStitch::run(2.5),
            None,
            None,
            false,
            0.0,
        );
        let three = sew_along(
            &line([0.0, 0.0], [20.0, 0.0], 4),
            false,
            &s,
            None,
            None,
            false,
            0.0,
        );
        assert_eq!(three[0].len(), 3 * once[0].len() - 2);
        assert_eq!(*three[0].pts.last().unwrap(), [20.0, 0.0]);
    }

    #[test]
    fn a_satin_line_has_its_underlay_first() {
        let mut s = PathStitch::run(2.5);
        s.kind = BorderType::Satin;
        s.width = 3.0;
        let runs = sew_along(
            &line([0.0, 0.0], [20.0, 0.0], 4),
            false,
            &s,
            None,
            None,
            false,
            0.0,
        );
        assert_eq!(runs.len(), 1);
        assert!(runs[0].len() > 50);
    }
}
