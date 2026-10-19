//! Stitches for a lettering (src/lettering/sew.ts): every letter's elements as the font digitized
//! them, sewn at the height asked for. Satin is sewn anew along its rails and rungs (so its density
//! stays right at any size), running stitch along its path, fills in their outline.

use std::f64::consts::PI;

use super::font::{Font, GlyphEl, SatinP};
use super::layout::{Layout, Lettering, layout};
use super::overlap::{Cover, fill_cover, leave_out_covered, satin_cover};
use crate::digitize::fill::{FillParams, fill_region};
use crate::digitize::region::expand_region;
use crate::digitize::run::{TOLERANCE, run_stitch};
use crate::digitize::satin::{UnderlayKind, underlay_of};
use crate::geom::Pt;
use crate::js::{dist, hypot, math_max, round};
use crate::material::rules::{LOCK_MM, SATIN_SPLIT_MM, SATIN_UNDER_MIN};
use crate::model::restitch::{
    Rails, SatinSettings, SatinType, column_of, reversed_rails, satin_runs, swapped_sides,
};
use crate::pattern::{JUMP, STITCH, TRIM};
use crate::shape::path::{Form, Mat, Node, Path, apply};
use crate::shape::rasterize::rasterize;

/// One continuous run of stitches and where in the text it belongs.
#[derive(Clone, Debug, PartialEq)]
pub struct LetterRun {
    pub pts: Vec<Pt>,
    pub word: usize,
    pub line: usize,
    /// Index of its letter in the layout.
    pub letter: usize,
    /// Satin or fill: it leaves out what lies under later letters (running stitch stays whole).
    pub leaves: bool,
}

fn pairs(a: &[f64]) -> Vec<Pt> {
    a.chunks_exact(2).map(|c| [c[0], c[1]]).collect()
}

/// Underlay for a satin column of `width` (mm): the font's, less where the column is too narrow
/// for it (see SATIN_UNDER_MIN).
fn underlay_for(kind: &str, width: f64) -> Option<UnderlayKind> {
    if kind == "none" || width < SATIN_UNDER_MIN {
        return None;
    }
    // Up to 2 mm a walk along the middle is all that fits (Ink/Stitch: center walk 1 to 2 mm).
    if width < 2.0 && matches!(kind, "zigzag" | "both" | "contour") {
        return Some(UnderlayKind::Center);
    }
    Some(match kind {
        "center" => UnderlayKind::Center,
        "contour" => UnderlayKind::Contour,
        "zigzag" => UnderlayKind::Zigzag,
        "both" => UnderlayKind::Both,
        _ => UnderlayKind::Auto,
    })
}

/// What an element covers, worked out when asked (only where letters meet).
enum Lazy {
    None,
    Satin(Rails),
    Fill(crate::digitize::region::Region),
}

/// The runs of one element in the design (mm), and what it covers.
struct Sewing {
    runs: Vec<Vec<Pt>>,
    leaves: bool,
    cover: Lazy,
    line: usize,
    word: usize,
    /// Index of its letter in the layout.
    at: usize,
}

impl Lazy {
    fn some(&self) -> bool {
        !matches!(self, Lazy::None)
    }
    fn make(&self) -> Option<Cover> {
        match self {
            Lazy::None => None,
            Lazy::Satin(r) => satin_cover(r),
            Lazy::Fill(r) => Some(fill_cover(r.clone())),
        }
    }
}

fn satin_settings(p: &SatinP, density: f64) -> SatinSettings {
    SatinSettings {
        spacing: math_max([0.15, p.sp * density]),
        edge: p.pc,
        edge_share: p.ps,
        edge_b: p.pcb,
        edge_share_b: p.psb,
        short: true,
        underlay: false,
        tolerance: TOLERANCE,
        split: Some(match p.sl {
            Some(sl) if sl > 0.0 => sl.max(3.0),
            _ => SATIN_SPLIT_MM,
        }),
        kind: Some(if p.e.is_some_and(|e| e != 0.0 && !e.is_nan()) {
            SatinType::E
        } else {
            SatinType::Satin
        }),
        ..Default::default()
    }
}

fn sew_element(
    e: &GlyphEl,
    m: &Mat,
    scale: f64,
    turn: f64,
    l: &Lettering,
    back: bool,
) -> (Vec<Vec<Pt>>, bool, Lazy) {
    let tf = |pts: Vec<Pt>| -> Vec<Pt> { pts.into_iter().map(|q| apply(m, q)).collect() };
    match e {
        GlyphEl::Satin { l: left, r, g, p } => {
            let mut rails = Rails {
                left: tf(pairs(left)),
                right: tf(pairs(r)),
                rungs: Some(
                    pairs(g)
                        .into_iter()
                        .map(|[a, b]| [a * scale, b * scale])
                        .collect(),
                ),
                ..Default::default()
            };
            if back {
                rails = reversed_rails(&rails);
            }
            let width = column_of(&rails).width;
            let under = underlay_for(&p.u, width);
            let given = satin_settings(p, l.density);
            // Walked the other way, the rails swap, and so does what each side is given.
            let s = if back { swapped_sides(&given) } else { given };
            let top: Vec<Vec<Pt>> = satin_runs(std::slice::from_ref(&rails), &s, None)
                .into_iter()
                .map(|r| r.pts)
                .filter(|r| r.len() > 1)
                .collect();
            let cover = if !top.is_empty() && s.kind != Some(SatinType::E) {
                Lazy::Satin(rails.clone())
            } else {
                Lazy::None
            };
            let Some(under) = under.filter(|_| !top.is_empty() && l.underlay) else {
                return (top, true, cover);
            };
            // As the font is digitized: the underlay comes back to the start, the satin ends at the
            // end of its column, where the font goes on (its next element starts there).
            let col = column_of(&rails);
            let u = underlay_of(&col, under, TOLERANCE, None, false, false);
            let home = if u.at_end {
                let rev: Vec<Pt> = col.center.iter().rev().copied().collect();
                run_stitch(&rev, 2.0, TOLERANCE)
            } else {
                vec![]
            };
            let mut first = u.pts;
            first.extend(home);
            first.extend_from_slice(&top[0]);
            let mut runs = vec![first];
            runs.extend(top.into_iter().skip(1));
            (runs, true, cover)
        }
        GlyphEl::Run { d, p } => {
            let mut path = tf(pairs(d));
            if back {
                path.reverse();
            }
            if path.len() < 2 {
                return (vec![], false, Lazy::None);
            }
            let manual = p.m.is_some_and(|v| v != 0.0 && !v.is_nan());
            let pts = if manual {
                path
            } else {
                run_stitch(&path, math_max([0.5, p.len]), TOLERANCE)
            };
            if !p.tr.is_some_and(|v| v != 0.0 && !v.is_nan()) {
                return (vec![pts], false, Lazy::None);
            }
            let mut out = vec![pts[0]];
            for i in 1..pts.len() {
                out.extend([pts[i], pts[i - 1], pts[i]]);
            }
            (vec![out], false, Lazy::None)
        }
        GlyphEl::Fill { d, p } => {
            let form = Form {
                paths: d
                    .iter()
                    .map(|lp| Path {
                        closed: true,
                        nodes: pairs(lp)
                            .into_iter()
                            .map(|q| {
                                let p = apply(m, q);
                                Node {
                                    p,
                                    a: p,
                                    b: p,
                                    smooth: false,
                                }
                            })
                            .collect(),
                    })
                    .collect(),
                ..Default::default()
            };
            let Some(r) =
                rasterize(&form, 0.1).and_then(|r0| expand_region(&r0, p.ex.unwrap_or(0.0)))
            else {
                return (vec![], false, Lazy::None);
            };
            let Some(first) = form
                .paths
                .first()
                .and_then(|q| q.nodes.first())
                .map(|n| n.p)
            else {
                return (vec![], false, Lazy::None);
            };
            let params = FillParams {
                spacing: math_max([0.15, p.sp * l.density]),
                stitch: p.len,
                angle: Some((((p.a + turn) % 180.0) + 180.0) % 180.0),
                pull: 0.0,
                underlay: l.underlay && p.u != 0.0 && !p.u.is_nan(),
                offset: Some(p.o.unwrap_or(0.25)),
                tolerance: Some(TOLERANCE),
                ..Default::default()
            };
            let runs: Vec<Vec<Pt>> = fill_region(&r, &params, first, &[])
                .map(|res| res.runs.into_iter().filter(|run| run.len() > 1).collect())
                .unwrap_or_default();
            let cover = if runs.is_empty() {
                Lazy::None
            } else {
                Lazy::Fill(r)
            };
            (runs, true, cover)
        }
    }
}

type Box4 = [f64; 4];

/// Bounds of runs (mm), a little grown: a satin reaches beyond its stitches by its pull
/// compensation.
fn box_of(runs: &[Vec<Pt>]) -> Box4 {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for run in runs {
        for &[x, y] in run {
            b[0] = b[0].min(x - 0.5);
            b[1] = b[1].min(y - 0.5);
            b[2] = b[2].max(x + 0.5);
            b[3] = b[3].max(y + 0.5);
        }
    }
    b
}

fn meet(a: &Box4, b: &Box4) -> bool {
    a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}

/// Whether a stitch of one letter lies wholly under another letter of `line`.
fn run_into(line: &[Sewing]) -> bool {
    let boxes: Vec<Box4> = line.iter().map(|s| box_of(&s.runs)).collect();
    line.iter().enumerate().any(|(k, s)| {
        if !s.leaves {
            return false;
        }
        let on: Vec<Cover> = line
            .iter()
            .enumerate()
            .filter(|(j, x)| x.cover.some() && x.at != s.at && meet(&boxes[k], &boxes[*j]))
            .filter_map(|(_, x)| x.cover.make())
            .collect();
        let refs: Vec<&Cover> = on.iter().collect();
        !refs.is_empty()
            && s.runs
                .iter()
                .any(|run| leave_out_covered(run, &refs).is_some())
    })
}

/// Every run of the lettering in sewing order, and the layout with the lines that are sewn back
/// marked. Where a letter lies on one sewn before, that one leaves out the stitches it hides (see
/// overlap.rs), unless `all` asks for every stitch; running stitch stays whole.
pub fn lettering_runs(font: &Font, l: &Lettering, lay: &mut Layout, all: bool) -> Vec<LetterRun> {
    let mut lines: Vec<usize> = lay.letters.iter().map(|p| p.line).collect();
    lines.sort_unstable();
    lines.dedup();
    let sew_line = |lay: &Layout, letters: &[usize], back: bool| -> Vec<Sewing> {
        let mut out = vec![];
        let order: Vec<usize> = if back {
            letters.iter().rev().copied().collect()
        } else {
            letters.to_vec()
        };
        for i in order {
            let p = &lay.letters[i];
            let Some(key) = &p.key else { continue };
            let glyph = &font.glyphs[key];
            let scale = hypot(p.m[0], p.m[1]);
            let turn = (p.m[1].atan2(p.m[0]) * 180.0) / PI;
            let els: Vec<&GlyphEl> = if back {
                glyph.e.iter().rev().collect()
            } else {
                glyph.e.iter().collect()
            };
            for e in els {
                let (runs, leaves, cover) = sew_element(e, &p.m, scale, turn, l, back);
                out.push(Sewing {
                    runs,
                    leaves,
                    cover,
                    line: p.line,
                    word: p.word,
                    at: i,
                });
            }
        }
        out
    };
    let mut sewn: Vec<Sewing> = vec![];
    for li in lines {
        let letters: Vec<usize> = (0..lay.letters.len())
            .filter(|&i| lay.letters[i].line == li)
            .collect();
        let mut line = sew_line(lay, &letters, false);
        // A line whose letters run into each other is sewn in writing direction, each letter on
        // the one before it as written; else it may be sewn back (shorter ways).
        if letters.first().is_some_and(|&i| lay.letters[i].back) {
            if run_into(&line) {
                for &i in &letters {
                    lay.letters[i].back = false;
                }
            } else {
                line = sew_line(lay, &letters, true);
            }
        }
        sewn.extend(line);
    }
    let boxes: Vec<Box4> = sewn.iter().map(|s| box_of(&s.runs)).collect();
    let mut covers: Vec<Option<Option<Cover>>> = (0..sewn.len()).map(|_| None).collect();
    let mut out = vec![];
    for k in 0..sewn.len() {
        // What the other letters sewn after it cover, where they reach it.
        let mut on: Vec<usize> = vec![];
        if sewn[k].leaves && !all {
            for j in k + 1..sewn.len() {
                if !sewn[j].cover.some() || sewn[j].at == sewn[k].at || !meet(&boxes[k], &boxes[j])
                {
                    continue;
                }
                if covers[j].is_none() {
                    covers[j] = Some(sewn[j].cover.make());
                }
                if covers[j].as_ref().unwrap().is_some() {
                    on.push(j);
                }
            }
        }
        let refs: Vec<&Cover> = on
            .iter()
            .map(|&j| covers[j].as_ref().unwrap().as_ref().unwrap())
            .collect();
        let s = &sewn[k];
        for pts in &s.runs {
            out.push(LetterRun {
                pts: leave_out_covered(pts, &refs).unwrap_or_else(|| pts.clone()),
                word: s.word,
                line: s.line,
                letter: s.at,
                leaves: s.leaves,
            });
        }
    }
    out
}

/// Lock stitches along the start (or the end) of a run: the half-stitch lock (see LOCK_MM).
fn lock(run: &[Pt], at_end: bool) -> [Pt; 4] {
    let pts: Vec<Pt> = if at_end {
        run.iter().rev().copied().collect()
    } else {
        run.to_vec()
    };
    let along = |d: f64| -> Pt {
        let mut left = d;
        for i in 1..pts.len() {
            let s = dist(pts[i - 1], pts[i]);
            if s >= left {
                let t = left / s;
                return [
                    pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
                    pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
                ];
            }
            left -= s;
        }
        pts[pts.len() - 1]
    };
    [
        along(LOCK_MM / 2.0),
        along(LOCK_MM),
        along(LOCK_MM / 2.0),
        pts[0],
    ]
}

/// The records of a lettering: they start with a jump and end with a trim (no color change, no
/// end).
pub struct SewnLettering {
    pub x: Vec<i32>,
    pub y: Vec<i32>,
    pub cmd: Vec<u8>,
    /// Number of the first stitch of each piece between trims, from the first stitch.
    pub starts: Vec<u32>,
    /// Number of the first stitch of each letter, counted the same way.
    pub letters: Vec<u32>,
    pub stitches: u32,
    pub layout: Layout,
}

/// The records of a lettering. Inside a word, moves up to 1 mm are sewn, up to `trim_mm` jumped,
/// longer ones trimmed (a joined script stays one piece); between words and lines the thread is
/// always trimmed.
pub fn sew_lettering(font: &Font, l: &Lettering, trim_mm: f64) -> SewnLettering {
    let mut lay = layout(font, l);
    let runs = lettering_runs(font, l, &mut lay, false);
    let mut o = SewnLettering {
        x: vec![],
        y: vec![],
        cmd: vec![],
        starts: vec![],
        letters: vec![],
        stitches: 0,
        layout: Layout {
            letters: vec![],
            missing: vec![],
            scale: 0.0,
            min_x: 0.0,
            min_y: 0.0,
            max_x: 0.0,
            max_y: 0.0,
        },
    };
    let mut last: Option<Pt> = None;
    let put = |o: &mut SewnLettering, last: &mut Option<Pt>, q: Pt, cmd: u8| {
        o.x.push(round(q[0] * 10.0) as i32);
        o.y.push(round(q[1] * 10.0) as i32);
        o.cmd.push(cmd);
        if cmd == STITCH {
            o.stitches += 1;
        }
        *last = Some(q);
    };
    let stitch = |o: &mut SewnLettering, last: &mut Option<Pt>, q: Pt| {
        if last.is_some_and(|p| dist(p, q) < 0.1) {
            return;
        }
        put(o, last, q, STITCH);
    };
    let trim = |o: &mut SewnLettering| {
        let (x, y) = (*o.x.last().unwrap(), *o.y.last().unwrap());
        o.x.push(x);
        o.y.push(y);
        o.cmd.push(TRIM);
    };
    let mut prev: Option<&LetterRun> = None;
    for run in &runs {
        let start = run.pts[0];
        // A letter starts after the lock stitches that end the piece before it.
        let new_letter = prev.is_none_or(|p| p.letter != run.letter);
        let gap = prev.map_or(f64::INFINITY, |p| dist(p.pts[p.pts.len() - 1], start));
        let same_word = prev.is_some_and(|p| p.line == run.line && p.word == run.word);
        if prev.is_none() || !same_word || gap > trim_mm {
            if let Some(p) = prev {
                for q in lock(&p.pts, true) {
                    put(&mut o, &mut last, q, STITCH);
                }
                trim(&mut o);
            }
            if new_letter {
                o.letters.push(o.stitches);
            }
            put(&mut o, &mut last, start, JUMP);
            o.starts.push(o.stitches);
            put(&mut o, &mut last, start, STITCH);
            for q in lock(&run.pts, false) {
                put(&mut o, &mut last, q, STITCH);
            }
        } else if gap <= 1.0 {
            if new_letter {
                o.letters.push(o.stitches);
            }
            stitch(&mut o, &mut last, start);
        } else {
            if new_letter {
                o.letters.push(o.stitches);
            }
            put(&mut o, &mut last, start, JUMP);
            put(&mut o, &mut last, start, STITCH);
        }
        for &q in &run.pts[1..] {
            stitch(&mut o, &mut last, q);
        }
        prev = Some(run);
    }
    if let Some(p) = prev {
        for q in lock(&p.pts, true) {
            put(&mut o, &mut last, q, STITCH);
        }
        trim(&mut o);
    }
    o.layout = lay;
    o
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lettering::font::{FillP, Glyph, RunP};
    use std::collections::HashMap;

    /// A font of two letters: "I" a satin bar, "o" a filled square with a running stitch across.
    fn font() -> Font {
        let mut glyphs = HashMap::new();
        glyphs.insert(
            "I".to_string(),
            Glyph {
                a: 3.0,
                x0: 0.0,
                x1: 2.0,
                y0: -10.0,
                y1: 0.0,
                e: vec![GlyphEl::Satin {
                    l: vec![0.0, 0.0, 0.0, -10.0],
                    r: vec![2.0, 0.0, 2.0, -10.0],
                    g: vec![0.0, 0.0, 10.0, 10.0],
                    p: SatinP {
                        sp: 0.4,
                        pc: 0.1,
                        u: "center".into(),
                        ps: None,
                        pcb: None,
                        psb: None,
                        sl: None,
                        e: None,
                    },
                }],
            },
        );
        glyphs.insert(
            "o".to_string(),
            Glyph {
                a: 7.0,
                x0: 0.0,
                x1: 6.0,
                y0: -6.0,
                y1: 0.0,
                e: vec![
                    GlyphEl::Fill {
                        d: vec![vec![0.0, 0.0, 6.0, 0.0, 6.0, -6.0, 0.0, -6.0]],
                        p: FillP {
                            sp: 0.4,
                            len: 3.0,
                            a: 0.0,
                            u: 1.0,
                            o: None,
                            ex: None,
                        },
                    },
                    GlyphEl::Run {
                        d: vec![0.0, -3.0, 6.0, -3.0],
                        p: RunP {
                            len: 2.0,
                            tr: Some(1.0),
                            m: None,
                        },
                    },
                ],
            },
        );
        Font {
            id: "t".into(),
            cap: 10.0,
            lead: 14.0,
            space: 3.0,
            case: None,
            glyphs,
            kern: HashMap::new(),
            rev: true,
        }
    }

    fn lettering(text: &str) -> Lettering {
        Lettering {
            text: text.into(),
            height: 10.0,
            align: "left".into(),
            spacing: 0.0,
            word_spacing: 0.0,
            line_spacing: 1.0,
            shape: "line".into(),
            radius: 40.0,
            x: 0.0,
            y: 0.0,
            angle: 0.0,
            back: true,
            density: 1.0,
            underlay: true,
            letters: vec![],
        }
    }

    #[test]
    fn sews_letters_with_locks_and_trims() {
        let f = font();
        let s = sew_lettering(&f, &lettering("Io I\nxo"), 3.0);
        assert_eq!(s.cmd[0], JUMP);
        assert_eq!(*s.cmd.last().unwrap(), TRIM);
        // Two words on the first line and one on the second: three pieces at least.
        assert!(s.starts.len() >= 3);
        assert_eq!(s.layout.missing, vec!["x".to_string()]);
        // Four letters the font has.
        assert_eq!(s.letters.len(), 4);
        assert!(s.stitches > 100);
    }

    #[test]
    fn a_letter_on_another_leaves_out_what_it_hides() {
        let f = font();
        let mut l = lettering("oI");
        // The bar sewn over the middle of the square.
        l.spacing = -5.0;
        let mut lay = layout(&f, &l);
        let some = lettering_runs(&f, &l, &mut lay, false);
        let all = lettering_runs(&f, &l, &mut lay, true);
        let n = |rs: &[LetterRun]| rs.iter().map(|r| r.pts.len()).sum::<usize>();
        assert!(n(&some) < n(&all));
        // Every piece still starts and ends where it did.
        for (a, b) in some.iter().zip(&all) {
            assert_eq!(a.pts[0], b.pts[0]);
            assert_eq!(a.pts.last(), b.pts.last());
        }
    }
}
