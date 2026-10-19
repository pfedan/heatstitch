//! The runs of an appliqué (appliqueRuns in src/model/applique.ts): placement line, tack-down and
//! cover edge along the outline, the machine stopping before the tack-down and before the cover.
//! Its settings as stored, the stops in a design and the cut lines stay TypeScript.

use serde::{Deserialize, Serialize};

use super::along::{BorderType, PathStitch, border_stitches};
use super::runs::Run;
use crate::digitize::region::Region;
use crate::geom::Pt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppliqueEdge {
    Satin,
    E,
    None,
}

/// AppliqueSettings of applique.ts, what sewing needs of them (not the fabric or its color).
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliqueSettings {
    #[serde(default)]
    pub place: Option<bool>,
    #[serde(default)]
    pub place_in: Option<f64>,
    #[serde(default)]
    pub tack_in: Option<f64>,
    #[serde(default)]
    pub tack: Option<PathStitch>,
    pub edge: AppliqueEdge,
    pub width: f64,
}

/// Stitch length of the placement line (mm).
pub const PLACE_STITCH: f64 = 2.5;
/// Stitch length of the tack-down (mm).
pub const TACK_STITCH: f64 = 2.0;
/// How far the tack-down of a raw edge lies inside the cut edge (mm).
pub const RAW_INSET: f64 = 1.5;

/// How far the tack-down lies inside the outline (mm): as set, else as the edge asks.
pub fn tack_inset(s: &AppliqueSettings) -> f64 {
    s.tack_in.unwrap_or(if s.edge == AppliqueEdge::None {
        RAW_INSET
    } else {
        let v = s.width * 0.3;
        if v.is_nan() { v } else { v.clamp(0.5, 1.0) }
    })
}

/// How far the placement line lies inside the outline (mm): as set, else on it.
pub fn place_inset(s: &AppliqueSettings) -> f64 {
    s.place_in.unwrap_or(0.0)
}

/// The running stitch of the tack-down, as sewn.
pub fn tack_of(s: &AppliqueSettings) -> PathStitch {
    let mut out = PathStitch::run(TACK_STITCH);
    if let Some(r) = &s.tack {
        if r.kind == BorderType::Triple {
            out.kind = BorderType::Triple;
        }
        out.length = Some(r.length.unwrap_or(TACK_STITCH));
        out.repeat = r.repeat.filter(|&v| v != 0.0 && !v.is_nan());
    }
    out
}

/// A number as a condition tests it: not 0 and not NaN.
fn yes(v: f64) -> bool {
    v != 0.0 && !v.is_nan()
}

fn end_of(runs: &[Run], or: Pt) -> Pt {
    runs.last().and_then(Run::last).unwrap_or(or)
}

fn with_offset(mut s: PathStitch, offset: f64) -> PathStitch {
    s.offset = Some(offset);
    s
}

/// The stitches of the parts of an appliqué on `area`; a part it is sewn without has none.
/// `shared`: where later appliqués cover the edge, the area the cover leaves out its edge on.
pub fn applique_parts(
    area: &Region,
    s: &AppliqueSettings,
    from: Pt,
    shared: Option<&Region>,
) -> [Vec<Run>; 3] {
    let line = PathStitch::run(PLACE_STITCH);
    let no_place = s.place == Some(false);
    // A shape too thin for the placement line as far inside: it is sewn on the outline.
    let inside = if no_place || !yes(place_inset(s)) {
        vec![]
    } else {
        border_stitches(
            area,
            &with_offset(line.clone(), -place_inset(s)),
            from,
            None,
        )
    };
    let place = if no_place {
        vec![]
    } else if !inside.is_empty() {
        inside
    } else {
        border_stitches(area, &line, from, None)
    };
    let run = tack_of(s);
    let tack = if yes(tack_inset(s)) {
        border_stitches(
            area,
            &with_offset(run.clone(), -tack_inset(s)),
            end_of(&place, from),
            None,
        )
    } else {
        vec![]
    };
    // A shape too thin for the tack-down inside: it is sewn on the outline, over the placement line.
    let held = if !tack.is_empty() {
        tack
    } else {
        border_stitches(area, &run, end_of(&place, from), None)
    };
    if s.edge == AppliqueEdge::None {
        return [place, held, vec![]];
    }
    let mut edge = PathStitch::run(0.0);
    edge.length = None;
    edge.kind = if s.edge == AppliqueEdge::E {
        BorderType::E
    } else {
        BorderType::Satin
    };
    edge.width = s.width;
    // Where later appliqués lie on its edge their cover is its, but never on all of it.
    let part = match shared {
        Some(sh) => border_stitches(sh, &edge, end_of(&held, from), Some(area)),
        None => vec![],
    };
    let cover = if !part.is_empty() {
        part
    } else {
        border_stitches(area, &edge, end_of(&held, from), None)
    };
    [place, held, cover]
}

/// The runs of an appliqué in sewing order, the machine stopping before the tack-down (after a
/// placement line) and before the cover; and how many points lie under the fabric.
pub fn applique_runs(
    area: &Region,
    s: &AppliqueSettings,
    from: Pt,
    shared: Option<&Region>,
) -> (Vec<Run>, usize) {
    let [place, mut tack, mut cover] = applique_parts(area, s, from, shared);
    if (s.place != Some(false) && place.is_empty())
        || tack.is_empty()
        || (s.edge != AppliqueEdge::None && cover.is_empty())
    {
        return (vec![], 0);
    }
    if !place.is_empty() {
        tack[0].stop = true;
    }
    if let Some(c) = cover.first_mut() {
        c.stop = true;
    }
    // Placement line and tack-down lie under the fabric and its edge, as an underlay does.
    let under = place
        .iter()
        .chain(&tack)
        .map(|r| if r.len() > 1 { r.len() } else { 0 })
        .sum();
    let mut runs = place;
    runs.extend(tack);
    runs.extend(cover);
    (runs, under)
}
