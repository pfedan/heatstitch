//! The optimizer of the sewing order (planCandidates in src/model/order.ts): greedy orders by
//! thread and shortest ways, 2-opt within a color, and objects sewn from the other side. Reading
//! the objects from the pattern (their ends, threads and the cuts between them), sewing an order
//! and comparing what it gives stay TypeScript.

use crate::js::hypot;

/// Where an object would start and end when sewn from the other side (0.1 mm).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reversal {
    pub sx: f64,
    pub sy: f64,
    pub ex: f64,
    pub ey: f64,
}

/// An object as the optimizer sees it (by index, in the order of the file).
#[derive(Clone, Debug, PartialEq)]
pub struct OrderObject {
    /// Its color block.
    pub block: u32,
    /// Its thread (blockKeys), as a number.
    pub key: u32,
    /// Its first and last stitch (0.1 mm).
    pub first: [f64; 2],
    pub last: [f64; 2],
    /// Where it starts and ends sewn from the other side, when it may be.
    pub rev: Option<Reversal>,
    pub tie_in: bool,
    pub tie_off: bool,
    /// Trims and color changes in the records before its first one, and up to its last one.
    pub cuts_before: u32,
    pub cuts_through: u32,
    /// A trim between it and the next object in the file.
    pub trim_after: bool,
}

/// The options of the order card (OrderOptions in order.ts).
#[derive(Clone, Copy, Debug)]
pub struct OrderOptions {
    pub combine_colors: bool,
    pub shortest_ways: bool,
    pub trim_mm: f64,
}

/// An order and the objects sewn from the other side in it (ascending).
#[derive(Clone, Debug, PartialEq)]
pub struct OrderPlan {
    pub order: Vec<usize>,
    pub flip: Vec<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Link {
    Color,
    Original,
    Trim,
    Jump,
}

/// Sewing one from the other side has to save at least this much (weigh units, 1 per mm).
const FLIP_GAIN: f64 = 2.0;

/// Start and end of each object as sewn (flip 0) or from the other side (flip 1).
struct Ends<'a> {
    objs: &'a [OrderObject],
    rev: bool,
    flip: Vec<u8>,
}

impl Ends<'_> {
    fn can(&self, i: usize) -> bool {
        self.rev && self.objs[i].rev.is_some()
    }
    fn rev_of(&self, i: usize) -> Option<Reversal> {
        if self.rev { self.objs[i].rev } else { None }
    }
    /// Way from the end of `a` to the start of `b` (mm), `b` sewn with `fb`.
    fn gap_with(&self, a: usize, b: usize, fb: u8) -> f64 {
        let ra = if self.flip[a] != 0 {
            self.rev_of(a)
        } else {
            None
        };
        let rb = if fb != 0 { self.rev_of(b) } else { None };
        let (ax, ay) = ra.map_or((self.objs[a].last[0], self.objs[a].last[1]), |r| {
            (r.ex, r.ey)
        });
        let (bx, by) = rb.map_or((self.objs[b].first[0], self.objs[b].first[1]), |r| {
            (r.sx, r.sy)
        });
        hypot(bx - ax, by - ay) / 10.0
    }
    fn gap(&self, a: usize, b: usize) -> f64 {
        self.gap_with(a, b, self.flip[b])
    }
}

/// Whether the file carried the thread between `a` and `b` without a cut, one of them lacking its
/// tie (joinedUncut in objects.ts).
fn joined_uncut(objs: &[OrderObject], a: usize, b: usize) -> bool {
    if objs[a].tie_off && objs[b].tie_in {
        return false;
    }
    let (lo, hi) = if a < b { (a, b) } else { (b, a) };
    objs[hi].cuts_before <= objs[lo].cuts_through
}

/// How the machine goes from `a` to `b` (link in order.ts); `flipped` marks the objects made anew.
fn link(objs: &[OrderObject], a: usize, b: usize, trim_mm: f64, flipped: &[u8], d: f64) -> Link {
    if objs[a].key != objs[b].key {
        return Link::Color;
    }
    let kept = flipped[a] == 0 && flipped[b] == 0;
    if b == a + 1 && objs[b].block == objs[a].block && kept {
        return Link::Original;
    }
    if kept && joined_uncut(objs, a, b) {
        return Link::Jump;
    }
    if d > trim_mm { Link::Trim } else { Link::Jump }
}

/// Color changes, trims and travel (mm) of an order, weighed into one number (orderCost and weigh).
fn order_cost(objs: &[OrderObject], order: &[usize], trim_mm: f64, ends: &Ends) -> f64 {
    let (mut colors, mut trims, mut travel) = (0.0, 0.0, 0.0);
    for k in 1..order.len() {
        let (a, b) = (order[k - 1], order[k]);
        let d = ends.gap(a, b);
        travel += d;
        match link(objs, a, b, trim_mm, &ends.flip, d) {
            Link::Color => {
                colors += 1.0;
                trims += 1.0;
            }
            Link::Trim => trims += 1.0,
            Link::Original if objs[a].trim_after => trims += 1.0,
            _ => {}
        }
    }
    colors * 1000.0 + trims * 40.0 + travel
}

/// Positions in `order` where an object would come before something it lies on (none: valid).
fn valid(order: &[usize], over: &[Vec<usize>]) -> bool {
    let mut pos = vec![usize::MAX; over.len()];
    for (k, &o) in order.iter().enumerate() {
        pos[o] = k;
    }
    order
        .iter()
        .enumerate()
        .all(|(k, &o)| over[o].iter().all(|&a| pos[a] == usize::MAX || pos[a] <= k))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ColorPick {
    Original,
    Complete,
}

fn greedy(
    objs: &[OrderObject],
    over: &[Vec<usize>],
    o: &OrderOptions,
    pick: ColorPick,
    ends: &mut Ends,
) -> Vec<usize> {
    let n = objs.len();
    let mut waiting: Vec<usize> = over.iter().map(Vec::len).collect();
    let mut after: Vec<Vec<usize>> = vec![vec![]; n];
    for (b, l) in over.iter().enumerate() {
        for &a in l {
            after[a].push(b);
        }
    }
    let mut done = vec![false; n];
    let mut order = Vec::with_capacity(n);
    let keys = objs
        .iter()
        .map(|x| x.key as usize)
        .max()
        .map_or(0, |m| m + 1);
    let mut remaining = vec![0usize; keys];
    for x in objs {
        remaining[x.key as usize] += 1;
    }
    let mut next = 0;
    loop {
        // Taken: what lies on it may come now.
        done[next] = true;
        order.push(next);
        remaining[objs[next].key as usize] -= 1;
        for &b in &after[next] {
            waiting[b] = waiting[b].wrapping_sub(1);
        }
        if order.len() >= n {
            break;
        }
        let last = next;
        let avail: Vec<usize> = (0..n).filter(|&i| !done[i] && waiting[i] == 0).collect();
        let pool: Vec<usize> = if !o.combine_colors {
            // Color blocks stay as they are: finish the current block, then the next one in order.
            let block = if avail.iter().any(|&i| objs[i].block == objs[last].block) {
                objs[last].block
            } else {
                avail
                    .iter()
                    .map(|&i| objs[i].block)
                    .min()
                    .unwrap_or(u32::MAX)
            };
            avail
                .iter()
                .copied()
                .filter(|&i| objs[i].block == block)
                .collect()
        } else {
            let same: Vec<usize> = avail
                .iter()
                .copied()
                .filter(|&i| objs[i].key == objs[last].key)
                .collect();
            if !same.is_empty() {
                same
            } else {
                let mut key = avail.iter().min().map(|&i| objs[i].key);
                if pick == ColorPick::Complete {
                    // The thread the most of whose remaining objects can be sewn now.
                    let mut best = -1.0;
                    for &i in &avail {
                        let k = objs[i].key;
                        let share = avail.iter().filter(|&&j| objs[j].key == k).count() as f64
                            / remaining[k as usize] as f64;
                        if share > best + 1e-9 {
                            best = share;
                            key = Some(k);
                        }
                    }
                }
                avail
                    .iter()
                    .copied()
                    .filter(|&i| Some(objs[i].key) == key)
                    .collect()
            }
        };
        // Nothing free to come next only when the layering goes round in a circle.
        let Some(&first) = pool.first() else { break };
        next = first;
        if o.shortest_ways {
            let mut bd = f64::INFINITY;
            let mut bf = 0u8;
            for &i in &pool {
                for f in 0..=u8::from(ends.can(i)) {
                    // Going on with the object that followed in the file keeps its move as it was.
                    let bonus = if i == last + 1 && f == 0 && ends.flip[last] == 0 {
                        0.5
                    } else {
                        0.0
                    };
                    let d = ends.gap_with(last, i, f) - bonus;
                    // Sewing one from the other side has to be clearly shorter: it means new stitches.
                    let df = d + f64::from(f);
                    if df < bd {
                        bd = df;
                        next = i;
                        bf = f;
                    }
                }
            }
            ends.flip[next] = bf;
        } else {
            next = *pool.iter().min().unwrap();
        }
    }
    order
}

/// 2-opt within runs of one color: reverses stretches where that shortens the moves.
fn untangle(objs: &[OrderObject], over: &[Vec<usize>], order: &[usize], ends: &Ends) -> Vec<usize> {
    let mut out = order.to_vec();
    let d = |a: usize, b: usize| ends.gap(a, b);
    let mut start = 0;
    let mut in_seg = vec![false; objs.len()];
    while start < out.len() {
        let mut end = start;
        while end + 1 < out.len() && objs[out[end + 1]].key == objs[out[start]].key {
            end += 1;
        }
        if end - start >= 2 && end - start < 250 {
            for _pass in 0..4 {
                let mut improved = false;
                for i in start..end {
                    for j in i + 1..=end {
                        // Moves into, inside and out of the stretch before and after reversing it.
                        let mut before = 0.0;
                        let mut after_rev = 0.0;
                        if i > 0 {
                            before += d(out[i - 1], out[i]);
                            after_rev += d(out[i - 1], out[j]);
                        }
                        if j + 1 < out.len() {
                            before += d(out[j], out[j + 1]);
                            after_rev += d(out[i], out[j + 1]);
                        }
                        for k in i..j {
                            before += d(out[k], out[k + 1]);
                            after_rev += d(out[k + 1], out[k]);
                        }
                        if after_rev >= before - 0.05 {
                            continue;
                        }
                        // Nothing in the stretch may lie on another part of it.
                        for &o in &out[i..=j] {
                            in_seg[o] = true;
                        }
                        let blocked = out[i..=j]
                            .iter()
                            .any(|&o| over[o].iter().any(|&a| in_seg[a]));
                        for &o in &out[i..=j] {
                            in_seg[o] = false;
                        }
                        if blocked {
                            continue;
                        }
                        out[i..=j].reverse();
                        improved = true;
                    }
                }
                if !improved {
                    break;
                }
            }
        }
        start = end + 1;
    }
    out
}

/// Turns objects around one at a time where that makes the order cheaper (a few passes).
fn improve_flips(objs: &[OrderObject], order: &[usize], trim_mm: f64, ends: &mut Ends) {
    let mut cost = order_cost(objs, order, trim_mm, ends);
    for _pass in 0..3 {
        let mut changed = false;
        for &i in order {
            if !ends.can(i) {
                continue;
            }
            ends.flip[i] ^= 1;
            let c = order_cost(objs, order, trim_mm, ends);
            // Turned around only for a real saving, and back again when that is not worse.
            let need = if ends.flip[i] != 0 { FLIP_GAIN } else { -1e-6 };
            if c < cost - need {
                cost = c;
                changed = true;
            } else {
                ends.flip[i] ^= 1;
            }
        }
        if !changed {
            break;
        }
    }
}

/// Every order the optimizer finds (and, where objects may be sewn from the other side, those
/// best sewn so in each), cheapest by the model first, each only when it is cheaper by the model
/// than the original; empty when nothing is. `over[b]`: the objects `b` lies on.
pub fn plan_candidates(
    objs: &[OrderObject],
    over: &[Vec<usize>],
    o: &OrderOptions,
) -> Vec<OrderPlan> {
    let n = objs.len();
    if n < 1 {
        return vec![];
    }
    let original: Vec<usize> = (0..n).collect();
    let plain = Ends {
        objs,
        rev: false,
        flip: vec![0; n],
    };
    let base = order_cost(objs, &original, o.trim_mm, &plain);
    let mut found: Vec<(OrderPlan, f64)> = vec![];
    let mut consider = |order: Vec<usize>, ends: &Ends| {
        if !valid(&order, over) {
            return;
        }
        let c = order_cost(objs, &order, o.trim_mm, ends);
        let flip: Vec<usize> = (0..n).filter(|&i| ends.flip[i] != 0).collect();
        let gain = if flip.is_empty() { 0.0 } else { FLIP_GAIN };
        // Sewing some from the other side has to save clearly more than the order alone.
        if c >= base - 1e-6 - gain {
            return;
        }
        if found
            .iter()
            .any(|(p, _)| p.order == order && p.flip == flip)
        {
            return;
        }
        found.push((OrderPlan { order, flip }, c + gain));
    };
    let flipping = objs.iter().any(|x| x.rev.is_some());
    for pick in [ColorPick::Original, ColorPick::Complete] {
        for with_flips in if flipping {
            vec![false, true]
        } else {
            vec![false]
        } {
            if n < 2 && !with_flips {
                continue;
            }
            let mut ends = Ends {
                objs,
                rev: with_flips,
                flip: vec![0; n],
            };
            let mut order = if n < 2 {
                original.clone()
            } else {
                greedy(objs, over, o, pick, &mut ends)
            };
            if o.shortest_ways {
                order = untangle(objs, over, &order, &ends);
            }
            if with_flips {
                improve_flips(objs, &order, o.trim_mm, &mut ends);
            }
            consider(order, &ends);
        }
    }
    // The original order with only some objects reversed.
    if flipping {
        let mut ends = Ends {
            objs,
            rev: true,
            flip: vec![0; n],
        };
        improve_flips(objs, &original, o.trim_mm, &mut ends);
        consider(original, &ends);
    }
    found.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    found.into_iter().map(|(p, _)| p).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(block: u32, key: u32, at: [f64; 2]) -> OrderObject {
        OrderObject {
            block,
            key,
            first: at,
            last: at,
            rev: None,
            tie_in: true,
            tie_off: true,
            cuts_before: 0,
            cuts_through: 0,
            trim_after: false,
        }
    }

    #[test]
    fn sews_one_thread_together() {
        // Red, blue, red, nothing on top of another: both reds together saves a color change.
        let objs = vec![
            obj(0, 0, [0.0, 0.0]),
            obj(1, 1, [100.0, 0.0]),
            obj(2, 0, [10.0, 0.0]),
        ];
        let o = OrderOptions {
            combine_colors: true,
            shortest_ways: true,
            trim_mm: 2.0,
        };
        let plans = plan_candidates(&objs, &[vec![], vec![], vec![]], &o);
        assert_eq!(plans[0].order, vec![0, 2, 1]);
        // The last red lying on the blue keeps it after the blue: nothing is better.
        assert!(plan_candidates(&objs, &[vec![], vec![], vec![1]], &o).is_empty());
    }
}
