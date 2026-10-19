//! Exact Euclidean distance transform (Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled
//! Functions", Theory of Computing 8, 2012): two passes of the 1D lower envelope of parabolas, linear
//! in the number of pixels.

const BIG: f64 = 1e20;

/// Squared 1D distance transform of f (length n) into d; v, z are scratch buffers.
fn edt1d(f: &[f64], d: &mut [f64], v: &mut [usize], z: &mut [f64], n: usize) {
    let mut k = 0;
    v[0] = 0;
    z[0] = -BIG;
    z[1] = BIG;
    let s = |q: usize, p: usize| {
        let (qf, pf) = (q as f64, p as f64);
        (f[q] + qf * qf - (f[p] + pf * pf)) / (2.0 * qf - 2.0 * pf)
    };
    for q in 1..n {
        let mut sq = s(q, v[k]);
        while sq <= z[k] {
            k -= 1;
            sq = s(q, v[k]);
        }
        k += 1;
        v[k] = q;
        z[k] = sq;
        z[k + 1] = BIG;
    }
    k = 0;
    for q in 0..n {
        while z[k + 1] < q as f64 {
            k += 1;
        }
        let dq = q as f64 - v[k] as f64;
        d[q] = dq * dq + f[v[k]];
    }
}

/// Distance (pixels) from every pixel to the nearest seed pixel (`seed[i]` set). Without seeds all
/// distances are huge. With `border`, the ring of pixels just outside the image counts as seeds.
pub fn distance_to_seeds(seed: &[u8], w: usize, h: usize, border: bool) -> Vec<f32> {
    let pad = usize::from(border);
    let (ww, hh) = (w + 2 * pad, h + 2 * pad);
    let mut g = vec![BIG; ww * hh];
    for y in 0..hh {
        for x in 0..ww {
            let outside = x < pad || y < pad || x - pad >= w || y - pad >= h;
            if outside || seed[(y - pad) * w + x - pad] != 0 {
                g[y * ww + x] = 0.0;
            }
        }
    }
    let n = ww.max(hh);
    let mut f = vec![0.0; n];
    let mut d = vec![0.0; n];
    let mut v = vec![0usize; n];
    let mut z = vec![0.0; n + 1];
    for x in 0..ww {
        for y in 0..hh {
            f[y] = g[y * ww + x];
        }
        edt1d(&f, &mut d, &mut v, &mut z, hh);
        for y in 0..hh {
            g[y * ww + x] = d[y];
        }
    }
    for y in 0..hh {
        f[..ww].copy_from_slice(&g[y * ww..(y + 1) * ww]);
        edt1d(&f, &mut d, &mut v, &mut z, ww);
        g[y * ww..(y + 1) * ww].copy_from_slice(&d[..ww]);
    }
    let mut out = vec![0f32; w * h];
    for y in 0..h {
        for x in 0..w {
            out[y * w + x] = g[(y + pad) * ww + x + pad].sqrt() as f32;
        }
    }
    out
}

/// Distance from every inside pixel (mask set) to the nearest outside pixel; outside the image is outside.
pub fn distance_inside(mask: &[u8], w: usize, h: usize) -> Vec<f32> {
    let outside: Vec<u8> = mask.iter().map(|&m| u8::from(m == 0)).collect();
    distance_to_seeds(&outside, w, h, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distance_to_one_seed() {
        let mut seed = vec![0u8; 25];
        seed[12] = 1;
        let d = distance_to_seeds(&seed, 5, 5, false);
        assert_eq!(d[12], 0.0);
        assert_eq!(d[0], (8f32).sqrt());
        assert_eq!(d[14], 2.0);
    }

    #[test]
    fn inside_a_square() {
        let d = distance_inside(&[1; 9], 3, 3);
        assert_eq!(d[4], 2.0);
        assert_eq!(d[0], 1.0);
    }

    #[test]
    fn no_seeds_are_far() {
        let d = distance_to_seeds(&[0; 4], 2, 2, false);
        assert!(d.iter().all(|&v| v > 1e9));
    }
}
