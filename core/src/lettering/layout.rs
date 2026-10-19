//! Setting the text of a lettering (src/lettering/layout.ts): letters along the baseline with
//! their advances and kerning, lines below each other, aligned, then bent onto an arc or circle
//! and turned. The text comes in NFC already (TypeScript normalizes it).

use std::collections::HashMap;
use std::f64::consts::PI;

use serde::{Deserialize, Serialize};

use super::font::Font;
use crate::geom::Pt;
use crate::shape::path::{Mat, apply, compose};
use crate::trig::JsMath;

#[derive(Clone, Debug, Deserialize)]
pub struct LetterOverride {
    pub at: f64,
    pub ch: String,
    pub dx: f64,
    pub dy: f64,
    pub rot: f64,
}

/// The settings of a lettering that its stitches depend on (Lettering in layout.ts).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lettering {
    pub text: String,
    pub height: f64,
    pub align: String,
    pub spacing: f64,
    pub word_spacing: f64,
    pub line_spacing: f64,
    pub shape: String,
    pub radius: f64,
    pub x: f64,
    pub y: f64,
    pub angle: f64,
    pub back: bool,
    pub density: f64,
    pub underlay: bool,
    #[serde(default)]
    pub letters: Vec<LetterOverride>,
}

/// A letter in its place: the key of its glyph (None: the font lacks it) and the map from font
/// millimetres to the design's.
#[derive(Clone, Debug, Serialize)]
pub struct Placed {
    pub at: usize,
    pub ch: String,
    pub line: usize,
    pub word: usize,
    pub key: Option<String>,
    pub m: Mat,
    pub back: bool,
    #[serde(rename = "box")]
    pub corners: [Pt; 4],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub letters: Vec<Placed>,
    pub missing: Vec<String>,
    pub scale: f64,
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

const fn blank(c: char) -> bool {
    matches!(c, ' ' | '\n' | '\r' | '\t')
}

/// Characters of `text` the font has no letter for (each once, in order).
pub fn missing_in(font: &Font, text: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for c in text.chars() {
        if blank(c) {
            continue;
        }
        let ch = c.to_string();
        if font.glyph_key(&ch).is_none() && !out.contains(&ch) {
            out.push(ch);
        }
    }
    out
}

fn rot(deg: f64, cx: f64, cy: f64) -> Mat {
    let r = (deg * PI) / 180.0;
    let c = r.js_cos();
    let s = r.js_sin();
    [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]
}
const fn shift(dx: f64, dy: f64) -> Mat {
    [1.0, 0.0, 0.0, 1.0, dx, dy]
}
const fn scaled(s: f64) -> Mat {
    [s, 0.0, 0.0, s, 0.0, 0.0]
}

struct Item {
    at: usize,
    ch: String,
    word: usize,
    key: Option<String>,
    /// Origin along the line (mm of the design).
    u: f64,
    /// Left and right edge of the letter (design mm, from its origin).
    a: f64,
    b: f64,
}

struct Line {
    items: Vec<Item>,
    left: f64,
    right: f64,
    words: usize,
}

/// `Math.min(...v)` / `Math.max(...v)` over a non-empty list (NaN wins, as there).
fn js_min(v: impl Iterator<Item = f64>) -> f64 {
    v.fold(f64::INFINITY, |a, x| {
        if a.is_nan() || x.is_nan() {
            f64::NAN
        } else {
            a.min(x)
        }
    })
}
fn js_max(v: impl Iterator<Item = f64>) -> f64 {
    v.fold(f64::NEG_INFINITY, |a, x| {
        if a.is_nan() || x.is_nan() {
            f64::NAN
        } else {
            a.max(x)
        }
    })
}

/// Sets the text: an advance runs from a letter's origin to the next one's; the first letter of a
/// word starts at its own left edge.
pub fn layout(font: &Font, l: &Lettering) -> Layout {
    let s = l.height
        / if font.cap == 0.0 || font.cap.is_nan() {
            1.0
        } else {
            font.cap
        };
    let text = l.text.replace('\r', "");
    let missing = missing_in(font, &l.text);
    let mut set: Vec<Line> = vec![];
    let mut at = 0;
    let gap = font.space * s;
    for line in text.split('\n') {
        let mut items: Vec<Item> = vec![];
        let mut pen = 0.0;
        let mut prev: Option<String> = None;
        let mut word = 0;
        let mut in_word = false;
        for c in line.chars() {
            if c == ' ' || c == '\t' {
                pen += gap + l.word_spacing;
                if in_word {
                    word += 1;
                }
                in_word = false;
                prev = None;
                at += 1;
                continue;
            }
            let ch = c.to_string();
            let key = font.glyph_key(&ch);
            let glyph = key.as_ref().map(|k| &font.glyphs[k]);
            let kern_key = if glyph.is_some() && font.upper() {
                ch.to_uppercase()
            } else if glyph.is_some() && font.lower() {
                ch.to_lowercase()
            } else {
                ch.clone()
            };
            // A letter the font lacks keeps a place the size of a narrow letter.
            let (ga, gx0, gx1) = match glyph {
                Some(g) => (g.a, g.x0, g.x1),
                None => (font.cap * 0.55, font.cap * 0.05, font.cap * 0.5),
            };
            let u = match &prev {
                None => pen - gx0 * s,
                Some(p) => {
                    pen - font
                        .kern
                        .get(&format!("{p}{kern_key}"))
                        .copied()
                        .unwrap_or(0.0)
                        * s
                        + l.spacing
                }
            };
            items.push(Item {
                at,
                ch,
                word,
                key,
                u,
                a: gx0 * s,
                b: gx1 * s,
            });
            pen = u + ga * s;
            prev = Some(kern_key);
            in_word = true;
            at += 1;
        }
        // The line break.
        at += 1;
        let left = if items.is_empty() {
            0.0
        } else {
            js_min(items.iter().map(|it| it.u + it.a))
        };
        let right = if items.is_empty() {
            0.0
        } else {
            js_max(items.iter().map(|it| it.u + it.b))
        };
        set.push(Line {
            items,
            left,
            right,
            words: word + usize::from(in_word),
        });
    }
    // Alignment: each line against the widest one; on an arc or circle around the middle.
    let widest = js_max(std::iter::once(0.0).chain(set.iter().map(|ln| ln.right - ln.left)));
    let centered = l.shape != "line" || l.align == "center";
    for ln in &mut set {
        let w = ln.right - ln.left;
        let mut sh = -ln.left;
        if centered {
            sh -= w / 2.0;
        } else if l.align == "right" {
            sh -= w;
        } else if l.align == "block" && ln.words > 1 {
            // Block: the words of every line spread to the width of the widest.
            let extra = (widest - w) / (ln.words - 1) as f64;
            for it in &mut ln.items {
                it.u += extra * it.word as f64;
            }
        }
        for it in &mut ln.items {
            it.u += sh;
        }
    }

    let lead = font.lead * s * l.line_spacing;
    let anchor = compose(&shift(l.x, l.y), &rot(l.angle, 0.0, 0.0));
    let mut placed: Vec<Placed> = vec![];
    // Later overrides of the same place win, as in a Map built from the list.
    let mut overrides: HashMap<u64, &LetterOverride> = HashMap::new();
    for o in &l.letters {
        overrides.insert(o.at.to_bits(), o);
    }
    for (li, ln) in set.iter_mut().enumerate() {
        let back = l.back && font.rev && li % 2 == 1;
        let lf = li as f64;
        // The circle: letters spread evenly around it, the text's middle at the top.
        if l.shape == "circle" && ln.items.len() > 1 {
            let r = (l.radius - lf * lead).max(1.0);
            let w = ln.right - ln.left;
            let n = ln.items.len() as f64;
            let spread = ((2.0 * PI * r - w) / n).max(0.0);
            for (k, it) in ln.items.iter_mut().enumerate() {
                it.u += spread * (k as f64 - (n - 1.0) / 2.0);
            }
        }
        for it in &ln.items {
            let mid = it.u + (it.a + it.b) / 2.0;
            let mut m = if l.shape == "line" {
                compose(&shift(it.u, lf * lead), &scaled(s))
            } else {
                let down = l.shape == "arcDown";
                let r = if down {
                    l.radius + lf * lead
                } else {
                    l.radius - lf * lead
                }
                .max(1.0);
                let phi = mid / r;
                // The letter stands on the circle at its middle, turned along it.
                let signed = if down { -phi } else { phi };
                let deg = (signed * 180.0) / PI;
                let base: Pt = if down {
                    [r * phi.js_sin(), -l.radius + r * phi.js_cos()]
                } else {
                    [r * phi.js_sin(), l.radius - r * phi.js_cos()]
                };
                compose(
                    &shift(base[0], base[1]),
                    &compose(
                        &rot(deg, 0.0, 0.0),
                        &compose(&shift(-mid + it.u, 0.0), &scaled(s)),
                    ),
                )
            };
            let glyph = it.key.as_ref().map(|k| &font.glyphs[k]);
            if let Some(o) = overrides.get(&(it.at as f64).to_bits())
                && o.ch == it.ch
            {
                let (cx, cy) = match glyph {
                    Some(g) => ((g.x0 + g.x1) / 2.0, (g.y0 + g.y1) / 2.0),
                    None => (0.0, -font.cap / 2.0),
                };
                let c = apply(&m, [cx, cy]);
                m = compose(&shift(o.dx, o.dy), &compose(&rot(o.rot, c[0], c[1]), &m));
            }
            m = compose(&anchor, &m);
            let (x0, x1, y0, y1) = match glyph {
                Some(g) => (g.x0, g.x1, g.y0, g.y1),
                None => (font.cap * 0.05, font.cap * 0.5, -font.cap, 0.0),
            };
            let corners = [
                apply(&m, [x0, y0]),
                apply(&m, [x1, y0]),
                apply(&m, [x1, y1]),
                apply(&m, [x0, y1]),
            ];
            placed.push(Placed {
                at: it.at,
                ch: it.ch.clone(),
                line: li,
                word: it.word,
                key: it.key.clone(),
                m,
                back,
                corners,
            });
        }
    }
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    for p in &placed {
        for [x, y] in p.corners {
            min_x = js_min([min_x, x].into_iter());
            min_y = js_min([min_y, y].into_iter());
            max_x = js_max([max_x, x].into_iter());
            max_y = js_max([max_y, y].into_iter());
        }
    }
    if placed.is_empty() {
        (min_x, min_y, max_x, max_y) = (l.x, l.y - l.height, l.x, l.y);
    }
    Layout {
        letters: placed,
        missing,
        scale: s,
        min_x,
        min_y,
        max_x,
        max_y,
    }
}
