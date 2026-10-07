import { describe, expect, it } from 'vitest';
import { digitizeDefaults } from '../src/digitize/digitize';
import { addShape } from '../src/model/addShape';
import { recolorBlock, shareBorders, syncBorders } from '../src/model/border';
import { blendObject } from '../src/model/blend';
import { MOTIFS } from '../src/digitize/deco';
import { ECHO_SIDES } from '../src/digitize/echo';
import { lineParts, partOf, SHADOW_DIRS, type LinePart } from '../src/model/shadow';
import { lineStitches, resewLine } from '../src/model/line';
import { refreshKnockouts, setKnockout } from '../src/model/knockout';
import { rememberObjects, sewObjects, tableOf } from '../src/model/objects';
import { COLOR_CHANGE, END, STITCH, type Pattern, type ThreadColor } from '../src/model/pattern';
import { sameColor } from '../src/model/recolor';
import { formOf, transformSewObject } from '../src/model/reshape';
import { canSplit, splitFill } from '../src/model/splitFill';
import { wholeArea } from '../src/model/knockout';
import type { Region } from '../src/digitize/region';
import { backToVersion, keepVersion, objectKey, remember, remembered, rememberedIn, restitch, restoreRemembered, DECO_PATTERNS, OPEN_PATTERNS, type FillSettings, type StoredObjects } from '../src/model/restitch';
import { reorder } from '../src/model/order';
import { stitchKinds } from '../src/model/sequence';
import { deleteObjects, duplicateObject, duplicateObjects, mirrorMatrix, recolorObjects, subtractTop } from '../src/model/shapeOps';
import { stitchesBefore } from '../src/model/transform';
import { sewDesign, specOf } from '../src/model/sew';
import { parsePattern } from '../src/parsers';
import { rotation, storeForm, translation, type Mat } from '../src/shape/path';
import { ellipsePath, parsePath, rectPath } from '../src/shape/svgPath';
import { fromStored, toStored } from '../src/storage/fileStore';
import { decodeProject, encodeProject, projectSettings } from '../src/storage/project';
import { DEFAULTS } from '../src/settings';
import { DEFAULT_PROFILE } from '../src/validation/profiles';
import { writePattern } from '../src/writers';
import { rng } from './helpers/images';

/**
 * The torture test: random chains of the operations the app offers on objects (add, duplicate (also
 * several, and in place),
 * move, turn, mirror, scale, delete, cut out, cut a fill apart, recolor, leave out, border in its own thread, empty fill, echo and shadow of a line, undo,
 * redo, save and open the project, export), done the way the app does them, with the design's
 * invariants checked after every step. A failing chain names its seed and steps, so it can be
 * replayed and turned into a fixed regression test.
 *
 * TORTURE_CHAINS and TORTURE_STEPS run more of them (e.g. TORTURE_CHAINS=10000 for a long run).
 */

const CHAINS = Number(process.env.TORTURE_CHAINS ?? 24);
const STEPS = Number(process.env.TORTURE_STEPS ?? 14);
const FIRST_SEED = Number(process.env.TORTURE_SEED ?? 1);

const ID: Mat = [1, 0, 0, 1, 0, 0];
const options = digitizeDefaults(DEFAULT_PROFILE);
const T = options.trimMm;
const COLORS: ThreadColor[] = [
  { r: 200, g: 30, b: 30 },
  { r: 30, g: 60, b: 200 },
  { r: 30, g: 160, b: 60 },
];
const empty = { name: 'torture', format: 'dst', x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } } as unknown as Pattern;
/** No records: the start, or every object deleted (an empty design). */
const blank = (p: Pattern) => p.cmd.length === 0;

/** What the app stores about the objects of a version (files.setObjects). */
const knowledge = (p: Pattern): StoredObjects => rememberedIn(p);

interface Version {
  p: Pattern;
  known: StoredObjects;
}

/** One design as the app holds it: the current version, undo and redo. */
class Doc {
  undo: Version[] = [];
  redo: Version[] = [];
  cur: Version = { p: empty, known: { v: 2, next: 1, objects: [] } };
  /** A new undo step (applyEdit). */
  commit(p: Pattern): void {
    if (p === this.cur.p) return;
    if (this.cur.p !== empty) this.undo.push(this.cur);
    this.redo = [];
    keepVersion(p);
    this.cur = { p, known: knowledge(p) };
  }
  /** The same undo step, changed (followKnockouts: record false). */
  amend(p: Pattern): void {
    keepVersion(p);
    this.cur = { p, known: knowledge(p) };
  }
  get objects() {
    return blank(this.cur.p) ? [] : sewObjects(this.cur.p);
  }
}

type Rand = () => number;
const pick = <X>(r: Rand, list: readonly X[]): X => list[Math.floor(r() * list.length)];
const between = (r: Rand, a: number, b: number) => Math.round((a + r() * (b - a)) * 10) / 10;

/** After shapes changed, the app sews anew what leaves out the shapes on top, in the same step. */
function follow(d: Doc): void {
  const r = refreshKnockouts(d.cur.p, T);
  if (r) d.amend(r.pattern);
}

/** The app's takeShapes: a new version, then the knockouts follow. */
function shapes(d: Doc, next: Pattern | null | undefined): boolean {
  if (!next) return false;
  d.commit(next);
  follow(d);
  return true;
}

/** The app's commitTransform for the objects `sel`. */
function transform(d: Doc, sel: number[], m: Mat): boolean {
  let cur = d.cur.p;
  for (const o of [...sel].sort((a, b) => b - a)) {
    const kinds = stitchKinds(cur);
    const objs = sewObjects(cur, kinds);
    const r = objs[o] && transformSewObject(cur, objs, objs[o], kinds, m, T);
    if (!r) return false;
    cur = r.pattern;
  }
  return shapes(d, syncBorders(cur, T));
}

/** The app's applyRestitched for one fill with new settings (here: its border). */
function restitchFill(d: Doc, o: number, s: FillSettings, drop: Set<string>): boolean {
  const p = d.cur.p;
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const r = restitch(p, objs, [o], { kind: 'fill', s }, kinds, T);
  if (!r.starts.length) return false;
  r.starts.forEach((a, k) => rememberObjects(r.pattern, [a], r.ends[k]));
  const now = sewObjects(r.pattern);
  r.starts.forEach((a, k) => {
    const pieces = now.filter((x) => {
      const n = stitchesBefore(r.pattern, x.first);
      return n >= a && n < r.ends[k];
    });
    if (pieces.length === 1) remember(r.pattern, pieces[0], r.memory[k]);
    shareBorders(r.pattern, pieces);
  });
  return shapes(d, syncBorders(r.pattern, T, drop));
}

function boxOf(d: Doc, sel: number[]) {
  const objs = d.objects;
  return {
    minX: Math.min(...sel.map((o) => objs[o].minX)) / 10,
    minY: Math.min(...sel.map((o) => objs[o].minY)) / 10,
    maxX: Math.max(...sel.map((o) => objs[o].maxX)) / 10,
    maxY: Math.max(...sel.map((o) => objs[o].maxY)) / 10,
  };
}

/** Saved as a project and opened again on a fresh page; the knowledge must come back whole. */
async function saveAndOpen(d: Doc): Promise<void> {
  const data = writePattern(d.cur.p, 'dst');
  const original = parsePattern(data, 'torture.dst');
  const bytes = await encodeProject({
    files: [{ name: 'torture.dst', data, working: toStored(d.cur.p), acks: [], objects: knowledge(d.cur.p) }],
    active: 0,
    image: null,
    settings: projectSettings(structuredClone(DEFAULTS)),
  });
  const back = await decodeProject(bytes);
  const p = fromStored(original, back.files[0].working);
  expect(p, 'project opens').toBeTruthy();
  restoreRemembered(p!, back.files[0].objects);
  // A fresh page has no undo history.
  d.undo = [];
  d.redo = [];
  keepVersion(p!);
  d.cur = { p: p!, known: d.cur.known };
}

/** The share of `area` that none of `parts` covers (sampled at its pixels). */
function uncovered(area: Region, parts: Region[]): number {
  const at = (r: Region, x: number, y: number) => {
    const i = Math.floor(x / r.pxMm) - r.x0;
    const j = Math.floor(y / r.pxMm) - r.y0;
    return i >= 0 && j >= 0 && i < r.w && j < r.h && !!r.mask[j * r.w + i];
  };
  let all = 0;
  let open = 0;
  for (let j = 0; j < area.h; j++) {
    for (let i = 0; i < area.w; i++) {
      if (!area.mask[j * area.w + i]) continue;
      all++;
      const x = (i + area.x0 + 0.5) * area.pxMm;
      const y = (j + area.y0 + 0.5) * area.pxMm;
      // A gap counts inside the area only: the outline itself is traced anew for each part.
      const inner = [-1, 1].every((k) => at(area, x + k * area.pxMm, y) && at(area, x, y + k * area.pxMm));
      if (inner && !parts.some((q) => at(q, x, y))) open++;
    }
  }
  return all ? open / all : 0;
}

type Op = { name: string; run: (d: Doc, r: Rand) => boolean | Promise<boolean> };

const OPS: Op[] = [
  {
    name: 'add fill',
    run: (d, r) => {
      const x = between(r, 0, 50);
      const y = between(r, 0, 50);
      const w = between(r, 6, 22);
      const h = between(r, 6, 22);
      const path = r() < 0.5 ? rectPath(x, y, w, h, 0, 0) : ellipsePath(x + w / 2, y + h / 2, w / 2, h / 2);
      const objs = d.objects;
      const after = objs.length && r() < 0.5 ? pick(r, objs).index : null;
      const a = addShape(d.cur.p, { form: parsePath(path, ID), kind: 'fill' }, pick(r, COLORS), after, options);
      return shapes(d, a?.pattern);
    },
  },
  {
    name: 'add line',
    run: (d, r) => {
      const pts = [0, 1, 2].map(() => `${between(r, 0, 60)} ${between(r, 0, 60)}`);
      const a = addShape(d.cur.p, { form: parsePath(`M${pts[0]} L${pts[1]} L${pts[2]}`, ID), kind: 'stroke', width: pick(r, [0, 2]) }, pick(r, COLORS), null, options);
      return shapes(d, a?.pattern);
    },
  },
  {
    name: 'echo',
    run: (d, r) => {
      // As the line panel: an echo on one side, both sides or none, sewn with the line.
      const lines = d.objects.filter((o) => remembered(d.cur.p, o)?.path && remembered(d.cur.p, o)?.line && !partOf(remembered(d.cur.p, o)));
      if (!lines.length) return false;
      const o = pick(r, lines);
      const m = remembered(d.cur.p, o)!;
      const count = pick(r, [1, 2, 3]);
      const old = m.line!.echo;
      // Now and then copies in threads of their own, or trimmed apart.
      const colors = r() < 0.4 ? Array.from({ length: count }, () => (r() < 0.5 ? null : pick(r, COLORS.filter((c) => !sameColor(c, o.color))))) : undefined;
      const echo = r() < 0.25 ? undefined : { side: pick(r, ECHO_SIDES), count, gap: between(r, 1.5, 5), ...(r() < 0.3 ? { cut: true } : {}), ...(colors?.some(Boolean) ? { colors, link: old?.link ?? `e${Math.floor(r() * 1e9).toString(36)}` } : {}) };
      const next = resewLine(d.cur.p, o.index, m.path!, { ...m.line!, echo }, T);
      // As the app: a shadow follows its line.
      return !!next && shapes(d, syncBorders(next.pattern, T));
    },
  },
  {
    name: 'shadow',
    run: (d, r) => {
      // As the line panel: a shadow in a thread of its own, another one, or none.
      const lines = d.objects.filter((o) => remembered(d.cur.p, o)?.path && remembered(d.cur.p, o)?.line && !partOf(remembered(d.cur.p, o)));
      if (!lines.length) return false;
      const o = pick(r, lines);
      const m = remembered(d.cur.p, o)!;
      const old = m.line!.shadow;
      const colors = COLORS.filter((c) => !sameColor(c, o.color));
      const shadow = old && r() < 0.3 ? undefined : { color: pick(r, colors), link: old?.link ?? `s${Math.floor(r() * 1e9).toString(36)}`, dir: pick(r, SHADOW_DIRS), dist: between(r, 0.3, 3) };
      const next = resewLine(d.cur.p, o.index, m.path!, { ...m.line!, shadow }, T);
      return !!next && shapes(d, syncBorders(next.pattern, T));
    },
  },
  { name: 'duplicate', run: (d, r) => d.objects.length > 0 && shapes(d, duplicateObject(d.cur.p, pick(r, d.objects).index, T)?.pattern) },
  {
    name: 'duplicate several',
    run: (d, r) => {
      if (d.objects.length < 2) return false;
      const sel = [...new Set([pick(r, d.objects).index, pick(r, d.objects).index, pick(r, d.objects).index])];
      return shapes(d, duplicateObjects(d.cur.p, sel, T)?.pattern);
    },
  },
  {
    name: 'duplicate in place',
    run: (d, r) => {
      // Ctrl+D: the copies lie exactly on their originals.
      if (!d.objects.length) return false;
      const sel = [...new Set([pick(r, d.objects).index, pick(r, d.objects).index])];
      if (process.env.TORTURE_TRACE) console.log('duplicate in place', sel);
      return shapes(d, duplicateObjects(d.cur.p, sel, T, 0)?.pattern);
    },
  },
  { name: 'move', run: (d, r) => d.objects.length > 0 && transform(d, [pick(r, d.objects).index], translation(between(r, -8, 8), between(r, -8, 8))) },
  {
    name: 'turn',
    run: (d, r) => {
      if (!d.objects.length) return false;
      const sel = [pick(r, d.objects).index];
      const b = boxOf(d, sel);
      return transform(d, sel, rotation(pick(r, [90, 45, -30]), (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2));
    },
  },
  {
    name: 'mirror',
    run: (d, r) => {
      if (!d.objects.length) return false;
      const sel = [...new Set([pick(r, d.objects).index, pick(r, d.objects).index])];
      return transform(d, sel, mirrorMatrix(pick(r, ['x', 'y'] as const), boxOf(d, sel)));
    },
  },
  {
    name: 'scale',
    run: (d, r) => {
      if (!d.objects.length) return false;
      const sel = [pick(r, d.objects).index];
      const b = boxOf(d, sel);
      const s = pick(r, [0.8, 1.25]);
      return transform(d, sel, [s, 0, 0, s, b.minX * (1 - s), b.minY * (1 - s)]);
    },
  },
  {
    name: 'delete',
    run: (d, r) => {
      if (d.objects.length < 2) return false;
      const o = pick(r, d.objects).index;
      if (process.env.TORTURE_TRACE) console.log('delete', o);
      return shapes(d, deleteObjects(d.cur.p, [o], T));
    },
  },
  {
    name: 'cut out',
    run: (d, r) => {
      if (d.objects.length < 2) return false;
      const a = pick(r, d.objects).index;
      const b = pick(r, d.objects).index;
      return a !== b && shapes(d, subtractTop(d.cur.p, [a, b], T)?.pattern);
    },
  },
  {
    name: 'cut apart',
    run: (d, r) => {
      // Zerteilen: a straight cut through the middle of a fill, at a random angle.
      const p = d.cur.p;
      const fills = d.objects.filter((o) => canSplit(p, o.index));
      if (!fills.length) return false;
      const o = pick(r, fills);
      const cx = (o.minX + o.maxX) / 20;
      const cy = (o.minY + o.maxY) / 20;
      const a = r() * Math.PI;
      const L = (o.maxX - o.minX + o.maxY - o.minY) / 10;
      const cut: [number, number][] = [
        [cx - Math.cos(a) * L, cy - Math.sin(a) * L],
        [cx + Math.cos(a) * L, cy + Math.sin(a) * L],
      ];
      const before = wholeArea(formOf(p, o, stitchKinds(p))!)!;
      const s = splitFill(p, o.index, [cut], T);
      if (s === 'whole') return false;
      expect(s, 'a fill cuts apart').toBeTruthy();
      const { pattern, parts } = s!;
      const hadBorder = !!remembered(p, o)?.fill?.border;
      if (!hadBorder) expect(sewObjects(pattern).length, 'one object more per part').toBe(d.objects.length + parts.length - 1);
      // Invariant: the parts are one whole and keep the fill's border, one object around them all.
      const pm = parts.map((k) => remembered(pattern, sewObjects(pattern)[k]));
      expect(new Set(pm.map((m) => m?.piece)).size, 'parts are one whole').toBe(1);
      expect(pm[0]?.piece, 'parts are one whole').toBeTruthy();
      expect(pm.every((m) => !!m?.fill?.border === hadBorder), 'parts keep the border').toBe(true);
      // Invariant: the parts cover the area as it was, no fabric along the cut.
      const kinds = stitchKinds(pattern);
      const objs = sewObjects(pattern, kinds);
      const areas = parts.map((k) => wholeArea(formOf(pattern, objs[k], kinds)!)!);
      expect(areas.every(Boolean), 'every part has an area').toBe(true);
      expect(uncovered(before, areas), 'parts cover the fill').toBeLessThan(0.005);
      return shapes(d, syncBorders(pattern, T));
    },
  },
  {
    name: 'recolor',
    run: (d, r) => {
      if (!d.objects.length) return false;
      // As the app: takeShapes, so what leaves out the shapes on top follows the new order.
      const o = pick(r, d.objects).index;
      const c = pick(r, COLORS);
      if (process.env.TORTURE_TRACE) console.log('recolor', o, c);
      return shapes(d, recolorObjects(d.cur.p, [o], c, T));
    },
  },
  {
    name: 'knockout',
    run: (d, r) => {
      const fills = d.objects.filter((o) => remembered(d.cur.p, o)?.form);
      if (!fills.length) return false;
      const o = pick(r, fills);
      const k = setKnockout(d.cur.p, [o.index], !remembered(d.cur.p, o)!.knockout, T);
      if (!k) return false;
      d.commit(k.pattern);
      return true;
    },
  },
  {
    name: 'border',
    run: (d, r) => {
      const fills = d.objects.filter((o) => remembered(d.cur.p, o)?.fill && !remembered(d.cur.p, o)?.asLine);
      if (!fills.length) return false;
      const o = pick(r, fills);
      const fill = remembered(d.cur.p, o)!.fill!;
      const old = fill.border?.link;
      if (old && r() < 0.4) return restitchFill(d, o.index, { ...fill, border: undefined }, new Set([old]));
      const border = { type: pick(r, ['run', 'satin'] as const), width: 2, length: 2.5, tolerance: 0.15, color: r() < 0.4 ? undefined : pick(r, COLORS), link: old ?? `l${Math.floor(r() * 1e9).toString(36)}` };
      return restitchFill(d, o.index, { ...fill, border }, new Set());
    },
  },
  {
    name: 'decorate',
    run: (d, r) => {
      const fills = d.objects.filter((o) => remembered(d.cur.p, o)?.fill && !remembered(d.cur.p, o)?.asLine);
      if (!fills.length) return false;
      const o = pick(r, fills);
      const fill = remembered(d.cur.p, o)!.fill!;
      const kind = pick(r, ['emboss', 'fade', ...DECO_PATTERNS, ...OPEN_PATTERNS] as const);
      const deco = { seed: 1 + Math.floor(r() * 9), focus: [r(), r()] as [number, number] };
      const s: FillSettings =
        kind === 'emboss'
          ? { ...fill, pattern: 'tatami', deco: { ...deco, emboss: pick(r, MOTIFS) } }
          : kind === 'fade'
            ? { ...fill, pattern: 'gradient', deco: { ...deco, fade: pick(r, ['out', 'in'] as const) } }
            : { ...fill, pattern: kind, deco };
      if (process.env.TORTURE_TRACE) console.log('decorate', o.index, kind);
      // As the app: another pattern takes a blend's second thread out.
      const blend = fill.deco?.blend?.link;
      return restitchFill(d, o.index, s, new Set(blend ? [blend] : []));
    },
  },
  {
    name: 'empty fill',
    run: (d, r) => {
      // As the pattern tile Leer: only the border, in the fill's thread; another tile fills it again.
      const fills = d.objects.filter((o) => remembered(d.cur.p, o)?.fill && !remembered(d.cur.p, o)?.asLine && !remembered(d.cur.p, o)?.blendOf);
      if (!fills.length) return false;
      const o = pick(r, fills);
      const fill = remembered(d.cur.p, o)!.fill!;
      if (fill.pattern === 'none') {
        // Another tile, or the border off (a plain fill again).
        const { border: _o, ...plain } = fill;
        return restitchFill(d, o.index, r() < 0.5 ? { ...fill, pattern: 'tatami' } : { ...plain, pattern: 'tatami' }, new Set());
      }
      const old = [fill.border?.link, fill.deco?.blend?.link].filter((l): l is string => !!l);
      const { color: _c, link: _l, ...kept } = fill.border ?? { type: pick(r, ['run', 'triple', 'satin'] as const), width: 2 };
      const { blend: _b, ...deco } = fill.deco ?? {};
      return restitchFill(d, o.index, { ...fill, pattern: 'none', deco, border: kept }, new Set(old));
    },
  },
  {
    name: 'blend',
    run: (d, r) => {
      const fills = d.objects.filter((o) => remembered(d.cur.p, o)?.fill && !remembered(d.cur.p, o)?.asLine);
      if (!fills.length) return false;
      const o = pick(r, fills).index;
      return shapes(d, blendObject(d.cur.p, o, pick(r, COLORS), T));
    },
  },
  {
    name: 'sew later',
    run: (d, r) => {
      // As the panel's Sew later: an object swaps places with the next one (a border too).
      if (d.objects.length < 2) return false;
      const o = Math.floor(r() * (d.objects.length - 1));
      const order = d.objects.map((x) => x.index);
      [order[o], order[o + 1]] = [order[o + 1], order[o]];
      const next = reorder(d.cur.p, d.objects, order, T, [], { whole: true });
      if (next === d.cur.p) return false;
      // As the app: what leaves out the shapes on top follows the new order.
      return shapes(d, next);
    },
  },
  {
    name: 'recolor block',
    run: (d, r) => {
      if (!d.cur.p.colors.length) return false;
      const b = Math.floor(r() * d.cur.p.colors.length);
      const c = pick(r, COLORS);
      if (sameColor(d.cur.p.colors[b], c)) return false;
      // As the layers panel: only the colors change.
      d.commit(recolorBlock(d.cur.p, b, c));
      return true;
    },
  },
  {
    name: 'undo',
    run: (d) => {
      const prev = d.undo.pop();
      if (!prev) return false;
      d.redo.push(d.cur);
      d.cur = prev;
      backToVersion(prev.p);
      return true;
    },
  },
  {
    name: 'redo',
    run: (d) => {
      const next = d.redo.pop();
      if (!next) return false;
      d.undo.push(d.cur);
      d.cur = next;
      backToVersion(next.p);
      return true;
    },
  },
  { name: 'save and open', run: async (d) => !blank(d.cur.p) && (await saveAndOpen(d), true) },
];

/** The records are a pattern the writers and the app can work with. */
function checkWellFormed(p: Pattern): void {
  const n = p.cmd.length;
  expect(p.x.length, 'x per record').toBe(n);
  expect(p.y.length, 'y per record').toBe(n);
  if (!n) {
    expect(p.colors, 'an empty design has no threads').toHaveLength(0);
    return;
  }
  expect(p.cmd[n - 1], 'ends with END').toBe(END);
  expect(p.cmd.slice(0, n - 1).includes(END), 'one END').toBe(false);
  const changes = p.cmd.reduce((k, c) => k + (c === COLOR_CHANGE ? 1 : 0), 0);
  expect(p.colors.length, 'a color per block').toBe(changes + 1);
  for (let i = 0; i < n; i++) if (!Number.isFinite(p.x[i]) || !Number.isFinite(p.y[i])) throw new Error(`record ${i} not finite`);
}

/** Every object was made here, so every one remembers what it is: nothing is guessed from stitches. */
function checkAllKnown(p: Pattern): void {
  const unknown = sewObjects(p).filter((o) => !remembered(p, o)).map((o) => `${o.index} (${o.kind})`);
  expect(unknown, 'objects that forgot what they are').toEqual([]);
}

/**
 * The parts an object was sewn in fit its stitches (they end at its last stitch), so the next edit
 * takes them as they are instead of telling parts apart again by how the stitches look.
 */
function checkPartsFit(p: Pattern): void {
  const problems: string[] = [];
  for (const o of sewObjects(p)) {
    const parts = remembered(p, o)?.parts;
    if (!parts) continue;
    let n = 0;
    for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) n++;
    if (parts[parts.length - 1].end !== n) problems.push(`${o.index}: parts end at ${parts[parts.length - 1].end} of ${n} stitches`);
  }
  expect(problems.join('; '), 'sewn parts that no longer fit').toBe('');
}

/**
 * Each fill's border is one object, in its own thread or the fill's, and every border has its fill.
 * Only the parts of one fill cut apart share a border (and have the same settings for it).
 */
function checkBorders(p: Pattern): void {
  const objs = sewObjects(p);
  const mem = objs.map((o) => remembered(p, o));
  const problems: string[] = [];
  const fills = new Map<string, number>();
  mem.forEach((m, k) => {
    const b = m?.fill?.border;
    if (!b?.link) return;
    const f = fills.get(b.link);
    if (f !== undefined && (!m!.piece || mem[f]!.piece !== m!.piece)) problems.push(`fills ${f} and ${k} share border link ${b.link}`);
    if (f === undefined) fills.set(b.link, k);
  });
  const pieces = new Map<string, number>();
  mem.forEach((m, k) => {
    if (!m?.piece || !m.region || !m.fill || m.fill.pattern === 'none') return;
    const f = pieces.get(m.piece);
    if (f === undefined) return void pieces.set(m.piece, k);
    if (JSON.stringify(mem[f]!.fill!.border) !== JSON.stringify(m.fill.border)) problems.push(`parts ${f} and ${k} of one whole have other borders`);
  });
  const borders = new Map<string, number>();
  mem.forEach((m, k) => {
    if (!m?.outline) return;
    if (borders.has(m.outline)) problems.push(`objects ${borders.get(m.outline)} and ${k} are the border ${m.outline}`);
    borders.set(m.outline, k);
    const f = fills.get(m.outline);
    if (f === undefined) problems.push(`border ${k} has no fill`);
    else if (!sameColor(objs[k].color, mem[f]!.fill!.border!.color ?? objs[f].color)) problems.push(`border ${k} not in its thread`);
  });
  for (const [link, k] of fills) if (!borders.has(link)) problems.push(`fill ${k} lost its border`);
  expect(problems.join('; '), 'border links').toBe('');
}

/** An empty fill is its border, in its own thread: it has one, without a thread or link of its own, and no object is its border. */
function checkEmptyFills(p: Pattern): void {
  const problems: string[] = [];
  for (const o of sewObjects(p)) {
    const f = remembered(p, o)?.fill;
    if (f?.pattern !== 'none') continue;
    if (!f.border) problems.push(`${o.index}: empty without border`);
    else if (f.border.link || f.border.color) problems.push(`${o.index}: empty with a border object`);
    if (f.deco?.blend) problems.push(`${o.index}: empty with a blend`);
  }
  expect(problems.join('; '), 'empty fills').toBe('');
}

/** Each blending fill has one second thread in its blend thread, and every second thread its fill. */
function checkBlends(p: Pattern): void {
  const objs = sewObjects(p);
  const mem = objs.map((o) => remembered(p, o));
  const problems: string[] = [];
  const fills = new Map<string, number>();
  mem.forEach((m, k) => {
    const b = m?.fill?.deco?.blend;
    if (!b) return;
    if (fills.has(b.link)) problems.push(`fills ${fills.get(b.link)} and ${k} share blend link ${b.link}`);
    fills.set(b.link, k);
  });
  const seconds = new Map<string, number>();
  mem.forEach((m, k) => {
    if (!m?.blendOf) return;
    if (seconds.has(m.blendOf)) problems.push(`objects ${seconds.get(m.blendOf)} and ${k} are the blend ${m.blendOf}`);
    seconds.set(m.blendOf, k);
    const f = fills.get(m.blendOf);
    if (f === undefined) problems.push(`second thread ${k} has no fill`);
    else if (!sameColor(objs[k].color, mem[f]!.fill!.deco!.blend!.color)) problems.push(`second thread ${k} not in its thread`);
  });
  for (const [link, k] of fills) if (!seconds.has(link)) problems.push(`fill ${k} lost its second thread`);
  expect(problems.join('; '), 'blend links').toBe('');
}

/**
 * A line's stitches are what its curve and settings (with its echo) sew: every stitch lies on the
 * lines sewn anew from them, and every one of those lines has stitches, so an echo that moved,
 * turned, mirrored, scaled, was undone or saved never parts from what the line remembers.
 */
function checkEchoes(p: Pattern): void {
  const problems: string[] = [];
  const near = (q: [number, number], line: [number, number][]) => {
    let best = Infinity;
    for (let i = 1; i < line.length; i++) {
      const [a, b] = [line[i - 1], line[i]];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy));
    }
    return best;
  };
  for (const o of sewObjects(p)) {
    const m = remembered(p, o);
    if (!m?.path || !m.line?.echo) continue;
    const fresh = lineStitches(m.path, m.line).flat();
    const sewn: [number, number][] = [];
    for (let i = o.first; i <= o.last; i++) if (p.cmd[i] === STITCH) sewn.push([p.x[i] / 10, p.y[i] / 10]);
    const off = Math.max(...sewn.map((q) => near(q, fresh)));
    const missing = Math.max(...fresh.filter((_, k) => k % 7 === 0).map((q) => near(q, sewn)));
    if (off > 0.6 || missing > 0.6) problems.push(`line ${o.index}: stitches ${off.toFixed(2)} mm off its echo, echo ${missing.toFixed(2)} mm from its stitches`);
  }
  expect(problems.join('; '), 'echoes that parted from their lines').toBe('');
}

/**
 * Each part of a line in a thread of its own (its shadow, its echo copies by thread) is one object,
 * in that thread, remembering what the line says it is; every such object has its line.
 */
function checkLineParts(p: Pattern): void {
  const objs = sewObjects(p);
  const mem = objs.map((o) => remembered(p, o));
  const problems: string[] = [];
  const want = new Map<string, { line: number; part: LinePart }>();
  mem.forEach((m, k) => {
    if (!m?.path || !m.line || partOf(m)) return;
    for (const part of lineParts(m)) {
      if (want.has(part.link)) problems.push(`lines ${want.get(part.link)!.line} and ${k} share part ${part.link}`);
      want.set(part.link, { line: k, part });
    }
  });
  const have = new Map<string, number>();
  mem.forEach((m, k) => {
    const l = partOf(m);
    if (!l) return;
    if (have.has(l)) problems.push(`objects ${have.get(l)} and ${k} are the part ${l}`);
    have.set(l, k);
    const w = want.get(l);
    if (!w) return void problems.push(`part ${k} has no line`);
    if (!sameColor(objs[k].color, w.part.color)) problems.push(`part ${k} not in its thread`);
    if (JSON.stringify(storeForm(m!.path!)) !== JSON.stringify(storeForm(w.part.memory.path!)) || JSON.stringify(m!.line) !== JSON.stringify(w.part.memory.line)) problems.push(`part ${k} not what its line says`);
  });
  // A copy with nothing to sew (no room for it beside the line) has no object.
  const sews = (w: { part: LinePart }) => lineStitches(w.part.memory.path!, w.part.memory.line!).some((run) => run.length > 1);
  for (const [link, w] of want) if (!have.has(link) && sews(w)) problems.push(`line ${w.line} lost its part ${link}`);
  expect(problems.join('; '), 'line parts').toBe('');
}

/**
 * The object list of the version: every stitch in exactly one object, the objects in sewing order
 * without overlap, each with an id of its own, and what an object knows carries its id.
 */
function checkObjectList(p: Pattern): void {
  const t = tableOf(p);
  const problems: string[] = [];
  const ids = new Set<number>();
  let last = -1;
  for (const e of t.entries) {
    if (ids.has(e.id)) problems.push(`id ${e.id} twice`);
    ids.add(e.id);
    if (e.id >= t.next) problems.push(`id ${e.id} not below next ${t.next}`);
    if (e.first <= last) problems.push(`object ${e.id} overlaps the one before`);
    if (e.first > e.last) problems.push(`object ${e.id} is empty`);
    if (e.memory?.id !== undefined && e.memory.id !== e.id) problems.push(`object ${e.id} knows itself as ${e.memory.id}`);
    last = e.last;
  }
  const owned = new Uint8Array(p.cmd.length);
  for (const e of t.entries) owned.fill(1, e.first, e.last + 1);
  for (let i = 0; i < p.cmd.length; i++) if (p.cmd[i] === STITCH && !owned[i]) problems.push(`stitch ${i} in no object`);
  expect(problems.slice(0, 5).join('; '), 'object list').toBe('');
}

/** Every object has a key of its own, also copies lying exactly on their originals, so none shares what another remembers. */
function checkKeys(p: Pattern): void {
  const seen = new Map<string, number>();
  const problems: string[] = [];
  for (const o of sewObjects(p)) {
    const k = objectKey(p, o);
    if (seen.has(k)) problems.push(`objects ${seen.get(k)} and ${o.index} share key ${k}`);
    seen.set(k, o.index);
  }
  expect(problems.join('; '), 'objects sharing what they remember').toBe('');
}

/** What leaves out the shapes on top fits the shapes on top now. */
function checkKnockouts(p: Pattern): void {
  expect(refreshKnockouts(p, T)?.changed ?? [], 'fills whose left-out parts are out of date').toEqual([]);
}

/** Exported and read back, the stitches are the same. */
function checkExport(p: Pattern): void {
  const stitches = (q: Pattern) => {
    const out: string[] = [];
    for (let i = 0; i < q.cmd.length; i++) if (q.cmd[i] === STITCH) out.push(`${q.x[i]},${q.y[i]}`);
    return out.filter((s, i) => s !== out[i - 1]);
  };
  const back = parsePattern(writePattern(p, 'pes'), 'torture.pes');
  const a = stitches(p);
  const b = stitches(back);
  const ox = Number(b[0]?.split(',')[0]) - Number(a[0]?.split(',')[0]);
  const oy = Number(b[0]?.split(',')[1]) - Number(a[0]?.split(',')[1]);
  const moved = a.map((s) => s.split(',').map(Number)).map(([x, y]) => `${x + ox},${y + oy}`);
  expect(b, 'stitches read back from PES').toEqual(moved);
}

/** The objects of `p` in a line each, to follow a chain (TORTURE_TRACE=1). */
/**
 * The design sewn from its object list (stage C, see src/model/sew.ts): the same objects with the
 * same ids, kinds and threads in the same order, each that knows its shape sewn from it, and sewn
 * again from the new list it stays as it is.
 */
function checkSewDesign(p: Pattern): void {
  if (!p.cmd.length) return;
  const objs = sewObjects(p);
  const q = sewDesign(p, T);
  checkWellFormed(q);
  checkObjectList(q);
  const after = sewObjects(q);
  const shape = (os: typeof objs) => os.map((o) => `${o.id}:${o.kind}:${o.block}`).join(' ');
  expect(shape(after), 'objects sewn from the list').toBe(shape(objs));
  expect(q.colors, 'threads').toEqual(p.colors);
  expect(objs.filter((o) => specOf(p, o)).length, 'objects sewn from their shape').toBe(after.filter((o) => specOf(q, o)).length);
  const r = sewDesign(q, T);
  const ro = sewObjects(r);
  const moved = after.filter((o, k) => {
    const b = ro[k];
    if (!b || b.last - b.first !== o.last - o.first) return true;
    for (let i = 0; i <= o.last - o.first; i++) if (q.x[o.first + i] !== r.x[b.first + i] || q.y[o.first + i] !== r.y[b.first + i] || q.cmd[o.first + i] !== r.cmd[b.first + i]) return true;
    return false;
  });
  const what = (o: (typeof objs)[number]) => { const m = remembered(q, o); return `${o.index}:${o.kind}:${specOf(q, o)?.kind ?? 'kept'}:${m?.fill?.pattern ?? ''}${m?.outline ? ':border' : ''}${m?.blendOf ? ':blend' : ''}${m?.knockout ? ':ko' : ''}`; };
  expect(moved.map(what).join(' '), 'sewn again from the new list: objects that changed').toBe('');
}

function describeObjects(p: Pattern): string {
  return sewObjects(p)
    .map((o) => {
      const m = remembered(p, o);
      const what = !m ? 'UNKNOWN' : [m.form && 'form', m.fill && 'fill', m.path && 'line', m.knockout && 'knockout', m.fill?.border?.link && `border->${m.fill.border.link}`, m.outline && `outline=${m.outline}`, m.blendOf && `blendOf=${m.blendOf}`, m.fill?.deco?.blend && `blend->${m.fill.deco.blend.link}`].filter(Boolean).join(' ');
      return `\n  ${o.index} ${objectKey(p, o)} ${o.kind} block ${o.block} rgb(${o.color.r},${o.color.g},${o.color.b}) ${what}`;
    })
    .join('');
}

async function chain(seed: number, steps = STEPS): Promise<void> {
  const r = rng(seed);
  const d = new Doc();
  const log: string[] = [];
  const at = () => `seed ${seed}: ${log.join(' > ')}`;
  for (let step = 0; step < steps; step++) {
    const op = blank(d.cur.p) ? OPS[0] : pick(r, OPS);
    let done: boolean;
    try {
      done = await op.run(d, r);
    } catch (e) {
      throw new Error(`${at()} > ${op.name} threw: ${(e as Error).stack}`);
    }
    if (!done) continue;
    log.push(op.name);
    const p = d.cur.p;
    if (process.env.TORTURE_TRACE) console.log(op.name, describeObjects(p));
    try {
      checkWellFormed(p);
      expect(knowledge(p), 'knowledge as stored with this version').toEqual(d.cur.known);
      checkAllKnown(p);
      checkKeys(p);
      checkObjectList(p);
      checkPartsFit(p);
      checkBorders(p);
      checkEmptyFills(p);
      checkBlends(p);
      checkEchoes(p);
      checkLineParts(p);
      checkKnockouts(p);
      if (op.name === 'save and open' || step === steps - 1) {
        checkExport(p);
        checkSewDesign(p);
      }
    } catch (e) {
      throw new Error(`${at()}\n${(e as Error).message}`);
    }
  }
}

describe('torture test', () => {
  const seeds = Array.from({ length: CHAINS }, (_, k) => FIRST_SEED + k);
  it.each(seeds)('chain %i keeps the design consistent', async (seed) => {
    await chain(seed);
  });
});

/** A square with a running border in a thread of its own, made as the app makes it. */
function borderedSquare(): Doc {
  const d = new Doc();
  shapes(d, addShape(empty, { form: parsePath(rectPath(0, 0, 20, 20, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
  shapes(d, addShape(d.cur.p, { form: parsePath(ellipsePath(40, 10, 6, 6), ID), kind: 'fill' }, COLORS[0], 0, options)!.pattern);
  const fill = remembered(d.cur.p, d.objects[0])!.fill!;
  restitchFill(d, 0, { ...fill, border: { type: 'run', width: 2, length: 2.5, tolerance: 0.15, color: COLORS[1], link: 'sq' } }, new Set());
  return d;
}

const borderOf = (d: Doc) => d.objects.findIndex((o) => remembered(d.cur.p, o)?.outline === 'sq');
const squareOf = (d: Doc) => d.objects.find((o) => remembered(d.cur.p, o)?.fill?.border?.link === 'sq');

describe('found by the torture test', () => {
  it('deleting a border leaves its fill without one, and undo brings both back', () => {
    const d = borderedSquare();
    const before = d.cur;
    expect(borderOf(d)).toBeGreaterThan(0);
    shapes(d, deleteObjects(d.cur.p, [borderOf(d)], T));
    expect(borderOf(d)).toBe(-1);
    expect(d.objects.every((o) => !remembered(d.cur.p, o)?.fill?.border)).toBe(true);
    checkBorders(d.cur.p);
    // The square's stitches did not change, yet the version before still knows its border.
    backToVersion(before.p);
    expect(knowledge(before.p)).toEqual(before.known);
    expect(squareOf({ cur: before, objects: sewObjects(before.p) } as unknown as Doc)).toBeTruthy();
  });

  it('deleting a fill takes its border along', () => {
    const d = borderedSquare();
    shapes(d, deleteObjects(d.cur.p, [squareOf(d)!.index], T));
    expect(borderOf(d)).toBe(-1);
    expect(d.objects).toHaveLength(1);
  });

  it('a border neither cuts nor is cut', () => {
    const d = borderedSquare();
    expect(subtractTop(d.cur.p, [0, borderOf(d)], T)).toBeNull();
    checkBorders(d.cur.p);
  });

  it('recoloring a border gives its fill that border thread', () => {
    const d = borderedSquare();
    shapes(d, recolorObjects(d.cur.p, [borderOf(d)], COLORS[2], T));
    expect(sameColor(squareOf(d)!.color, COLORS[0])).toBe(true);
    expect(sameColor(remembered(d.cur.p, squareOf(d)!)!.fill!.border!.color, COLORS[2])).toBe(true);
    checkBorders(d.cur.p);
  });

  // Chains that failed once (borders on delete, cut out and recolor; knockouts after reopening a
  // project whose curves were stored rounded; a fill leaving out its own satin border): replayed
  // with every run.
  // The ones the regular chains above already run with the same steps are not run twice.
  const regular = (seed: number) => STEPS === 14 && seed >= FIRST_SEED && seed < FIRST_SEED + CHAINS;
  it.each([3, 4, 9, 11, 12, 16, 18, 24, 34, 38, 101, 389].filter((s) => !regular(s)))('chain %i still holds', async (seed) => {
    await chain(seed, 14);
  });
  // From the first long run (20 steps): a narrow added shape sewn as satin forgot what it was;
  // neighbours of one thread became one object after a delete or recolor between them; a copy
  // (or its border) landing on another object shared its memory; leaving out depended on what was
  // left out before.
  it.each([270, 387, 383, 130, 139, 315, 1124])('long chain %i still holds', async (seed) => {
    await chain(seed, 20);
  }, 60_000);
});

describe('versions keep what they knew', () => {
  /** A pattern of one stitch at (i, i): something else to remember. */
  const other = (i: number): Pattern => ({ ...empty, x: Int32Array.of(i, i), y: Int32Array.of(i, i), cmd: Uint8Array.of(STITCH, END), colors: [COLORS[0]] });

  it('a version forgets nothing, however much other versions learn meanwhile', () => {
    const d = new Doc();
    shapes(d, addShape(empty, { form: parsePath(rectPath(0, 0, 20, 20, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
    const first = d.cur;
    // A long session: far more objects remembered than the old memory held (400).
    for (let i = 1; i <= 1000; i++) {
      const q = other(i);
      remember(q, sewObjects(q)[0], { region: null });
    }
    expect(remembered(first.p, sewObjects(first.p)[0])?.form).toBeTruthy();
    expect(knowledge(first.p)).toEqual(first.known);
  });

  it('a later version with the same stitches does not change what an earlier one knows', () => {
    const d = new Doc();
    shapes(d, addShape(empty, { form: parsePath(rectPath(0, 0, 20, 20, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
    const first = d.cur;
    const o = sewObjects(first.p)[0];
    const m = remembered(first.p, o)!;
    // Same stitches, other settings (as a setting changed without new stitches).
    const same = { ...first.p };
    remember(same, o, { ...m, lock: true });
    d.commit(same);
    expect(remembered(first.p, o)?.lock).toBeUndefined();
    expect(remembered(same, o)?.lock).toBe(true);
    // The same object in both: the same id.
    expect(sewObjects(same)[0].id).toBe(o.id);
  });
});
