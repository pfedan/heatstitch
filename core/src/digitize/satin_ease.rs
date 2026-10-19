//! Easing where a satin in sections piles up: a cut line through the densest spot, so each side is
//! a column of its own. Ported from src/digitize/satinEase.ts.

use std::f64::consts::PI;

use super::measure::peak_cell;
use super::region::{Region, sample};
use super::rungs::{Cut, Parts, cut_parts, cut_pieces, parts_of, strips_of_parts};
use super::satin_suggest::area_loops;
use crate::geom::{Pt, to_segment};
use crate::js::hypot;
use crate::model::restitch::{Rails, SatinSettings, chained, satin_runs};
use crate::shape::path::inside_poly;
use crate::trig::JsMath;

/// Satin denser than this many times its nominal density somewhere piles up (2 / spacing is a column's own).
pub const SATIN_PEAK: f64 = 2.4;
/// Cut lines added at most to ease where a satin in sections piles up (see ease_piles).
const EASE_MAX: usize = 3;
/// Directions a cut through a pile is tried in.
const EASE_DIRECTIONS: usize = 12;
/// Cells this near a cut line of the plan (mm) are where columns overlap on purpose.
const SEAM_MM: f64 = 0.9;
/// Columns this near the pile (mm) are sewn again to measure a cut through it.
const EASE_NEAR: f64 = 5.0;

/// Where columns meet at cut lines they overlap on purpose: those cells are not counted.
fn seam(cuts: &[Cut]) -> impl Fn(f64, f64) -> bool {
    let pieces: Vec<[Pt; 2]> = cuts.iter().flat_map(|c| cut_pieces(c)).collect();
    move |x, y| {
        pieces
            .iter()
            .any(|&[a, b]| to_segment([x, y], a, b) < SEAM_MM)
    }
}

/// Where a satin in sections piles up (its stitches fanning in round a hole beside a wide place,
/// say), a cut line straight through the densest spot: each side then a column of its own, with
/// stitches that run more alike. Of the cuts tried, in several directions through the spot and
/// beside it, the one that eases it most; again while the spot piles up beyond `limit` (density,
/// see peak_density; SATIN_PEAK times its own by default) and a cut helps. Cuts no longer than `max`
/// (mm). The cut lines added (none when nothing helps). `runs`: the satin as sewn from the plan,
/// when known.
pub fn ease_piles(
    area: &Region,
    plan_cuts: &[Cut],
    lines: &[[Pt; 2]],
    s: &SatinSettings,
    max: f64,
    limit: f64,
    runs: Option<Vec<Vec<Pt>>>,
) -> Vec<Cut> {
    let (outsides, holes) = area_loops(area);
    let material = |q: Pt| sample(area, &area.sdf_base, q[0], q[1]) < 0.0;
    // Each outline cut into parts by the cut lines so far, once per round (see parts_of): a cut
    // tried cuts one of those parts further and leaves the rest, and their columns, as they were.
    let parts_of_all = |cuts: &[Cut]| -> Vec<Parts> {
        outsides
            .iter()
            .map(|o| {
                let mine: Vec<Vec<Pt>> = holes
                    .iter()
                    .filter(|h| inside_poly(o, h[0]))
                    .cloned()
                    .collect();
                parts_of(o, cuts, &mine)
            })
            .collect()
    };
    let columns_of = |p: &Parts, chain: usize| -> Option<Vec<Rails>> {
        let made = strips_of_parts(p, lines);
        if made.bad >= 0 || made.hole >= 0 {
            return None;
        }
        Some(
            made.strips
                .into_iter()
                .map(|x| Rails {
                    rungs: Some(x.rungs),
                    chain: Some(chain as f64),
                    ..Rails::new(x.left, x.right)
                })
                .collect(),
        )
    };
    // The columns of the parts of this round, made once each.
    let mut cache: Vec<Option<Option<Vec<Rails>>>> = vec![];
    let sew = |base: &[Parts],
               cache: &mut Vec<Option<Option<Vec<Rails>>>>,
               cut: Option<&[Pt; 2]>,
               near: Option<Pt>|
     -> Option<Vec<Vec<Pt>>> {
        if cache.len() != base.len() {
            *cache = vec![None; base.len()];
        }
        let mut all: Vec<Rails> = vec![];
        for (a, p) in base.iter().enumerate() {
            let further = cut.and_then(|c| cut_parts(p, c));
            let own = match &further {
                Some(q) => columns_of(q, a),
                None => cache[a].get_or_insert_with(|| columns_of(p, a)).clone(),
            }?;
            let mut chain = own;
            if let Some(near) = near {
                // Near the spot, in the order the satin is sewn in (see sewSections): the measure it gets there.
                chain.retain(|c| {
                    c.left
                        .iter()
                        .chain(&c.right)
                        .any(|q| hypot(q[0] - near[0], q[1] - near[1]) < EASE_NEAR)
                });
                if chain.len() > 1 {
                    chain = chained(&chain, s);
                }
            }
            all.extend(chain);
        }
        Some(
            satin_runs(&all, s, None)
                .into_iter()
                .map(|r| r.pts)
                .collect(),
        )
    };
    let mut cuts: Vec<Cut> = plan_cuts.to_vec();
    let mut base = parts_of_all(&cuts);
    let all = match runs {
        Some(r) => r,
        None => match sew(&base, &mut cache, None, None) {
            Some(r) => r,
            None => return vec![],
        },
    };
    let (mut density, mut at) = peak_cell(&all, seam(&cuts));
    let mut n = 0;
    while n < EASE_MAX && density > limit {
        n += 1;
        // Measured the same way with and without a cut: only the columns near the spot.
        let Some(here) = sew(&base, &mut cache, None, Some(at)) else {
            break;
        };
        let now = peak_cell(&here, seam(&cuts)).0;
        let mut best: Option<(f64, Pt, [Pt; 2])> = None;
        for [dx, dy] in [[0.0, 0.0], [0.5, 0.0], [-0.5, 0.0], [0.0, 0.5], [0.0, -0.5]] {
            let c: Pt = [at[0] + dx, at[1] + dy];
            if !material(c) {
                continue;
            }
            for k in 0..EASE_DIRECTIONS {
                let a = (k as f64 * PI) / EASE_DIRECTIONS as f64;
                let u: Pt = [a.js_cos(), a.js_sin()];
                // From edge to edge through the spot, no longer than a satin stitch may be.
                let reach = |sign: f64| {
                    let mut t = 0.0;
                    while t <= max && material([c[0] + u[0] * sign * t, c[1] + u[1] * sign * t]) {
                        t += 0.05;
                    }
                    t
                };
                let ahead = reach(1.0);
                let back = reach(-1.0);
                if ahead + back > max {
                    continue;
                }
                let cut: [Pt; 2] = [
                    [c[0] - u[0] * (back + 0.3), c[1] - u[1] * (back + 0.3)],
                    [c[0] + u[0] * (ahead + 0.3), c[1] + u[1] * (ahead + 0.3)],
                ];
                let Some(near) = sew(&base, &mut cache, Some(&cut), Some(at)) else {
                    continue;
                };
                let mut with = cuts.clone();
                with.push(cut.to_vec());
                let (d, p) = peak_cell(&near, seam(&with));
                if best.is_none_or(|b| d < b.0) {
                    best = Some((d, p, cut));
                }
            }
        }
        let Some((d, p, cut)) = best else { break };
        if d >= now {
            break;
        }
        cuts.push(cut.to_vec());
        base = parts_of_all(&cuts);
        cache.clear();
        // Eased here; whether it piles up elsewhere now is for the satin's own check to tell.
        (density, at) = (d, p);
    }
    cuts.split_off(plan_cuts.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digitize::measure::peak_density;
    use crate::digitize::region::{Bbox, build_region};
    use crate::digitize::rungs::strips_of_areas;
    use crate::digitize::satin_suggest::{STROKE_MAX, suggest_satin};

    const PX: f64 = 0.1;
    const W: usize = 600;

    fn region(f: impl Fn(f64, f64) -> bool) -> Region {
        let mut comp = vec![-1i32; W * W];
        for y in 0..W {
            for x in 0..W {
                if f((x as f64 + 0.5) * PX, (y as f64 + 0.5) * PX) {
                    comp[y * W + x] = 0;
                }
            }
        }
        let bbox = Bbox {
            min_x: 0,
            min_y: 0,
            max_x: W as i32 - 1,
            max_y: W as i32 - 1,
        };
        build_region(&comp, &vec![0u8; W * W], W, 0, 0, bbox, W, PX, 0.0, |_| {
            false
        })
    }

    fn settings() -> SatinSettings {
        SatinSettings {
            spacing: 0.4,
            edge: 0.0,
            short: true,
            underlay: false,
            tolerance: 0.15,
            ..Default::default()
        }
    }

    fn sewn(r: &Region, cuts: &[Cut], lines: &[[Pt; 2]]) -> Option<Vec<Vec<Pt>>> {
        let (o, h) = area_loops(r);
        let made = strips_of_areas(&o, lines, cuts, &h);
        if made.bad.is_some() || made.hole >= 0 {
            return None;
        }
        let rails: Vec<Rails> = made
            .areas
            .into_iter()
            .enumerate()
            .flat_map(|(a, st)| {
                st.into_iter().map(move |x| Rails {
                    rungs: Some(x.rungs),
                    chain: Some(a as f64),
                    ..Rails::new(x.left, x.right)
                })
            })
            .collect();
        Some(
            satin_runs(&rails, &settings(), None)
                .into_iter()
                .map(|r| r.pts)
                .collect(),
        )
    }

    #[test]
    fn eases_a_pile_with_a_cut_through_it() {
        let poly = |p: Vec<Pt>| move |x: f64, y: f64| inside_poly(&p, [x, y]);
        let w1 = poly(vec![[16.0, 28.0], [30.0, 26.0], [34.0, 32.0], [16.0, 29.4]]);
        let w2 = poly(vec![[32.0, 30.0], [45.0, 34.0], [45.0, 35.2], [32.0, 31.4]]);
        let r = region(|x, y| {
            let d = hypot(x - 30.0, y - 24.0);
            (2.0..3.2).contains(&d) || w1(x, y) || w2(x, y)
        });
        let plan = suggest_satin(&r, None, STROKE_MAX, false, true)
            .unwrap()
            .unwrap();
        assert!(plan.ok);
        let cuts: Vec<Cut> = plan.cuts.iter().map(|c| c.to_vec()).collect();
        let s = settings();
        // Below its own limit: nothing to ease.
        assert!(
            ease_piles(
                &r,
                &cuts,
                &plan.lines,
                &s,
                7.0,
                SATIN_PEAK * 2.0 / s.spacing,
                None
            )
            .is_empty()
        );
        let before = peak_density(&sewn(&r, &cuts, &plan.lines).unwrap(), |_, _| false);
        let added = ease_piles(&r, &cuts, &plan.lines, &s, 7.0, before * 0.9, None);
        assert!(!added.is_empty());
        let mut all = cuts.clone();
        all.extend(added.iter().cloned());
        let after = sewn(&r, &all, &plan.lines).unwrap();
        assert!(peak_density(&after, |_, _| false) < before);
        for c in &added {
            assert!(hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) < 7.7);
        }
    }
}
