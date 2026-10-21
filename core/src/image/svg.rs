//! Regions of an SVG file by color (src/image/svg.ts). The browser reads and draws the file (every
//! feature it knows: CSS, text, clip paths, markers); what it draws comes here as pixels.

use super::quantize::NONE;

/// Labels from drawings in which the shapes of colors 3p, 3p + 1 and 3p + 2 are pure red, green and
/// blue and all other shapes black (one drawing p per three colors, RGBA, one after the other in
/// `passes`): each pixel gets the color that covers most of it, if shapes cover at least half of it.
pub fn labels_from_passes(passes: &[u8], count: usize, size: usize) -> Vec<u8> {
    let mut labels = vec![NONE; size];
    let mut best = vec![0.0f32; size];
    for (p, d) in passes.chunks_exact(4 * size.max(1)).enumerate() {
        for c in 0..3 {
            let label = p * 3 + c;
            if label >= count {
                break;
            }
            for i in 0..size {
                let a = d[i * 4 + 3];
                if a < 128 {
                    continue;
                }
                let v = f32::from(d[i * 4 + c]) * f32::from(a);
                if v > best[i] {
                    best[i] = v;
                    labels[i] = label as u8;
                }
            }
        }
    }
    labels
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gives_each_pixel_the_color_that_covers_most_of_it() {
        // Two pixels per drawing; colors 0..2 in the first, 3 in the second.
        let pass0 = [255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 0];
        let pass1 = [0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0];
        let both: Vec<u8> = [pass0, pass1].concat();
        assert_eq!(labels_from_passes(&both, 4, 3), vec![0, 3, NONE]);
        // A pixel covered less than half stays unsewn; an edge pixel goes to the larger share.
        assert_eq!(
            labels_from_passes(&[200, 55, 0, 255, 0, 0, 255, 100], 3, 2),
            vec![0, NONE]
        );
    }
}
