//! Separable Gaussian blur of a density grid (src/density/blur.ts). Values are kept as f32 and
//! summed in f64, as the Float32Array and the JavaScript numbers do, so the grids stay identical.

pub fn gaussian_kernel(sigma: f64) -> Vec<f32> {
    let r = (3.0 * sigma).ceil().max(1.0) as i64;
    let mut k = vec![0f32; (2 * r + 1) as usize];
    let mut sum = 0.0;
    for i in -r..=r {
        let v = (-((i * i) as f64) / (2.0 * sigma * sigma)).exp();
        k[(i + r) as usize] = v as f32;
        sum += v;
    }
    for v in k.iter_mut() {
        *v = (*v as f64 / sum) as f32;
    }
    k
}

/// Blur with zero padding; preserves the sum as long as values sit >= 3 sigma from the edge.
pub fn gaussian_blur(src: &[f32], cols: usize, rows: usize, sigma: f64) -> Vec<f32> {
    let k = gaussian_kernel(sigma);
    let r = (k.len() - 1) / 2;
    let mut tmp = vec![0f32; src.len()];
    let mut out = vec![0f32; src.len()];
    // Rows without thread stay zero: adding +0 never changes a sum, so leaving them out is exact.
    let mut busy = vec![false; rows];
    for y in 0..rows {
        let src_row = &src[y * cols..(y + 1) * cols];
        if src_row.iter().all(|&v| v == 0.0) {
            continue;
        }
        busy[y] = true;
        let tmp_row = &mut tmp[y * cols..(y + 1) * cols];
        for x in 0..cols {
            let lo = x.min(r);
            let hi = r.min(cols - 1 - x);
            // Offsets -lo..=hi around x, in the order JavaScript sums them.
            let s = src_row[x - lo..=x + hi]
                .iter()
                .zip(&k[r - lo..=r + hi])
                .fold(0.0f64, |s, (&v, &w)| s + v as f64 * w as f64);
            tmp_row[x] = s as f32;
        }
    }
    // Down the columns, a whole row at a time: each cell still sums its taps in the same order.
    let mut acc = vec![0f64; cols];
    for y in 0..rows {
        let lo = y.min(r);
        let hi = r.min(rows - 1 - y);
        acc.fill(0.0);
        let mut any = false;
        for j in 0..=(lo + hi) {
            let yy = y - lo + j;
            if !busy[yy] {
                continue;
            }
            any = true;
            let w = k[r - lo + j] as f64;
            for (a, &v) in acc.iter_mut().zip(&tmp[yy * cols..(yy + 1) * cols]) {
                *a += v as f64 * w;
            }
        }
        if any {
            for (o, &a) in out[y * cols..(y + 1) * cols].iter_mut().zip(&acc) {
                *o = a as f32;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kernel_sums_to_one() {
        let k = gaussian_kernel(2.0);
        assert_eq!(k.len(), 13);
        let s: f64 = k.iter().map(|&v| v as f64).sum();
        assert!((s - 1.0).abs() < 1e-6);
        assert!(k[6] > k[5] && k[5] == k[7]);
    }

    #[test]
    fn blur_keeps_the_sum_away_from_edges() {
        let mut d = vec![0f32; 900];
        d[15 * 30 + 15] = 10.0;
        let out = gaussian_blur(&d, 30, 30, 2.0);
        let s: f64 = out.iter().map(|&v| v as f64).sum();
        assert!((s - 10.0).abs() < 1e-4);
        assert!(out[15 * 30 + 15] < 10.0 && out[15 * 30 + 16] > 0.0);
    }
}
