//! Fills along the outline, one spacing apart everywhere: the contour fill (ring in ring) and the
//! spiral, for any shape.
//!
//! The rings are the level lines of the area's distance field, the first half a spacing inside the
//! edge (moved out by `pull`), each next one a spacing further in, so neighbouring rings lie exactly
//! one spacing apart all round (as in the contour fill of other digitizers and the offset curves of
//! spiral pocket milling). Each ring knows the ring it lies in (its parent, one spacing further
//! out): a tree, which branches where the shape gets narrow (a dumbbell) and has more roots where it
//! has holes.
//!
//! The sewn line runs from ring to ring without a step: ring k is sewn shifted by φ(f) spacings
//! along the field's gradient, where f is the share of the ring's length from its start. When φ
//! goes from -1/2 at the start to +1/2 at the end, the end of ring k lies exactly where ring k+1
//! begins (its start is one spacing further in on the same gradient line), and neighbouring turns
//! stay one spacing apart everywhere, as both are shifted alike. With φ = f - 1/2 the line is a
//! spiral: the ring to ring interpolation of spiral pocket milling (Held and Spielberger, "A smooth
//! spiral tool path for high speed machining of 2D pockets", 2009), here exact in the distance field
//! rather than between resampled polygons. With φ = 0 except a short ramp at both ends it is the
//! contour fill, whose rings pass on to the next one over a few millimetres instead of in one step
//! with a needle point sewn twice.
//!
//! Along the ridge in the middle no full spacing may be left for another line: the last line there
//! moves so that the gap across the ridge and the gap to the line before come out equal, rather than
//! leaving a strip of fabric or two lines on top of each other.
//!
//! Where the tree branches, the line goes on into one branch; every other branch is a spiral of its
//! own, sewn before the line passes it and from its middle outwards, so the needle reaches it and
//! leaves it under rows still to come (like the connected spirals of Zhao et al., "Connected Fermat
//! Spirals for Layered Fabrication", 2016, but with single spirals and hidden travel).

use std::collections::HashSet;

use super::fill::{
    FillParams, FillResult, TRAVEL_STITCH, TRAVEL_TOLERANCE, note_travel, path_length, point_count,
    sew_underlay,
};
use super::region::{Region, outline, sample};
use super::run::{MIN_CURVE_STITCH, Path, TOLERANCE, run_stitch, simplify};
use super::travel_grid::TravelGrid;
use crate::geom::Pt;
use crate::js::{IdMap, dist, hypot};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RingMode {
    Spiral,
    Contour,
}

/// Rings shorter than this are left out (mm).
const MIN_RING: f64 = 1.0;
/// Ring points at most this far apart before they are shifted (mm).
const RESAMPLE: f64 = 0.3;
/// Length over which a contour ring passes on to the next one, at each end (mm).
const RAMP: f64 = 3.0;
/// Cells for finding rings near a point (mm).
const CELL: f64 = 0.2;
/// A ring whose two sides lie closer than this share of a spacing is left out (a sliver along a ridge).
const SLIVER: f64 = 0.25;
/// Probe beyond a ridge (mm), and the cosine between the gradients there below which the ridge is a fold.
const FOLD_PROBE: f64 = 0.3;
const FOLD_COS: f64 = -0.5;
/// Rings over which a spiral turns into rings beside its first ring and where branches leave.
const BLEND: f64 = 4.0;
/// Moves of the last line are evened out over this many ring points to each side.
const SMOOTH: isize = 3;
/// Needle points: the shortest stitch as a share of the longest that fits, how many lengths are
/// tried, and how far a needle point counts as near (mm).
const SHORTEST: f64 = 0.7;
const CANDIDATES: usize = 6;
const NEAR: f64 = 1.2;

struct Ring {
    pts: Vec<Pt>,
    /// Number of the ring from the edge, and its depth inside the area (mm).
    k: usize,
    depth: f64,
    kids: Vec<usize>,
    /// How far the ring lies inside the one around it (a spacing, less for a ring a quarter spacing further out).
    out: f64,
}

struct Way {
    pts: Vec<Pt>,
    d: Vec<f64>,
}

struct Spot {
    /// The point on the line, its depth, and the way on from it to the ridge or a spacing deeper.
    x: Pt,
    a: f64,
    w: Way,
    mv: f64,
}

struct Line {
    pts: Vec<Pt>,
    /// Where each turn begins (indices into pts).
    turns: Vec<usize>,
}

pub fn ring_fill(
    r: &Region,
    p: &FillParams,
    start: Pt,
    mode: RingMode,
    angle: f64,
) -> Option<FillResult> {
    let s = p.spacing;
    let mut field = Field::new(r, s);
    let (rings, roots) = ring_tree(r, &mut field, s, p.pull);
    if roots.is_empty() {
        return None;
    }
    let mut runs: Vec<Vec<Pt>> = Vec::new();
    let mut grid = TravelGrid::new(
        p.travel.as_ref().unwrap_or(r),
        p.off_row_ends == Some(true),
        None,
    );
    let mut pos = if p.underlay {
        sew_underlay(r, angle, p, start, &mut grid, &mut runs, None)
    } else {
        start
    };
    let under = point_count(&runs);

    // The lines in the order they are sewn, each reached by travel from the end of the one before.
    struct Sewing<'a> {
        field: &'a Field<'a>,
        rings: &'a [Ring],
        mode: RingMode,
        lines: Vec<Line>,
        at: Pt,
    }
    fn sew(st: &mut Sewing, ring: usize, inwards: bool) {
        let mut branches: Vec<usize> = Vec::new();
        let seam = nearest_on(&st.rings[ring].pts, st.at).pt;
        let mut line = chain(st.field, st.rings, ring, seam, st.mode, &mut branches);
        // Branches off the way first, each from its middle out to its edge.
        while !branches.is_empty() {
            let i = nearest_ring(st.rings, &branches, st.at);
            let b = branches.remove(i);
            sew(st, b, false);
        }
        if !inwards {
            line.pts.reverse();
            let n = line.pts.len();
            line.turns = line.turns.iter().map(|&i| n - 1 - i).rev().collect();
        }
        st.at = line.pts[line.pts.len() - 1];
        st.lines.push(line);
    }
    let mut st = Sewing {
        field: &field,
        rings: &rings,
        mode,
        lines: Vec::new(),
        at: pos,
    };
    let mut todo = roots.clone();
    while !todo.is_empty() {
        let i = nearest_ring(&rings, &todo, st.at);
        let ring = todo.remove(i);
        sew(&mut st, ring, true);
    }
    let lines = st.lines;

    let mut has_cur = !runs.is_empty();
    let mut trail: Vec<[usize; 2]> = Vec::new();
    let mut turn = 0usize;
    let mut needles = Needles::default();
    let tol = p.tolerance.unwrap_or(TOLERANCE);
    for line in &lines {
        let pts = stitches(line, p.stitch, tol, turn, &mut needles);
        turn += line.turns.len();
        if pts.len() < 2 {
            continue;
        }
        let bd = dist(pos, pts[0]);
        let mut travel: Option<Vec<Pt>> = None;
        if has_cur && bd > 1.0 {
            if let Some(path) = grid.path(pos, pts[0], true)
                && path_length(&path) < 2.0 * bd + 6.0
            {
                travel = Some(run_stitch(&path, TRAVEL_STITCH, TRAVEL_TOLERANCE));
            }
        } else if has_cur {
            travel = Some(vec![pos, pts[0]]);
        }
        match travel {
            Some(t) if has_cur => {
                if t.len() > 2 {
                    note_travel(&mut trail, &runs, t.len());
                }
                let cur = runs.last_mut().unwrap();
                cur.extend_from_slice(&t[1..]);
                cur.extend_from_slice(&pts[1..]);
            }
            _ => {
                runs.push(pts.clone());
                has_cur = true;
            }
        }
        for i in 1..line.pts.len() {
            grid.cover(line.pts[i - 1], line.pts[i], s / 2.0);
        }
        pos = pts[pts.len() - 1];
    }
    if runs.is_empty() {
        return None;
    }
    Some(FillResult {
        runs,
        angle,
        under,
        travel: trail,
        curved: false,
    })
}

fn cell_key(i: i64, j: i64) -> i64 {
    (i + 65536) * 131072 + (j + 65536)
}

/// Needle points sewn so far, to find the nearest one to a point (each with its number, so the
/// last few of a line can be left out).
#[derive(Default)]
struct Needles {
    cells: IdMap<i64, Vec<(Pt, usize)>>,
    count: usize,
}

impl Needles {
    fn add(&mut self, q: Pt) -> usize {
        let k = cell_key((q[0] / NEAR).floor() as i64, (q[1] / NEAR).floor() as i64);
        let id = self.count;
        self.count += 1;
        self.cells.entry(k).or_default().push((q, id));
        id
    }

    /// Distance from q to the nearest needle point (at most NEAR), leaving out those in `skip`.
    fn near(&self, q: Pt, skip: &[usize]) -> f64 {
        let i = (q[0] / NEAR).floor() as i64;
        let j = (q[1] / NEAR).floor() as i64;
        let mut best = NEAR;
        for di in -1..=1 {
            for dj in -1..=1 {
                if let Some(c) = self.cells.get(&cell_key(i + di, j + dj)) {
                    for &(p, id) in c {
                        if !skip.contains(&id) {
                            best = best.min(dist(p, q));
                        }
                    }
                }
            }
        }
        best
    }
}

/// Needle points along a line, at most `len` apart and shorter in curves (as a running stitch), and
/// one at each sharp corner. Each stitch ends at the best of a few lengths between SHORTEST and the
/// longest that fits: the one furthest from the needle points sewn before (Mitchell's best
/// candidate, a blue noise sampling). Needle points of neighbouring turns thus neither line up into
/// spokes nor fall into a regular pattern (as an even split per turn with a fixed or growing offset
/// does, seen as steps or diagonal lines), and the area looks like even thread.
fn stitches(line: &Line, len: f64, tol: f64, first: usize, needles: &mut Needles) -> Vec<Pt> {
    let simple = 0.1f64.min(tol / 2.0);
    let pts = simplify(&line.pts, simple);
    let tol = 0.02f64.max(tol - simple);
    if pts.len() < 2 {
        return pts;
    }
    let path = Path::new(pts.clone());
    let mut cuts: Vec<f64> = Vec::new();
    for i in 1..pts.len() - 1 {
        let a = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
        let b = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
        let den = hypot(a[0], a[1]) * hypot(b[0], b[1]);
        let den = if den == 0.0 || den.is_nan() { 1.0 } else { den };
        let cos = (a[0] * b[0] + a[1] * b[1]) / den;
        if cos < std::f64::consts::FRAC_1_SQRT_2 {
            cuts.push(path.cum[i]);
        }
    }
    let mut marks = vec![0.0];
    for &c in &cuts {
        if c - marks[marks.len() - 1] >= MIN_CURVE_STITCH && path.total - c >= MIN_CURVE_STITCH {
            marks.push(c);
        }
    }
    marks.push(path.total);
    let mut out: Vec<Pt> = vec![pts[0]];
    let mut ids: Vec<usize> = vec![needles.add(pts[0])];
    let min = MIN_CURVE_STITCH.min(len);
    // The same needle points each time the object is sewn.
    let mut n = first as i64 * 7919;
    for m in 1..marks.len() {
        let to = marks[m];
        let mut a = marks[m - 1];
        while to - a > 1e-9 {
            // The longest stitch that stays within tol of the line (as Path::marks).
            let mut hi = (a + len).min(to);
            if path.deviation(a, hi) > tol {
                let mut lo = (a + min).min(hi);
                if path.deviation(a, lo) <= tol {
                    let mut it = 0;
                    while it < 14 && hi - lo > 0.01 {
                        let c = (lo + hi) / 2.0;
                        if path.deviation(a, c) <= tol {
                            lo = c;
                        } else {
                            hi = c;
                        }
                        it += 1;
                    }
                }
                hi = lo;
            }
            let mut b = hi;
            if hi < to {
                let lo = (a + SHORTEST * (hi - a)).max(hi.min(a + min));
                // No short stitch left over before the corner or the end.
                let cap = to - min;
                let skip = &ids[ids.len().saturating_sub(3)..];
                let mut best = f64::NEG_INFINITY;
                for _ in 0..CANDIDATES {
                    let mut c = lo + (hi - lo) * hash(n);
                    n += 1;
                    if c > cap {
                        c = (a + (to - a) / 2.0).max(cap);
                    }
                    let score = needles.near(path.at(c), skip) + 0.02 * (c - a);
                    if score > best {
                        best = score;
                        b = c;
                    }
                }
            }
            let q = path.at(b);
            out.push(q);
            ids.push(needles.add(q));
            a = b;
        }
    }
    out
}

/// A number in [0, 1) from an integer, the same each time.
fn hash(n: i64) -> f64 {
    let mut x = (n as u32 ^ 0x9e37_79b9).wrapping_mul(0x85eb_ca6b);
    x = (x ^ (x >> 13)).wrapping_mul(0xc2b2_ae35);
    f64::from(x ^ (x >> 16)) / 4294967296.0
}

struct Level {
    depth: f64,
    cells: HashSet<i64>,
}

/// Depth inside the area (mm) and its gradient, from the region's signed distance field.
struct Field<'a> {
    r: &'a Region,
    s: f64,
    e: f64,
    step: f64,
    /// Per ring number, where its rings lie (their depth and the cells they pass through).
    levels: Vec<Vec<Level>>,
}

impl<'a> Field<'a> {
    fn new(r: &'a Region, s: f64) -> Field<'a> {
        Field {
            r,
            s,
            e: r.px_mm / 2.0,
            step: 0.05f64.max(0.15f64.min(s / 3.0)),
            levels: Vec::new(),
        }
    }

    fn depth(&self, q: Pt) -> f64 {
        -sample(self.r, self.r.sdf(), q[0], q[1])
    }

    fn grad(&self, q: Pt) -> Pt {
        let e = self.e;
        [
            (self.depth([q[0] + e, q[1]]) - self.depth([q[0] - e, q[1]])) / (2.0 * e),
            (self.depth([q[0], q[1] + e]) - self.depth([q[0], q[1] - e])) / (2.0 * e),
        ]
    }

    /// The way from q along the gradient (or against it) towards depth `to`, as points with their
    /// depths. It stops early where the depth no longer changes that way: on the ridge in the middle
    /// of the shape, or at its edge.
    fn walk(&self, q: Pt, to: f64) -> Way {
        let mut x = q;
        let mut d = self.depth(x);
        let mut pts = vec![x];
        let mut ds = vec![d];
        let sign = if to >= d { 1.0 } else { -1.0 };
        let mut i = 0;
        while i < 400 && sign * (to - d) > 1e-3 {
            let g = self.grad(x);
            let m = hypot(g[0], g[1]);
            if m < 0.2 {
                break;
            }
            let len = (-self.step).max(self.step.min((to - d) / m));
            let nx = [x[0] + (g[0] / m) * len, x[1] + (g[1] / m) * len];
            let nd = self.depth(nx);
            if sign * (nd - d) < 0.2 * len.abs() * m {
                break;
            }
            x = nx;
            d = nd;
            pts.push(x);
            ds.push(d);
            i += 1;
        }
        Way { pts, d: ds }
    }

    /// The point at depth `to` on the way from q, as far as it gets.
    fn reach(&self, q: Pt, to: f64) -> Pt {
        let w = self.walk(q, to);
        w.pts[w.pts.len() - 1]
    }

    /// The line through point q of ring `ring` shifted by `delta` (mm) deeper along the gradient, and
    /// how far it should move from there: where no further ring lies beyond it, it is the last line
    /// before the ridge, and moves by a third of what the gap across the ridge is wider (or narrower)
    /// than the gap to the ring before, so both come out equal.
    fn spot(&self, q: Pt, ring: &Ring, delta: f64) -> Spot {
        let s = self.s;
        let x = if delta.abs() < 1e-4 {
            q
        } else {
            self.reach(q, ring.depth + delta)
        };
        let a = self.depth(x);
        let to = a.max(ring.depth) + s;
        let w = self.walk(x, to);
        let ridge = w.d[w.d.len() - 1];
        // Not the last line where the way meets the next ring; nor where it stops on the line from a
        // corner inwards, which the next ring only bends round.
        let last = !self.crosses(ring.k + 1, &w)
            && (ridge >= to - 1e-3 || self.fold(w.pts[w.pts.len() - 1]));
        let mv = if last {
            (2.0 * (ridge - a) - ring.out) / 3.0
        } else {
            0.0
        };
        Spot { x, a, w, mv }
    }

    /// Whether the ridge at q has the edge on its other side facing back (the two sides of a narrow
    /// part), not only turned (the line from a corner inwards, where the rings just bend round).
    fn fold(&self, q: Pt) -> bool {
        let g = self.grad(q);
        let m = hypot(g[0], g[1]);
        if m < 1e-6 {
            return true;
        }
        let h = self.grad([
            q[0] + (g[0] / m) * FOLD_PROBE,
            q[1] + (g[1] / m) * FOLD_PROBE,
        ]);
        let n = hypot(h[0], h[1]);
        n < 1e-6 || (g[0] * h[0] + g[1] * h[1]) / (m * n) < FOLD_COS
    }

    /// The spot moved by `mv` (mm) deeper (shallower when negative).
    fn moved(&self, spot: &Spot, mv: f64) -> Pt {
        let Spot { x, a, w, .. } = spot;
        if mv.abs() < 1e-3 {
            return *x;
        }
        if mv < 0.0 {
            return self.reach(*x, a + mv);
        }
        for i in 1..w.pts.len() {
            if w.d[i] < a + mv {
                continue;
            }
            let t = if w.d[i] > w.d[i - 1] {
                (a + mv - w.d[i - 1]) / (w.d[i] - w.d[i - 1])
            } else {
                1.0
            };
            return [
                w.pts[i - 1][0] + (w.pts[i][0] - w.pts[i - 1][0]) * t,
                w.pts[i - 1][1] + (w.pts[i][1] - w.pts[i - 1][1]) * t,
            ];
        }
        w.pts[w.pts.len() - 1]
    }

    /// Notes where a ring lies, for crosses.
    fn add(&mut self, ring: &Ring) {
        while self.levels.len() <= ring.k {
            self.levels.push(Vec::new());
        }
        let level = &mut self.levels[ring.k];
        let at = match level
            .iter()
            .position(|e| (e.depth - ring.depth).abs() < 1e-6)
        {
            Some(i) => i,
            None => {
                level.push(Level {
                    depth: ring.depth,
                    cells: HashSet::new(),
                });
                level.len() - 1
            }
        };
        let entry = &mut level[at];
        for i in 1..ring.pts.len() {
            let (p, q) = (ring.pts[i - 1], ring.pts[i]);
            let n = (dist(p, q) / (CELL / 2.0)).ceil();
            // Two equal points give no cell (NaN in TypeScript, which no query meets).
            if n == 0.0 {
                continue;
            }
            let mut j = 0.0;
            while j <= n {
                let x = p[0] + ((q[0] - p[0]) * j) / n;
                let y = p[1] + ((q[1] - p[1]) * j) / n;
                entry.cells.insert(cell_key(
                    (x / CELL).floor() as i64,
                    (y / CELL).floor() as i64,
                ));
                j += 1.0;
            }
        }
    }

    /// Whether a ring numbered k lies within a cell or so of q.
    fn near(&self, k: usize, q: Pt, depth: Option<f64>) -> bool {
        let Some(level) = self.levels.get(k) else {
            return false;
        };
        for e in level {
            if let Some(d) = depth
                && (e.depth - d).abs() > 1e-6
            {
                continue;
            }
            let cx = (q[0] / CELL).floor() as i64;
            let cy = (q[1] / CELL).floor() as i64;
            for dx in -1..=1 {
                for dy in -1..=1 {
                    if e.cells.contains(&cell_key(cx + dx, cy + dy)) {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Whether the way meets a ring numbered k where it reaches that ring's depth.
    fn crosses(&self, k: usize, w: &Way) -> bool {
        let Some(level) = self.levels.get(k) else {
            return false;
        };
        for e in level {
            if let Some(i) = w.d.iter().position(|&d| d >= e.depth - 0.01)
                && self.near(k, w.pts[i], Some(e.depth))
            {
                return true;
            }
        }
        false
    }
}

/// The rings of the area as trees (see above): every ring oriented with the deeper side on its
/// left, so the line keeps turning the same way from ring to ring. Returns all rings and the roots.
fn ring_tree(r: &Region, field: &mut Field, s: f64, pull: f64) -> (Vec<Ring>, Vec<usize>) {
    let first = pull.min(s / 2.0) - s / 2.0;
    let mut all: Vec<Ring> = Vec::new();
    let mut roots: Vec<usize> = Vec::new();
    let mut prev: Vec<usize> = Vec::new();
    let mut k = 0usize;
    loop {
        let level = first - k as f64 * s;
        let loops = outline(r, level, r.sdf());
        if loops.is_empty() {
            break;
        }
        let mut rings: Vec<usize> = Vec::new();
        let mut left = 0.0;
        for l in &loops {
            let ring = Ring {
                pts: orient(field, simplify(l, 0.02)),
                k,
                depth: -level,
                kids: Vec::new(),
                out: s,
            };
            if path_length(l) < MIN_RING || sliver(field, &ring) {
                left += path_length(l);
            } else {
                all.push(ring);
                rings.push(all.len() - 1);
            }
        }
        for &i in &rings {
            field.add(&all[i]);
        }
        // Where the ridge lies only just deeper than this ring, its level line falls apart into bits
        // and slivers. A level a quarter spacing further out gives whole rings there instead.
        if k > 0 && left >= MIN_RING {
            for l in outline(r, level + s / 4.0, r.sdf()) {
                if path_length(&l) < MIN_RING {
                    continue;
                }
                let ring = Ring {
                    pts: orient(field, simplify(&l, 0.02)),
                    k,
                    depth: -level - s / 4.0,
                    kids: Vec::new(),
                    out: s,
                };
                let n = ring.pts.len() - 1;
                let mut by = 0;
                for j in 0..8 {
                    if field.near(k, ring.pts[(n * j) / 8], Some(-level)) {
                        by += 1;
                    }
                }
                if by > 2 || sliver(field, &ring) {
                    continue;
                }
                field.add(&ring);
                all.push(ring);
                rings.push(all.len() - 1);
            }
        }
        for &ri in &rings {
            let parent = if k > 0 {
                parent_of(field, &all, ri, &prev, s)
            } else {
                None
            };
            if let Some(pi) = parent {
                all[pi].kids.push(ri);
                all[ri].out = all[ri].depth - all[pi].depth;
            } else {
                roots.push(ri);
            }
        }
        if rings.is_empty() {
            break;
        }
        prev = rings;
        k += 1;
    }
    (all, roots)
}

/// Whether the ring is only a thin sliver along a ridge: nowhere deeper inside than a fraction of a spacing.
fn sliver(field: &Field, ring: &Ring) -> bool {
    let n = ring.pts.len() - 1;
    let most = ring.depth + (SLIVER / 2.0) * field.s;
    for j in 0..8 {
        let w = field.walk(ring.pts[(n * j) / 8], most);
        if w.d[w.d.len() - 1] >= most - 1e-3 {
            return false;
        }
    }
    true
}

/// The loop turned, if needed, so that the deeper side lies on its left.
fn orient(field: &Field, mut pts: Vec<Pt>) -> Vec<Pt> {
    let mut sum = 0.0;
    let n = pts.len() - 1;
    let every = 1.max(n / 16);
    let mut i = 0;
    while i < n {
        let a = pts[i];
        let b = pts[i + 1];
        let l = dist(a, b);
        if l >= 1e-6 {
            let m = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
            let left = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
            sum += field.depth([m[0] + left[0] * 0.1, m[1] + left[1] * 0.1])
                - field.depth([m[0] - left[0] * 0.1, m[1] - left[1] * 0.1]);
        }
        i += every;
    }
    if sum >= 0.0 {
        return pts;
    }
    pts.reverse();
    pts
}

/// The ring one spacing further out that this ring lies in: where a few of its points end up when
/// moved out along the gradient by a spacing (nearness alone would mix up the two sides of a ridge).
fn parent_of(
    field: &Field,
    all: &[Ring],
    ring: usize,
    candidates: &[usize],
    s: f64,
) -> Option<usize> {
    if candidates.is_empty() {
        return None;
    }
    if candidates.len() == 1 {
        return Some(candidates[0]);
    }
    let mut score = vec![0.0; candidates.len()];
    let r = &all[ring];
    let n = r.pts.len() - 1;
    for j in 0..5 {
        let out = field.reach(r.pts[(n * j) / 5], r.depth - s);
        for (i, &c) in candidates.iter().enumerate() {
            score[i] += nearest_on(&all[c].pts, out).d;
        }
    }
    // A NaN score finds no parent, as Math.min in TypeScript.
    if score.iter().any(|x| x.is_nan()) {
        return None;
    }
    let min = score.iter().copied().fold(f64::INFINITY, f64::min);
    let at = score.iter().position(|&x| x == min)?;
    Some(candidates[at])
}

struct Nearest {
    pt: Pt,
    i: usize,
    d: f64,
}

/// Nearest point of a polyline to q: the point, its segment and its distance.
fn nearest_on(pts: &[Pt], q: Pt) -> Nearest {
    let mut best = Nearest {
        pt: pts[0],
        i: 0,
        d: f64::INFINITY,
    };
    for i in 1..pts.len() {
        let (a, b) = (pts[i - 1], pts[i]);
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let l2 = dx * dx + dy * dy;
        let t = if l2 > 0.0 {
            0f64.max(1f64.min(((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2))
        } else {
            0.0
        };
        let pt = [a[0] + dx * t, a[1] + dy * t];
        let d = dist(pt, q);
        if d < best.d {
            best = Nearest { pt, i: i - 1, d };
        }
    }
    best
}

fn nearest_ring(all: &[Ring], rings: &[usize], q: Pt) -> usize {
    let mut bi = 0;
    let mut bd = f64::INFINITY;
    for (i, &ring) in rings.iter().enumerate() {
        let d = nearest_on(&all[ring].pts, q).d;
        if d < bd {
            bd = d;
            bi = i;
        }
    }
    bi
}

/// The closed ring starting (and ending) at its point nearest `seam`, resampled finely.
fn rolled(ring: &Ring, seam: Pt) -> Vec<Pt> {
    let near = nearest_on(&ring.pts, seam);
    let open = &ring.pts[..ring.pts.len() - 1];
    let k = near.i + 1;
    let mut lp = vec![near.pt];
    lp.extend_from_slice(&open[k.min(open.len())..]);
    lp.extend_from_slice(&open[..k.min(open.len())]);
    lp.push(near.pt);
    let mut out = vec![lp[0]];
    for i in 1..lp.len() {
        let (a, b) = (lp[i - 1], lp[i]);
        let n = (dist(a, b) / RESAMPLE).ceil();
        let mut j = 1.0;
        while j <= n {
            out.push([
                a[0] + ((b[0] - a[0]) * j) / n,
                a[1] + ((b[1] - a[1]) * j) / n,
            ]);
            j += 1.0;
        }
    }
    out
}

/// Shift of a contour ring's points in spacings at share f of its length: none, but for a ramp
/// from -1/2 to +1/2 over a few millimetres round its start (see above).
fn ramp(f: f64, length: f64) -> f64 {
    let a = 0.1f64.min(RAMP / length);
    if f < a {
        return -0.5 + (0.5 * f) / a;
    }
    if f > 1.0 - a {
        return (0.5 * (f - 1.0 + a)) / a;
    }
    0.0
}

/// The line from `ring` inwards, ring after ring, until a ring with nothing inside; it starts at
/// `seam` on the first ring and ends in the middle. Where rings branch, it goes on into the one
/// straight ahead; the others are added to `branches`.
///
/// A spiral's turns lie between rings, so beside a ring that is not part of it (the edge, a branch
/// sewn on its own) the gap would open and close by half a spacing round the turn. There it is sewn
/// as rings instead, turning into the spiral over a few rings: neighbouring turns differ by little,
/// so they stay about a spacing apart.
fn chain(
    field: &Field,
    all: &[Ring],
    ring: usize,
    seam: Pt,
    mode: RingMode,
    branches: &mut Vec<usize>,
) -> Line {
    let s = field.s;
    // The rings of the line and where each begins.
    let mut steps: Vec<(usize, Pt)> = Vec::new();
    let mut cur = Some(ring);
    let mut at = seam;
    while let Some(c) = cur {
        steps.push((c, at));
        let cr = &all[c];
        // On the gradient line through the start, the next ring begins where it crosses it.
        let start = nearest_on(&cr.pts, at).pt;
        let next = if cr.kids.is_empty() {
            None
        } else {
            Some(cr.kids[nearest_ring(all, &cr.kids, field.reach(start, cr.depth + s))])
        };
        for &kid in &cr.kids {
            if Some(kid) != next {
                branches.push(kid);
            }
        }
        if let Some(nx) = next {
            at = field.reach(start, all[nx].depth);
        }
        cur = next;
    }
    // How much each ring is sewn as a ring rather than a spiral turn: fully at the first one and where
    // branches leave, less and less over BLEND rings from there.
    let mut ringness: Vec<f64> = vec![0.0; steps.len()];
    for (k, &(c, _)) in steps.iter().enumerate() {
        if k > 0 && all[c].kids.len() < 2 {
            continue;
        }
        for (j, rj) in ringness.iter_mut().enumerate() {
            *rj = rj.max(1.0 - (j as f64 - k as f64).abs() / BLEND);
        }
    }
    let mut line = Line {
        pts: Vec::new(),
        turns: Vec::new(),
    };
    for (k, &(c, at)) in steps.iter().enumerate() {
        let cr = &all[c];
        // Out to the ring before and in to the next one (a quarter spacing less to a ring further out, see ring_tree).
        let before = if k > 0 {
            cr.depth - all[steps[k - 1].0].depth
        } else {
            s
        };
        let after = if k + 1 < steps.len() {
            all[steps[k + 1].0].depth - cr.depth
        } else {
            s
        };
        let pts = rolled(cr, at);
        let path = Path::new(pts.clone());
        let total = if path.total == 0.0 { 1.0 } else { path.total };
        let w = if mode == RingMode::Contour {
            1.0
        } else {
            ringness[k]
        };
        line.turns.push(line.pts.len().saturating_sub(1));
        let spots: Vec<Spot> = pts
            .iter()
            .enumerate()
            .map(|(i, &q)| {
                let f = path.cum[i] / total;
                let mut phi = (1.0 - w) * (f - 0.5) + w * ramp(f, total);
                // The first ring does not reach out past itself (it lies at the edge, or beside rows sewn before).
                if k == 0 {
                    phi = phi.max(0.0);
                }
                field.spot(q, cr, phi * if phi < 0.0 { before } else { after })
            })
            .collect();
        // The moves along the ridge evened out over a millimetre or so: the ridge found is uneven.
        let n = spots.len() as isize;
        for i in (if k > 0 { 1 } else { 0 })..n {
            let mut sum = 0.0;
            for j in -SMOOTH..=SMOOTH {
                sum += spots[(n - 1).min(0.max(i + j)) as usize].mv;
            }
            line.pts
                .push(field.moved(&spots[i as usize], sum / (2 * SMOOTH + 1) as f64));
        }
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digitize::region::tests::region_of;

    fn params() -> FillParams {
        FillParams {
            spacing: 0.4,
            stitch: 2.5,
            ..Default::default()
        }
    }

    #[test]
    fn a_disc_is_one_spiral() {
        let r = region_of(120, 0.1, |x, y| (x - 6.0).hypot(y - 6.0) < 5.0);
        let res = ring_fill(&r, &params(), [6.0, 0.0], RingMode::Spiral, -45.0).expect("spiral");
        assert_eq!(res.runs.len(), 1);
        // About the disc's area over the spacing in thread.
        let len = path_length(&res.runs[0]);
        let want = std::f64::consts::PI * 25.0 / 0.4;
        assert!((len - want).abs() / want < 0.15, "{len} vs {want}");
    }

    #[test]
    fn a_ring_shape_has_contours() {
        let r = region_of(120, 0.1, |x, y| {
            let d = (x - 6.0).hypot(y - 6.0);
            (2.0..5.0).contains(&d)
        });
        let res = ring_fill(&r, &params(), [6.0, 0.0], RingMode::Contour, 0.0).expect("contour");
        assert!(!res.runs.is_empty());
        assert!(hash(0) >= 0.0 && hash(12345) < 1.0);
    }
}
