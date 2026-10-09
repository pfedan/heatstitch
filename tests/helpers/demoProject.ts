import { readFileSync } from 'node:fs';
import { digitizeDefaults, type DigitizeOptions } from '../../src/digitize/digitize';
import { addFont, type Font } from '../../src/lettering/font';
import { LETTERING_DEFAULTS, type Lettering } from '../../src/lettering/layout';
import { placeLettering } from '../../src/lettering/place';
import { sewLettering } from '../../src/lettering/sew';
import { addShape } from '../../src/model/addShape';
import { blendObject } from '../../src/model/blend';
import { syncBorders } from '../../src/model/border';
import { lineSettings, resewLine } from '../../src/model/line';
import { refreshKnockouts, setKnockout } from '../../src/model/knockout';
import { rememberObjects, sewObjects } from '../../src/model/objects';
import type { PathStitch } from '../../src/model/along';
import type { Pattern, ThreadColor } from '../../src/model/pattern';
import { keepVersion, remember, remembered, rememberedIn, restitch, restoreRemembered, type FillSettings, type StoredObjects } from '../../src/model/restitch';
import { stitchKinds } from '../../src/model/sequence';
import { stitchesBefore } from '../../src/model/transform';
import { parsePattern } from '../../src/parsers';
import type { Mat } from '../../src/shape/path';
import { ellipsePath, parsePath, rectPath } from '../../src/shape/svgPath';
import { DEFAULTS, materialOf, type Material } from '../../src/settings';
import type { FabricId, Profile } from '../../src/validation/profiles';
import { writePattern } from '../../src/writers';
import { toStored, type StoredPattern, type Titles } from '../../src/storage/fileStore';
import { setTrims } from '../../src/model/jumps';
import { transitions } from '../../src/model/sequence';

/**
 * The demo project: a handful of own designs (Stickmuster), each showing a group of what the app
 * can do, made with the same operations the app uses, so every object stays editable when the
 * project is opened. tests/demoProject.test.ts builds and checks it and keeps
 * public/examples/demo/heatstitch-demo.heatstitch (under "Load example") in sync.
 */

const ID: Mat = [1, 0, 0, 1, 0, 0];
const text = (u: URL) => new TextDecoder().decode(readFileSync(u));

// Threads from the Madeira Polyneon catalog (public/threads/catalogs.json), so the color list names them.
const catalogs = JSON.parse(text(new URL('../../public/threads/catalogs.json', import.meta.url))) as {
  catalogs: { id: string; name: string; threads: [string, string, string][] }[];
};
const polyneon = catalogs.catalogs.find((c) => c.id === 'madeira-polyneon')!;
function madeira(number: string): ThreadColor {
  const t = polyneon.threads.find((x) => x[1] === number);
  if (!t) throw new Error(`Madeira Polyneon ${number} not in the catalog`);
  const [hex, catalog, name] = t;
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), name, brand: polyneon.name, catalog };
}

export const THREADS = {
  red: madeira('1878'),
  orange: madeira('1955'),
  yellow: madeira('1925'),
  green: madeira('1749'),
  darkGreen: madeira('1902'),
  lime: madeira('1950'),
  blue: madeira('1642'),
  navy: madeira('1966'),
  sky: madeira('1827'),
  pink: madeira('1721'),
  purple: madeira('1880'),
  white: madeira('1802'),
  black: madeira('1800'),
  grey: madeira('1689'),
  brown: madeira('1858'),
  gold: madeira('1772'),
  teal: madeira('1846'),
};

const fonts = new Map<string, Font>();
function font(id: string): Font {
  let f = fonts.get(id);
  if (!f) {
    f = JSON.parse(text(new URL(`../../public/fonts/${id}.json`, import.meta.url))) as Font;
    addFont(f);
    fonts.set(id, f);
  }
  return f;
}

const empty = { name: 'demo', format: 'pes', x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } } as unknown as Pattern;

/** One design built step by step the way the app edits it. */
export class Design {
  p: Pattern = empty;
  readonly options: DigitizeOptions;
  readonly T: number;
  private links = 0;
  constructor(
    readonly title: string,
    readonly profile: Profile = { fabric: 'woven', thread: '40' },
    readonly hoop: { w: number; h: number } = { w: 100, h: 100 },
    /** The fabric color the design is shown on. */
    readonly background = '#f3efe6',
  ) {
    this.options = digitizeDefaults(profile);
    this.T = this.options.trimMm;
  }

  get objects() {
    return this.p.cmd.length ? sewObjects(this.p) : [];
  }

  /** Sewn after the last object: in its thread when it is the same, so one color stays one block. */
  private get tail(): number | null {
    const n = this.objects.length;
    return n ? this.objects[n - 1].index : null;
  }

  private link(prefix: string): string {
    return `${prefix}${this.title.toLowerCase().replace(/[^a-z]/g, '')}${++this.links}`;
  }

  /** After shapes changed, what leaves out the shapes on top follows (the app's takeShapes). */
  private take(next: Pattern | null | undefined): void {
    if (!next) throw new Error(`${this.title}: a step failed`);
    keepVersion(next);
    this.p = next;
    const r = refreshKnockouts(this.p, this.T);
    if (r) {
      keepVersion(r.pattern);
      this.p = r.pattern;
    }
  }

  /** A filled area, then sewn anew with `s` over the material's fill settings. Returns its index. */
  fill(path: string, color: ThreadColor, s: Partial<FillSettings> = {}): number {
    const a = addShape(this.p, { form: parsePath(path, ID), kind: 'fill' }, color, this.tail, this.options);
    this.take(a?.pattern);
    const o = this.objects.find((x) => stitchesBefore(this.p, x.first) === a!.start)!;
    if (Object.keys(s).length) this.restitchFill(o.index, { ...remembered(this.p, o)!.fill!, ...s });
    return this.objects.length - 1;
  }

  /** A line; `st` changes its stitch from what a new line gets. Returns its index. */
  line(path: string, color: ThreadColor, st: Partial<PathStitch> = {}, width = 0): number {
    const a = addShape(this.p, { form: parsePath(path, ID), kind: 'stroke', width }, color, this.tail, this.options);
    this.take(a?.pattern);
    if (Object.keys(st).length) this.restitchLine(this.objects.length - 1, st);
    return this.objects.length - 1;
  }

  /** The line `index` sewn anew with these stitch settings (the line panel). */
  restitchLine(index: number, st: Partial<PathStitch>): void {
    const o = this.objects[index];
    const m = remembered(this.p, o)!;
    const next = resewLine(this.p, o.index, m.path!, { ...lineSettings(this.p, o), ...st }, this.T);
    this.take(next && syncBorders(next.pattern, this.T));
  }

  echo(index: number, side: 'out' | 'in' | 'both', count: number, gap: number, colors?: (ThreadColor | null)[]): void {
    this.restitchLine(index, { echo: { side, count, gap, ...(colors ? { colors, link: this.link('e') } : {}) } });
  }

  shadow(index: number, color: ThreadColor, angle = 45, dist = 1.1): void {
    this.restitchLine(index, { shadow: { color, link: this.link('s'), angle, dist } });
  }

  /** The fill `index` sewn anew with the settings `s` (the stitch panel). */
  restitchFill(index: number, s: FillSettings, drop = new Set<string>()): void {
    const kinds = stitchKinds(this.p);
    const objs = sewObjects(this.p, kinds);
    const r = restitch(this.p, objs, [index], { kind: 'fill', s }, kinds, this.T);
    if (!r.starts.length) throw new Error(`${this.title}: fill ${index} not sewn anew`);
    r.starts.forEach((a, k) => rememberObjects(r.pattern, [a], r.ends[k]));
    const now = sewObjects(r.pattern);
    r.starts.forEach((a, k) => {
      const pieces = now.filter((x) => {
        const n = stitchesBefore(r.pattern, x.first);
        return n >= a && n < r.ends[k];
      });
      if (pieces.length === 1) remember(r.pattern, pieces[0], r.memory[k]);
    });
    this.take(syncBorders(r.pattern, this.T, drop));
  }

  settingsOf(index: number): FillSettings {
    return remembered(this.p, this.objects[index])!.fill!;
  }

  /** A border on the edge of fill `index`, in `color` (its own thread) or the fill's. */
  border(index: number, type: 'run' | 'triple' | 'satin', width = 2, color?: ThreadColor): void {
    const s = this.settingsOf(index);
    this.restitchFill(index, { ...s, border: { type, width, length: 2.5, tolerance: 0.15, ...(color ? { color } : {}), link: this.link('b') } });
  }

  /** A two-thread blend: fill `index` fades out, `color` fades in on the same area. */
  blend(index: number, color: ThreadColor): void {
    // The app links the two by a random id; a fixed one keeps the demo file the same from run to run.
    const random = Math.random;
    Math.random = () => 0.5;
    try {
      this.take(blendObject(this.p, index, color, this.T));
    } finally {
      Math.random = random;
    }
  }

  /** Fill `index` leaves out the shapes sewn on top of it. */
  knockout(index: number): void {
    const k = setKnockout(this.p, [index], true, this.T);
    if (!k) throw new Error(`${this.title}: knockout of ${index} changed nothing`);
    keepVersion(k.pattern);
    this.p = k.pattern;
  }

  /** Jumps between objects from `mm` on are trimmed (as the jumps panel's "Ab Grenze schneiden"). */
  cutJumps(mm = 3): void {
    // Only between objects: a trim inside one would change its stitches from what it remembers.
    const ends = this.objects.map((o) => o.last);
    const long = transitions(this.p).filter((t) => !t.trimmed && t.lengthMm >= mm && ends.some((e) => e >= t.from && e < t.to));
    if (long.length) {
      this.p = setTrims(this.p, long, true);
      keepVersion(this.p);
    }
  }

  /** A lettering (Schriftzug), sewn at the end of the design. */
  text(over: Partial<Lettering> & Pick<Lettering, 'text' | 'font' | 'x' | 'y' | 'color'>): void {
    const l: Lettering = { ...LETTERING_DEFAULTS, id: this.link('t'), ...over };
    const placed = placeLettering(this.p.cmd.length ? this.p : null, [], sewLettering(font(l.font), l, this.T), l, this.title);
    this.take(placed?.pattern);
  }

  /** The design as a file of the project: PES bytes as the app writes an own design, and what it knows of its objects. */
  file(): { name: string; data: Uint8Array; working: StoredPattern; acks: []; titles: Titles; objects: StoredObjects; material: Material; title: string; own: true } {
    const data = writePattern(this.p, 'pes');
    // As the app opens it: the stitches read back from the file, and the object list put on them.
    const back = parsePattern(data, `${this.title}.pes`);
    const objs = sewObjects(this.p);
    const known = rememberedIn(this.p, objs);
    restoreRemembered(back, structuredClone(known));
    const read = sewObjects(back);
    if (objs.length !== read.length) throw new Error(`${this.title}: ${objs.length} objects, ${read.length} read back`);
    const material: Material = {
      ...materialOf(structuredClone(DEFAULTS)),
      profile: this.profile,
      hoop: { ...this.hoop },
      background: this.background,
    };
    // The working copy keeps the threads as picked from the catalog (PES alone maps them to Brother's).
    const titles = { de: this.title, en: ENGLISH[this.title] };
    return { name: `${this.title}.pes`, data, working: toStored(this.p), acks: [], objects: known, material, title: this.title, titles, own: true };
  }
}

// Shapes ---------------------------------------------------------------------------------------

const f = (n: number) => Math.round(n * 100) / 100;
const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L')} Z`;
/** A petal from the middle (cx, cy) outwards at `deg`, `len` long, `w` wide. */
function petal(cx: number, cy: number, deg: number, len: number, w: number, r0 = 0): string {
  const a = (deg * Math.PI) / 180;
  const [ux, uy] = [Math.cos(a), Math.sin(a)];
  const [nx, ny] = [-uy, ux];
  const P = (s: number, t: number) => `${f(cx + ux * s + nx * t)} ${f(cy + uy * s + ny * t)}`;
  return `M${P(r0, 0)} C${P(r0 + len * 0.25, w * 0.75)} ${P(r0 + len * 0.8, w * 0.75)} ${P(r0 + len, 0)} C${P(r0 + len * 0.8, -w * 0.75)} ${P(r0 + len * 0.25, -w * 0.75)} ${P(r0, 0)} Z`;
}
const heart = (cx: number, cy: number, s: number) =>
  `M${f(cx)} ${f(cy + s * 0.9)} C${f(cx - s * 1.3)} ${f(cy)} ${f(cx - s * 0.9)} ${f(cy - s * 0.9)} ${f(cx)} ${f(cy - s * 0.35)} C${f(cx + s * 0.9)} ${f(cy - s * 0.9)} ${f(cx + s * 1.3)} ${f(cy)} ${f(cx)} ${f(cy + s * 0.9)} Z`;
const star = (cx: number, cy: number, r: number, inner = 0.45, n = 5) =>
  poly(Array.from({ length: n * 2 }, (_, k) => {
    const a = -Math.PI / 2 + (k * Math.PI) / n;
    const rr = k % 2 ? r * inner : r;
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)] as [number, number];
  }));
const wave = (x0: number, y: number, len: number, amp: number, waves: number) => {
  const step = len / (waves * 2);
  let d = `M${f(x0)} ${f(y)}`;
  for (let k = 0; k < waves * 2; k++) d += ` Q${f(x0 + step * (k + 0.5))} ${f(y + (k % 2 ? amp : -amp) * 1.6)} ${f(x0 + step * (k + 1))} ${f(y)}`;
  return d;
};

/** The designs' names in English: the list shows them in the app's language. */
const ENGLISH: Record<string, string> = {
  Blume: 'Flower',
  'Musterkarte Dekor': 'Decorative sampler',
  Linienstiche: 'Line stitches',
  'Linien mit Parametern': 'Line settings',
  Linieneffekte: 'Line effects',
  Schriftzug: 'Lettering',
  Aufnäher: 'Patch',
  Handtuch: 'Towel',
};

// The designs ----------------------------------------------------------------------------------

/** Blume: fill patterns on drawn shapes (tatami, gradient, contour, spiral), a satin stem and leaves with guided rows. */
export function flower(): Design {
  const d = new Design('Blume');
  const { green, darkGreen, pink, purple, orange } = THREADS;
  // Stem as a satin line, leaves along it.
  d.line('M50 52 C48 65 52 78 50 94', darkGreen, {}, 2.4);
  d.fill(petal(50, 78, 205, 22, 7), green, { pattern: 'follow' });
  d.fill(petal(50, 70, -25, 22, 7), green, { pattern: 'contour' });
  // Petals: tatami at their own angles (pink), gradients (purple); one thread after the other.
  const petals: number[] = [];
  for (const purple_ of [false, true])
    for (let k = purple_ ? 1 : 0; k < 8; k += 2) {
      const deg = k * 45 - 90;
      const angle = (deg + 90 + 180) % 180;
      petals.push(d.fill(petal(50, 34, deg, 22, 8.5, 5), purple_ ? purple : pink, purple_ ? { pattern: 'gradient', angle, spacingEnd: 0.8 } : { angle }));
    }
  d.fill(ellipsePath(50, 34, 8, 8), orange, { pattern: 'spiral' });
  // The petals leave out the middle sewn on top of them.
  for (const k of petals) d.knockout(k);
  d.cutJumps();
  return d;
}

/** Musterkarte Dekor: decorative and open fills, embossing and a two-thread blend, one per field. */
export function decoSampler(): Design {
  const d = new Design('Musterkarte Dekor', { fabric: 'woven', thread: '40' }, { w: 130, h: 180 }, '#f4f2ee');
  const { blue, teal, purple, red, orange, green, navy, pink, gold, sky } = THREADS;
  const fields: [Partial<FillSettings>, ThreadColor][] = [
    [{ pattern: 'waves', deco: { height: 1.5, length: 6 } }, blue],
    [{ pattern: 'grain', deco: { seed: 3, strength: 0.6 } }, gold],
    [{ pattern: 'rays', deco: { focus: [0.5, 0.5] } }, orange],
    [{ pattern: 'swirl', deco: { seed: 2 } }, purple],
    [{ pattern: 'tatami', deco: { emboss: 'hearts', embossSize: 9, embossStrong: true } }, red],
    [{ pattern: 'tatami', deco: { emboss: 'stars', embossSize: 9, embossStrong: true } }, navy],
    [{ pattern: 'meander', deco: { seed: 4, size: 2.5 } }, teal],
    [{ pattern: 'maze', deco: { seed: 5, size: 3 } }, green],
    [{ pattern: 'cross', deco: { cross: 'full', size: 3 } }, pink],
  ];
  const size = 34;
  const gap = 6;
  fields.forEach(([s, c], k) => {
    const x = 6 + (k % 3) * (size + gap);
    const y = 6 + Math.floor(k / 3) * (size + gap);
    d.fill(rectPath(x, y, size, size, 3, 3), c, s);
  });
  // A blend below the fields: sky into purple.
  const blendAt = d.fill(rectPath(6, 6 + 3 * (size + gap), 3 * size + 2 * gap, 24, 3, 3), sky, { angle: 0 });
  d.blend(blendAt, purple);
  d.cutJumps();
  return d;
}

/** Linienstiche: every line stitch on the same wave, one under the other. */
export function lineStitches(): Design {
  const d = new Design('Linienstiche', { fabric: 'woven', thread: '40' }, { w: 130, h: 180 });
  const { black, red, blue, green, purple, orange, pink, teal, navy, brown } = THREADS;
  const rows: [string, Partial<PathStitch>, ThreadColor, number?][] = [
    ['Steppstich', { type: 'run' }, black],
    ['Bohnenstich 3-fach', { type: 'triple', repeat: 3 }, brown],
    ['Bohnenstich 5-fach', { type: 'triple', repeat: 5 }, red],
    ['Zickzack', { type: 'zigzag', width: 3 }, orange],
    ['E-Stich', { type: 'e', width: 3 }, green],
    ['Motivstich Wellen', { type: 'motif', motif: 'waves', width: 3 }, teal],
    ['Motivstich Bögen', { type: 'motif', motif: 'scallops', width: 3.5 }, blue],
    ['Motivstich Herzen', { type: 'motif', motif: 'hearts', width: 4 }, pink],
    ['Motivstich Kette', { type: 'motif', motif: 'chain', width: 3 }, purple],
    ['Satinlinie', { type: 'satin', width: 3 }, navy, 3],
  ];
  // The names say which stitch each row shows, as the stitch panel calls it.
  rows.forEach(([, st, c, w], k) => d.line(wave(10, 12 + k * 16, 110, 2.2, 3), c, st, w ?? 0));
  d.cutJumps();
  return d;
}

/**
 * Linien mit Parametern: each line stitch and line effect in three settings side by side, one row
 * per setting that changes (stitch length, repeats, width, spacing, side, motif size, underlay,
 * echo copies and gap, shadow direction and distance).
 */
export function lineVariants(): Design {
  const d = new Design('Linien mit Parametern', { fabric: 'woven', thread: '40' }, { w: 130, h: 180 }, '#f3efe6');
  const { black, brown, red, orange, green, teal, blue, pink, purple, navy, grey, sky, gold } = THREADS;
  type Cell = { st: Partial<PathStitch>; width?: number; then?: (d: Design, i: number) => void };
  const rows: [ThreadColor, Cell[]][] = [
    // Steppstich: stitch length 1.5, 2.5, 4 mm.
    [black, [1.5, 2.5, 4].map((length) => ({ st: { type: 'run', length } }))],
    // Bohnenstich: 3 and 5 times, and 5 times with long stitches.
    [brown, [{ st: { type: 'triple', repeat: 3 } }, { st: { type: 'triple', repeat: 5 } }, { st: { type: 'triple', repeat: 5, length: 4 } }]],
    // Zickzack: narrow and dense, middle, wide and open.
    [orange, [[2, 0.8], [3.5, 1.5], [5, 2.5]].map(([width, spacing]) => ({ st: { type: 'zigzag', width, spacing } }))],
    // E-Stich: narrow, wide, wide on the other side.
    [green, [{ st: { type: 'e', width: 2 } }, { st: { type: 'e', width: 4 } }, { st: { type: 'e', width: 4, flip: true } }]],
    // Motivstich Wellen: 2, 4, 6 mm across.
    [teal, [2, 4, 6].map((width) => ({ st: { type: 'motif', motif: 'waves', width } }))],
    // Motivstich Bögen on one side and the other, a chain sewn three times; then hearts 3 and 5 mm, the big ones three times.
    [blue, [{ st: { type: 'motif', motif: 'scallops', width: 4 } }, { st: { type: 'motif', motif: 'scallops', width: 4, flip: true } }, { st: { type: 'motif', motif: 'chain', width: 3, repeat: 3 } }]],
    [pink, [{ st: { type: 'motif', motif: 'hearts', width: 3 } }, { st: { type: 'motif', motif: 'hearts', width: 5 } }, { st: { type: 'motif', motif: 'hearts', width: 5, repeat: 3 } }]],
    // Satinlinie: 1.5 mm without underlay, 3 mm, 5 mm with zigzag underlay.
    [navy, [{ st: { type: 'satin', width: 1.5, under: 'off' }, width: 1.5 }, { st: { type: 'satin', width: 3 }, width: 3 }, { st: { type: 'satin', width: 5, under: 'zigzag' }, width: 5 }]],
    // Echo: one copy outside, two on both sides, three close ones.
    [purple, [
      { st: { type: 'run' }, then: (x, i) => x.echo(i, 'out', 1, 2.5) },
      { st: { type: 'run' }, then: (x, i) => x.echo(i, 'both', 2, 1.8) },
      { st: { type: 'triple', repeat: 3 }, then: (x, i) => x.echo(i, 'in', 3, 1.2) },
    ]],
    // Echo copies in threads of their own.
    [red, [
      { st: { type: 'run' }, then: (x, i) => x.echo(i, 'out', 1, 2.5, [gold]) },
      { st: { type: 'triple', repeat: 3 }, then: (x, i) => x.echo(i, 'both', 1, 2.2, [sky]) },
      { st: { type: 'run' }, then: (x, i) => x.echo(i, 'out', 2, 2, [orange, gold]) },
    ]],
    // Schatten: close below right, further below right, above left.
    [navy, [
      { st: { type: 'satin', width: 2 }, width: 2, then: (x, i) => x.shadow(i, grey, 45, 0.5 * Math.SQRT2) },
      { st: { type: 'satin', width: 2 }, width: 2, then: (x, i) => x.shadow(i, grey, 45, 1.5 * Math.SQRT2) },
      { st: { type: 'satin', width: 2 }, width: 2, then: (x, i) => x.shadow(i, grey, 225, 1.2 * Math.SQRT2) },
    ]],
  ];
  rows.forEach(([color, cells], r) =>
    cells.forEach(({ st, width, then }, c) => {
      const i = d.line(wave(8 + c * 40, 12 + r * 15.5, 34, 1.6, 1), color, st, width ?? 0);
      then?.(d, i);
    }),
  );
  d.cutJumps();
  return d;
}

/** Linieneffekte: echoes on one side and both sides, a shadow in a thread of its own, echo copies in their own threads. */
export function lineEffects(): Design {
  const d = new Design('Linieneffekte', undefined, undefined, '#eef0f2');
  const { red, blue, grey, teal, sky, navy, orange, yellow } = THREADS;
  const a = d.line(wave(10, 16, 80, 2.5, 2), blue, { type: 'triple', repeat: 3 });
  d.echo(a, 'out', 2, 2.5);
  const b = d.line('M12 52 C30 32 70 32 88 52', teal, { type: 'run' });
  d.echo(b, 'both', 2, 2.2, [sky, navy]);
  const c = d.line(heart(50, 78, 14), red, { type: 'satin', width: 2.5 }, 2.5);
  d.shadow(c, grey, 45, Math.SQRT2);
  const s = d.line(star(50, 78, 6, 0.5), yellow, { type: 'triple', repeat: 3 });
  d.echo(s, 'out', 1, 2, [orange]);
  d.cutJumps();
  return d;
}

/** Schriftzug: lettering in several fonts, straight and on an arc. */
export function lettering(): Design {
  const d = new Design('Schriftzug', undefined, undefined, '#f6efe4');
  const { navy, red, purple, gold } = THREADS;
  d.text({ text: 'heatstitch', font: 'pacificlo', height: 16, align: 'center', x: 50, y: 30, color: purple, shape: 'arcUp', radius: 45 });
  d.text({ text: 'Stick mit mir', font: 'barstitch_bold', height: 11, align: 'center', x: 50, y: 56, color: navy });
  d.text({ text: 'Danke!', font: 'mam_script', height: 20, align: 'center', x: 50, y: 84, color: red });
  d.line('M22 90 L78 90', gold, { type: 'motif', motif: 'hearts', width: 3.5 });
  d.cutJumps();
  return d;
}

/** Aufnäher: a round patch with a satin border in its own thread and letters the fill leaves out. */
export function patch(): Design {
  const d = new Design('Aufnäher', undefined, undefined, '#cdbf9f');
  const { navy, white, gold, yellow } = THREADS;
  const disc = d.fill(ellipsePath(50, 50, 40, 40), navy, { angle: 45 });
  d.border(disc, 'satin', 3.5, gold);
  d.fill(star(50, 32, 10), yellow, { angle: 90 });
  d.text({ text: 'HEAT', font: 'barstitch_bold', height: 12, align: 'center', x: 50, y: 62, color: white });
  d.text({ text: 'STITCH', font: 'barstitch_bold', height: 9, align: 'center', x: 50, y: 76, color: white });
  d.knockout(disc);
  d.cutJumps();
  return d;
}

/** Handtuch: a monogram on terry, with its own fabric and hoop. */
export function towel(): Design {
  const d = new Design('Handtuch', { fabric: 'terry', thread: '40' }, { w: 130, h: 180 }, '#efe6d2');
  const { teal, white, sky } = THREADS;
  const plate = d.fill(rectPath(20, 40, 90, 80, 12, 12), sky, { pattern: 'tatami', angle: 30 });
  d.border(plate, 'satin', 3, teal);
  d.text({ text: 'A', font: 'montecarlo', height: 52, align: 'center', x: 65, y: 100, color: white });
  d.knockout(plate);
  d.line(wave(20, 138, 90, 2, 4), teal, { type: 'motif', motif: 'scallops', width: 5 });
  d.cutJumps();
  return d;
}

export const DEMO_DESIGNS = [flower, decoSampler, lineStitches, lineVariants, lineEffects, lettering, patch, towel];

/** Builds every design afresh (object memory starts empty). */
export function buildDemos(): Design[] {
  return DEMO_DESIGNS.map((make) => make());
}

export const fabricOfDesign = (d: Design): FabricId => d.profile.fabric;
