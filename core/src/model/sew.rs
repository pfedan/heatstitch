//! One object sewn from what it is (sewOne in src/model/sew.ts): its shape and how it is stitched
//! give its runs and how many points of them are underlay. Which spec an object has, the caches of
//! what was sewn and the design sewn in order stay TypeScript.

use super::along::{self, PathStitch};
use super::applique::{self, AppliqueSettings};
use super::covers::Cover;
use super::fill::{FillSettings, FillWay, fill_runs};
use super::line;
use super::restitch::{self, Rails, SatinSettings};
use super::runs::Run;
use crate::digitize::region::{Region, expand_region};
use crate::geom::Pt;
use crate::shape::path::Form;

/// How far travel along an old thread may reach beyond the edge where the rows end (mm).
pub const TRAVEL_REACH: f64 = 0.5;

/// What an object is sewn from: its shape and how it is stitched (Spec in sew.ts). The whole area
/// an area was cut from by shapes on top (knockout) is looked up by the TypeScript and given.
pub enum Spec<'a> {
    Line {
        path: &'a Form,
        line: &'a PathStitch,
    },
    Fill {
        area: &'a Region,
        fill: &'a FillSettings,
        /// The whole area as the object remembers it (wholeOf(area, memory)): travel may run there.
        whole_kept: Option<&'a Region>,
        /// The whole area the area was cut from in this session (wholeOf(area)).
        whole: Option<&'a Region>,
    },
    Satin {
        columns: &'a [Vec<Rails>],
        satin: &'a SatinSettings,
    },
    Border {
        area: &'a Region,
        border: &'a PathStitch,
        whole: Option<&'a Region>,
        open: Option<&'a Form>,
    },
    Applique {
        area: &'a Region,
        applique: &'a AppliqueSettings,
        shared: Option<&'a Region>,
    },
}

/// Where an object is sewn from and to (Way in sew.ts).
pub struct Way<'a> {
    pub from: Pt,
    pub to: Option<Pt>,
    pub covers: &'a [Cover],
}

/// The runs of an object sewn from `spec` along `way` (none shorter than two points), and how many
/// of their points are underlay; None when nothing is sewn.
pub fn sew_one(spec: &Spec, way: &Way) -> Option<(Vec<Run>, usize)> {
    let ok = |runs: Vec<Run>, under: usize| {
        let out: Vec<Run> = runs.into_iter().filter(|r| r.len() > 1).collect();
        (!out.is_empty()).then_some((out, under))
    };
    match *spec {
        Spec::Line { path, line } => ok(line::line_stitches(path, line, false, None), 0),
        Spec::Satin { columns, satin } => ok(
            columns
                .iter()
                .flat_map(|rails| restitch::satin_runs(rails, satin, None))
                .collect(),
            0,
        ),
        Spec::Applique {
            area,
            applique,
            shared,
        } => {
            let (runs, under) = applique::applique_runs(area, applique, way.from, shared);
            ok(runs, under)
        }
        Spec::Border {
            area,
            border,
            whole,
            open,
        } => {
            let mut runs = along::border_stitches(area, border, way.from, whole);
            if let Some(open) = open {
                let end = runs
                    .last()
                    .and_then(|r| r.pts.last().copied())
                    .unwrap_or(way.from);
                runs.extend(along::open_stitches(open, border, end, area, whole));
            }
            ok(runs, 0)
        }
        Spec::Fill {
            area,
            fill,
            whole_kept,
            whole,
        } => {
            // Travel may run where it is hidden: across the whole area where shapes on top left
            // parts out (knockout), and a little beyond the edge where the rows end (as far as
            // travel along an old thread may, TRAVEL_REACH).
            let travel = expand_region(whole_kept.unwrap_or(area), TRAVEL_REACH);
            let f = fill_runs(
                area,
                fill,
                &FillWay {
                    start: way.from,
                    end: way.to,
                    travel: travel.as_ref(),
                    covers: way.covers,
                    rows: None,
                    zigzag: None,
                    whole,
                },
            )?;
            ok(f.runs, f.under)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digitize::region::tests::region_of;
    use crate::model::fill::FillPattern;
    use crate::model::fill::tests::settings;

    #[test]
    fn sews_a_fill_and_its_border() {
        let area = region_of(200, 0.1, |x, y| (x - 10.0).hypot(y - 10.0) < 8.0);
        let fill = settings(FillPattern::Tatami);
        let way = Way {
            from: [2.0, 10.0],
            to: Some([18.0, 10.0]),
            covers: &[],
        };
        let (runs, under) = sew_one(
            &Spec::Fill {
                area: &area,
                fill: &fill,
                whole_kept: None,
                whole: None,
            },
            &way,
        )
        .unwrap();
        assert!(under > 0 && runs.iter().all(|r| r.len() > 1));
        // It starts near where the thread is.
        assert!(
            crate::js::dist(runs[0].pts[0], way.from) < 3.0,
            "{:?}",
            runs[0].pts[0]
        );
        let border = PathStitch::run(2.5);
        let (runs, under) = sew_one(
            &Spec::Border {
                area: &area,
                border: &border,
                whole: None,
                open: None,
            },
            &way,
        )
        .unwrap();
        assert_eq!(under, 0);
        assert_eq!(runs.len(), 1);
        // Nothing to sew: none.
        let empty: Vec<Vec<Rails>> = vec![];
        let satin = SatinSettings::default();
        assert!(
            sew_one(
                &Spec::Satin {
                    columns: &empty,
                    satin: &satin
                },
                &way
            )
            .is_none()
        );
    }
}
