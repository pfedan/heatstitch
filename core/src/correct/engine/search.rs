//! The search of the correction engine (upperFix in src/correct/engine/solve.ts) on the additive
//! field: which objects carry the open cells, how much of each lies hidden, the variants' predicted
//! thread, and the choice of one variant per unit that clears the most open cells under the hard
//! rules. Sewing the variants, checking the result for real and blaming stay TypeScript, which
//! hands each unit's variants in as stitches and reads the choice back.
//!
//! A group (units that share open cells) is searched completely when it is small, else greedily and
//! then by large neighbourhoods: a few units at once, exactly (Shaw 1998, large neighbourhood
//! search). The time it may take is spent as field work (Field::work), so the same design gets the
//! same answer on any machine.

use super::field::{Contribution, Field, SUB};
use super::levels::{CRITICAL, SAFE, Thresholds};
use crate::js::IdMap;
use crate::pattern::Records;

/// Later thread (mm/mm²) from which an object's thread counts as covered.
const HIDDEN: f64 = 2.2;
/// Groups with at most this many combinations are searched completely.
const EXHAUSTIVE: f64 = 1500.0;
/// Field work the search does per millisecond, measured on the test set (110 to 120 thousand on
/// the cloud machine, 2026-10-08). The budget is given in milliseconds and spent in work: a slower
/// machine takes longer, but comes to the same choice.
const WORK_PER_MS: f64 = 110_000.0;
/// Neighbourhoods in a row without a better choice before the search stops.
const STALE: usize = 40;

/// Open cells fixed and the hard rules' counts, over everything chosen so far.
#[derive(Clone, Copy, Debug, Default)]
pub struct Tally {
    pub fixed: i64,
    pub new_critical: i64,
    pub new_caution: i64,
}

/// A unit that may change: its variants' contributions (ids), their visibility, which are banned.
struct Cand {
    contribs: Vec<usize>,
    visibility: Vec<f64>,
    banned: Vec<bool>,
    chosen: usize,
}

/// Where the search of one group stands between the calls that make it up.
struct GroupState {
    allowed: Vec<Vec<usize>>,
    start: Vec<usize>,
    best: f64,
    best_choice: Vec<usize>,
}

pub struct Search {
    pub f: Field,
    /// Levels of the design as it is (the field's base), for the tally.
    base: Vec<u8>,
    contribs: Vec<Contribution>,
    /// Open cells that count (1), and the list of them as they were given.
    target: Vec<u8>,
    targets: Vec<usize>,
    /// Number of objects (their contributions are the first ones).
    objects: usize,
    /// Objects carrying each open cell, by cell in the order the cells were given.
    carriers: Vec<(usize, Vec<usize>)>,
    cands: Vec<Cand>,
    /// Candidate of each object (-1: none).
    obj_cand: Vec<i64>,
    groups: Vec<Vec<usize>>,
    tally: Tally,
    /// Thread of the objects sewn after an object, by sub-cell, for coveredAfter.
    covered: IdMap<usize, IdMap<i64, f64>>,
    state: Option<GroupState>,
}

/// `seed = (seed * 1103515245 + 12345) & 0x7fffffff` as JavaScript computes it (the product in
/// doubles, then cut to 32 bits).
fn lcg(seed: i64) -> i64 {
    let v = seed as f64 * 1_103_515_245.0 + 12345.0;
    ((v as i128).rem_euclid(1 << 32) as i64) & 0x7fff_ffff
}

impl Search {
    pub fn new(p: &Records, bounds: [f64; 4], th: Thresholds, stable_fabric: bool) -> Search {
        let f = Field::new(p, bounds, th, stable_fabric);
        let n = f.cells();
        Search {
            base: f.base.clone(),
            f,
            contribs: vec![],
            target: vec![0; n],
            targets: vec![],
            objects: 0,
            carriers: vec![],
            cands: vec![],
            obj_cand: vec![],
            groups: vec![],
            tally: Tally::default(),
            covered: IdMap::default(),
            state: None,
        }
    }

    pub fn tally(&self) -> Tally {
        self.tally
    }

    /// Field cell of each validation cell, by world key (-1: none).
    pub fn field_cells(&self, keys: &[f64]) -> Vec<i32> {
        let mut by_key: IdMap<i64, usize> = IdMap::default();
        for c in 0..self.f.cells() {
            by_key.insert(self.f.key_of(c) as i64, c);
        }
        keys.iter()
            .map(|&k| by_key.get(&(k as i64)).map_or(-1, |&c| c as i32))
            .collect()
    }

    /// The open cells that count (field cells, in the order the check lists them).
    pub fn set_target(&mut self, cells: &[u32]) {
        for &c in cells {
            self.target[c as usize] = 1;
            self.targets.push(c as usize);
        }
    }

    /// The objects as they are: records `first..=last` of `p` with their bounds, as six numbers
    /// each (first, last, min x, min y, max x, max y).
    pub fn add_objects(&mut self, p: &Records, objects: &[f64]) {
        for o in objects.chunks_exact(6) {
            let (a, b) = (o[0] as usize, o[1] as usize + 1);
            let s = Records {
                x: p.x[a..b].to_vec(),
                y: p.y[a..b].to_vec(),
                cmd: p.cmd[a..b].to_vec(),
                colors: vec![],
            };
            let c = self.f.contribution(&s, [o[2], o[3], o[4], o[5]], None);
            self.contribs.push(c);
        }
        self.objects = self.contribs.len();
        self.obj_cand = vec![-1; self.objects];
    }

    /// Share of each object's thread that later objects cover (by its base map).
    pub fn hidden_shares(&self) -> Vec<f64> {
        let f = &self.f;
        let mut later = vec![0f32; f.total.len()];
        let mut out = vec![0.0; self.objects];
        for k in (0..self.objects).rev() {
            let m = &self.contribs[k].map;
            let mut all = 0.0;
            let mut hid = 0.0;
            for y in 0..m.rows {
                let fy = m.oy + y;
                if fy < 0 || fy >= f.srows {
                    continue;
                }
                for x in 0..m.cols {
                    let fx = m.ox + x;
                    if fx < 0 || fx >= f.scols {
                        continue;
                    }
                    let t = m.total[(y * m.cols + x) as usize] as f64;
                    all += t;
                    if later[(fy * f.scols + fx) as usize] as f64 >= HIDDEN {
                        hid += t;
                    }
                }
            }
            out[k] = if all > 0.0 { hid / all } else { 0.0 };
            for y in 0..m.rows {
                let fy = m.oy + y;
                if fy < 0 || fy >= f.srows {
                    continue;
                }
                for x in 0..m.cols {
                    let fx = m.ox + x;
                    if fx >= 0 && fx < f.scols {
                        let i = (fy * f.scols + fx) as usize;
                        later[i] =
                            (later[i] as f64 + m.total[(y * m.cols + x) as usize] as f64) as f32;
                    }
                }
            }
        }
        out
    }

    /// Sub-cell of the peak of cell `c` and the thread there.
    fn peak_of(&self, c: usize) -> (i64, i64, f64) {
        let f = &self.f;
        let c = c as i64;
        let cx = c % f.cols;
        let cy = c / f.cols;
        let mut best = (cx * SUB, cy * SUB, -1.0);
        for y in cy * SUB..cy * SUB + SUB {
            for x in cx * SUB..cx * SUB + SUB {
                let t = f.total[(y * f.scols + x) as usize] as f64;
                if t > best.2 {
                    best = (x, y, t);
                }
            }
        }
        best
    }

    /// Who carries each open cell: objects with at least `share` of the thread at its peak, and
    /// with `holes` those with short stitches in it. Flat: cell, count, objects..., per cell.
    pub fn find_carriers(&mut self, share: f64, holes: bool) -> Vec<u32> {
        let mut seen: IdMap<usize, ()> = IdMap::default();
        let mut carriers = vec![];
        for &c in &self.targets {
            if seen.insert(c, ()).is_some() {
                continue;
            }
            let (sx, sy, t) = self.peak_of(c);
            let mut who = vec![];
            for (i, b) in self.contribs[..self.objects].iter().enumerate() {
                if b.map.cols == 0 {
                    continue;
                }
                let s = if t > 0.0 { b.map.at(sx, sy) / t } else { 0.0 };
                if s >= share || (holes && b.shorts.contains_key(&c)) {
                    who.push(i);
                }
            }
            carriers.push((c, who));
        }
        let mut out = vec![];
        for (c, who) in &carriers {
            out.push(*c as u32);
            out.push(who.len() as u32);
            out.extend(who.iter().map(|&i| i as u32));
        }
        self.carriers = carriers;
        out
    }

    /// What stitches `s` (with their bounds) contribute; `keep` as Field::contribution. Its id.
    pub fn contribution(&mut self, s: &Records, bounds: [f64; 4], keep: Option<&[u8]>) -> usize {
        let c = self.f.contribution(s, bounds, keep);
        self.contribs.push(c);
        self.contribs.len() - 1
    }

    /// Notes the thread of the objects sewn after object `index`, by sub-cell (once).
    fn note_later(&mut self, index: usize) {
        if self.covered.contains_key(&index) {
            return;
        }
        let mut later: IdMap<i64, f64> = IdMap::default();
        for k in index + 1..self.objects {
            let m = &self.contribs[k].map;
            for y in 0..m.rows {
                for x in 0..m.cols {
                    let t = m.total[(y * m.cols + x) as usize] as f64;
                    if t == 0.0 {
                        continue;
                    }
                    let key = (m.oy + y) * self.f.scols + m.ox + x;
                    *later.entry(key).or_insert(0.0) += t;
                }
            }
        }
        self.covered.insert(index, later);
    }

    /// A predicted contribution (Field::blend) of contributions `top` and `under`; with `after`,
    /// the underlay is kept only where the objects sewn after that one do not cover it. Its id.
    pub fn blend(
        &mut self,
        top: usize,
        under: usize,
        k: f64,
        u: f64,
        after: Option<usize>,
    ) -> usize {
        if let Some(i) = after {
            self.note_later(i);
        }
        let scols = self.f.scols;
        let later = after.map(|i| &self.covered[&i]);
        let test = later.map(|l| {
            move |sx: i64, sy: i64| l.get(&(sy * scols + sx)).copied().unwrap_or(0.0) < HIDDEN
        });
        let c = self.f.blend(
            &self.contribs[top],
            &self.contribs[under],
            k,
            u,
            test.as_ref().map(|t| t as &dyn Fn(i64, i64) -> bool),
        );
        self.contribs.push(c);
        self.contribs.len() - 1
    }

    /// A unit with its variants (contribution ids, the current one first), their visibility and
    /// which are banned. Its index.
    pub fn add_candidate(&mut self, contribs: &[u32], visibility: &[f64], banned: &[u8]) -> usize {
        self.cands.push(Cand {
            contribs: contribs.iter().map(|&c| c as usize).collect(),
            visibility: visibility.to_vec(),
            banned: banned.iter().map(|&b| b != 0).collect(),
            chosen: 0,
        });
        self.cands.len() - 1
    }

    /// The candidate of each object (-1: none), then the groups: units sharing an open cell, in
    /// the order of their first unit. Returns the number of groups.
    pub fn link(&mut self, obj_cand: &[i32]) -> usize {
        self.obj_cand = obj_cand.iter().map(|&c| c as i64).collect();
        let n = self.cands.len();
        let mut parent: Vec<usize> = (0..n).collect();
        fn find(parent: &mut [usize], x: usize) -> usize {
            let mut r = x;
            while parent[r] != r {
                r = parent[r];
            }
            let mut y = x;
            while parent[y] != r {
                let next = parent[y];
                parent[y] = r;
                y = next;
            }
            r
        }
        for (_, who) in &self.carriers {
            let mut c: Vec<usize> = vec![];
            for &x in who {
                let k = self.obj_cand[x];
                if k >= 0 && !c.contains(&(k as usize)) {
                    c.push(k as usize);
                }
            }
            for k in 1..c.len() {
                let a = find(&mut parent, c[k]);
                let b = find(&mut parent, c[0]);
                parent[a] = b;
            }
        }
        let mut groups: Vec<Vec<usize>> = vec![];
        let mut index: IdMap<usize, usize> = IdMap::default();
        for c in 0..n {
            let g = find(&mut parent, c);
            match index.get(&g) {
                Some(&i) => groups[i].push(c),
                None => {
                    index.insert(g, groups.len());
                    groups.push(vec![c]);
                }
            }
        }
        self.groups = groups;
        self.groups.len()
    }

    /// Puts contribution `to` in the place of `from`, keeping the tally.
    fn swap_ids(&mut self, from: usize, to: usize) {
        let Search {
            f,
            contribs,
            target,
            tally,
            base,
            ..
        } = self;
        f.swap(
            &contribs[from],
            &contribs[to],
            |c, was, now, risk_was, risk_now| {
                if target[c] != 0 {
                    let open = |l: u8| l == CRITICAL;
                    if open(was) && !open(now) {
                        tally.fixed += 1;
                    } else if !open(was) && open(now) {
                        tally.fixed -= 1;
                    }
                }
                tally.new_critical += risk_now as i64 - risk_was as i64;
                if base[c] == SAFE {
                    if was != SAFE {
                        tally.new_caution -= 1;
                    }
                    if now != SAFE {
                        tally.new_caution += 1;
                    }
                }
            },
        );
    }

    /// Switches candidate `c` to variant `k`.
    pub fn choose(&mut self, c: usize, k: usize) {
        let cand = &self.cands[c];
        if cand.chosen == k {
            return;
        }
        let (from, to) = (cand.contribs[cand.chosen], cand.contribs[k]);
        self.swap_ids(from, to);
        self.cands[c].chosen = k;
    }

    pub fn chosen(&self) -> Vec<u32> {
        self.cands.iter().map(|c| c.chosen as u32).collect()
    }

    pub fn ban(&mut self, c: usize, k: usize) {
        self.cands[c].banned[k] = true;
    }

    pub fn set_visibility(&mut self, c: usize, k: usize, v: f64) {
        self.cands[c].visibility[k] = v;
    }

    /// Replaces the predicted thread of the chosen variant of candidate `c` by what it gives sewn
    /// for real (`s` with its bounds).
    pub fn replace(&mut self, c: usize, s: &Records, bounds: [f64; 4]) {
        let real = self.f.contribution(s, bounds, None);
        self.contribs.push(real);
        let id = self.contribs.len() - 1;
        let k = self.cands[c].chosen;
        let old = self.cands[c].contribs[k];
        self.swap_ids(old, id);
        self.cands[c].contribs[k] = id;
    }

    /// Lexicographic: open cells fixed, then measured visibility, new caution, objects touched.
    fn value(&self, g: usize) -> f64 {
        if self.tally.new_critical > 0 {
            return f64::NEG_INFINITY;
        }
        let mut vis = 0.0;
        let mut touched = 0.0;
        for &c in &self.groups[g] {
            let cand = &self.cands[c];
            vis += cand.visibility[cand.chosen];
            if cand.chosen != 0 {
                touched += 1.0;
            }
        }
        self.tally.fixed as f64 * 1e6 - vis * 1e3 - self.tally.new_caution as f64 * 20.0 - touched
    }

    fn keep(&mut self, g: usize) {
        let val = self.value(g);
        let best = self.state.as_ref().unwrap().best;
        if val > best {
            let choice = self.groups[g]
                .iter()
                .map(|&c| self.cands[c].chosen)
                .collect();
            let st = self.state.as_mut().unwrap();
            st.best = val;
            st.best_choice = choice;
        }
    }

    /// Starts searching group `g`: banned variants leave the choice first. Returns the number of
    /// combinations of its allowed variants.
    pub fn begin_group(&mut self, g: usize) -> f64 {
        for i in 0..self.groups[g].len() {
            let c = self.groups[g][i];
            if self.cands[c].banned[self.cands[c].chosen] {
                self.choose(c, 0);
            }
        }
        let allowed: Vec<Vec<usize>> = self.groups[g]
            .iter()
            .map(|&c| {
                let cand = &self.cands[c];
                (0..cand.contribs.len())
                    .filter(|&k| !cand.banned[k])
                    .collect()
            })
            .collect();
        let combos = allowed.iter().fold(1.0, |a, l| a * l.len() as f64);
        let start: Vec<usize> = self.groups[g]
            .iter()
            .map(|&c| self.cands[c].chosen)
            .collect();
        self.state = Some(GroupState {
            allowed,
            best: self.value(g),
            best_choice: start.clone(),
            start,
        });
        combos
    }

    /// What the exact program found for group `g` (one variant per unit), or None. In `mip` mode
    /// its choice stands when it breaks no rule (returns true: the group is done); else the search
    /// goes on from where the group started.
    pub fn mip_result(&mut self, g: usize, choice: Option<&[u32]>, mip: bool) -> bool {
        if let Some(choice) = choice {
            for (k, &x) in choice.iter().enumerate() {
                let c = self.groups[g][k];
                self.choose(c, x as usize);
            }
            self.keep(g);
        }
        let st = self.state.as_ref().unwrap();
        let back = if mip {
            st.best_choice.clone()
        } else {
            st.start.clone()
        };
        for (k, x) in back.into_iter().enumerate() {
            let c = self.groups[g][k];
            self.choose(c, x);
        }
        let done = mip && choice.is_some() && self.value(g) > f64::NEG_INFINITY;
        if done {
            self.state = None;
        }
        done
    }

    /// Every combination of the allowed variants of units `sub` (indices in group `g`).
    fn exhaust(&mut self, g: usize, sub: &[usize], j: usize) {
        if j == sub.len() {
            self.keep(g);
            return;
        }
        let k = sub[j];
        let allowed = self.state.as_ref().unwrap().allowed[k].clone();
        for x in allowed {
            let c = self.groups[g][k];
            self.choose(c, x);
            self.exhaust(g, sub, j + 1);
        }
    }

    /// Indices in group `g` of the units sharing open cells with unit `k`, `k` first.
    fn neighbours(&self, g: usize, k: usize) -> Vec<usize> {
        let group = &self.groups[g];
        let me = group[k] as i64;
        let mut near: Vec<i64> = vec![me];
        for (_, who) in &self.carriers {
            if who.iter().any(|&x| self.obj_cand[x] == me) {
                for &x in who {
                    let c = self.obj_cand[x];
                    if c >= 0 && !near.contains(&c) {
                        near.push(c);
                    }
                }
            }
        }
        let mut out = vec![k];
        for (j, &c) in group.iter().enumerate() {
            if j != k && near.contains(&(c as i64)) {
                out.push(j);
            }
        }
        out
    }

    /// Searches group `g` (after begin_group): completely when it is small, else greedily and by
    /// large neighbourhoods within `budget_ms` of work, then leaves its best choice in place.
    pub fn search_group(&mut self, g: usize, budget_ms: f64) {
        let size = self.groups[g].len();
        let combos = self
            .state
            .as_ref()
            .unwrap()
            .allowed
            .iter()
            .fold(1.0, |a, l| a * l.len() as f64);
        if combos <= EXHAUSTIVE {
            let all: Vec<usize> = (0..size).collect();
            self.exhaust(g, &all, 0);
        } else {
            // Greedy from the current choice, then large neighbourhoods: a few objects at once,
            // exactly. Budgeted by work, not by the clock: the same design gets the same answer on
            // any machine.
            let end = self.f.work + budget_ms * WORK_PER_MS;
            let mut improved = true;
            while improved && self.f.work < end {
                improved = false;
                for k in 0..size {
                    let c = self.groups[g][k];
                    let was = self.cands[c].chosen;
                    let mut local_best = self.value(g);
                    let mut pick = was;
                    let allowed = self.state.as_ref().unwrap().allowed[k].clone();
                    for x in allowed {
                        self.choose(c, x);
                        let val = self.value(g);
                        if val > local_best {
                            local_best = val;
                            pick = x;
                        }
                    }
                    self.choose(c, pick);
                    if pick != was {
                        improved = true;
                    }
                }
                self.keep(g);
            }
            let mut seed: i64 = 1;
            let mut stale = 0;
            while self.f.work < end && stale < STALE {
                let best_choice = self.state.as_ref().unwrap().best_choice.clone();
                for (k, x) in best_choice.into_iter().enumerate() {
                    let c = self.groups[g][k];
                    self.choose(c, x);
                }
                // A neighbourhood: one object and those sharing open cells with it, up to five.
                seed = lcg(seed);
                let r = seed as f64 / 0x7fff_ffff as f64;
                let pivot = (r * size as f64).floor() as usize;
                let near: Vec<usize> = self.neighbours(g, pivot).into_iter().take(5).collect();
                let st = self.state.as_ref().unwrap();
                let sub: Vec<usize> = near
                    .into_iter()
                    .filter(|&k| st.allowed[k].len() > 1)
                    .collect();
                let before = st.best;
                let n = sub.iter().fold(1.0, |a, &k| a * st.allowed[k].len() as f64);
                if n <= EXHAUSTIVE {
                    self.exhaust(g, &sub, 0);
                }
                stale = if self.state.as_ref().unwrap().best > before {
                    0
                } else {
                    stale + 1
                };
            }
        }
        let best_choice = self.state.take().unwrap().best_choice;
        for (k, x) in best_choice.into_iter().enumerate() {
            let c = self.groups[g][k];
            self.choose(c, x);
        }
    }

    /// Group `g` as units for the exact program.
    pub fn group_units(&self, g: usize) -> Vec<MipUnit<'_>> {
        let st = self.state.as_ref().unwrap();
        self.groups[g]
            .iter()
            .enumerate()
            .map(|(k, &c)| {
                let cand = &self.cands[c];
                MipUnit {
                    contributions: cand.contribs.iter().map(|&i| &self.contribs[i]).collect(),
                    allowed: st.allowed[k].clone(),
                    chosen: cand.chosen,
                    visibility: cand.visibility.clone(),
                }
            })
            .collect()
    }

    pub fn target(&self) -> &[u8] {
        &self.target
    }
}

/// A unit as the exact program sees it.
pub struct MipUnit<'a> {
    pub contributions: Vec<&'a Contribution>,
    /// Variants that may be chosen.
    pub allowed: Vec<usize>,
    pub chosen: usize,
    pub visibility: Vec<f64>,
}
