//! Grid over a region for travel paths between the parts of a fill: passable cells, cells covered
//! by sewn rows, and shortest hidden ways (A*) between two points inside. The TypeScript twin
//! (TravelGrid in src/digitize/fill.ts) stays for the model's travel between objects.

use super::region::{Region, sample};
use super::run::simplify;
use crate::geom::Pt;
use crate::js::{dist, hypot};

/// Travel may run on top of sewn rows for this long (mm); a longer way becomes a jump.
const SEWN_CROSSING: f64 = 2.0;
/// How far past its ends a sewn row reaches the strip along the outline beside it (mm).
const ROW_END_STRIP: f64 = 0.35;
/// How far travel may run along those strips (mm); crossing one takes a cell or two.
const ROW_END_RUN: f64 = 4.0;
/// How far travel may show where rows to come are known (mm): crossing the strip at a row end.
const BARE_RUN: f64 = 1.5;
/// What a step costs on a cell travel ran through already (times; see TravelGrid::trodden).
const TRODDEN_COST: f64 = 3.0;
/// Half the width of the lane a way treads (mm).
const TREAD_HALF: f64 = 0.4;
/// What a trim costs against travel when choosing the order of sections (mm of travel).
pub const TRIM_COST: f64 = 25.0;
/// A search while planning looks at no more cells than this many times the longest way it may take.
const SEARCH_SPREAD: f64 = 80.0;
/// What a millimetre of travel that shows costs when choosing the order of sections (mm of travel).
const SHOWN_COST: f64 = 4.0;
/// What a millimetre of travel along the outline beside sewn row ends costs (mm of travel): the eye
/// follows an edge, so a millimetre there costs about a trim.
const EDGE_COST: f64 = 25.0;

pub const STEP_I: [i64; 8] = [1, -1, 0, 0, 1, 1, -1, -1];
pub const STEP_J: [i64; 8] = [0, 0, 1, -1, 1, -1, 1, -1];
pub const STEP_LEN: [f64; 8] = [
    1.0,
    1.0,
    1.0,
    1.0,
    std::f64::consts::SQRT_2,
    std::f64::consts::SQRT_2,
    std::f64::consts::SQRT_2,
    std::f64::consts::SQRT_2,
];

/// A binary min-heap of cell indices by value, as the TypeScript twin (same order on ties).
#[derive(Default)]
pub struct MinHeap {
    k: Vec<i32>,
    v: Vec<f64>,
}

impl MinHeap {
    pub fn new() -> MinHeap {
        MinHeap {
            k: Vec::with_capacity(256),
            v: Vec::with_capacity(256),
        }
    }
    pub fn len(&self) -> usize {
        self.k.len()
    }
    pub fn is_empty(&self) -> bool {
        self.k.is_empty()
    }
    pub fn push(&mut self, key: i32, val: f64) {
        let mut i = self.k.len();
        self.k.push(key);
        self.v.push(val);
        while i > 0 {
            let p = (i - 1) >> 1;
            if self.v[p] <= val {
                break;
            }
            self.k[i] = self.k[p];
            self.v[i] = self.v[p];
            i = p;
        }
        self.k[i] = key;
        self.v[i] = val;
    }
    /// The key with the smallest value, taken off the heap.
    pub fn pop(&mut self) -> i32 {
        let top = self.k[0];
        let lk = self.k.pop().unwrap();
        let lv = self.v.pop().unwrap();
        let n = self.k.len();
        if n == 0 {
            return top;
        }
        let mut i = 0;
        loop {
            let l = 2 * i + 1;
            if l >= n {
                break;
            }
            let m = if l + 1 < n && self.v[l + 1] < self.v[l] {
                l + 1
            } else {
                l
            };
            if self.v[m] >= lv {
                break;
            }
            self.k[i] = self.k[m];
            self.v[i] = self.v[m];
            i = m;
        }
        self.k[i] = lk;
        self.v[i] = lv;
        top
    }
}

/// The cells a sewn row covers (see TravelGrid::footprint).
#[derive(Clone, Debug, Default)]
pub struct Footprint {
    pub under: Vec<u32>,
    pub ends: Vec<u32>,
}

/// The state of a grid that planning changes and puts back.
#[derive(Clone)]
pub struct Kept {
    covered: Vec<u8>,
    row_ends: Vec<u8>,
    ahead: Option<Vec<u16>>,
    gone: Option<Vec<u8>>,
}

struct Walked {
    cells: Vec<Pt>,
    length: f64,
    on_top: f64,
    along_ends: f64,
}

/// Grid over the region for travel paths: passable cells and cells covered by sewn rows.
pub struct TravelGrid {
    pub cell: f64,
    pub gw: usize,
    pub gh: usize,
    pub ox: f64,
    pub oy: f64,
    pub depth: Vec<f32>,
    pub covered: Vec<u8>,
    /// Cells just past the ends of sewn rows (with `off_row_ends`): travel may cross them, not run along them.
    pub row_ends: Vec<u8>,
    pub off_row_ends: bool,
    /// With `ahead` set (see expect): how many rows still to come cover each cell. Travel there is
    /// hidden, as in the parts left out (`gone`); anywhere else not sewn it shows, like beside row ends.
    pub ahead: Option<Vec<u16>>,
    pub gone: Option<Vec<u8>>,
    /// Sparse rows crossing (crosshatch): a sewn row is a way for travel like a row still to come.
    pub layered: bool,
    /// How much longer than the straight way travel may be (times, plus `slack`).
    pub detour: f64,
    pub slack: f64,
    /// Cells travel ran through already (see tread): another way there costs more.
    pub trodden: Option<Vec<u8>>,
    /// What a jump costs against travel when planning the order of sections (mm of travel).
    pub trim_cost: f64,
    /// Where rows to come are known, travel may still run a few mm along row ends.
    pub walks: bool,
    seen: Vec<u32>,
    marks: u32,
    w0: Option<Vec<f32>>,
    cost: Vec<f64>,
    from: Vec<i32>,
    done: Vec<u8>,
    touched: Vec<usize>,
}

impl TravelGrid {
    pub fn new(r: &Region, off_row_ends: bool, cut: Option<(&Region, &Region)>) -> TravelGrid {
        let cell = r.px_mm.max(0.25);
        let ox = f64::from(r.x0) * r.px_mm;
        let oy = f64::from(r.y0) * r.px_mm;
        let gw = ((r.w as f64 * r.px_mm) / cell).ceil() as usize;
        let gh = ((r.h as f64 * r.px_mm) / cell).ceil() as usize;
        let n = gw * gh;
        let mut g = TravelGrid {
            cell,
            gw,
            gh,
            ox,
            oy,
            depth: vec![0.0; n],
            covered: vec![0; n],
            row_ends: vec![0; n],
            off_row_ends,
            ahead: None,
            gone: None,
            layered: false,
            detour: 2.0,
            slack: 6.0,
            trodden: None,
            trim_cost: TRIM_COST,
            walks: false,
            seen: Vec::new(),
            marks: 0,
            w0: None,
            cost: Vec::new(),
            from: Vec::new(),
            done: Vec::new(),
            touched: Vec::new(),
        };
        let sdf = r.sdf();
        for j in 0..gh {
            for i in 0..gw {
                let [x, y] = g.center(i, j);
                g.depth[j * gw + i] = (-sample(r, sdf, x, y)) as f32;
            }
        }
        if let Some((whole, area)) = cut {
            let mut gone = vec![0u8; n];
            for j in 0..gh {
                for i in 0..gw {
                    let [x, y] = g.center(i, j);
                    if sample(whole, whole.sdf(), x, y) < 0.0
                        && sample(area, area.sdf(), x, y) > 0.0
                    {
                        gone[j * gw + i] = 1;
                    }
                }
            }
            g.gone = Some(gone);
        }
        g
    }

    /// The longest way travel may take between two points `d` apart.
    pub fn way(&self, d: f64) -> f64 {
        self.detour * d + self.slack
    }

    pub fn center(&self, i: usize, j: usize) -> Pt {
        [
            self.ox + (i as f64 + 0.5) * self.cell,
            self.oy + (j as f64 + 0.5) * self.cell,
        ]
    }

    fn center_of(&self, c: usize) -> Pt {
        self.center(c % self.gw, c / self.gw)
    }

    /// The cell of p, or None outside the grid.
    pub fn index(&self, p: Pt) -> Option<usize> {
        let i = ((p[0] - self.ox) / self.cell).floor();
        let j = ((p[1] - self.oy) / self.cell).floor();
        if i < 0.0 || j < 0.0 || i >= self.gw as f64 || j >= self.gh as f64 {
            return None;
        }
        Some(j as usize * self.gw + i as usize)
    }

    /// Marks the cells under a sewn row (and half a row spacing to each side), and the strips past its ends.
    pub fn cover(&mut self, a: Pt, b: Pt, half_width: f64) {
        let fp = self.footprint(a, b, half_width);
        self.apply(&fp);
    }

    /// The cells a sewn row covers (see cover), worked out once for planning.
    pub fn footprint(&mut self, a: Pt, b: Pt, half_width: f64) -> Footprint {
        let mut under = Vec::new();
        let mut ends = Vec::new();
        let l = dist(a, b);
        let nx = if l > 0.0 { -(b[1] - a[1]) / l } else { 0.0 };
        let ny = if l > 0.0 { (b[0] - a[0]) / l } else { 0.0 };
        if l > 0.0 && self.off_row_ends {
            let ux = (b[0] - a[0]) / l;
            let uy = (b[1] - a[1]) / l;
            let m = (ROW_END_STRIP / (self.cell / 2.0)).ceil() as usize;
            for k in 1..=m {
                let t = (ROW_END_STRIP * k as f64) / m as f64;
                for o in [-half_width, 0.0, half_width] {
                    for [ex, ey] in [
                        [a[0] - ux * t, a[1] - uy * t],
                        [b[0] + ux * t, b[1] + uy * t],
                    ] {
                        if let Some(c) = self.index([ex + nx * o, ey + ny * o]) {
                            ends.push(c as u32);
                        }
                    }
                }
            }
        }
        self.stamp(a, b, half_width, |c| under.push(c as u32));
        Footprint { under, ends }
    }

    /// Marks a footprint sewn: covered, one row less to come, strips past the row ends.
    pub fn apply(&mut self, fp: &Footprint) {
        for &c in &fp.ends {
            self.row_ends[c as usize] = 1;
        }
        for &c in &fp.under {
            let c = c as usize;
            if let Some(ahead) = &mut self.ahead
                && ahead[c] > 0
            {
                ahead[c] -= 1;
            }
            match (&mut self.gone, self.layered) {
                (Some(gone), true) => gone[c] = 1,
                _ => self.covered[c] = 1,
            }
        }
    }

    /// Marks the cells along a way travel took (see trodden).
    pub fn tread(&mut self, path: &[Pt]) {
        let mut t = self
            .trodden
            .take()
            .unwrap_or_else(|| vec![0; self.gw * self.gh]);
        for i in 1..path.len() {
            self.stamp(path[i - 1], path[i], TREAD_HALF, |c| t[c] = 1);
        }
        self.trodden = Some(t);
    }

    /// Counts the cells under a row still to come (see ahead).
    pub fn expect(&mut self, a: Pt, b: Pt, half_width: f64) {
        let mut ahead = self
            .ahead
            .take()
            .unwrap_or_else(|| vec![0; self.gw * self.gh]);
        self.stamp(a, b, half_width, |c| ahead[c] = ahead[c].wrapping_add(1));
        self.ahead = Some(ahead);
    }

    /// Calls `f` once for each cell under the row from a to b.
    fn stamp(&mut self, a: Pt, b: Pt, half_width: f64, mut f: impl FnMut(usize)) {
        let l = dist(a, b);
        let n = ((l / (self.cell / 2.0)).ceil() as usize).max(1);
        let nx = if l > 0.0 { -(b[1] - a[1]) / l } else { 0.0 };
        let ny = if l > 0.0 { (b[0] - a[0]) / l } else { 0.0 };
        if self.seen.is_empty() {
            self.seen = vec![0; self.gw * self.gh];
        }
        self.marks += 1;
        let mark = self.marks;
        // Across the row no more than a cell apart, so sparse rows leave no stripes between them.
        let m = ((2.0 * half_width) / self.cell).ceil().max(2.0) as usize;
        let offs: Vec<f64> = (0..=m)
            .map(|i| -half_width + (2.0 * half_width * i as f64) / m as f64)
            .collect();
        for k in 0..=n {
            let x = a[0] + ((b[0] - a[0]) * k as f64) / n as f64;
            let y = a[1] + ((b[1] - a[1]) * k as f64) / n as f64;
            for &o in &offs {
                if let Some(c) = self.index([x + nx * o, y + ny * o])
                    && self.seen[c] != mark
                {
                    self.seen[c] = mark;
                    f(c);
                }
            }
        }
    }

    /// A cell where travel shows: neither sewn on top of nor hidden by rows to come or a part left out.
    fn bare(&self, c: usize) -> bool {
        match &self.ahead {
            Some(ahead) => {
                self.covered[c] == 0
                    && ahead[c] == 0
                    && !self.gone.as_ref().is_some_and(|g| g[c] != 0)
            }
            None => self.row_ends[c] != 0 && self.covered[c] == 0,
        }
    }

    /// Within 1 mm of a or b: a path may leave and reach rows sewn already there.
    fn near(&self, c: usize, a: Pt, b: Pt) -> bool {
        let [x, y] = self.center_of(c);
        hypot(x - a[0], y - a[1]) < 1.0 || hypot(x - b[0], y - b[1]) < 1.0
    }

    /// Nearest passable cell to p within a few cells.
    fn snap(&self, p: Pt) -> Option<usize> {
        if let Some(c) = self.index(p)
            && self.depth[c] > 0.05
        {
            return Some(c);
        }
        let mut best = None;
        let mut bd = i64::MAX;
        let ci = ((p[0] - self.ox) / self.cell).floor() as i64;
        let cj = ((p[1] - self.oy) / self.cell).floor() as i64;
        for dj in -4..=4i64 {
            for di in -4..=4i64 {
                let i = ci + di;
                let j = cj + dj;
                if i < 0 || j < 0 || i >= self.gw as i64 || j >= self.gh as i64 {
                    continue;
                }
                let q = j as usize * self.gw + i as usize;
                if self.depth[q] <= 0.05 {
                    continue;
                }
                let d = di * di + dj * dj;
                if d < bd {
                    bd = d;
                    best = Some(q);
                }
            }
        }
        best
    }

    /// Shortest inside path from a to b (A*, 8 neighbours); the cost falls towards the middle of the
    /// shape, which keeps travel away from the edges. With `avoid_sewn`, cells covered by rows sewn
    /// already cost much more, and a path that would still lie on top of them for more than
    /// SEWN_CROSSING is refused (None): a jump is cleaner than a visible travel line.
    pub fn path(&mut self, a: Pt, b: Pt, avoid_sewn: bool) -> Option<Vec<Pt>> {
        let w = self.route(a, b, avoid_sewn, f64::INFINITY)?;
        let s = simplify(&w.cells, self.cell * 0.6);
        let mut out = Vec::with_capacity(s.len() + 2);
        out.push(a);
        if s.len() > 2 {
            out.extend_from_slice(&s[1..s.len() - 1]);
        }
        out.push(b);
        Some(out)
    }

    /// The way from a to b as path takes it, or None. Where rows to come are known, a way hidden all
    /// along comes first; only without one may it cross sewn rows or run beside row ends a little.
    fn route(&mut self, a: Pt, b: Pt, avoid_sewn: bool, limit: f64) -> Option<Walked> {
        let s = self.snap(a)?;
        let t = self.snap(b)?;
        let ends_max = if self.ahead.is_some() && (self.gone.is_some() || !self.walks) {
            BARE_RUN
        } else {
            ROW_END_RUN
        };
        let ok = |x: &Walked| x.on_top <= SEWN_CROSSING && x.along_ends <= ends_max;
        if avoid_sewn && self.ahead.is_some() {
            self.search(s, a, Some(b), true, Some(t), true, limit);
            let w = self.walk(s, t, a, b, true);
            if let Some(w) = w
                && ok(&w)
                && w.length < self.way(dist(a, b))
            {
                return Some(w);
            }
        }
        self.search(s, a, Some(b), avoid_sewn, Some(t), false, limit);
        let w = self.walk(s, t, a, b, avoid_sewn)?;
        ok(&w).then_some(w)
    }

    /// The cells a hidden way reaches from a (leaving a within 1 mm any way): see reaches.
    pub fn flood(&self, a: Pt) -> Vec<u8> {
        let (gw, gh) = (self.gw, self.gh);
        let mut seen = vec![0u8; gw * gh];
        let mut stack: Vec<usize> = Vec::new();
        let shows = |q: usize| {
            self.covered[q] != 0
                || self
                    .ahead
                    .as_ref()
                    .is_some_and(|ah| ah[q] == 0 && !self.gone.as_ref().is_some_and(|g| g[q] != 0))
        };
        let r = (1.0 / self.cell).ceil() as i64;
        let ci = ((a[0] - self.ox) / self.cell).floor() as i64;
        let cj = ((a[1] - self.oy) / self.cell).floor() as i64;
        for j in cj - r..=cj + r {
            for i in ci - r..=ci + r {
                if i < 0 || j < 0 || i >= gw as i64 || j >= gh as i64 {
                    continue;
                }
                let q = j as usize * gw + i as usize;
                if self.depth[q] > 0.05 && dist(self.center(i as usize, j as usize), a) < 1.0 {
                    seen[q] = 1;
                    stack.push(q);
                }
            }
        }
        while let Some(c) = stack.pop() {
            let i0 = (c % gw) as i64;
            let j0 = (c / gw) as i64;
            for k in 0..8 {
                let i = i0 + STEP_I[k];
                let j = j0 + STEP_J[k];
                if i < 0 || j < 0 || i >= gw as i64 || j >= gh as i64 {
                    continue;
                }
                let q = j as usize * gw + i as usize;
                if seen[q] != 0 || self.depth[q] <= 0.05 || shows(q) {
                    continue;
                }
                if k >= 4
                    && shows(j0 as usize * gw + i as usize)
                    && shows(j as usize * gw + i0 as usize)
                {
                    continue;
                }
                seen[q] = 1;
                stack.push(q);
            }
        }
        seen
    }

    /// Whether a flood (see flood) gets within 1 mm of b.
    pub fn reaches(&self, seen: &[u8], b: Pt) -> bool {
        let r = (1.0 / self.cell).ceil() as i64;
        let ci = ((b[0] - self.ox) / self.cell).floor() as i64;
        let cj = ((b[1] - self.oy) / self.cell).floor() as i64;
        for j in (cj - r).max(0)..=(cj + r).min(self.gh as i64 - 1) {
            for i in (ci - r).max(0)..=(ci + r).min(self.gw as i64 - 1) {
                if seen[j as usize * self.gw + i as usize] != 0
                    && dist(self.center(i as usize, j as usize), b) < 1.0
                {
                    return true;
                }
            }
        }
        false
    }

    /// Whether the straight way from a to b stays inside, off sewn rows and hidden all along.
    pub fn clear(&self, a: Pt, b: Pt) -> bool {
        let l = dist(a, b);
        let n = (l / (self.cell / 2.0)).ceil() as usize;
        for k in 1..n {
            let p = [
                a[0] + ((b[0] - a[0]) * k as f64) / n as f64,
                a[1] + ((b[1] - a[1]) * k as f64) / n as f64,
            ];
            let Some(c) = self.index(p) else {
                return false;
            };
            if self.depth[c] <= 0.05 {
                return false;
            }
            if dist(p, a) < 1.0 || dist(p, b) < 1.0 {
                continue;
            }
            if self.covered[c] != 0 || self.bare(c) {
                return false;
            }
        }
        true
    }

    /// How much the way from a to b costs (see path): its length, and more for each millimetre of it
    /// that shows (on sewn rows, beside row ends); None where only a jump gets there.
    pub fn length(&mut self, a: Pt, b: Pt) -> Option<f64> {
        // Planning asks often: a search that has to look far and wide counts as no way.
        let limit = (SEARCH_SPREAD * self.way(dist(a, b))) / self.cell;
        let w = self.route(a, b, true, limit)?;
        Some(
            w.length
                + SHOWN_COST * w.on_top
                + if self.walks { SHOWN_COST } else { EDGE_COST } * w.along_ends,
        )
    }

    /// The arrays a search works in, set back where the last search touched them.
    fn reset(&mut self) {
        if self.cost.is_empty() {
            let n = self.gw * self.gh;
            self.cost = vec![f64::INFINITY; n];
            self.from = vec![-1; n];
            self.done = vec![0; n];
        }
        for &q in &self.touched {
            self.cost[q] = f64::INFINITY;
            self.from[q] = -1;
            self.done[q] = 0;
        }
        self.touched.clear();
    }

    /// The cost of a step into each cell: higher towards the edges, 0 where travel cannot go.
    fn weights(&mut self) {
        if self.w0.is_none() {
            self.w0 = Some(
                self.depth
                    .iter()
                    .map(|&d| {
                        if d <= 0.05 {
                            0.0
                        } else {
                            (1.0 + 0.4 / (f64::from(d) + 0.1)) as f32
                        }
                    })
                    .collect(),
            );
        }
    }

    /// A* from cell s to t (Dijkstra everywhere without t), at most `limit` cells: the predecessor
    /// of each cell in `self.from`.
    fn search(
        &mut self,
        s: usize,
        a: Pt,
        b: Option<Pt>,
        avoid_sewn: bool,
        t: Option<usize>,
        hidden_only: bool,
        limit: f64,
    ) {
        self.reset();
        self.weights();
        let base = self.w0.as_ref().unwrap();
        let mut heap = MinHeap::new();
        let (gw, gh, cell, ox, oy) = (self.gw, self.gh, self.cell, self.ox, self.oy);
        let covered = &self.covered;
        let ahead = self.ahead.as_deref();
        let gone = self.gone.as_deref();
        let trodden = self.trodden.as_deref();
        // Where rows to come are known, only ways short enough to take: inside an ellipse round a and b.
        let reach = match (ahead, b) {
            (Some(_), Some(b)) => self.detour * dist(a, b) + self.slack + 2.0 * cell,
            _ => 0.0,
        };
        // Towards t, the straight distance left is a lower bound of the cost (A*).
        let (tx, ty) = match t {
            Some(t) => (
                ox + ((t % gw) as f64 + 0.5) * cell,
                oy + ((t / gw) as f64 + 0.5) * cell,
            ),
            None => (0.0, 0.0),
        };
        let bb = b.unwrap_or(a);
        // On sewn rows, or where rows to come are known, where it would show (see bare); not within
        // 1 mm of a or b, where the way leaves and reaches rows.
        let shows = |i: i64, j: i64| -> bool {
            let q = j as usize * gw + i as usize;
            let hidden_ahead = match ahead {
                Some(ah) => !(ah[q] == 0 && !gone.is_some_and(|g| g[q] != 0)),
                None => true,
            };
            if covered[q] == 0 && hidden_ahead {
                return false;
            }
            let x = ox + (i as f64 + 0.5) * cell;
            let y = oy + (j as f64 + 0.5) * cell;
            (x - a[0]) * (x - a[0]) + (y - a[1]) * (y - a[1]) >= 1.0
                && (x - bb[0]) * (x - bb[0]) + (y - bb[1]) * (y - bb[1]) >= 1.0
        };
        let cost = &mut self.cost;
        let from = &mut self.from;
        let done = &mut self.done;
        let touched = &mut self.touched;
        cost[s] = 0.0;
        touched.push(s);
        heap.push(s as i32, 0.0);
        let mut popped = 0.0;
        while !heap.is_empty() {
            let c = heap.pop() as usize;
            if Some(c) == t {
                break;
            }
            popped += 1.0;
            if popped > limit {
                break;
            }
            if done[c] != 0 {
                continue;
            }
            done[c] = 1;
            let ci = (c % gw) as i64;
            let cj = (c / gw) as i64;
            let cc = cost[c];
            for k in 0..8 {
                let i = ci + STEP_I[k];
                let j = cj + STEP_J[k];
                if i < 0 || j < 0 || i >= gw as i64 || j >= gh as i64 {
                    continue;
                }
                let q = j as usize * gw + i as usize;
                let w0 = base[q];
                if w0 == 0.0 || done[q] != 0 {
                    continue;
                }
                let mut w = STEP_LEN[k] * f64::from(w0);
                if trodden.is_some_and(|tr| tr[q] != 0) {
                    w *= TRODDEN_COST;
                }
                let x = ox + (i as f64 + 0.5) * cell;
                let y = oy + (j as f64 + 0.5) * cell;
                if reach != 0.0
                    && ((x - a[0]) * (x - a[0]) + (y - a[1]) * (y - a[1])).sqrt()
                        + ((x - bb[0]) * (x - bb[0]) + (y - bb[1]) * (y - bb[1])).sqrt()
                        > reach
                {
                    continue;
                }
                // On sewn rows, or where rows to come are known, where it would show (see bare).
                if avoid_sewn && shows(i, j) {
                    if hidden_only {
                        continue;
                    }
                    w *= if covered[q] != 0 { 12.0 } else { 4.0 };
                }
                // Hidden only, not diagonally between two cells where it would show (between sewn rows).
                if hidden_only && k >= 4 && shows(ci + STEP_I[k], cj) && shows(ci, cj + STEP_J[k]) {
                    continue;
                }
                let nc = cc + w;
                if nc < cost[q] {
                    if cost[q] == f64::INFINITY {
                        touched.push(q);
                    }
                    cost[q] = nc;
                    from[q] = c as i32;
                    let key = if t.is_some() {
                        nc + ((x - tx) * (x - tx) + (y - ty) * (y - ty)).sqrt()
                    } else {
                        nc
                    };
                    heap.push(q as i32, key);
                }
            }
        }
    }

    /// The cells of the tree's path from s to t, its length, and how much of it lies on sewn rows or along their ends.
    fn walk(&self, s: usize, t: usize, a: Pt, b: Pt, avoid_sewn: bool) -> Option<Walked> {
        if self.from[t] < 0 && s != t {
            return None;
        }
        let mut cells = Vec::new();
        let mut on_top = 0.0;
        let mut along_ends = 0.0;
        let mut c = t as i64;
        while c >= 0 {
            let cu = c as usize;
            cells.push(self.center_of(cu));
            if avoid_sewn && !self.near(cu, a, b) {
                if self.covered[cu] != 0 {
                    on_top += self.cell;
                } else if self.bare(cu) {
                    along_ends += self.cell;
                }
            }
            c = if cu == s {
                -1
            } else {
                i64::from(self.from[cu])
            };
        }
        cells.reverse();
        let mut length = 0.0;
        for i in 1..cells.len() {
            length += dist(cells[i - 1], cells[i]);
        }
        Some(Walked {
            cells,
            length,
            on_top,
            along_ends,
        })
    }

    /// The state planning changes (sewn rows of layered rows are ways: `gone` changes too).
    pub fn keep(&self) -> Kept {
        Kept {
            covered: self.covered.clone(),
            row_ends: self.row_ends.clone(),
            ahead: self.ahead.clone(),
            gone: if self.layered {
                self.gone.clone()
            } else {
                None
            },
        }
    }

    /// Puts back what keep took.
    pub fn back(&mut self, k: &Kept) {
        self.covered.copy_from_slice(&k.covered);
        self.row_ends.copy_from_slice(&k.row_ends);
        if let (Some(a), Some(ka)) = (&mut self.ahead, &k.ahead) {
            a.copy_from_slice(ka);
        }
        if let (Some(g), Some(kg)) = (&mut self.gone, &k.gone) {
            g.copy_from_slice(kg);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digitize::region::tests::region_of;

    #[test]
    fn heap_pops_in_order() {
        let mut h = MinHeap::new();
        for (k, v) in [(1, 5.0), (2, 1.0), (3, 3.0), (4, 1.0), (5, 0.5)] {
            h.push(k, v);
        }
        let mut out = vec![];
        while !h.is_empty() {
            out.push(h.pop());
        }
        assert_eq!(out[0], 5);
        assert_eq!(*out.last().unwrap(), 1);
    }

    #[test]
    fn travel_goes_round_a_hole() {
        // A ring: the way across the hole runs round it.
        let r = region_of(200, 0.1, |x, y| {
            let d = (x - 10.0).hypot(y - 10.0);
            d < 9.0 && d > 4.0
        });
        let mut g = TravelGrid::new(&r, false, None);
        let path = g.path([3.0, 10.0], [17.0, 10.0], false).unwrap();
        let mut l = 0.0;
        for i in 1..path.len() {
            l += dist(path[i - 1], path[i]);
        }
        assert!(l > 18.0, "{l}");
        g.cover([3.0, 6.0], [17.0, 6.0], 0.5);
        assert!(g.covered.iter().any(|&c| c != 0));
    }
}
