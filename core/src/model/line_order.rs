//! A satin line's own order set by hand (see lineOrder.ts): rungs, cut lines, spacings and the
//! order of its sections kept as shares of the rails' length, put on the rails the line makes.
//! Reading an order back from edited rails stays TypeScript (the satin view).

use serde::{Deserialize, Serialize};

use super::restitch::{Rails, SectionStep, reversed_rails};
use crate::digitize::rungs::{Rung, cumulative};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct LineOrder {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rungs: Option<Vec<Rung>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cuts: Option<Vec<Rung>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spacings: Option<Vec<[f64; 2]>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<Vec<SectionStep>>,
    #[serde(
        default,
        skip_serializing_if = "std::ops::Not::not",
        deserialize_with = "truthy"
    )]
    pub mirror: bool,
    #[serde(
        default,
        skip_serializing_if = "std::ops::Not::not",
        deserialize_with = "truthy"
    )]
    pub turned: bool,
}

fn truthy<'de, D: serde::Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    Ok(Option::<bool>::deserialize(d)?.unwrap_or(false))
}

/// `o` turned round: sewn from the other end of its path.
pub fn turned_order(o: &LineOrder) -> LineOrder {
    LineOrder {
        turned: !o.turned,
        ..o.clone()
    }
}

/// As Math.min(1, Math.max(0, v)).
fn clamp(v: f64) -> f64 {
    if v.is_nan() { v } else { v.clamp(0.0, 1.0) }
}

/// Each rail's length, at least 1e-6.
fn lengths(r: &Rails) -> (f64, f64) {
    let of = |l: &[crate::geom::Pt]| {
        let v = cumulative(l).last().copied().unwrap_or(0.0);
        if v.is_nan() { v } else { v.max(1e-6) }
    };
    (of(&r.left), of(&r.right))
}

/// `r` (rails as the line makes them) with `order` set on them.
pub fn with_order(r: Rails, order: Option<&LineOrder>) -> Rails {
    let Some(order) = order else {
        return r;
    };
    let base = if order.turned { reversed_rails(&r) } else { r };
    let (la, lb) = lengths(&base);
    let at = |g: &Rung| -> Rung { [clamp(g[0]) * la, clamp(g[1]) * lb] };
    let mut out = Rails::new(base.left, base.right);
    out.rungs = order.rungs.as_ref().map(|v| v.iter().map(at).collect());
    out.cuts = order.cuts.as_ref().map(|v| v.iter().map(at).collect());
    out.spacings = order
        .spacings
        .as_ref()
        .map(|v| v.iter().map(|&[s, x]| [clamp(s) * la, x]).collect());
    // A plan only holds while the line has as many sections as it has steps (see Rails.plan).
    if let Some(plan) = &order.plan
        && plan.len() == order.cuts.as_ref().map_or(0, Vec::len) + 1
    {
        out.plan = Some(plan.clone());
    }
    out.mirror = order.mirror;
    out
}
