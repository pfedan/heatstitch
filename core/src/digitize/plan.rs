//! Planning the order of the pieces of a fill on its travel grid (from src/digitize/fill.ts): the
//! next piece is the one reached by the shortest hidden way (under rows still to come), searched
//! greedily with a look one step further (plan_on_grid) or, for a few pieces, as a beam of plans
//! side by side (beam_on_grid).

use super::travel_grid::{Footprint, Kept, TravelGrid};
use crate::geom::Pt;
use crate::js::{IdMap, dist};

/// What a trim costs against travel when choosing the order of sections (mm of travel).
const TRIM_COST: f64 = super::travel_grid::TRIM_COST;
/// How many of the cheapest next steps get a look one step further.
const LOOKAHEAD: usize = 3;
/// How many of the nearest ways on are tried at each step; farther ones would mostly be jumps anyway.
const TRIES: usize = 8;
/// Ending this close to where the next object starts costs only the distance (mm).
const END_NEAR: f64 = 3.0;
/// Up to this many sections, the order is searched more widely: BEAM plans side by side. On random
/// fills with parts left out, 8 plans for up to 8 sections left 16 trims in 72 fills, 16 for up to 16
/// left 8, 32 left 3 but took 250 ms: too slow for every edit.
pub const BEAM_PIECES: usize = 16;
const BEAM: usize = 16;

/// What ending away from `end` (where the next object starts) costs when choosing the order: more
/// than a few millimetres off, as much as a trim, so the next object keeps its start.
pub fn end_cost(p: Pt, end: Pt) -> f64 {
    let d = dist(p, end);
    if d > END_NEAR { d + TRIM_COST } else { d }
}

/// What planning needs of the pieces sewn in one go (sections of straight or wave rows, curved
/// rows), by their index: the ways into a piece (each with its entry point), where it leaves the
/// needle entered that way, and the cells it covers once sewn.
pub trait Pieces {
    type W: Clone;
    fn ways(&self, s: usize) -> Vec<Self::W>;
    fn p(w: &Self::W) -> Pt;
    fn exit(&self, s: usize, w: &Self::W) -> Pt;
    fn prints(&self, s: usize, grid: &mut TravelGrid) -> Vec<Footprint>;
    /// From a to b the needle goes straight, at the cost of the distance (rows close by).
    fn straight(&self, _a: Pt, _b: Pt) -> bool {
        false
    }
}

/// Planning on a grid: its state kept and put back, a piece marked sewn, and what the way from one
/// point to another costs: its length when hidden enough (and not much of a detour), else a trim.
pub struct Planning<'g, 'p, P: Pieces> {
    pub grid: &'g mut TravelGrid,
    pieces: &'p P,
    prints: IdMap<usize, Vec<Footprint>>,
}

pub fn planning<'g, 'p, P: Pieces>(grid: &'g mut TravelGrid, pieces: &'p P) -> Planning<'g, 'p, P> {
    Planning {
        grid,
        pieces,
        prints: IdMap::default(),
    }
}

impl<P: Pieces> Planning<'_, '_, P> {
    pub fn cover(&mut self, s: usize) {
        if !self.prints.contains_key(&s) {
            let fp = self.pieces.prints(s, self.grid);
            self.prints.insert(s, fp);
        }
        for p in &self.prints[&s] {
            self.grid.apply(p);
        }
    }

    pub fn step_cost(&mut self, from: Pt, to: Pt) -> f64 {
        let d = dist(from, to);
        if d <= 1.0 || self.pieces.straight(from, to) || self.grid.clear(from, to) {
            return d;
        }
        match self.grid.length(from, to) {
            Some(l) if l < self.grid.way(d) => l,
            _ => self.grid.trim_cost + d,
        }
    }

    fn keep(&self) -> Kept {
        self.grid.keep()
    }

    fn back(&mut self, k: &Kept) {
        self.grid.back(k);
    }
}

#[derive(Clone)]
struct Cand<W> {
    i: usize,
    e: W,
    d: f64,
    c: f64,
}

/// Order of the pieces on the travel grid: the next piece is the one reached by the shortest
/// hidden way (under rows still to come), entered at the end that leaves a hidden way on, too; a
/// piece only reached by a jump costs a trim. The grid is left as it was.
pub fn plan_on_grid<P: Pieces>(
    u: &P,
    secs: &[usize],
    start: Pt,
    grid: &mut TravelGrid,
    last: Option<(usize, P::W)>,
    end: Option<Pt>,
) -> (Vec<(usize, P::W)>, f64) {
    let mut pl = planning(grid, u);
    let kept = pl.keep();
    // The `n` cheapest ways from `from` into the pieces in `todo` (but `skip`): nearest first, as
    // no way is shorter than the straight line.
    fn cheapest<P: Pieces>(
        pl: &mut Planning<P>,
        u: &P,
        from: Pt,
        todo: &[usize],
        n: usize,
        skip: Option<usize>,
    ) -> Vec<Cand<P::W>> {
        let mut all: Vec<Cand<P::W>> = Vec::new();
        for (i, &s) in todo.iter().enumerate() {
            if Some(i) == skip {
                continue;
            }
            for e in u.ways(s) {
                let d = dist(from, P::p(&e));
                all.push(Cand {
                    i,
                    e,
                    d,
                    c: f64::INFINITY,
                });
            }
        }
        all.sort_by(|x, y| x.d.partial_cmp(&y.d).unwrap());
        let mut best: Vec<Cand<P::W>> = Vec::new();
        for mut c in all.into_iter().take(TRIES) {
            if best.len() >= n && c.d >= best[n - 1].c {
                break;
            }
            c.c = pl.step_cost(from, P::p(&c.e));
            best.push(c);
            best.sort_by(|x, y| x.c.partial_cmp(&y.c).unwrap());
        }
        best.truncate(n);
        best
    }
    let last_s = last.as_ref().map(|l| l.0);
    let mut todo: Vec<usize> = secs
        .iter()
        .copied()
        .filter(|&s| Some(s) != last_s)
        .collect();
    let mut order = Vec::new();
    let mut pos = start;
    let mut cost = 0.0;
    while !todo.is_empty() {
        let cands = cheapest(&mut pl, u, pos, &todo, LOOKAHEAD, None);
        let mut best = cands[0].clone();
        if cands.len() > 1 {
            // One step further: where the section leaves the needle, and how hidden the way on is.
            let mut bs = f64::INFINITY;
            let saved = pl.keep();
            for c in &cands {
                if c.c >= bs {
                    break;
                }
                let s = todo[c.i];
                pl.cover(s);
                let out = u.exit(s, &c.e);
                let next = if todo.len() > 1 {
                    cheapest(&mut pl, u, out, &todo, 1, Some(c.i))[0].c
                } else if let Some(l) = &last {
                    pl.step_cost(out, P::p(&l.1))
                } else if let Some(end) = end {
                    end_cost(out, end)
                } else {
                    0.0
                };
                // Pieces left that no hidden way reaches any more will each need a trim.
                let mut stranded = 0.0;
                if todo.len() > 2 {
                    let seen = pl.grid.flood(out);
                    for (i, &o) in todo.iter().enumerate() {
                        if i != c.i && !u.ways(o).iter().any(|e| pl.grid.reaches(&seen, P::p(e))) {
                            stranded += 1.0;
                        }
                    }
                }
                let total = c.c + next + pl.grid.trim_cost * stranded;
                if total < bs {
                    bs = total;
                    best = c.clone();
                }
                pl.back(&saved);
            }
        }
        let s = todo.remove(best.i);
        cost += best.c;
        pl.cover(s);
        pos = u.exit(s, &best.e);
        order.push((s, best.e));
    }
    if let Some(l) = last {
        cost += pl.step_cost(pos, P::p(&l.1));
        pos = u.exit(l.0, &l.1);
        order.push(l);
    }
    if let Some(end) = end {
        cost += end_cost(pos, end);
    }
    pl.back(&kept);
    (order, cost)
}

struct Plan<W> {
    order: Vec<(usize, W)>,
    cost: f64,
    pos: Pt,
    state: Kept,
}

/// Order of a few sections on the travel grid (see plan_on_grid), searched more widely: step by
/// step the BEAM cheapest plans so far each go on into every section left at each of its ends, and
/// the cheapest of them go on. With `end`, the way there counts too.
pub fn beam_on_grid<P: Pieces>(
    u: &P,
    secs: &[usize],
    start: Pt,
    grid: &mut TravelGrid,
    end: Option<Pt>,
) -> (Vec<(usize, P::W)>, f64) {
    let mut pl = planning(grid, u);
    let kept = pl.keep();
    let mut beam: Vec<Plan<P::W>> = vec![Plan {
        order: Vec::new(),
        cost: 0.0,
        pos: start,
        state: kept.clone(),
    }];
    let pos_of = |s: usize| secs.iter().position(|&x| x == s).unwrap();
    for depth in 0..secs.len() {
        // Every way on, cheapest first by the straight line (no way is shorter); the actual cost is
        // worked out only while it may still get into the beam.
        struct Next<W> {
            from: usize,
            s: usize,
            e: W,
            lb: f64,
            cost: f64,
        }
        let mut next: Vec<Next<P::W>> = Vec::new();
        let last_step = depth == secs.len() - 1;
        for (bi, b) in beam.iter().enumerate() {
            for &s in secs {
                if b.order.iter().any(|o| o.0 == s) {
                    continue;
                }
                for e in u.ways(s) {
                    let tail = match end {
                        Some(end) if last_step => end_cost(u.exit(s, &e), end),
                        _ => 0.0,
                    };
                    let lb = b.cost + dist(b.pos, P::p(&e)) + tail;
                    next.push(Next {
                        from: bi,
                        s,
                        e,
                        lb,
                        cost: f64::INFINITY,
                    });
                }
            }
        }
        next.sort_by(|x, y| x.lb.partial_cmp(&y.lb).unwrap());
        // Indices into `next` of those costed, cheapest first.
        let mut costed: Vec<usize> = Vec::new();
        let mut at: Option<usize> = None;
        // Twice as many as go on are worked out, and those that leave sections out of hidden reach rank lower.
        let wide = 2 * BEAM;
        for ni in 0..next.len().min(BEAM * TRIES) {
            if costed.len() >= wide && next[ni].lb >= next[costed[wide - 1]].cost {
                break;
            }
            if at != Some(next[ni].from) {
                at = Some(next[ni].from);
                pl.back(&beam[next[ni].from].state);
            }
            let fpos = beam[next[ni].from].pos;
            let to = P::p(&next[ni].e);
            next[ni].cost = next[ni].lb + pl.step_cost(fpos, to) - dist(fpos, to);
            costed.push(ni);
            costed.sort_by(|&x, &y| next[x].cost.partial_cmp(&next[y].cost).unwrap());
        }
        let mut plans: Vec<(Plan<P::W>, f64)> = costed
            .iter()
            .take(wide)
            .map(|&ni| {
                let n = &next[ni];
                let from = &beam[n.from];
                pl.back(&from.state);
                pl.cover(n.s);
                let mut order = from.order.clone();
                order.push((n.s, n.e.clone()));
                let pos = u.exit(n.s, &n.e);
                // Sections left that no hidden way reaches any more will each need a trim.
                let mut stranded = 0.0;
                if !last_step {
                    let seen = pl.grid.flood(pos);
                    for &o in secs {
                        if !order.iter().any(|x| x.0 == o)
                            && !u.ways(o).iter().any(|e| pl.grid.reaches(&seen, P::p(e)))
                        {
                            stranded += 1.0;
                        }
                    }
                }
                let rank = n.cost + pl.grid.trim_cost * stranded;
                (
                    Plan {
                        order,
                        cost: n.cost,
                        pos,
                        state: pl.keep(),
                    },
                    rank,
                )
            })
            .collect();
        plans.sort_by(|x, y| x.1.partial_cmp(&y.1).unwrap());
        // One plan for each set of sections sewn so far: the beam does not fill with one set in different orders.
        let mut sets: Vec<Vec<usize>> = Vec::new();
        beam = plans
            .into_iter()
            .filter(|(x, _)| {
                let mut key: Vec<usize> = x.order.iter().map(|o| pos_of(o.0)).collect();
                key.sort_unstable();
                if sets.contains(&key) {
                    false
                } else {
                    sets.push(key);
                    true
                }
            })
            .map(|(x, _)| x)
            .take(BEAM)
            .collect();
    }
    pl.back(&kept);
    let b = beam.swap_remove(0);
    (b.order, b.cost)
}
