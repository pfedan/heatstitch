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
 * The interface shows 'rule' and 'disputed' next to the value and words all advice carefully.
 * No brand names in the texts, no fixed stitches per minute (home machines run about 400 to 1000).
 * Texts are i18n keys in src/i18n/areas/ready.ts.
 */

export type Basis = 'source' | 'disputed' | 'rule';
/** Relative speed: normal, about 2/3 to 3/4 of the maximum, about half or less. */
export type Speed = 'normal' | 'reduced' | 'slow';
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
  speed: Value & { step: Speed };
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
    speed: { step: 'normal', text: 'ready.speed.normal', basis: 'rule' },
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
    // https://static.naehpark.com//out/pictures/media/brother-pr-680w-herstellerprospekt.pdf (speed limited for caps)
    speed: { step: 'reduced', text: 'ready.speed.reduced', basis: 'source' },
    // https://www.sewingmachinefun.com/machine-embroider-hat/ (flat hoop, sticky stabilizer)
    // https://machineembroiderygeek.com/durkee-cap-frames-for-easy-embroidery-on-baseball-caps/
    hooping: { method: 'capFrameOrFloat', text: 'ready.cap.hoop', basis: 'source' },
    tips: [
      { text: 'ready.cap.tip.small', basis: 'rule' },
      { text: 'ready.cap.tip.order', basis: 'rule' },
      { text: 'ready.cap.tip.structured', basis: 'rule' },
    ],
  },

  // Strick, Fleece (jersey, T-shirt, polo, sweat) ----------------------------------------------------
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
    speed: { step: 'normal', text: 'ready.speed.normalOrLess', basis: 'rule' },
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
    speed: { step: 'normal', text: 'ready.speed.normalOrLess', basis: 'rule' },
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

  // Leicht, empfindlich (batiste, lawn; also sheer fabrics in today's profile) ----------------------
  light: {
    // Disputed: sheer fabrics take heavy wash-away https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-organza-machine-embroidery
    // batiste takes mesh or tear-away https://emblibrary.com/blogs/projects/fabrics-101-embroidering-on-batiste
    // https://kimberbell.com/blogs/thekimberbellablog/using-no-show-mesh-stabilizer-for-lightweight-fabrics
    stabilizer: { kind: 'mesh', weight: 'light', gsm: [40, 50], text: 'ready.light.stab', basis: 'disputed' },
    stabilizerDense: { kind: 'mesh', weight: 'light', gsm: [40, 50], text: 'ready.light.stabDense', basis: 'rule' },
    topping: { need: 'no', text: 'ready.topping.no', basis: 'rule' },
    // Disputed: one source 75/11 sharp, many guides smaller. https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-organza-machine-embroidery
    // https://allstitch.com/pages/embroidering-with-60-weight-thread (65/9 with 60 wt)
    needle: { size: '70/10', alt: 'ready.light.needleAlt', text: 'ready.needle.fineSharp', basis: 'disputed' },
    // https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-organza-machine-embroidery (bobbin like top thread)
    thread: { text: 'ready.light.thread', basis: 'source' },
    // https://zdigitizing.com/how-to-machine-embroidery-on-chiffon-fabric/ (weak source)
    speed: { step: 'reduced', text: 'ready.speed.reduced', basis: 'source' },
    // https://emblibrary.com/learn/how-to/fabrics-101-embroidering-on-organza-machine-embroidery ("hoop both layers together firmly")
    hooping: { method: 'hoop', text: 'ready.light.hoop', basis: 'source' },
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
    speed: { step: 'slow', text: 'ready.speed.slow', basis: 'source' },
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
   * Rule of thumb: mean stitches per cm² over the stitched area (2 mm cells, see figures.ts). The
   * research reckons tatami at about 60 per cm² (0.4 mm rows, about 4 mm stitches) and takes a design
   * above 40, two thirds of that, as mostly solid fill. Fills as this app sews them (shorter stitches,
   * underlay) measure about 130 to 160 on that grid, so two thirds of solid fill is about 100 here.
   * No source names a firm number (https://oesd.com/embroidery-density-stitch-count-and-size/ says
   * there is none).
   */
  denseStitchesPerCm2: 100,
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
  speed: Recipe['speed'];
  hooping: Recipe['hooping'];
  /** Design-dependent notes, most important first, at most 3. */
  hints: Hint[];
  tips: Value[];
}

const DELICATE: readonly FabricId[] = ['knit', 'light', 'leather'];
const PILE: readonly FabricId[] = ['terry', 'knit'];

/** Extra tear-away layers for many stitches: about one per further 10,000 (rule of thumb), at most 2. */
export function extraLayers(stitches: number, free = 1): number {
  const n = Math.ceil(stitches / DESIGN_RULES.stitchesPerLayer) - free;
  return Math.max(0, Math.min(DESIGN_RULES.maxExtraLayers, n));
}

/** The card for a fabric and thread weight, adjusted to the design. */
export function recipeCard(fabric: FabricId, thread: ThreadId, d: DesignFigures): Card {
  const r = RECIPES[fabric];
  const hints: Hint[] = [];
  const many = d.stitches > DESIGN_RULES.stitchesPerLayer;
  const dense = d.perCm2 > DESIGN_RULES.denseStitchesPerCm2 || d.largestFillCm2 > DESIGN_RULES.largeFillCm2;
  const large = (fabric === 'knit' || fabric === 'light') && Math.max(d.widthMm, d.heightMm) > DESIGN_RULES.largeDesignMm;

  // Stabilizer: the fabric is the base; stitch count, density and size add to it.
  let stronger: Line | null = null;
  let layers = 0;
  if (fabric === 'woven' || fabric === 'terry') {
    if (dense) stronger = { text: 'ready.reason.dense', basis: 'rule' };
    layers = extraLayers(d.stitches);
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
    speed: r.speed,
    hooping: r.hooping,
    hints: hints.slice(0, 3),
    tips: r.tips.slice(0, 3),
  };
}
