//! The order of the sections of a fill as one tour that keeps all travel hidden.
//!
//! Sections are the cells of the boustrophedon decomposition (Choset 2000): each is sewn back and
//! forth in one go, from the row on one of its sides to the row on the other. Sections that touch
//! across a row line form a graph (the Reeb graph of the decomposition, with cells as nodes). Coverage
//! planning tours that graph as a postman tour (Mannadiar & Rekleitis 2010): on a tree the cheapest
//! tour is a depth-first one, every edge walked twice, except along the way from start to end.
//!
//! Embroidery adds one rule: travel only hides under rows still to come. So each section is sewn on
//! its last visit and every earlier pass through it is travel under its rows to come: the tour walks
//! down the spanning tree to the far end of a branch through rows not sewn yet, and sews back towards
//! the root (postorder: a section after all sections beyond it, ending on the side its parent lies).
//! Every way then runs through sections still to come, so a connected area needs no trim and no
//! travel on top of sewn rows. Areas with holes have cycles in the graph; their spanning tree keeps
//! the widest touches, where hidden ways are roomiest. A postman tour over a cycle (with a matching of
//! its odd nodes) could save one way along it, but would cross a section sewn already where the cycle
//! closes; the tree tour never does.
//!
//! What is left to choose is cheap to search exactly: which section is sewn last (the root) and from
//! which side, and in which order the branches are taken (those on the side the section ends first,
//! each group nearest first). Every root is tried; the cheapest tour by the straight ways counts.
//! Separate parts of the area (holes cut it apart, parts left out) are toured one after another,
//! nearest bound first with branch and bound (the same choice as touring every part).

use crate::geom::Pt;
use crate::js::{IdMap, dist};

/// Where a section touches another across one of its sides (0: its first row, 1: its last).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Touch {
    pub to: usize,
    pub side: u8,
    /// The middle of where they touch.
    pub at: Pt,
    /// How long they touch along the rows (mm).
    pub width: f64,
}

/// A way to sew a section starting at one side: the entry point and where it leaves the needle.
#[derive(Clone, Debug)]
pub struct Way<W> {
    pub w: W,
    pub p: Pt,
    pub exit: Pt,
}

pub struct TourInput<'a, W> {
    pub touches: Vec<Vec<Touch>>,
    /// The length of the way between two points inside the area; never shorter than the straight line.
    pub dist: &'a dyn Fn(Pt, Pt) -> f64,
    /// The ways to sew section i starting at side `from` (the ends of that row).
    pub ways: &'a dyn Fn(usize, u8) -> Vec<Way<W>>,
}

#[derive(Clone, Debug)]
pub struct Step<W> {
    pub i: usize,
    pub from: u8,
    pub w: W,
}

/// Parts of the graph: the sections each part holds.
fn parts(touches: &[Vec<Touch>]) -> Vec<Vec<usize>> {
    let mut seen = vec![false; touches.len()];
    let mut out = Vec::new();
    for i in 0..touches.len() {
        if seen[i] {
            continue;
        }
        let mut part = vec![i];
        seen[i] = true;
        let mut j = 0;
        while j < part.len() {
            for t in &touches[part[j]] {
                if !seen[t.to] {
                    seen[t.to] = true;
                    part.push(t.to);
                }
            }
            j += 1;
        }
        out.push(part);
    }
    out
}

/// A touch between two sections of a part, from both sides.
#[derive(Clone, Copy)]
struct Edge {
    a: usize,
    b: usize,
    ta: Touch,
    tb: Touch,
}

fn edges_of(part: &[usize], touches: &[Vec<Touch>]) -> Vec<Edge> {
    let mut out = Vec::new();
    for &a in part {
        for ta in &touches[a] {
            if ta.side != 1 {
                continue;
            }
            let tb = *touches[ta.to]
                .iter()
                .find(|x| x.to == a && x.side == 0)
                .expect("a touch from both sides");
            out.push(Edge {
                a,
                b: ta.to,
                ta: *ta,
                tb,
            });
        }
    }
    out
}

type Tree = IdMap<usize, Vec<Touch>>;

/// The tree of these edges: for each section, the touches to its neighbours.
fn tree_of(part: &[usize], edges: &[&Edge]) -> Tree {
    let mut tree: Tree = part.iter().map(|&i| (i, Vec::new())).collect();
    for e in edges {
        tree.get_mut(&e.a).unwrap().push(e.ta);
        tree.get_mut(&e.b).unwrap().push(e.tb);
    }
    tree
}

/// Union-find over the sections of a part.
struct Up(IdMap<usize, usize>);

impl Up {
    fn new(part: &[usize]) -> Up {
        Up(part.iter().map(|&i| (i, i)).collect())
    }
    fn find(&self, mut i: usize) -> usize {
        loop {
            let u = self.0[&i];
            if u == i {
                return i;
            }
            i = u;
        }
    }
}

/// Whether these edges hold the part together (with as many edges as a tree has, then a tree).
fn connects(part: &[usize], edges: &[&Edge]) -> bool {
    let mut up = Up::new(part);
    let mut n = part.len();
    for e in edges {
        let (x, y) = (up.find(e.a), up.find(e.b));
        if x != y {
            up.0.insert(x, y);
            n -= 1;
        }
    }
    n == 1
}

/// Whether adding e to these edges would close a cycle.
fn same_side(part: &[usize], edges: &[&Edge], e: &Edge) -> bool {
    let mut up = Up::new(part);
    for x in edges {
        let (fa, fb) = (up.find(x.a), up.find(x.b));
        up.0.insert(fa, fb);
    }
    up.find(e.a) == up.find(e.b)
}

/// Up to this many spanning trees of a part with holes are tried.
const TREES: usize = 400;

/// Spanning trees of a part. Each hole closes one cycle; leaving out one touch of every cycle gives
/// a tree, and every choice is tried while they are few. The widest tree (keeping the longest
/// touches, where hidden ways are roomiest) comes first.
fn spanning_trees(part: &[usize], touches: &[Vec<Touch>]) -> Vec<Tree> {
    let mut edges = edges_of(part, touches);
    edges.sort_by(|x, y| y.ta.width.partial_cmp(&x.ta.width).unwrap());
    let drop = edges.len() as i64 - (part.len() as i64 - 1);
    // Kruskal by width: the widest tree.
    let mut widest: Vec<&Edge> = Vec::new();
    for e in &edges {
        if !same_side(part, &widest, e) {
            widest.push(e);
        }
    }
    let mut trees = vec![tree_of(part, &widest)];
    if drop <= 0 {
        return trees;
    }
    let drop = drop as usize;
    let mut count = 1.0;
    for i in 0..drop {
        count = (count * (edges.len() - i) as f64) / (i + 1) as f64;
    }
    if count > (TREES * 4) as f64 {
        return trees;
    }
    fn pick(
        part: &[usize],
        edges: &[Edge],
        trees: &mut Vec<Tree>,
        from: usize,
        left: usize,
        out: &mut Vec<usize>,
    ) {
        if trees.len() >= TREES {
            return;
        }
        if left == 0 {
            let kept: Vec<&Edge> = edges
                .iter()
                .enumerate()
                .filter(|(i, _)| !out.contains(i))
                .map(|(_, e)| e)
                .collect();
            if connects(part, &kept) {
                trees.push(tree_of(part, &kept));
            }
            return;
        }
        let mut i = from;
        while i + left <= edges.len() {
            out.push(i);
            pick(part, edges, trees, i + 1, left - 1, out);
            out.pop();
            i += 1;
        }
    }
    pick(part, &edges, &mut trees, 0, drop, &mut Vec::new());
    trees
}

pub struct Toured<W> {
    pub steps: Vec<Step<W>>,
    pub cost: f64,
    pub pos: Pt,
}

/// The postorder tour of a tree from `root`, sewn starting at side `from`, entered at `pos`:
/// the sections in sewing order and the straight length of the ways between them.
fn postorder<W: Clone>(
    tree: &Tree,
    input: &TourInput<W>,
    root: usize,
    from: u8,
    pos: Pt,
    finish: Option<&dyn Fn(Pt) -> f64>,
) -> Toured<W> {
    struct St<'b, 'a, W> {
        tree: &'b Tree,
        input: &'b TourInput<'a, W>,
        root: usize,
        finish: Option<&'b dyn Fn(Pt) -> f64>,
        steps: Vec<Step<W>>,
        cost: f64,
        pos: Pt,
    }
    fn visit<W: Clone>(st: &mut St<W>, s: usize, start: u8, parent: Option<usize>) {
        let end = 1 - start;
        // Branches on the side the section ends first, then those on the side it starts: the needle
        // ends up where the section begins. Each group nearest first.
        for side in [end, start] {
            let mut todo: Vec<Touch> = st.tree[&s]
                .iter()
                .filter(|t| Some(t.to) != parent && t.side == side)
                .copied()
                .collect();
            while !todo.is_empty() {
                let d = st.input.dist;
                let mut bi = 0;
                for i in 1..todo.len() {
                    if d(st.pos, todo[i].at) < d(st.pos, todo[bi].at) {
                        bi = i;
                    }
                }
                let t = todo.remove(bi);
                // The branch touches this section across its side t.side; it ends there, so starts on the other.
                visit(st, t.to, t.side, Some(s));
            }
        }
        // The root, sewn last, also by where it leaves the needle.
        let d = st.input.dist;
        let pos = st.pos;
        let fin = if s == st.root { st.finish } else { None };
        let tail = |w: &Way<W>| d(pos, w.p) + fin.map_or(0.0, |f| f(w.exit));
        let mut best: Option<(Way<W>, f64)> = None;
        for w in (st.input.ways)(s, start) {
            let t = tail(&w);
            if best.as_ref().is_none_or(|b| t < b.1) {
                best = Some((w, t));
            }
        }
        let (best, _) = best.expect("a way into every section");
        st.cost += d(st.pos, best.p);
        st.pos = best.exit;
        st.steps.push(Step {
            i: s,
            from: start,
            w: best.w,
        });
    }
    let mut st = St {
        tree,
        input,
        root,
        finish,
        steps: Vec::new(),
        cost: 0.0,
        pos,
    };
    visit(&mut st, root, from, None);
    Toured {
        steps: st.steps,
        cost: st.cost,
        pos: st.pos,
    }
}

/// The cheapest tree tour of one part from `pos` (with `end`, the way on there counts too).
pub fn tour_part<W: Clone>(
    part: &[usize],
    input: &TourInput<W>,
    pos: Pt,
    end: Option<&dyn Fn(Pt) -> f64>,
) -> Toured<W> {
    let mut best: Option<Toured<W>> = None;
    for tree in spanning_trees(part, &input.touches) {
        for &root in part {
            for from in [0, 1] {
                let t = postorder(&tree, input, root, from, pos, end);
                let c = t.cost + end.map_or(0.0, |e| e(t.pos));
                if best.as_ref().is_none_or(|b| c < b.cost) {
                    best = Some(Toured { cost: c, ..t });
                }
            }
        }
    }
    best.expect("a part has a section")
}

/// Up to this many parts, every order of them is tried.
const ORDER_ALL: usize = 5;

/// Sews the parts in a given order: the steps and their cost.
type Run<'a, W> = dyn Fn(&[&Vec<usize>]) -> (Vec<Step<W>>, f64) + 'a;

/// The tour of all sections from `start`. With `end`, what ending at a point costs; `jump`, what a
/// way between parts costs on top of its length (they are often a trim apart).
pub fn tour<W: Clone>(
    input: &TourInput<W>,
    start: Pt,
    end: Option<&dyn Fn(Pt) -> f64>,
    jump: f64,
) -> Vec<Step<W>> {
    let ps = parts(&input.touches);
    if ps.len() == 1 {
        return tour_part(&ps[0], input, start, end).steps;
    }
    // Several parts: every order of a few, else nearest part next.
    let run = |order: &[&Vec<usize>]| -> (Vec<Step<W>>, f64) {
        let mut pos = start;
        let mut cost = 0.0;
        let mut steps = Vec::new();
        for (k, part) in order.iter().enumerate() {
            let t = tour_part(
                part,
                input,
                pos,
                if k == order.len() - 1 { end } else { None },
            );
            cost += t.cost + if k > 0 { jump } else { 0.0 };
            steps.extend(t.steps);
            pos = t.pos;
        }
        (steps, cost)
    };
    if ps.len() <= ORDER_ALL {
        let mut best: Option<(Vec<Step<W>>, f64)> = None;
        fn perm<'p, W>(
            left: Vec<&'p Vec<usize>>,
            done: &mut Vec<&'p Vec<usize>>,
            run: &Run<'_, W>,
            best: &mut Option<(Vec<Step<W>>, f64)>,
        ) {
            if left.is_empty() {
                let r = run(done);
                if best.as_ref().is_none_or(|b| r.1 < b.1) {
                    *best = Some(r);
                }
                return;
            }
            for i in 0..left.len() {
                let mut rest = left.clone();
                let p = rest.remove(i);
                done.push(p);
                perm(rest, done, run, best);
                done.pop();
            }
        }
        perm(ps.iter().collect(), &mut Vec::new(), &run, &mut best);
        return best.unwrap().0;
    }
    // The entries of each part, for a bound on what touring it from somewhere costs.
    let entries: Vec<Vec<Pt>> = ps
        .iter()
        .map(|part| {
            part.iter()
                .flat_map(|&i| {
                    let mut w = (input.ways)(i, 0);
                    w.extend((input.ways)(i, 1));
                    w.into_iter().map(|w| w.p)
                })
                .collect()
        })
        .collect();
    let mut left: Vec<usize> = (0..ps.len()).collect();
    let mut order: Vec<&Vec<usize>> = Vec::new();
    let mut pos = start;
    while !left.is_empty() {
        // The part whose tour from here is cheapest. A tour costs at least the straight way to the
        // part's nearest entry (ways inside are never shorter), so the parts are toured nearest bound
        // first and the search stops once no bound can beat the best tour (branch and bound): the same
        // choice as touring every part, at a fraction of the tours on areas cut into many parts.
        let mut bounds: Vec<(usize, f64)> = left
            .iter()
            .enumerate()
            .map(|(i, &k)| {
                let mut b = f64::INFINITY;
                for &p in &entries[k] {
                    b = b.min(dist(pos, p));
                }
                (i, b)
            })
            .collect();
        bounds.sort_by(|x, y| x.1.partial_cmp(&y.1).unwrap().then(x.0.cmp(&y.0)));
        let mut bi = 0;
        let mut bt: Option<Toured<W>> = None;
        for &(i, b) in &bounds {
            if bt.as_ref().is_some_and(|t| b > t.cost) {
                break;
            }
            let t = tour_part(&ps[left[i]], input, pos, None);
            // Ties go to the part listed first, as when every part was toured in turn.
            let better = match &bt {
                None => true,
                Some(o) => t.cost < o.cost || (t.cost == o.cost && i < bi),
            };
            if better {
                bt = Some(t);
                bi = i;
            }
        }
        order.push(&ps[left.remove(bi)]);
        pos = bt.unwrap().pos;
    }
    run(&order).0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sections in a row, each touching the next across its last row.
    fn chain(n: usize) -> Vec<Vec<Touch>> {
        let mut t = vec![Vec::new(); n];
        for i in 0..n - 1 {
            let at = [i as f64 + 0.5, 0.0];
            t[i].push(Touch {
                to: i + 1,
                side: 1,
                at,
                width: 1.0,
            });
            t[i + 1].push(Touch {
                to: i,
                side: 0,
                at,
                width: 1.0,
            });
        }
        t
    }

    #[test]
    fn a_chain_is_sewn_from_its_far_end() {
        let ways = |i: usize, from: u8| {
            vec![Way {
                w: (i, from),
                p: [i as f64 + if from == 1 { 0.4 } else { 0.0 }, 0.0],
                exit: [i as f64 + if from == 1 { 0.0 } else { 0.4 }, 0.0],
            }]
        };
        let d = |p: Pt, q: Pt| dist(p, q);
        let input = TourInput {
            touches: chain(4),
            dist: &d,
            ways: &ways,
        };
        let steps = tour(&input, [0.0, 0.0], None, 0.0);
        assert_eq!(steps.len(), 4);
        let mut seen: Vec<usize> = steps.iter().map(|s| s.i).collect();
        seen.sort();
        assert_eq!(seen, vec![0, 1, 2, 3]);
    }

    #[test]
    fn parts_apart_are_all_toured() {
        let mut touches = chain(3);
        touches.extend(vec![Vec::new(); 7]);
        let ways = |i: usize, _from: u8| {
            vec![Way {
                w: i,
                p: [i as f64 * 3.0, 1.0],
                exit: [i as f64 * 3.0, 2.0],
            }]
        };
        let d = |p: Pt, q: Pt| dist(p, q);
        let input = TourInput {
            touches,
            dist: &d,
            ways: &ways,
        };
        let steps = tour(&input, [30.0, 0.0], None, 25.0);
        assert_eq!(steps.len(), 10);
        // Nearest part first.
        assert_eq!(steps[0].i, 9);
    }
}
