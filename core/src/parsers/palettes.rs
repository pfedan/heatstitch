//! Thread palettes of the formats that store colors as indices (src/parsers/pecPalette.ts,
//! jefPalette.ts, sewPalette.ts). The TypeScript tables stay too: the thread catalogs and the
//! picker read them when the app starts, before the core is loaded. tests/rust/formats.test.ts
//! reads every index through both to keep them equal.

use crate::pattern::ThreadColor;

type Entry = (u8, u8, u8, &'static str);

/// Brother PEC thread palette, index 0 is "unknown". 62 to 64 are no threads: Brother machines
/// show them as appliqué steps; the colors are only how they are drawn.
const PEC: [Entry; 65] = [
    (0, 0, 0, "Unknown"),
    (14, 31, 124, "Prussian Blue"),
    (10, 85, 163, "Blue"),
    (0, 135, 119, "Teal Green"),
    (75, 107, 175, "Cornflower Blue"),
    (237, 23, 31, "Red"),
    (209, 92, 0, "Reddish Brown"),
    (145, 54, 151, "Magenta"),
    (228, 154, 203, "Light Lilac"),
    (145, 95, 172, "Lilac"),
    (158, 214, 125, "Mint Green"),
    (232, 169, 0, "Deep Gold"),
    (254, 186, 53, "Orange"),
    (255, 255, 0, "Yellow"),
    (112, 188, 31, "Lime Green"),
    (186, 152, 0, "Brass"),
    (168, 168, 168, "Silver"),
    (125, 111, 0, "Russet Brown"),
    (255, 255, 179, "Cream Brown"),
    (79, 85, 86, "Pewter"),
    (0, 0, 0, "Black"),
    (11, 61, 145, "Ultramarine"),
    (119, 1, 118, "Royal Purple"),
    (41, 49, 51, "Dark Gray"),
    (42, 19, 1, "Dark Brown"),
    (246, 74, 138, "Deep Rose"),
    (178, 118, 36, "Light Brown"),
    (252, 187, 197, "Salmon Pink"),
    (254, 55, 15, "Vermilion"),
    (240, 240, 240, "White"),
    (106, 28, 138, "Violet"),
    (168, 221, 196, "Seacrest"),
    (37, 132, 187, "Sky Blue"),
    (254, 179, 67, "Pumpkin"),
    (255, 243, 107, "Cream Yellow"),
    (208, 166, 96, "Khaki"),
    (209, 84, 0, "Clay Brown"),
    (102, 186, 73, "Leaf Green"),
    (19, 74, 70, "Peacock Blue"),
    (135, 135, 135, "Gray"),
    (216, 204, 198, "Warm Gray"),
    (67, 86, 7, "Dark Olive"),
    (253, 217, 222, "Flesh Pink"),
    (249, 147, 188, "Pink"),
    (0, 56, 34, "Deep Green"),
    (178, 175, 212, "Lavender"),
    (104, 106, 176, "Wisteria Violet"),
    (239, 227, 185, "Beige"),
    (247, 56, 102, "Carmine"),
    (181, 75, 100, "Amber Red"),
    (19, 43, 26, "Olive Green"),
    (199, 1, 86, "Dark Fuchsia"),
    (254, 158, 50, "Tangerine"),
    (168, 222, 235, "Light Blue"),
    (0, 103, 62, "Emerald Green"),
    (78, 41, 144, "Purple"),
    (47, 126, 32, "Moss Green"),
    (255, 204, 204, "Flesh Pink"),
    (255, 217, 17, "Harvest Gold"),
    (9, 91, 166, "Electric Blue"),
    (240, 249, 112, "Lemon Yellow"),
    (227, 243, 91, "Fresh Green"),
    (255, 153, 0, "Applique Material"),
    (255, 240, 141, "Applique Position"),
    (255, 200, 200, "Applique"),
];

/// Janome JEF thread palette as pyembroidery knows it; index 0 means "stop" (same thread again).
const JEF: [Option<Entry>; 79] = [
    None,
    Some((0, 0, 0, "Black")),
    Some((255, 255, 255, "White")),
    Some((255, 255, 23, "Yellow")),
    Some((255, 102, 0, "Orange")),
    Some((47, 89, 51, "Olive Green")),
    Some((35, 115, 54, "Green")),
    Some((101, 194, 200, "Sky")),
    Some((171, 90, 150, "Purple")),
    Some((246, 105, 160, "Pink")),
    Some((255, 0, 0, "Red")),
    Some((177, 112, 78, "Brown")),
    Some((11, 47, 132, "Blue")),
    Some((228, 195, 93, "Gold")),
    Some((72, 26, 5, "Dark Brown")),
    Some((172, 156, 199, "Pale Violet")),
    Some((252, 242, 148, "Pale Yellow")),
    Some((249, 153, 183, "Pale Pink")),
    Some((250, 179, 129, "Peach")),
    Some((201, 164, 128, "Beige")),
    Some((151, 5, 51, "Wine Red")),
    Some((160, 184, 204, "Pale Sky")),
    Some((127, 194, 28, "Yellow Green")),
    Some((229, 229, 229, "Silver Gray")),
    Some((136, 155, 155, "Gray")),
    Some((152, 214, 189, "Pale Aqua")),
    Some((178, 225, 227, "Baby Blue")),
    Some((54, 139, 160, "Powder Blue")),
    Some((79, 131, 171, "Bright Blue")),
    Some((56, 106, 145, "Slate Blue")),
    Some((7, 22, 80, "Navy Blue")),
    Some((249, 153, 162, "Salmon Pink")),
    Some((249, 103, 107, "Coral")),
    Some((227, 49, 31, "Burnt Orange")),
    Some((226, 161, 136, "Cinnamon")),
    Some((181, 148, 116, "Umber")),
    Some((228, 207, 153, "Blond")),
    Some((255, 203, 0, "Sunflower")),
    Some((225, 173, 212, "Orchid Pink")),
    Some((195, 0, 126, "Peony Purple")),
    Some((128, 0, 75, "Burgundy")),
    Some((84, 5, 113, "Royal Purple")),
    Some((177, 5, 37, "Cardinal Red")),
    Some((202, 224, 192, "Opal Green")),
    Some((137, 152, 86, "Moss Green")),
    Some((92, 148, 26, "Meadow Green")),
    Some((0, 49, 20, "Dark Green")),
    Some((93, 174, 148, "Aquamarine")),
    Some((76, 191, 143, "Emerald Green")),
    Some((0, 119, 114, "Peacock Green")),
    Some((89, 91, 97, "Dark Gray")),
    Some((255, 255, 242, "Ivory White")),
    Some((177, 88, 24, "Hazel")),
    Some((203, 138, 7, "Toast")),
    Some((152, 108, 128, "Salmon")),
    Some((152, 105, 45, "Cocoa Brown")),
    Some((77, 52, 25, "Sienna")),
    Some((76, 51, 11, "Sepia")),
    Some((51, 32, 10, "Dark Sepia")),
    Some((82, 58, 151, "Violet Blue")),
    Some((13, 33, 126, "Blue Ink")),
    Some((30, 119, 172, "Sola Blue")),
    Some((178, 221, 83, "Green Dust")),
    Some((243, 54, 137, "Crimson")),
    Some((222, 100, 158, "Floral Pink")),
    Some((152, 65, 97, "Wine")),
    Some((76, 86, 18, "Olive Drab")),
    Some((76, 136, 31, "Meadow")),
    Some((228, 222, 121, "Mustard")),
    Some((203, 138, 26, "Yellow Ocher")),
    Some((203, 162, 28, "Old Gold")),
    Some((255, 152, 5, "Honey Dew")),
    Some((252, 178, 87, "Tangerine")),
    Some((255, 229, 5, "Canary Yellow")),
    Some((240, 51, 31, "Vermilion")),
    Some((26, 132, 45, "Bright Green")),
    Some((56, 108, 174, "Ocean Blue")),
    Some((227, 196, 180, "Beige Gray")),
    Some((227, 172, 129, "Bamboo")),
];

/// Janome SEW thread table, from pystitch/pyembroidery's EmbThreadSew (MIT). Index 0 is
/// "Unknown" (black), not a stop. The names are pyembroidery's, oddities included.
const SEW: [Entry; 79] = [
    (0, 0, 0, "Unknown"),
    (0, 0, 0, "Black"),
    (255, 255, 255, "White"),
    (255, 255, 23, "Sunflower"),
    (250, 160, 96, "Hazel"),
    (92, 118, 73, "Green Dust"),
    (64, 192, 48, "Green"),
    (101, 194, 200, "Sky"),
    (172, 128, 190, "Purple"),
    (245, 188, 203, "Pink"),
    (255, 0, 0, "Red"),
    (192, 128, 0, "Brown"),
    (0, 0, 240, "Blue"),
    (228, 195, 93, "Gold"),
    (165, 42, 42, "Dark Brown"),
    (213, 176, 212, "Pale Violet"),
    (252, 242, 148, "Pale Yellow"),
    (240, 208, 192, "Pale Pink"),
    (255, 192, 0, "Peach"),
    (201, 164, 128, "Beige"),
    (155, 61, 75, "Wine Red"),
    (160, 184, 204, "Pale Sky"),
    (127, 194, 28, "Yellow Green"),
    (185, 185, 185, "Silver Grey"),
    (160, 160, 160, "Grey"),
    (152, 214, 189, "Pale Aqua"),
    (184, 240, 240, "Baby Blue"),
    (54, 139, 160, "Powder Blue"),
    (79, 131, 171, "Bright Blue"),
    (56, 106, 145, "Slate Blue"),
    (0, 32, 107, "Nave Blue"),
    (229, 197, 202, "Salmon Pink"),
    (249, 103, 107, "Coral"),
    (227, 49, 31, "Burnt Orange"),
    (226, 161, 136, "Cinnamon"),
    (181, 148, 116, "Umber"),
    (228, 207, 153, "Blonde"),
    (225, 203, 0, "Sunflower"),
    (225, 173, 212, "Orchid Pink"),
    (195, 0, 126, "Peony Purple"),
    (128, 0, 75, "Burgundy"),
    (160, 96, 176, "Royal Purple"),
    (192, 64, 32, "Cardinal Red"),
    (202, 224, 192, "Opal Green"),
    (137, 152, 86, "Moss Green"),
    (0, 170, 0, "Meadow Green"),
    (33, 138, 33, "Dark Green"),
    (93, 174, 148, "Aquamarine"),
    (76, 191, 143, "Emerald Green"),
    (0, 119, 114, "Peacock Green"),
    (112, 112, 112, "Dark Grey"),
    (242, 255, 255, "Ivory White"),
    (177, 88, 24, "Hazel"),
    (203, 138, 7, "Toast"),
    (247, 146, 123, "Salmon"),
    (152, 105, 45, "Cocoa Brown"),
    (162, 113, 72, "Sienna"),
    (123, 85, 74, "Sepia"),
    (79, 57, 70, "Dark Sepia"),
    (82, 58, 151, "Violet Blue"),
    (0, 0, 160, "Blue Ink"),
    (0, 150, 222, "Solar Blue"),
    (178, 221, 83, "Green Dust"),
    (250, 143, 187, "Crimson"),
    (222, 100, 158, "Floral Pink"),
    (181, 80, 102, "Wine"),
    (94, 87, 71, "Olive Drab"),
    (76, 136, 31, "Meadow"),
    (228, 220, 121, "Canary Yellow"),
    (203, 138, 26, "Toast"),
    (198, 170, 66, "Beige"),
    (236, 176, 44, "Honey Dew"),
    (248, 128, 64, "Tangerine"),
    (255, 229, 5, "Ocean Blue"),
    (250, 122, 122, "Sepia"),
    (107, 224, 0, "Royal Purple"),
    (56, 108, 174, "Yellow Ocher"),
    (208, 186, 176, "Beige Grey"),
    (227, 190, 129, "Bamboo"),
];

/// First of the appliqué slots (62 to 64), which no thread may take.
pub const PEC_APPLIQUE: u32 = 62;

fn color(e: Entry) -> ThreadColor {
    ThreadColor {
        r: e.0,
        g: e.1,
        b: e.2,
        name: Some(e.3.to_string()),
        ..Default::default()
    }
}

pub fn pec_color(index: i64) -> ThreadColor {
    let i = if (0..PEC.len() as i64).contains(&index) {
        index as usize
    } else {
        0
    };
    ThreadColor {
        pec_index: Some(i as u32),
        ..color(PEC[i])
    }
}

/// The PEC slot a color may keep when saved: its own, unless that is an appliqué slot it does not
/// carry as one (a color read from such a file keeps the step, one merely drawn alike does not).
pub fn pec_own_slot(c: &ThreadColor) -> Option<u32> {
    let i = c.pec_index?;
    if i < 1 || i as usize >= PEC.len() {
        return None;
    }
    (i < PEC_APPLIQUE || c.name.as_deref() == Some(PEC[i as usize].3)).then_some(i)
}

/// Distinct colors for formats without color info (DST).
const DEFAULTS: [i64; 12] = [2, 5, 14, 13, 7, 12, 32, 20, 25, 37, 55, 33];

pub fn default_color(block: usize) -> ThreadColor {
    pec_color(DEFAULTS[block % DEFAULTS.len()])
}

pub fn jef_color(index: u64) -> ThreadColor {
    let e = JEF[(index % JEF.len() as u64) as usize].or(JEF[1]);
    color(e.unwrap_or_default())
}

/// The usable Janome palette slots (never 0, "stop").
pub fn jef_slots() -> Vec<u32> {
    (1..JEF.len() as u32)
        .filter(|&i| JEF[i as usize].is_some())
        .collect()
}

/// Color of a SEW palette index; indices past the end wrap around, as pyembroidery reads them.
pub fn sew_color(index: u64) -> ThreadColor {
    color(SEW[(index % SEW.len() as u64) as usize])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn palettes() {
        assert_eq!(pec_color(20).name.as_deref(), Some("Black"));
        assert_eq!(pec_color(99).pec_index, Some(0));
        assert_eq!(jef_color(0).name.as_deref(), Some("Black"));
        assert_eq!(jef_color(79 + 2).name.as_deref(), Some("White"));
        assert_eq!(sew_color(0).name.as_deref(), Some("Unknown"));
        assert_eq!(jef_slots().len(), 78);
        let applique = pec_color(62);
        assert_eq!(pec_own_slot(&applique), Some(62));
        let drawn = ThreadColor {
            name: Some("Orange".into()),
            ..applique
        };
        assert_eq!(pec_own_slot(&drawn), None);
        assert_eq!(default_color(12), pec_color(2));
    }
}
