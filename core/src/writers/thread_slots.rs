//! Palette slots for the formats that store threads as palette indices (src/writers/threadSlots.ts),
//! matched by CIEDE2000 (image::color).

use std::collections::HashMap;

use crate::image::color::{Lab, delta_e2000, rgb_to_lab};
use crate::pattern::ThreadColor;

/// Palette slot per color block for formats that store threads as palette indices (PEC, JEF). Every
/// distinct color gets a slot of its own, so two different threads never show up on the machine as
/// the same one. The distinct colors are assigned to the slots at the least total squared CIEDE2000
/// difference (Hungarian method), so no color takes a slot another one needs more. A color keeps
/// the slot `own` names for it (one read from the file) unless another color has it already.
/// Colors beyond the number of slots share their nearest slot.
pub fn unique_slots(
    colors: &[ThreadColor],
    slots: &[u32],
    color_of: impl Fn(u32) -> ThreadColor,
    own: impl Fn(&ThreadColor) -> Option<u32>,
) -> Vec<u32> {
    let lab = |c: &ThreadColor| rgb_to_lab(c.r, c.g, c.b);
    let slot_labs: Vec<Lab> = slots.iter().map(|&s| lab(&color_of(s))).collect();
    let key = |c: &ThreadColor| (c.r, c.g, c.b, c.pec_index);
    let mut distinct: Vec<&ThreadColor> = vec![];
    let mut row = HashMap::new();
    for c in colors {
        row.entry(key(c)).or_insert_with(|| {
            distinct.push(c);
            distinct.len() - 1
        });
    }
    let costs: Vec<Vec<f64>> = distinct
        .iter()
        .map(|c| {
            let (l, o) = (lab(c), own(c));
            slots
                .iter()
                .zip(&slot_labs)
                .map(|(&s, sl)| {
                    if o == Some(s) {
                        -1.0
                    } else {
                        let d = delta_e2000(&l, sl);
                        d * d
                    }
                })
                .collect()
        })
        .collect();
    let assigned = assign(&costs[..costs.len().min(slots.len())], slots.len());
    let nearest = |r: usize| {
        let mut best = 0;
        for j in 1..slots.len() {
            if costs[r][j] < costs[r][best] {
                best = j;
            }
        }
        slots[best]
    };
    colors
        .iter()
        .map(|c| {
            let r = row[&key(c)];
            assigned
                .get(r)
                .map(|&j| slots[j])
                .unwrap_or_else(|| nearest(r))
        })
        .collect()
}

/// Minimum-cost assignment of n rows to distinct columns out of m >= n (Hungarian method with
/// potentials, O(n^2 m)). Returns the column of each row.
pub fn assign(cost: &[Vec<f64>], m: usize) -> Vec<usize> {
    let n = cost.len();
    let mut u = vec![0.0; n + 1];
    let mut v = vec![0.0; m + 1];
    let mut owner = vec![0usize; m + 1]; // row (1-based) holding each column, 0 = free
    let mut way = vec![0usize; m + 1];
    for i in 1..=n {
        owner[0] = i;
        let mut j0 = 0;
        let mut minv = vec![f64::INFINITY; m + 1];
        let mut used = vec![false; m + 1];
        loop {
            used[j0] = true;
            let i0 = owner[j0];
            let mut delta = f64::INFINITY;
            let mut j1 = 0;
            for j in 1..=m {
                if used[j] {
                    continue;
                }
                let cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
                if cur < minv[j] {
                    minv[j] = cur;
                    way[j] = j0;
                }
                if minv[j] < delta {
                    delta = minv[j];
                    j1 = j;
                }
            }
            for j in 0..=m {
                if used[j] {
                    u[owner[j]] += delta;
                    v[j] -= delta;
                } else {
                    minv[j] -= delta;
                }
            }
            j0 = j1;
            if owner[j0] == 0 {
                break;
            }
        }
        loop {
            let j1 = way[j0];
            owner[j0] = owner[j1];
            j0 = j1;
            if j0 == 0 {
                break;
            }
        }
    }
    let mut out = vec![0; n];
    for j in 1..=m {
        if owner[j] != 0 {
            out[owner[j] - 1] = j - 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assigns_at_least_cost() {
        let cost = vec![
            vec![4.0, 1.0, 3.0],
            vec![2.0, 0.0, 5.0],
            vec![3.0, 2.0, 2.0],
        ];
        assert_eq!(assign(&cost, 3), vec![1, 0, 2]);
    }

    #[test]
    fn distinct_colors_get_distinct_slots() {
        let palette = |s: u32| ThreadColor {
            r: (s * 100) as u8,
            ..Default::default()
        };
        let c = |r: u8| ThreadColor {
            r,
            ..Default::default()
        };
        let slots = unique_slots(&[c(10), c(20), c(10), c(250)], &[0, 1, 2], palette, |_| {
            None
        });
        assert_eq!(slots[0], slots[2]);
        assert_ne!(slots[0], slots[1]);
        assert_eq!(slots[3], 2);
    }
}
