//! What objects sewn later cover of an object (src/model/covers.ts): leaving it out. Finding the
//! covers of an object (its remembered shape, the satins' columns, the cells a cross stitch takes,
//! the caches) stays TypeScript.

use crate::digitize::region::Region;
use crate::shape::rasterize::{self, knock_out};

/// An area sewn later and how far the object below still reaches under it (mm).
#[derive(Clone, Debug)]
pub struct Cover {
    pub region: Region,
    pub overlap: f64,
}

/// `base` without what the covers cover beyond their overlap (cutAway in covers.ts): `changed`
/// false when nothing was left out (`base` stays as it is), else what is left (None: nothing).
pub fn cut_away(base: &Region, covers: &[Cover]) -> (bool, Option<Region>) {
    let mut cur: Option<Region> = None;
    let mut changed = false;
    for c in covers {
        let now = if changed { cur.as_ref() } else { Some(base) };
        let Some(b) = now else { return (true, None) };
        let cover = rasterize::Cover {
            x0: c.region.x0,
            y0: c.region.y0,
            w: c.region.w,
            h: c.region.h,
            px_mm: c.region.px_mm,
            sdf_base: &c.region.sdf_base,
        };
        let (cut, left) = knock_out(b, &[cover], c.overlap);
        if cut {
            changed = true;
            cur = left;
        }
    }
    (changed, cur)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digitize::region::tests::region_of;

    #[test]
    fn leaves_out_what_lies_on_top_beyond_the_overlap() {
        let base = region_of(200, 0.1, |x, y| (x - 10.0).hypot(y - 10.0) < 8.0);
        let bar = Cover {
            region: region_of(200, 0.1, |_, y| (y - 10.0).abs() < 2.0),
            overlap: 0.2,
        };
        let (changed, left) = cut_away(&base, std::slice::from_ref(&bar));
        let left = left.unwrap();
        assert!(changed);
        assert!(left.area_mm2 < base.area_mm2 - 40.0, "{}", left.area_mm2);
        // Nothing hidden: the base as it is.
        let far = Cover {
            region: region_of(200, 0.1, |x, _| x > 19.5),
            overlap: 0.2,
        };
        assert!(!cut_away(&base, &[far]).0);
        // All of it hidden: nothing left.
        let all = Cover {
            region: region_of(200, 0.1, |_, _| true),
            overlap: 0.0,
        };
        let (changed, left) = cut_away(&base, &[all, bar]);
        assert!(changed && left.is_none());
    }
}
