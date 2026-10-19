//! Thread colors for the colors of an image. The threads to choose from come from the caller (the
//! Brother palette in the app), each with its Lab color.

use super::color::{Lab, delta_e2000, rgb_to_lab};
use crate::pattern::ThreadColor;

pub struct Thread {
    pub color: ThreadColor,
    pub lab: Lab,
}

pub fn threads_of(colors: Vec<ThreadColor>) -> Vec<Thread> {
    colors
        .into_iter()
        .map(|color| {
            let lab = rgb_to_lab(color.r, color.g, color.b);
            Thread { color, lab }
        })
        .collect()
}

/// Candidate threads per color: the nearest few are enough, a farther one never pays off.
const CANDIDATES: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ThreadMatch {
    /// Index into the threads.
    pub thread: usize,
    /// CIEDE2000 between the color and its thread.
    pub delta_e: f64,
}

/// Nearest thread by CIEDE2000.
pub fn nearest_thread(lab: &Lab, threads: &[Thread]) -> ThreadMatch {
    let mut best = 0;
    let mut bd = f64::INFINITY;
    for (k, t) in threads.iter().enumerate() {
        let d = delta_e2000(lab, &t.lab);
        if d < bd {
            bd = d;
            best = k;
        }
    }
    ThreadMatch {
        thread: best,
        delta_e: bd,
    }
}

/// Threads for the colors of one image, chosen together rather than each on its own: two
/// colors that tell apart in the image (eye white next to light fur) should not end up as the same
/// thread when a second one keeps them apart. As embroidery-streamlines does it (Liu et al.,
/// Eurographics 2023), each choice costs its color difference, and each pair of colors the contrast
/// it loses:
///
///   E = sum_k dE(c_k, t_k)^2 + sum_{i<j} w_i w_j max(0, dE(c_i, c_j) - dE(t_i, t_j))^2
///
/// all CIEDE2000. Colors close enough share a thread still, since a second thread costs more than
/// the little contrast it saves. `weights` (0 to 1, all 1 when left out) say how much a color is one
/// of the image's own rather than the blend along an edge between two others, whose contrast is not
/// worth a thread. Minimized over each color's nearest candidates: iterated conditional modes (Besag
/// 1986) from the nearest threads give a good first answer, branch and bound the exact one.
pub fn match_threads(
    colors: &[Lab],
    weights: Option<&[f64]>,
    threads: &[Thread],
) -> Vec<ThreadMatch> {
    let n = colors.len();
    if threads.is_empty() {
        return vec![];
    }
    let ones = vec![1.0; n];
    let weights = weights.unwrap_or(&ones);
    let cands: Vec<Vec<(usize, f64)>> = colors
        .iter()
        .map(|c| {
            let mut all: Vec<(usize, f64)> = threads
                .iter()
                .enumerate()
                .map(|(j, t)| (j, delta_e2000(c, &t.lab)))
                .collect();
            all.sort_by(|a, b| a.1.total_cmp(&b.1));
            all.truncate(CANDIDATES);
            all
        })
        .collect();
    let contrast: Vec<Vec<f64>> = colors
        .iter()
        .map(|a| colors.iter().map(|b| delta_e2000(a, b)).collect())
        .collect();
    // Thread to thread differences, computed on first use.
    let nt = threads.len();
    let mut between = vec![f64::NAN; nt * nt];
    let mut thread_diff = |a: usize, b: usize| -> f64 {
        if a == b {
            return 0.0;
        }
        let key = a.min(b) * nt + a.max(b);
        if between[key].is_nan() {
            let (lo, hi) = (a.min(b), a.max(b));
            between[key] = delta_e2000(&threads[lo].lab, &threads[hi].lab);
        }
        between[key]
    };
    let mut pick = vec![0usize; n];
    for _ in 0..50 {
        let mut changed = false;
        for k in 0..n {
            let mut cost = |c: usize, pick: &[usize]| {
                let mut e = cands[k][c].1 * cands[k][c].1;
                let j = cands[k][c].0;
                for o in 0..n {
                    if o == k {
                        continue;
                    }
                    let lost = contrast[k][o] - thread_diff(j, cands[o][pick[o]].0);
                    if lost > 0.0 {
                        e += weights[k] * weights[o] * lost * lost;
                    }
                }
                e
            };
            let mut best = pick[k];
            let mut best_e = cost(best, &pick);
            for c in 0..cands[k].len() {
                let e = cost(c, &pick);
                if e < best_e - 1e-9 {
                    best_e = e;
                    best = c;
                }
            }
            if best != pick[k] {
                pick[k] = best;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    // Then the exact minimum by branch and bound, from that bound: every term is at least zero, so
    // the nearest thread's difference is a lower bound for each color still open. Within a budget of
    // steps (eight colors, twice the default, rarely need a tenth of it); past it, the best found so far.
    let mut total = 0.0;
    for k in 0..n {
        total += cands[k][pick[k]].1 * cands[k][pick[k]].1;
        for o in k + 1..n {
            let lost = contrast[k][o] - thread_diff(cands[k][pick[k]].0, cands[o][pick[o]].0);
            if lost > 0.0 {
                total += weights[k] * weights[o] * lost * lost;
            }
        }
    }
    let mut rest = vec![0.0; n + 1];
    for k in (0..n).rev() {
        rest[k] = rest[k + 1] + cands[k][0].1 * cands[k][0].1;
    }
    struct Search<'a, F: FnMut(usize, usize) -> f64> {
        n: usize,
        cands: &'a [Vec<(usize, f64)>],
        contrast: &'a [Vec<f64>],
        weights: &'a [f64],
        rest: &'a [f64],
        thread_diff: F,
        sel: Vec<usize>,
        best: Vec<usize>,
        best_e: f64,
        budget: i64,
    }
    impl<F: FnMut(usize, usize) -> f64> Search<'_, F> {
        fn go(&mut self, k: usize, e: f64) {
            self.budget -= 1;
            if self.budget < 0 {
                return;
            }
            if k == self.n {
                if e < self.best_e - 1e-9 {
                    self.best_e = e;
                    self.best.copy_from_slice(&self.sel);
                }
                return;
            }
            for c in 0..self.cands[k].len() {
                let mut add = self.cands[k][c].1 * self.cands[k][c].1;
                let j = self.cands[k][c].0;
                for o in 0..k {
                    let lost =
                        self.contrast[k][o] - (self.thread_diff)(j, self.cands[o][self.sel[o]].0);
                    if lost > 0.0 {
                        add += self.weights[k] * self.weights[o] * lost * lost;
                    }
                }
                if e + add + self.rest[k + 1] >= self.best_e - 1e-9 {
                    continue;
                }
                self.sel[k] = c;
                self.go(k + 1, e + add);
            }
        }
    }
    let mut s = Search {
        n,
        cands: &cands,
        contrast: &contrast,
        weights,
        rest: &rest,
        thread_diff,
        sel: vec![0; n],
        best: pick.clone(),
        best_e: total,
        budget: 30_000,
    };
    s.go(0, 0.0);
    s.best
        .iter()
        .enumerate()
        .map(|(k, &c)| ThreadMatch {
            thread: cands[k][c].0,
            delta_e: cands[k][c].1,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::image::color::rgb_lab;

    fn threads(colors: &[[u8; 3]]) -> Vec<Thread> {
        threads_of(
            colors
                .iter()
                .map(|c| ThreadColor {
                    r: c[0],
                    g: c[1],
                    b: c[2],
                    ..Default::default()
                })
                .collect(),
        )
    }

    #[test]
    fn nearest_is_the_closest() {
        let t = threads(&[[0, 0, 0], [255, 255, 255], [220, 30, 40]]);
        assert_eq!(nearest_thread(&rgb_lab([200, 40, 40]), &t).thread, 2);
    }

    #[test]
    fn two_close_colors_keep_apart_when_a_second_thread_helps() {
        // Two light colors both nearest to the same white; a cream thread keeps them apart.
        let t = threads(&[[255, 255, 255], [250, 235, 200], [0, 0, 0]]);
        let colors = [rgb_lab([252, 252, 252]), rgb_lab([248, 236, 205])];
        let m = match_threads(&colors, None, &t);
        assert_ne!(m[0].thread, m[1].thread);
        // Identical colors share a thread.
        let same = match_threads(&[colors[0], colors[0]], None, &t);
        assert_eq!(same[0].thread, same[1].thread);
    }
}
