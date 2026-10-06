import type { Key } from '../../i18n';
import type { FabricId, ThreadId } from '../../validation/profiles';

/**
 * "Bereit zum Sticken": what to put under and on the fabric, which needle, thread, speed and how
 * to hoop, per fabric profile of the app, adjusted to the design (stitch count, density, size,
 * smallest lettering).
 *
 * Basis: research of 2026-10-06 (plans: ui-umbau/stick-karte-recherche.md). The research could
 * only read search excerpts of its sources, not the pages themselves, so every value carries how
 * firm it is:
 *   'source'   backed by at least one maker's or specialist source (URL in the comment)
 *   'disputed' the sources disagree; the more common advice is taken (reason in the comment)
 *   'rule'     rule of thumb without a firm source
 * The interface marks 'rule' and 'disputed' next to the value and explains the marks in a legend.
 * No brand names in the texts. Speed is a recommended maximum in stitches per minute, shown as
 * "max. etwa N": home machines run about 400 to 1000, so it is a guide, not a setting.
 * Texts are i18n keys in src/i18n/areas/ready.ts.
 */

export type Basis = 'source' | 'disputed' | 'rule';
/** Recommended maximum speed in stitches per minute; null: the machine's own maximum. */
export interface Speed {
  maxSpm: number | null;
  basis: Basis;
}
export type Hooping = 'hoop' | 'float' | 'hoopOrFloat' | 'capFrameOrFloat';
export type StabKind = 'tear' | 'cut' | 'mesh' | 'wash' | 'sticky';
export type Weight = 'light' | 'medium' | 'heavy';

export interface Value {
  text: Key;
  basis: Basis;
}

export interface Stabilizer extends Value {
  kind: StabKind;
  weight: Weight;
  /** Guide weight in g/m² (1 oz/yd² is about 34 g/m²); makers' stabilizers of equal weight still differ. */
  gsm?: [number, number];
}

export interface Recipe {
  stabilizer: Stabilizer;
  /** One step stronger: many stitches, dense fills, large design. */
  stabilizerDense: Stabilizer;
  topping: Value & { need: 'always' | 'optional' | 'no' };
  needle: Value & { size?: string; alt?: Key };
  /** What matters about the thread on this fabric, after its weight. */
  thread: Value;
  speed: Speed;
  hooping: Value & { method: Hooping };
  /** At most 3. */
  tips: Value[];
}

export const RECIPES: Record<FabricId, Recipe> = {
  // Webware (cotton, linen, twill, light denim) ---------------------------------------------------
  woven: {
    // https://oesd.com/content/PDF/OESD_Stabilizers.pdf (tear-away for stable wovens)
    // https://makema.de/en/products/gunold-stiffy-zuschnitte-20-x-20cm-weiss-250-blatt (50 g/m² for cotton, shirting, light denim)
    // https://library.loudoun.gov/Portals/0/Pdf/Makerspace/Makerspace%20-%20Embroidery%20Machine%20Trifold%20May%202025%20Update.pdf
    stabilizer: { kind: 'tear', weight: 'medium', gsm: [50, 60], text: 'ready.woven.stab', basis: 'source' },
    // Maker's rule of thumb (one medium tear-away carries about 8,000 to 10,000 stitches):
    // https://rnk-floriani.com/wp-content/uploads/2023/10/FlorianiWorkbookStabilizer.pdf
    stabilizerDense: { kind: 'cut', weight: 'medium', gsm: [70, 85], text: 'ready.woven.stabDense', basis: 'rule' },
    // https://makerspace.aapld.org/wp-content/uploads/2024/06/stabilizers.pdf (topping on textured surfaces like corduroy)
    topping: { need: 'no', text: 'ready.woven.topping', basis: 'source' },
    // https://lindas.com/blogs/product-guides/isacord-40wt-embroidery-thread-guide (75/11, 90/14 on denim and canvas)
    needle: { size: '75/11', alt: 'ready.woven.needleAlt', text: 'ready.needle.embroidery', basis: 'source' },
    // https://lindas.com/blogs/product-guides/isacord-40wt-embroidery-thread-guide
    thread: { text: 'ready.woven.thread', basis: 'source' },
    // Rule of thumb: stable woven runs at the machine's own maximum.
    speed: { maxSpm: null, basis: 'rule' },
    // https://janome.com/learn/software-lessons/embroidery-tips/proper-hooping
    // https://www.sewingpartsonline.com/blogs/education/beginners-guide-to-embroidery-episode-5-hooping
    hooping: { method: 'hoop', text: 'ready.woven.hoop', basis: 'source' },
    tips: [
      { text: 'ready.woven.tip.wash', basis: 'rule' },
      // https://www.sewingpartsonline.com/blogs/education/beginners-guide-to-embroidery-episode-5-hooping
      { text: 'ready.woven.tip.drum', basis: 'source' },
      // Disputed: one source takes cut-away for all denim, others tear-away for firm denim; cut-away once
      // it stretches. https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-denim-machine-embroidery
      { text: 'ready.woven.tip.stretch', basis: 'disputed' },
    ],
  },

  // Jeans, schwere Webware (denim, canvas, bags, heavy twill) ----------------------------------------
  // Split off woven (research section 3): another needle (90/14), totes and denim jackets are common.
  woven_heavy: {
    // Disputed: one source takes cut-away for all denim, others tear-away for firm denim and canvas.
    // Taken: tear-away, cut-away once it stretches or the design is dense.
    // https://oesd.com/content/PDF/OESD_Stabilizers.pdf (tear-away for canvas)
    // https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-denim-machine-embroidery (cut-away)
    stabilizer: { kind: 'tear', weight: 'medium', gsm: [50, 60], text: 'ready.wovenHeavy.stab', basis: 'disputed' },
    // https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-denim-machine-embroidery
    stabilizerDense: { kind: 'cut', weight: 'medium', gsm: [60, 85], text: 'ready.wovenHeavy.stabDense', basis: 'source' },
    // https://library.loudoun.gov/Portals/0/Pdf/Makerspace/Makerspace%20-%20Embroidery%20Machine%20Trifold%20May%202025%20Update.pdf (denim: no topping)
    topping: { need: 'no', text: 'ready.topping.no', basis: 'source' },
    // https://lindas.com/blogs/product-guides/isacord-40wt-embroidery-thread-guide (90/14 on denim and canvas)
    needle: { size: '90/14', alt: 'ready.wovenHeavy.needleAlt', text: 'ready.needle.embroidery', basis: 'source' },
    thread: { text: 'ready.woven.thread', basis: 'source' },
    speed: { maxSpm: null, basis: 'rule' },
    // https://janome.com/learn/software-lessons/embroidery-tips/proper-hooping
    hooping: { method: 'hoop', text: 'ready.woven.hoop', basis: 'source' },
    tips: [
      { text: 'ready.woven.tip.stretch', basis: 'disputed' },
      { text: 'ready.wovenHeavy.tip.seams', basis: 'rule' },
      { text: 'ready.wovenHeavy.tip.bags', basis: 'rule' },
    ],
  },

  // Kappe --------------------------------------------------------------------------------------------
  cap: {
    // https://mclogan.com/products/madeira-86-45-7b-e-zee-cap-supreme-2-5oz
    // https://sps-i.com/products/embroidery-cap-tear-away-3-0oz-white-4-5x7-250ct-330
    // https://makema.de/en/products/gunold-stiffy-zuschnitte-20-x-20cm-weiss-250-blatt (80 g/m² for caps)
    stabilizer: { kind: 'tear', weight: 'heavy', gsm: [80, 100], text: 'ready.cap.stab', basis: 'source' },
    // https://mclogan.com/products/madeira-86-45-7b-e-zee-cap-supreme-2-5oz (larger designs: 2 layers)
    stabilizerDense: { kind: 'tear', weight: 'heavy', gsm: [80, 100], text: 'ready.cap.stabDense', basis: 'source' },
    topping: { need: 'no', text: 'ready.topping.no', basis: 'rule' },
    // https://coldesi.com/?p=270768 (caps work best with a sharp needle, 70/10 or 75/11)
    needle: { size: '75/11', text: 'ready.needle.sharp', basis: 'source' },
    thread: { text: 'ready.cap.thread', basis: 'rule' },
    // https://static.naehpark.com//out/pictures/media/brother-pr-680w-herstellerprospekt.pdf (cap frames limited to 400 per minute)
    speed: { maxSpm: 400, basis: 'source' },
    // https://www.sewingmachinefun.com/machine-embroider-hat/ (flat hoop, sticky stabilizer)
    // https://machineembroiderygeek.com/durkee-cap-frames-for-easy-embroidery-on-baseball-caps/
    hooping: { method: 'capFrameOrFloat', text: 'ready.cap.hoop', basis: 'source' },
    tips: [
      { text: 'ready.cap.tip.small', basis: 'rule' },
      { text: 'ready.cap.tip.order', basis: 'rule' },
      { text: 'ready.cap.tip.structured', basis: 'rule' },
    ],
  },

  // Strick, Jersey (T-shirt, polo, jersey) -----------------------------------------------------------
  knit: {
    // Disputed: one guide names sticky tear-away for T-shirts, nearly all makers say cut-away, since knits
    // need lasting support. https://emblibrary.com/blogs/projects/fabrics-101-embroidering-on-t-shirts
    // https://www.madeira.com/fileadmin/user_upload/Downloads/Data_Sheets/Data_Sheets_Backings/TD_DE_Web.pdf
    stabilizer: { kind: 'mesh', weight: 'light', gsm: [40, 50], text: 'ready.knit.stab', basis: 'disputed' },
    // https://rnk-floriani.com/stabilizing-solutions-t-shirts-sweatshirts/ (mesh to about 10,000 to 12,000 stitches)
    // https://graphics-pro.com/education/is-my-design-too-heavy-for-the-fabric-i-want-to-embroider/
    stabilizerDense: { kind: 'cut', weight: 'medium', gsm: [60, 85], text: 'ready.knit.stabDense', basis: 'source' },
    // https://www.madeira.com/fileadmin/user_upload/Downloads/HowTo/DE_Avalon.pdf (piqué, coarse knits)
    // https://emblibrary.com/blogs/projects/fabrics-101-embroidering-on-fleece (fleece: topping)
    topping: { need: 'optional', text: 'ready.knit.topping', basis: 'source' },
    // https://emblibrary.com/blogs/projects/fabrics-101-embroidering-on-t-shirts (ballpoint 75/11)
    // https://oesd.com/embroidery-needles-ballpoint-7511-10pk
    needle: { size: '75/11', alt: 'ready.knit.needleAlt', text: 'ready.needle.ballpoint', basis: 'source' },
    // https://www.madeira.co.uk/embroidery-threads/polyneon (polyester for textiles washed often)
    thread: { text: 'ready.knit.thread', basis: 'source' },
    // Rule of thumb: knits shift and pucker less a little slower.
    speed: { maxSpm: 600, basis: 'rule' },
    // https://emblibrary.com/blogs/projects/fabrics-101-embroidering-on-t-shirts (spray on cut-away)
    // https://www.magnetichoop.com/blogs/news/mastering-embroidery-on-t-shirts-techniques-for-professional-results (fusible mesh)
    hooping: { method: 'hoop', text: 'ready.knit.hoop', basis: 'source' },
    tips: [
      // https://www.sewingpartsonline.com/blogs/education/beginners-guide-to-embroidery-episode-5-hooping
      { text: 'ready.knit.tip.stretch', basis: 'source' },
      // https://library.loudoun.gov/Portals/0/Pdf/Makerspace/Makerspace%20-%20Embroidery%20Machine%20Trifold%20May%202025%20Update.pdf
      { text: 'ready.knit.tip.light', basis: 'source' },
      // https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-denim-machine-embroidery (trim with a margin)
      { text: 'ready.knit.tip.trim', basis: 'source' },
    ],
  },

  // Fleece, Sweat (fleece, sweatshirt, hoodie) --------------------------------------------------------
  // Split off knit (research section 3): cut-away like knit, but medium to heavy, and topping. Not
  // with terry: fleece stretches and needs cut-away, terry does not.
  fleece: {
    // https://emblibrary.com/blogs/projects/fabrics-101-embroidering-on-fleece (cut-away 2.5 to 3 oz)
    // https://quiltsocial.com/a-comprehensive-look-at-the-wide-and-varied-world-of-sulky-stabilizers/ (cut-away for sweatshirts)
    stabilizer: { kind: 'cut', weight: 'medium', gsm: [60, 85], text: 'ready.fleece.stab', basis: 'source' },
    // https://emblibrary.com/blogs/projects/fabrics-101-embroidering-on-fleece (3 oz is about 100 g/m²)
    stabilizerDense: { kind: 'cut', weight: 'heavy', gsm: [85, 100], text: 'ready.fleece.stabDense', basis: 'source' },
    // https://emblibrary.com/blogs/projects/fabrics-101-embroidering-on-fleece (topping on the nap)
    // https://www.urbanthreads.com/blogs/projects/embroidery-on-sweatshirts (smooth outside: optional)
    topping: { need: 'always', text: 'ready.fleece.topping', basis: 'source' },
    // https://oesd.com/embroidery-needles-ballpoint-7511-10pk (ballpoint for knits)
    needle: { size: '75/11', text: 'ready.needle.ballpoint', basis: 'source' },
    // https://www.madeira.co.uk/embroidery-threads/polyneon
    thread: { text: 'ready.knit.thread', basis: 'source' },
    speed: { maxSpm: 600, basis: 'rule' },
    // Spray on cut-away as on knit (source); floating against hoop marks is a rule of thumb.
    hooping: { method: 'hoopOrFloat', text: 'ready.fleece.hoop', basis: 'rule' },
    tips: [
      // https://emblibrary.com/blogs/projects/fabrics-101-embroidering-on-fleece
      { text: 'ready.fleece.tip.sink', basis: 'source' },
      // https://www.sewingpartsonline.com/blogs/education/beginners-guide-to-embroidery-episode-5-hooping
      { text: 'ready.knit.tip.stretch', basis: 'source' },
      { text: 'ready.fleece.tip.marks', basis: 'rule' },
    ],
  },

  // Frottee, Flor (towels) ---------------------------------------------------------------------------
  terry: {
    // Disputed: tear-away (tidy back, towel backs show) https://hatchembroidery.com/resources/blog/top-10-tips-for-embroidering-on-towels
    // against cut-away (lasts through washing) https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-terrycloth-towels-machine-embroidery
    // Taken: tear-away, cut-away for dense designs.
    stabilizer: { kind: 'tear', weight: 'medium', gsm: [50, 60], text: 'ready.terry.stab', basis: 'disputed' },
    // https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-terrycloth-towels-machine-embroidery
    stabilizerDense: { kind: 'cut', weight: 'medium', gsm: [60, 85], text: 'ready.terry.stabDense', basis: 'source' },
    // https://www.madeira.com/fileadmin/user_upload/Downloads/HowTo/DE_Avalon.pdf (sources agree)
    topping: { need: 'always', text: 'ready.terry.topping', basis: 'source' },
    // https://lindas.com/blogs/product-guides/isacord-40wt-embroidery-thread-guide
    // https://janome.com/blog/what-you-need-to-know-about-needles-blue-tip (90/14 for thick layers)
    needle: { size: '75/11', alt: 'ready.terry.needleAlt', text: 'ready.needle.embroidery', basis: 'source' },
    // https://www.madeira.co.uk/embroidery-threads/polyneon
    thread: { text: 'ready.terry.thread', basis: 'source' },
    // Rule of thumb: "normal to reduced" in the research.
    speed: { maxSpm: 700, basis: 'rule' },
    // https://hatchembroidery.com/resources/blog/top-10-tips-for-embroidering-on-towels (sticky stabilizer for thick towels)
    hooping: { method: 'hoopOrFloat', text: 'ready.terry.hoop', basis: 'source' },
    tips: [
      // https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-terrycloth-towels-machine-embroidery
      { text: 'ready.terry.tip.bold', basis: 'source' },
      // https://www.madeira.com/fileadmin/user_upload/Downloads/HowTo/DE_Avalon.pdf
      { text: 'ready.terry.tip.residue', basis: 'source' },
      // https://hatchembroidery.com/resources/blog/top-10-tips-for-embroidering-on-towels
      { text: 'ready.terry.tip.knockdown', basis: 'source' },
    ],
  },

  // Leicht, empfindlich (batiste, lawn, silk; see-through fabrics are 'sheer') -----------------------
  light: {
    // https://emblibrary.com/blogs/projects/fabrics-101-embroidering-on-batiste (mesh, tear-away if very thin)
    // https://kimberbell.com/blogs/thekimberbellablog/using-no-show-mesh-stabilizer-for-lightweight-fabrics
    stabilizer: { kind: 'mesh', weight: 'light', gsm: [40, 50], text: 'ready.light.stab', basis: 'source' },
    stabilizerDense: { kind: 'mesh', weight: 'light', gsm: [40, 50], text: 'ready.light.stabDense', basis: 'rule' },
    topping: { need: 'no', text: 'ready.topping.no', basis: 'rule' },
    // Disputed: one source 75/11 sharp, many guides smaller. https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-organza-machine-embroidery
    // https://allstitch.com/pages/embroidering-with-60-weight-thread (65/9 with 60 wt)
    needle: { size: '70/10', alt: 'ready.light.needleAlt', text: 'ready.needle.fineSharp', basis: 'disputed' },
    // https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-organza-machine-embroidery (bobbin like top thread)
    thread: { text: 'ready.light.thread', basis: 'source' },
    // https://zdigitizing.com/how-to-machine-embroidery-on-chiffon-fabric/ (weak source)
    speed: { maxSpm: 600, basis: 'rule' },
    // https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-organza-machine-embroidery ("hoop both layers together firmly")
    hooping: { method: 'hoop', text: 'ready.light.hoop', basis: 'source' },
    tips: [
      { text: 'ready.light.tip.open', basis: 'source' },
      { text: 'ready.light.tip.bobbin', basis: 'source' },
      // https://emblibrary.com/blogs/projects/fabrics-101-embroidering-on-batiste
      { text: 'ready.light.tip.shows', basis: 'source' },
    ],
  },

  // Durchsichtiges (organza, chiffon, tulle, voile) ---------------------------------------------------
  // Split off light (research section 3): a wholly different stabilizer (wash-away) than batiste.
  sheer: {
    // https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-organza-machine-embroidery (one layer heavy wash-away)
    // https://makema.de/en/products/madeira-avalon-plus-wash-away (silk, organza, tulle)
    stabilizer: { kind: 'wash', weight: 'heavy', text: 'ready.sheer.stab', basis: 'source' },
    // Rule of thumb: the number of layers; the source advises open, light designs.
    stabilizerDense: { kind: 'wash', weight: 'heavy', text: 'ready.sheer.stabDense', basis: 'rule' },
    topping: { need: 'no', text: 'ready.topping.no', basis: 'rule' },
    // Disputed: one source 75/11 sharp, many guides smaller.
    // https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-organza-machine-embroidery
    needle: { size: '75/11', alt: 'ready.sheer.needleAlt', text: 'ready.needle.sharp', basis: 'disputed' },
    // https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-organza-machine-embroidery (bobbin like top thread)
    thread: { text: 'ready.light.thread', basis: 'source' },
    // https://zdigitizing.com/how-to-machine-embroidery-on-chiffon-fabric/ (weak source)
    speed: { maxSpm: 500, basis: 'rule' },
    // https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-organza-machine-embroidery ("hoop both layers together firmly")
    hooping: { method: 'hoop', text: 'ready.sheer.hoop', basis: 'source' },
    tips: [
      { text: 'ready.light.tip.open', basis: 'source' },
      { text: 'ready.light.tip.bobbin', basis: 'source' },
      { text: 'ready.light.tip.rinse', basis: 'source' },
    ],
  },

  // Leder, Kunstleder, Vinyl ---------------------------------------------------------------------------
  leather: {
    // Disputed: one source hoops leather on cut-away with spray, others float it on sticky stabilizer.
    // Taken: floating, no hoop marks possible. https://blog.sulky.com/machine-embroidery-series-leather/
    // https://www.madeira.com/fileadmin/user_upload/Downloads/HowTo/DE_Stick_on_adhesive_backing.pdf
    stabilizer: { kind: 'sticky', weight: 'medium', gsm: [50, 70], text: 'ready.leather.stab', basis: 'disputed' },
    // https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-leather-machine-embroidery/print
    stabilizerDense: { kind: 'cut', weight: 'medium', gsm: [60, 85], text: 'ready.leather.stabDense', basis: 'source' },
    topping: { need: 'no', text: 'ready.leather.topping', basis: 'rule' },
    // Disputed: cutting point needles slit cleanly but can perforate dense designs; faux leather often a sharp needle.
    // https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-leather-machine-embroidery/print (80/12 leather)
    // https://zdigitizing.com/how-to-do-embroidery-on-leather/ (90/14 topstitch)
    needle: { text: 'ready.leather.needle', basis: 'disputed' },
    thread: { text: 'ready.leather.thread', basis: 'rule' },
    // https://blog.sulky.com/machine-embroidery-series-upholstery/ (at least halve the speed)
    // https://allstitch.com/blogs/embroidery-blogs/how-to-embroider-on-leather
    // The halving is sourced; the number (half of a usual 800) is a rule of thumb.
    speed: { maxSpm: 400, basis: 'rule' },
    // https://blog.sulky.com/machine-embroidery-series-leather/ ; tape instead of pins: rule of thumb
    hooping: { method: 'float', text: 'ready.leather.hoop', basis: 'disputed' },
    tips: [
      // https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-leather-machine-embroidery/print
      { text: 'ready.leather.tip.light', basis: 'source' },
      // https://allstitch.com/blogs/embroidery-blogs/how-to-embroider-on-leather (holes stay)
      { text: 'ready.leather.tip.holes', basis: 'source' },
      // https://www.superiorthreads.com/90-14-topstitch-titanium-coated-needles/p/132-90-14 (maker's claim)
      { text: 'ready.leather.tip.titanium', basis: 'source' },
    ],
  },
};

/** Thread weight: its own needle where it differs from 40 wt, and a warning for thick threads. */
export const THREAD_NEEDLE: Record<ThreadId, { needle?: Value; warn?: Value }> = {
  // https://allstitch.com/pages/embroidering-with-60-weight-thread (60 wt with 65/9)
  '60': { needle: { text: 'ready.thread.needle60', basis: 'source' } },
  // https://lindas.com/blogs/product-guides/isacord-40wt-embroidery-thread-guide
  '40': {},
  // Rule of thumb: makers' advice for 30 wt, page not readable.
  '30': { needle: { text: 'ready.thread.needle30', basis: 'rule' }, warn: { text: 'ready.hint.thread30', basis: 'rule' } },
  // https://edutechwiki.unige.ch/en/Embroidery_and_sewing_needle (weak source)
  '12': { needle: { text: 'ready.thread.needle12', basis: 'source' }, warn: { text: 'ready.hint.thread12', basis: 'source' } },
};

/** Thresholds of the design rules (research section 2). */
export const DESIGN_RULES = {
  // Maker's rule of thumb: one medium tear-away carries about 8,000 to 10,000 stitches, one more layer
  // per further 10,000. https://rnk-floriani.com/wp-content/uploads/2023/10/FlorianiWorkbookStabilizer.pdf
  // https://threadworks.com/blogs/buying-guides/embroidery-stabilizer-guide-cut-away-vs-tear-away-vs-specialty-stabilizers-which-one-do-you-need
  stitchesPerLayer: 10_000,
  /** Rule of thumb: at most 2 extra layers (3 in all). */
  maxExtraLayers: 2,
  /**
   * Rule of thumb: mean stitches per cm² over the stitched area (2 mm cells, see figures.ts) above
   * which a design counts as dense. No source names a firm number
   * (https://oesd.com/embroidery-density-stitch-count-and-size/ says there is none).
   *
   * The research takes a design that is mostly solid fill as dense (above 40 on its reckoning, two
   * thirds of a tatami at about 60). On this grid fills as this app sews them (shorter stitches,
   * underlay) already measure about 130 to 160, narrow satin and lettering about 150 to 210. With
   * 100 (two thirds of a fill) every ordinary small hobby design was dense, the flower of the demo
   * too (Daniel: too strict). So dense here means clearly more than a solid fill, about 1.5 times:
   * stacked layers or very tight stitching. Large solid areas still count through largeFillCm2.
   * Measured 2026-10-06: Blume 129, Musterkarte Dekor 136, Linienstiche 70, Linieneffekte 98,
   * Schriftzug 207, Aufnäher 157, Handtuch 124; examples letters.pes 272 and cat-60mm.pes 382.
   */
  denseStitchesPerCm2: 220,
  /** Rule of thumb: one closed fill larger than about 5 × 5 cm. */
  largeFillCm2: 25,
  /** Rule of thumb: on knits and light fabrics a design over about 10 cm needs more support. */
  largeDesignMm: 100,
  // https://allstitch.com/pages/embroidering-with-60-weight-thread (40 wt block letters from about 6 to 7 mm,
  // 60 wt from about 3 mm) https://signwarehouse.com/blogs/content/embroidery-thread-weights-explained
  smallTextMm: 6.5,
  tinyTextMm: 3.5,
  /** Rule of thumb: designs on caps mostly at most about 5 to 6 cm high. */
  capMaxHeightMm: 55,
  /** Rule of thumb: dense designs and small lettering sew cleaner at most this fast (stitches per minute). */
  carefulSpm: 600,
  /** Rule of thumb: thick thread (30 wt, 12 wt) at most this fast. */
  thickThreadSpm: { '30': 600, '12': 500 } as Partial<Record<ThreadId, number>>,
  /**
   * Metallic thread: about 350 to 400 per minute on home machines (swpea), 650 to 750 on industrial
   * ones (Madeira); taken about 450, a rule of thumb.
   * https://swpea.com/blogs/machine-embroidery-blogs/tips-for-using-metallic-thread-with-an-embroidery-machine
   */
  metallicSpm: 450,
} as const;

// The card for one design ------------------------------------------------------------------------

/** What the card needs to know about the design. */
export interface DesignFigures {
  stitches: number;
  /** Mean stitches per cm² over the area the design covers. */
  perCm2: number;
  /** Largest closed area covered by stitches, cm² (0 when not measured yet). */
  largestFillCm2: number;
  widthMm: number;
  heightMm: number;
  /** Height of the smallest lettering in mm, or null without lettering. */
  minLetterMm: number | null;
}

export type Params = Record<string, string | number>;

export interface Line extends Value {
  params?: Params;
}

export interface Hint extends Line {
  level: 'info' | 'warn';
}

export interface Card {
  fabric: FabricId;
  thread: ThreadId;
  stabilizer: Stabilizer;
  /** Why the stronger stabilizer was taken, if it was. */
  stronger: Line | null;
  /** Extra tear-away layers under the stabilizer for many stitches. */
  extraLayers: number;
  topping: Recipe['topping'];
  needle: Recipe['needle'];
  /** Needle for a thread weight other than 40. */
  threadNeedle: Value | null;
  /** What matters about the thread on this fabric. */
  threadNote: Value;
  /** Recommended maximum, lowered by the design and thread where they ask for it. */
  speed: Speed & { why: Key | null };
  hooping: Recipe['hooping'];
  /** Design-dependent notes, most important first, at most 3. */
  hints: Hint[];
  tips: Value[];
}

/** Fabrics a dense design is a risk on (research rule R4). */
const DELICATE: readonly FabricId[] = ['knit', 'light', 'sheer', 'leather'];
/** Fabrics with pile or texture small lettering sinks into (rule R7). */
const PILE: readonly FabricId[] = ['terry', 'knit', 'fleece'];
/** Fabrics where a large design needs more support (rule R9): knits and thin fabrics. */
const STRETCHY_OR_THIN: readonly FabricId[] = ['knit', 'fleece', 'light', 'sheer'];

/** Extra tear-away layers for many stitches: about one per further 10,000 (rule of thumb), at most 2. */
export function extraLayers(stitches: number, free = 1): number {
  const n = Math.ceil(stitches / DESIGN_RULES.stitchesPerLayer) - free;
  return Math.max(0, Math.min(DESIGN_RULES.maxExtraLayers, n));
}

/** The fabric's maximum speed, lowered (never raised) for dense designs, small lettering and thick thread. */
function speedFor(base: Speed, thread: ThreadId, dense: boolean, smallText: boolean): Card['speed'] {
  let out: Card['speed'] = { ...base, why: null };
  const lower = (spm: number | undefined, why: Key) => {
    if (spm !== undefined && (out.maxSpm === null || spm < out.maxSpm)) out = { maxSpm: spm, basis: 'rule', why };
  };
  lower(DESIGN_RULES.thickThreadSpm[thread], 'ready.speed.why.thick');
  if (smallText) lower(DESIGN_RULES.carefulSpm, 'ready.speed.why.text');
  if (dense) lower(DESIGN_RULES.carefulSpm, 'ready.speed.why.dense');
  return out;
}

/** The card for a fabric and thread weight, adjusted to the design. */
export function recipeCard(fabric: FabricId, thread: ThreadId, d: DesignFigures): Card {
  const r = RECIPES[fabric];
  const hints: Hint[] = [];
  const many = d.stitches > DESIGN_RULES.stitchesPerLayer;
  const dense = d.perCm2 > DESIGN_RULES.denseStitchesPerCm2 || d.largestFillCm2 > DESIGN_RULES.largeFillCm2;
  const large = STRETCHY_OR_THIN.includes(fabric) && Math.max(d.widthMm, d.heightMm) > DESIGN_RULES.largeDesignMm;

  // Stabilizer: the fabric is the base; stitch count, density and size add to it.
  let stronger: Line | null = null;
  let layers = 0;
  if (fabric === 'woven' || fabric === 'woven_heavy' || fabric === 'terry') {
    if (dense) stronger = { text: 'ready.reason.dense', basis: 'rule' };
    layers = extraLayers(d.stitches);
  } else if (fabric === 'fleece') {
    // Medium cut-away carries about 20,000 stitches, then heavy; past about 30,000 a tear-away under it.
    // https://graphics-pro.com/education/is-my-design-too-heavy-for-the-fabric-i-want-to-embroider/
    const lots = d.stitches > 2 * DESIGN_RULES.stitchesPerLayer;
    if (lots || dense || large) stronger = { text: lots ? 'ready.reason.many' : dense ? 'ready.reason.dense' : 'ready.reason.large', basis: lots ? 'source' : 'rule' };
    layers = extraLayers(d.stitches, 3);
  } else if (fabric === 'knit') {
    // Mesh to about 10,000 stitches, then medium cut-away; past about 20,000 a tear-away under it.
    if (many || dense || large) stronger = { text: many ? 'ready.reason.many' : dense ? 'ready.reason.dense' : 'ready.reason.large', basis: many ? 'source' : 'rule' };
    layers = extraLayers(d.stitches, 2);
  } else if (fabric === 'cap') {
    if (many || dense) stronger = { text: many ? 'ready.reason.many' : 'ready.reason.dense', basis: many ? 'source' : 'rule' };
  } else if (many || dense || large) {
    stronger = { text: many ? 'ready.reason.many' : dense ? 'ready.reason.dense' : 'ready.reason.large', basis: 'rule' };
  }
  if (stronger) stronger.params = { stitches: d.stitches };
  if (layers > 0) hints.push({ level: 'info', text: 'ready.hint.layers', params: { n: layers, stitches: d.stitches }, basis: 'rule' });
  if (DELICATE.includes(fabric) && (dense || (fabric !== 'knit' && many)))
    hints.push({ level: 'warn', text: fabric === 'leather' ? 'ready.hint.denseLeather' : 'ready.hint.denseDelicate', basis: 'rule' });

  // Lettering: thin thread for small letters, topping so they do not sink into pile.
  let topping = r.topping;
  const mm = d.minLetterMm;
  if (mm !== null && mm < DESIGN_RULES.tinyTextMm) {
    hints.push({ level: 'warn', text: 'ready.hint.tinyText', params: { mm }, basis: 'source' });
  } else if (mm !== null && mm < DESIGN_RULES.smallTextMm && thread !== '60') {
    hints.push({ level: 'info', text: 'ready.hint.smallText', params: { mm }, basis: 'source' });
  }
  if (mm !== null && mm < DESIGN_RULES.smallTextMm && PILE.includes(fabric)) {
    // https://www.madeira.com/fileadmin/user_upload/Downloads/HowTo/DE_Avalon.pdf
    topping = { need: 'always', text: 'ready.topping.forText', basis: 'source' };
  }

  if (fabric === 'cap' && d.heightMm > DESIGN_RULES.capMaxHeightMm)
    hints.push({ level: 'warn', text: 'ready.hint.capTall', params: { mm: Math.round(d.heightMm) }, basis: 'rule' });
  const tw = THREAD_NEEDLE[thread];
  if (tw.warn) hints.push({ level: 'warn', ...tw.warn });

  // Warnings first.
  hints.sort((a, b) => (a.level === b.level ? 0 : a.level === 'warn' ? -1 : 1));

  return {
    fabric,
    thread,
    stabilizer: stronger ? r.stabilizerDense : r.stabilizer,
    stronger,
    extraLayers: layers,
    topping,
    needle: r.needle,
    threadNeedle: tw.needle ?? null,
    threadNote: r.thread,
    speed: speedFor(r.speed, thread, dense, mm !== null && mm < DESIGN_RULES.smallTextMm),
    hooping: r.hooping,
    hints: hints.slice(0, 3),
    tips: r.tips.slice(0, 3),
  };
}
