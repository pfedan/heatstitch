/**
 * Names of the fabric profiles (src/validation/profiles.ts) with examples. The part before the
 * first comma is the short name ("Für Jeans, 40 wt"). English mirrors German.
 */
export const de = {
  'fabric.woven': 'Webware, stabil',
  'fabric.woven.ex': 'z. B. Baumwolle, Leinen, Popeline, leichter Twill',
  'fabric.woven_heavy': 'Jeans, schwere Webware',
  'fabric.woven_heavy.ex': 'z. B. Jeans, Canvas, Taschen, fester Twill',
  'fabric.cap': 'Kappe, strukturiert',
  'fabric.cap.ex': 'z. B. Baseballkappen mit Versteifung',
  'fabric.knit': 'Strick, Jersey',
  'fabric.knit.ex': 'z. B. T-Shirt, Polo-Piqué, Jersey',
  'fabric.fleece': 'Fleece, Sweat',
  'fabric.fleece.ex': 'z. B. Fleece, Sweatshirt, Hoodie, Nicki',
  'fabric.terry': 'Frottee, Flor',
  'fabric.terry.ex': 'z. B. Handtuch, Bademantel, Samt, Cord',
  'fabric.light': 'Leicht, empfindlich',
  'fabric.light.ex': 'z. B. Batist, Seide, Satin, leichte Baumwolle',
  'fabric.sheer': 'Durchsichtiges, zart',
  'fabric.sheer.ex': 'z. B. Organza, Chiffon, Tüll, Voile',
  'fabric.leather': 'Leder, Kunstleder',
  'fabric.leather.ex': 'z. B. Glattleder, Kunstleder, Vinyl',
} as const;

export const en: Record<keyof typeof de, string> = {
  'fabric.woven': 'Stable woven',
  'fabric.woven.ex': 'e.g. cotton, linen, poplin, light twill',
  'fabric.woven_heavy': 'Denim, heavy woven',
  'fabric.woven_heavy.ex': 'e.g. denim, canvas, bags, heavy twill',
  'fabric.cap': 'Structured cap',
  'fabric.cap.ex': 'e.g. baseball caps with buckram',
  'fabric.knit': 'Knit, jersey',
  'fabric.knit.ex': 'e.g. T-shirt, polo piqué, jersey',
  'fabric.fleece': 'Fleece, sweatshirt',
  'fabric.fleece.ex': 'e.g. fleece, sweatshirt, hoodie, minky',
  'fabric.terry': 'Terry, pile',
  'fabric.terry.ex': 'e.g. towels, bathrobes, velvet, corduroy',
  'fabric.light': 'Light, delicate',
  'fabric.light.ex': 'e.g. batiste, silk, satin, light cotton',
  'fabric.sheer': 'Sheer, see-through',
  'fabric.sheer.ex': 'e.g. organza, chiffon, tulle, voile',
  'fabric.leather': 'Leather, vinyl',
  'fabric.leather.ex': 'e.g. smooth leather, faux leather, vinyl',
};
