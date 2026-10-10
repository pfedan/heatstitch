import { expect } from 'vitest';
import { digitizeDefaults } from '../../src/digitize/digitize';
import { addShape } from '../../src/model/addShape';
import { followerLinks, partHolders, recolorBlock, sameRegion, shareBorders, syncBorders } from '../../src/model/border';
import { blendObject } from '../../src/model/blend';
import { MOTIFS } from '../../src/digitize/deco';
import { ECHO_SIDES } from '../../src/digitize/echo';
import { partOf, type LinePart } from '../../src/model/shadow';
import { fillToLine, lineStitches, lineToFill, resewLine } from '../../src/model/line';
import { refreshKnockouts, setKnockout } from '../../src/model/knockout';
import { rememberObjects, sewObjects, tableOf, type SewObject } from '../../src/model/objects';
import { COLOR_CHANGE, END, STITCH, type Pattern, type ThreadColor } from '../../src/model/pattern';
import { sameColor } from '../../src/model/recolor';
import { fillsToLines, lineToSatin, reshapeFill, reshapeObject, transformSewObject } from '../../src/model/reshape';
import { canSplit, splitFill } from '../../src/model/splitFill';
import { cutKey, sewnArea, wholeArea, wholeOf } from '../../src/model/knockout';
import { unionOf } from '../../src/shape/rasterize';
import { borderStitches } from '../../src/model/along';
import type { Region } from '../../src/digitize/region';
import { backToVersion, edgeAlong, keepVersion, objectKey, remember, remembered, rememberedIn, restitch, restoreRemembered, DECO_PATTERNS, OPEN_PATTERNS, type BorderSettings, type FillSettings, type Rails, type Remembered, type StoredObjects } from '../../src/model/restitch';
import { reorder } from '../../src/model/order';
import { stitchKinds } from '../../src/model/sequence';
import { deleteObjects, duplicateObject, duplicateObjects, mirrorMatrix, recolorObjects, subtractTop } from '../../src/model/shapeOps';
import { stitchesBefore } from '../../src/model/transform';
import { sewDesign, specOf } from '../../src/model/sew';
import { parsePattern } from '../../src/parsers';
import { bounds as boundsOf, extendPath, flatten, insertNode, rotation, segments, storeForm, translation, type Form, type Mat } from '../../src/shape/path';
import { ellipsePath, parsePath, rectPath } from '../../src/shape/svgPath';
import { fromStored, toStored } from '../../src/storage/fileStore';
import { decodeProject, encodeProject, projectSettings } from '../../src/storage/project';
import { DEFAULTS } from '../../src/settings';
import { DEFAULT_PROFILE } from '../../src/validation/profiles';
import { tagShortStitches, TIE } from '../../src/validation/shortStitches';
import { thinByHand } from '../../src/correct/thinHand';
import { keepObjects } from '../../src/model/handEdit';
import { Editor } from '../../src/ui/editor';
import { stitchBefore } from '../../src/model/edit';
import { THIN_SHARES } from '../../src/areas/stitches/state';
import { writePattern } from '../../src/writers';
import { rng } from './images';
import { inheritTrace, movedTrace, readTrace, setTraceOf, sizedTrace, storeTrace, traceFrom, traceOf, withTrace, type Trace } from '../../src/model/trace';
import { areaLoops, suggestSatin } from '../../src/digitize/satinSuggest';
import { stripsOfAreas } from '../../src/digitize/rungs';
import { areaOfForm, loadOps, subtractForm } from '../../src/shape/ops';
import { areaOf, fillArea, fits, formKey, geoOf, geoUse, guessArea, guessGeo, lineGeoOf, openOf, withGeo } from '../../src/model/geo';

// Joining and cutting run on the curves (paper.js), loaded once.
await loadOps();

/**
 * The torture test: random chains of the operations the app offers on objects (add, duplicate (also
 * several, and in place),
 * move, turn, mirror, scale, thin out by hand, delete, cut out, cut a fill apart, recolor, leave out, border in its own thread, empty fill, echo and shadow of a line,
 * a line's nodes edited (put in, added at an end, closed, opened), a closed line filled inside, undo,
 * redo, save and open the project, export), done the way the app does them, with the design's
 * invariants checked after every step. A failing chain names its seed and steps, so it can be
 * replayed and turned into a fixed regression test.
 *
 * TORTURE_CHAINS and TORTURE_STEPS run more of them (e.g. TORTURE_CHAINS=10000 for a long run).
 *
 * The chains live here; torture.test.ts, tortureSeeds, tortureLong and tortureRead run them, as
 * four files so they run side by side instead of one after another.
 */

/** The stitches of object `o` (0.1 mm), its tie-in left out. */
export const ownStitches = (p: Pattern, o: SewObject) => {
  const out: string[] = [];
  for (let i = o.first + o.tieIn; i <= o.last; i++) if (p.cmd[i] === STITCH) out.push(`${p.x[i]},${p.y[i]}`);
  return out.join(' ');
};

export const CHAINS = Number(process.env.TORTURE_CHAINS ?? 24);
export const STEPS = Number(process.env.TORTURE_STEPS ?? 14);
export const FIRST_SEED = Number(process.env.TORTURE_SEED ?? 1);

export const ID: Mat = [1, 0, 0, 1, 0, 0];
export const options = digitizeDefaults(DEFAULT_PROFILE);
export const T = options.trimMm;
export const COLORS: ThreadColor[] = [
  { r: 200, g: 30, b: 30 },
  { r: 30, g: 60, b: 200 },
  { r: 30, g: 160, b: 60 },
];
export const empty = { name: 'torture', format: 'dst', x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } } as unknown as Pattern;
/** No records: the start, or every object deleted (an empty design). */
export const blank = (p: Pattern) => p.cmd.length === 0;

/** What the app stores about the objects of a version (files.setObjects). */
export const knowledge = (p: Pattern): StoredObjects => rememberedIn(p);

export interface Version {
  p: Pattern;
  known: StoredObjects;
  /** The tracing image this version should have (what the ops laid, not what the pattern says). */
  trace: Trace | null;
}

/** One design as the app holds it: the current version, undo and redo. */
export class Doc {
  undo: Version[] = [];
  redo: Version[] = [];
  cur: Version = { p: empty, known: { v: 2, next: 1, objects: [] }, trace: null };
  /** A new undo step (applyEdit). */
  commit(p: Pattern, trace = this.cur.trace): void {
    if (p === this.cur.p) return;
    if (this.cur.p !== empty) this.undo.push(this.cur);
    this.redo = [];
    // As files.setPattern: a new version keeps the tracing image of the one before.
    inheritTrace(this.cur.p, p);
    keepVersion(p);
    this.cur = { p, known: knowledge(p), trace };
  }
  /** The same undo step, changed (followKnockouts: record false). */
  amend(p: Pattern): void {
    inheritTrace(this.cur.p, p);
    keepVersion(p);
    this.cur = { p, known: knowledge(p), trace: this.cur.trace };
  }
  /** Lays, moves or removes the tracing image (one undo step, the stitches as they are). */
  commitTrace(t: Trace | null): void {
    this.commit(withTrace(this.cur.p, t), t);
  }
  get objects() {
    return blank(this.cur.p) ? [] : sewObjects(this.cur.p);
  }
}

export type Rand = () => number;
export const pick = <X>(r: Rand, list: readonly X[]): X => list[Math.floor(r() * list.length)];
export const between = (r: Rand, a: number, b: number) => Math.round((a + r() * (b - a)) * 10) / 10;

/** After shapes changed, the app sews anew what leaves out the shapes on top, in the same step. */
export function follow(d: Doc): void {
  const r = refreshKnockouts(d.cur.p, T);
  if (r) d.amend(r.pattern);
}

/** The app's takeShapes: a new version, then the knockouts follow. */
/**
 * Ausschneiden on the curves: what is left of the lower fill `o` (now `left` in `next`) does not
 * overlap the cutter `top`, and is exactly the old form without the cutter.
 */
function checkCut(p: Pattern, o: number, top: number, next: Pattern, left: number): void {
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  const cutter = guessArea(p, objs[top], kinds)!;
  const was = guessArea(p, objs[o], kinds)!;
  const now = guessArea(next, sewObjects(next)[left], stitchKinds(next));
  expect(now, 'a cut fill keeps a form').toBeTruthy();
  const area = areaOfForm(now!);
  const outside = subtractForm(now!, cutter);
  expect(area - (outside ? areaOfForm(outside) : 0), 'cut fill and cutter overlap (mm²)').toBeLessThan(0.01);
  const want = subtractForm(was, cutter);
  expect(Math.abs(area - (want ? areaOfForm(want) : 0)), 'cut fill is the old form without the cutter (mm²)').toBeLessThan(Math.max(0.01, 1e-3 * area));
}

export function shapes(d: Doc, next: Pattern | null | undefined): boolean {
  if (!next) return false;
  d.commit(next);
  follow(d);
  return true;
}

/** The app's commitTransform for the objects `sel`. */
export function transform(d: Doc, sel: number[], m: Mat): boolean {
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
/** Fill `o` sewn anew with `s` and, when given, the border `line` beside it (null: none; not given: the one it has). */
export function restitchFill(d: Doc, o: number, s: FillSettings, drop: Set<string>, line?: BorderSettings | null): boolean {
  const p = d.cur.p;
  const kinds = stitchKinds(p);
  const objs = sewObjects(p, kinds);
  return took(d, restitch(p, objs, [o], { kind: 'fill', s, line }, kinds, T), drop);
}

/** New stitches taken over as the app does: each object remembers what it is made of. */
function took(d: Doc, r: ReturnType<typeof restitch> | null, drop: ReadonlySet<string> = new Set()): boolean {
  if (!r?.starts.length) return false;
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

export function boxOf(d: Doc, sel: number[]) {
  const objs = d.objects;
  return {
    minX: Math.min(...sel.map((o) => objs[o].minX)) / 10,
    minY: Math.min(...sel.map((o) => objs[o].minY)) / 10,
    maxX: Math.max(...sel.map((o) => objs[o].maxX)) / 10,
    maxY: Math.max(...sel.map((o) => objs[o].maxY)) / 10,
  };
}

/** Saved as a project and opened again on a fresh page; the knowledge must come back whole. */
export async function saveAndOpen(d: Doc): Promise<void> {
  const data = writePattern(d.cur.p, 'dst');
  const original = parsePattern(data, 'torture.dst');
  const t = traceOf(d.cur.p);
  const view = { shown: true, locked: false, opacity: 0.35 };
  const bytes = await encodeProject({
    files: [{ name: 'torture.dst', data, working: toStored(d.cur.p), acks: [], objects: knowledge(d.cur.p), ...(t ? { trace: storeTrace(t, view) } : {}) }],
    active: 0,
    image: null,
    settings: projectSettings(structuredClone(DEFAULTS)),
  });
  const back = await decodeProject(bytes);
  const p = fromStored(original, back.files[0].working);
  expect(p, 'project opens').toBeTruthy();
  restoreRemembered(p!, back.files[0].objects);
  // As files.addData: the tracing image read back lies under the opened version.
  const stored = readTrace(back.files[0].trace);
  expect(!!stored, 'the tracing image comes back').toBe(!!t);
  if (stored) expect({ shown: stored.shown, locked: stored.locked, opacity: stored.opacity }, 'with its view').toEqual(view);
  setTraceOf(p!, stored && traceFrom(stored));
  // A fresh page has no undo history.
  d.undo = [];
  d.redo = [];
  keepVersion(p!);
  d.cur = { p: p!, known: d.cur.known, trace: d.cur.trace };
}

/** Bytes standing in for a picture: the model never looks inside. */
const PICTURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

/** What can happen to the tracing image, interleaved with the ops when a chain asks for it. */
export const TRACE_OPS: Op[] = [
  {
    name: 'lay tracing image',
    run: (d, r) => {
      const w = between(r, 20, 150);
      d.commitTrace({ name: 'vorlage', type: 'image/png', data: PICTURE, x: between(r, -80, 40), y: between(r, -80, 40), w, h: w * between(r, 0.4, 2) });
      return true;
    },
  },
  {
    name: 'move tracing image',
    run: (d, r) => {
      const t = traceOf(d.cur.p);
      if (!t) return false;
      d.commitTrace(movedTrace(t, between(r, -30, 30), between(r, -30, 30)));
      return true;
    },
  },
  {
    name: 'size tracing image',
    run: (d, r) => {
      const t = traceOf(d.cur.p);
      if (!t) return false;
      d.commitTrace(sizedTrace(t, between(r, 1, 3000)));
      return true;
    },
  },
  {
    name: 'remove tracing image',
    run: (d) => {
      if (!traceOf(d.cur.p)) return false;
      d.commitTrace(null);
      return true;
    },
  },
];

/**
 * The tracing image is exactly the one laid last (undo and redo bring back their own, every edit
 * keeps it, a project brings it back), lies where it can be drawn, and is no part of the stitches.
 */
export function checkTrace(d: Doc): void {
  const t = traceOf(d.cur.p);
  const want = d.cur.trace;
  if (!want) return expect(t, 'no tracing image').toBeNull();
  expect(t, 'the tracing image laid last').toEqual(want);
  expect([t!.x, t!.y, t!.w, t!.h].every(Number.isFinite), 'placed in finite mm').toBe(true);
  expect(t!.w > 0 && t!.h > 0, 'with a size').toBe(true);
  expect(Math.abs(t!.h / t!.w - want.h / want.w), 'keeps its aspect ratio').toBeLessThan(1e-9);
}

/** The share of `area` that none of `parts` covers (sampled at its pixels). */
export function uncovered(area: Region, parts: Region[]): number {
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

export type Op = { name: string; run: (d: Doc, r: Rand) => boolean | Promise<boolean> };

export const OPS: Op[] = [
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
      const lines = d.objects.filter((o) => lineGeoOf(remembered(d.cur.p, o)) && remembered(d.cur.p, o)?.line && !partOf(remembered(d.cur.p, o)));
      if (!lines.length) return false;
      const o = pick(r, lines);
      const m = remembered(d.cur.p, o)!;
      const count = pick(r, [1, 2, 3]);
      const old = m.line!.echo;
      // Now and then copies in threads of their own, or trimmed apart.
      const colors = r() < 0.4 ? Array.from({ length: count }, () => (r() < 0.5 ? null : pick(r, COLORS.filter((c) => !sameColor(c, o.color))))) : undefined;
      // Copies apart or overlapping (0 to 10 mm), their figures in step or shifted, sewn either way round.
      const echo =
        r() < 0.25
          ? undefined
          : {
              side: pick(r, ECHO_SIDES),
              count,
              gap: r() < 0.1 ? 0 : between(r, 0.2, 6),
              ...(r() < 0.3 ? { cut: true } : {}),
              ...(r() < 0.4 ? { phase: Math.round(between(r, -180, 180)) } : {}),
              ...(r() < 0.3 ? { reverse: true } : {}),
              ...(colors?.some(Boolean) ? { colors, link: old?.link ?? `e${Math.floor(r() * 1e9).toString(36)}` } : {}),
            };
      // Now and then sewn more than once: the whole line there and back, or a motif as bean stitch.
      const repeat = r() < 0.3 ? pick(r, [2, 3, 4, 5]) : m.line!.repeat;
      const next = resewLine(d.cur.p, o.index, m.geo!, { ...m.line!, echo, ...(repeat && m.line!.type !== 'triple' ? { repeat } : {}), ...(r() < 0.3 ? { whole: true } : {}) }, T);
      // As the app: a shadow follows its line.
      return !!next && shapes(d, syncBorders(next.pattern, T));
    },
  },
  {
    name: 'shadow',
    run: (d, r) => {
      // As the line panel: a shadow in a thread of its own, another one, or none.
      const lines = d.objects.filter((o) => lineGeoOf(remembered(d.cur.p, o)) && remembered(d.cur.p, o)?.line && !partOf(remembered(d.cur.p, o)));
      if (!lines.length) return false;
      const o = pick(r, lines);
      const m = remembered(d.cur.p, o)!;
      const old = m.line!.shadow;
      const colors = COLORS.filter((c) => !sameColor(c, o.color));
      const shadow = old && r() < 0.3 ? undefined : { color: pick(r, colors), link: old?.link ?? `s${Math.floor(r() * 1e9).toString(36)}`, angle: Math.floor(r() * 360), dist: r() < 0.15 ? 0 : between(r, 0, 10) };
      const next = resewLine(d.cur.p, o.index, m.geo!, { ...m.line!, shadow }, T);
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
    // As the app: the stitches of one object selected (Strg+A in it) and thinned out by hand.
    name: 'thin by hand',
    run: (d, r) => {
      if (!d.objects.length) return false;
      const p = d.cur.p;
      const before = sewObjects(p);
      const o = pick(r, before);
      const [share] = pick(r, THIN_SHARES);
      const tags = tagShortStitches(p);
      const t = thinByHand(p, {
        needAt: (i) => (i >= o.first && i <= o.last && p.cmd[i] === STITCH ? share : 0),
        protect: tags.map((x) => (x === TIE ? 1 : 0)),
      });
      if (!t.removed) return false;
      const removed: number[] = [];
      t.mask.forEach((m, i) => m && removed.push(i));
      const now = keepObjects(p, t.pattern, { removed }).get(o.index);
      // Thinning takes stitches out of the object, it never cuts it in two or joins it to another.
      const after = sewObjects(t.pattern);
      expect(after.map((x) => x.id), 'thinned by hand: the same objects').toEqual(before.map((x) => x.id));
      expect(now, 'thinned by hand: the object stays where it was').toBe(o.index);
      expect(after[o.index].last - after[o.index].first, 'thinned by hand: only its own stitches go').toBe(o.last - o.first - t.removed);
      // Its stitches are only spread wider, never laid outside where they were.
      const a = after[o.index];
      expect([a.minX >= o.minX, a.minY >= o.minY, a.maxX <= o.maxX, a.maxY <= o.maxY], 'thinned by hand: stays within its stitches').toEqual([true, true, true, true]);
      d.commit(t.pattern);
      return true;
    },
  },
  {
    // As the app: stitches level in one object, "Weitersticken" on, one to three clicks from its
    // thread end (or after a point picked in it), each its own undo step.
    name: 'stitch on by hand',
    run: (d, r) => {
      if (!d.objects.length) return false;
      const before = sewObjects(d.cur.p);
      const o0 = pick(r, before);
      let o = o0.index;
      const others = new Map(before.map((x) => [x.id, ownStitches(d.cur.p, x)]));
      const before0 = d.cur.p;
      const obj = () => sewObjects(d.cur.p)[o];
      const editor = new Editor({
        pattern: () => d.cur.p,
        range: () => ({ first: obj().first, last: obj().last }),
        ends: () => ({ first: obj().first, end: obj().last - obj().tieOff, last: obj().last }),
        commit: (next, change) => {
          const moved = keepObjects(d.cur.p, next, change!);
          o = moved.get(o) ?? -1;
          d.commit(next);
        },
        redraw: () => {},
        changed: () => {},
      });
      editor.setActive(true);
      const fromEnd = r() < 0.7;
      if (!fromEnd) {
        const pts: number[] = [];
        for (let i = o0.first; i < o0.last - o0.tieOff; i++) if (d.cur.p.cmd[i] === STITCH) pts.push(i);
        if (!pts.length) return false;
        editor.selection = new Set([pick(r, pts)]);
      }
      editor.setPen(true);
      const clicks = 1 + Math.floor(r() * 3);
      const cur = () => [...editor.selection][0] ?? obj().last - obj().tieOff;
      for (let k = 0; k < clicks; k++) {
        const i = cur();
        // 2 to 5 mm on in some direction: never a tie, never the same spot.
        const a = r() * Math.PI * 2;
        const len = between(r, 2, 5);
        const x = d.cur.p.x[i] / 10 + Math.cos(a) * len;
        const y = d.cur.p.y[i] / 10 + Math.sin(a) * len;
        // Far from other points, so it does not snap into another hole (scale 1000: within 0.08 mm).
        editor.down(x, y, 0, 0, false, 1000);
        editor.up();
        expect(o, 'stitched on: the object stays').toBe(o0.index);
      }
      const after = sewObjects(d.cur.p);
      expect(after.map((x) => x.id), 'stitched on: the same objects').toEqual(before.map((x) => x.id));
      expect(after[o].stitches, 'stitched on: one stitch more per click').toBe(o0.stitches + clicks);
      for (const x of after) if (x.index !== o) expect(ownStitches(d.cur.p, x), 'stitched on: the others stay as they were').toBe(others.get(x.id));
      if (fromEnd) {
        // The thread ends at the last click, locked by the tie-off that came along: what is sewn after
        // it stays as close to it as the tie-off was to the old end (each turn may round by 0.1 mm).
        const a = after[o];
        const p = d.cur.p;
        const last = [...editor.selection][0];
        const reach = (q: Pattern, end: number, to: number) => {
          let m = 0;
          for (let i = end + 1; i <= to; i++) if (q.cmd[i] === STITCH) m = Math.max(m, Math.hypot(q.x[i] - q.x[end], q.y[i] - q.y[end]));
          return m;
        };
        expect(last, 'stitched on: the last point set is the last of the object, its tie-off aside').toBe(a.last - o0.tieOff);
        expect(reach(p, last, a.last), 'stitched on: the tie-off goes along').toBeLessThanOrEqual(reach(before0, o0.last - o0.tieOff, o0.last) + clicks);
        // Turned with the last stitch: a tie-off on the line of the old last stitch is on the line
        // of the new one (as far off it as it was, rounding aside), not sticking out sideways.
        const off = (q: Pattern, end: number, to: number) => {
          const prev = stitchBefore(q, end);
          const [ux, uy] = [q.x[end] - q.x[prev], q.y[end] - q.y[prev]];
          const n = Math.hypot(ux, uy);
          let m = 0;
          if (n) for (let i = end + 1; i <= to; i++) if (q.cmd[i] === STITCH) m = Math.max(m, Math.abs((q.x[i] - q.x[end]) * uy - (q.y[i] - q.y[end]) * ux) / n);
          return m;
        };
        if (stitchBefore(before0, o0.last - o0.tieOff) >= o0.first) expect(off(p, last, a.last), 'stitched on: the tie-off turns with the last stitch').toBeLessThanOrEqual(off(before0, o0.last - o0.tieOff, o0.last) + clicks);
      }
      return true;
    },
  },
  {
    name: 'delete',
    run: (d, r) => {
      if (d.objects.length < 2) return false;
      const o = pick(r, d.objects).index;
      if (process.env.TORTURE_TRACE) console.log('delete', o);
      const before = d.cur.p;
      const next = deleteObjects(before, [o], T);
      // Sewn from the list without it: what stays keeps its stitches (tie-ins aside).
      if (next) {
        const was = new Map(sewObjects(before).map((x) => [x.id, ownStitches(before, x)]));
        const moved = sewObjects(next).filter((x) => was.get(x.id) !== ownStitches(next, x));
        expect(moved.map((x) => `${x.id}: other stitches after delete`).join('; ')).toBe('');
      }
      return shapes(d, next);
    },
  },
  {
    name: 'cut out',
    run: (d, r) => {
      if (d.objects.length < 2) return false;
      const a = pick(r, d.objects).index;
      const b = pick(r, d.objects).index;
      if (a === b) return false;
      const p = d.cur.p;
      const s = subtractTop(p, [a, b], T);
      if (s?.cut.length) checkCut(p, Math.min(a, b), Math.max(a, b), s.pattern, s.cut[0]);
      return shapes(d, s?.pattern);
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
      const before = wholeArea(guessArea(p, o, stitchKinds(p))!)!;
      const s = splitFill(p, o.index, [cut], T);
      if (s === 'whole') return false;
      expect(s, 'a fill cuts apart').toBeTruthy();
      const { pattern, parts } = s!;
      const hadBorder = !!remembered(p, o)?.line;
      if (!hadBorder) expect(sewObjects(pattern).length, 'one object more per part').toBe(d.objects.length + parts.length - 1);
      // Invariant: the parts are one whole and keep the fill's border, one object around them all.
      const pm = parts.map((k) => remembered(pattern, sewObjects(pattern)[k]));
      expect(new Set(pm.map((m) => m?.piece)).size, 'parts are one whole').toBe(1);
      expect(pm[0]?.piece, 'parts are one whole').toBeTruthy();
      expect(pm.every((m) => !!m?.line === hadBorder), 'parts keep the border').toBe(true);
      // Invariant: the parts cover the area as it was, no fabric along the cut.
      const kinds = stitchKinds(pattern);
      const objs = sewObjects(pattern, kinds);
      const areas = parts.map((k) => wholeArea(guessArea(pattern, objs[k], kinds)!)!);
      expect(areas.every(Boolean), 'every part has an area').toBe(true);
      expect(uncovered(before, areas), 'parts cover the fill').toBeLessThan(0.005);
      return shapes(d, syncBorders(pattern, T));
    },
  },
  {
    name: 'satin in sections',
    run: (d, r) => {
      // A fill sewn as satin along what Vorschlagen suggests (R on the fill, Vorschlagen, sewn): each
      // part a column, the area and its cut lines kept with them (see Rails.split).
      const p = d.cur.p;
      const kinds = stitchKinds(p);
      // A fill with a border of its own is left out: what becomes of the border is another question.
      // Nor the second thread of a blend: it follows its fill (the kind switch is off for it).
      const fills = d.objects.filter((o) => remembered(p, o)?.fill && !remembered(p, o)?.line && !remembered(p, o)?.kept?.satin && !remembered(p, o)?.outline && !remembered(p, o)?.blendOf);
      if (!fills.length) return false;
      const o = pick(r, fills);
      const area = wholeArea(guessArea(p, o, kinds)!);
      const s = area && suggestSatin(area);
      if (!area || !s || s.kind === 'wide' || !s.ok) return false;
      const { outsides, holes } = areaLoops(area);
      const made = stripsOfAreas(outsides, s.lines, s.cuts, holes);
      if (made.hole >= 0 || made.bad) return false;
      const columns: Rails[] = made.areas.flatMap((strips, a) => strips.map((c) => ({ ...c, chain: a })));
      if (!columns.length) return false;
      columns[0].split = { outlines: outsides, holes, cuts: s.cuts.map(([a, b]) => [a, b]) };
      const satin = { spacing: 0.4, edge: 0.1, short: true, underlay: true, tolerance: 0.15 };
      const res = restitch(p, sewObjects(p, kinds), [o.index], { kind: 'satin', s: satin }, kinds, T, 'fill', false, new Map([[o.index, columns]]));
      return !res.failed.length && took(d, res);
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
      const fills = d.objects.filter((o) => areaOf(remembered(d.cur.p, o)) && remembered(d.cur.p, o)?.fill);
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
      // As the panel: a blend's second thread has its fill's settings, no border of its own.
      const fills = d.objects.filter((o) => remembered(d.cur.p, o)?.fill && !remembered(d.cur.p, o)?.blendOf && geoUse(remembered(d.cur.p, o)) !== 'band');
      if (!fills.length) return false;
      const o = pick(r, fills);
      const m = remembered(d.cur.p, o)!;
      const old = m.line?.link;
      if (old && r() < 0.4) return restitchFill(d, o.index, m.fill!, new Set([old]), null);
      const id = () => `l${Math.floor(r() * 1e9).toString(36)}`;
      const type = pick(r, ['run', 'satin'] as const);
      // What a line can do, a border can too: echo copies (some in threads of their own), a shadow, a fringe.
      const echo = r() < 0.3 ? { side: pick(r, ['out', 'in', 'both'] as const), count: 1 + Math.floor(r() * 2), gap: 2, ...(r() < 0.5 ? { colors: [pick(r, COLORS)], link: id() } : {}) } : undefined;
      const shadow = r() < 0.25 ? { color: pick(r, COLORS), link: id(), angle: 45, dist: 1.1 } : undefined;
      const fringe = type === 'satin' && r() < 0.3 ? { fringe: 0.6, ...(r() < 0.5 ? { fringeSide: pick(r, ['left', 'right'] as const) } : {}) } : {};
      const border = { type, width: 2, length: 2.5, tolerance: 0.15, color: r() < 0.4 ? undefined : pick(r, COLORS), link: old ?? id(), ...(echo ? { echo } : {}), ...(shadow ? { shadow } : {}), ...fringe };
      return restitchFill(d, o.index, m.fill!, new Set(), border);
    },
  },
  {
    name: 'decorate',
    run: (d, r) => {
      const fills = d.objects.filter((o) => remembered(d.cur.p, o)?.fill && geoUse(remembered(d.cur.p, o)) !== 'band');
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
      // As the pattern tile Leer (and Linie on the kind switch): sewn as a line along its paths, the
      // fill kept; Füllung on the kind switch fills it again as it was.
      const lines = d.objects.filter((o) => remembered(d.cur.p, o)?.kept?.fill && lineGeoOf(remembered(d.cur.p, o)) && !remembered(d.cur.p, o)?.free);
      if (lines.length && r() < 0.4) {
        const o = pick(r, lines);
        return took(d, lineToFill(d.cur.p, o.index, remembered(d.cur.p, o)!.kept!.fill!, T));
      }
      const fills = d.objects.filter((o) => remembered(d.cur.p, o)?.fill && geoUse(remembered(d.cur.p, o)) !== 'band' && !remembered(d.cur.p, o)?.blendOf && !remembered(d.cur.p, o)?.outline);
      if (!fills.length) return false;
      const sel = [...new Set([pick(r, fills).index, pick(r, fills).index])].sort((a, b) => a - b);
      const res = fillsToLines(d.cur.p, sel, T);
      return !!res && took(d, res, res.drop);
    },
  },
  {
    name: 'blend',
    run: (d, r) => {
      const fills = d.objects.filter((o) => remembered(d.cur.p, o)?.fill && geoUse(remembered(d.cur.p, o)) !== 'band');
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
/**
 * The nodes of lines edited, and closed lines filled. Drawn from a stream of their own beside the
 * regular chain (as the tracing image), so the chains of OPS stay as they were for the seeds above.
 */
/**
 * Satins over an area made lines along their edge and satins again (the kind switch). Drawn from a
 * stream of their own, so the chains of the other ops stay as they were for the seeds above.
 */
export const SATIN_OPS: Op[] = [
  {
    name: 'satin there and back',
    run: (d, r) => {
      // A satin over an area made a line (the kind switch, or its last path opened) and a satin
      // again: the same form, the same satin settings; the line it was is kept.
      const lines = d.objects.filter((o) => remembered(d.cur.p, o)?.kept?.satinSettings && fits(lineGeoOf(remembered(d.cur.p, o)), 'fill') && !remembered(d.cur.p, o)?.free);
      if (lines.length && r() < 0.5) {
        const o = pick(r, lines);
        const m = remembered(d.cur.p, o)!;
        const back = lineToSatin(d.cur.p, o.index, T);
        if (!back) return false;
        const n = back.memory[0];
        expect(sortedJson(storeForm(n.geo!)), 'the form, sewn as satin again').toBe(sortedJson(storeForm(m.geo!)));
        expect(sortedJson(n.satin), 'the satin, sewn as satin again').toBe(sortedJson(m.kept!.satinSettings));
        expect(n.kept?.line, 'the line it was, kept').toEqual(m.line);
        return took(d, back);
      }
      const satins = d.objects.filter((o) => {
        const m = remembered(d.cur.p, o);
        return o.kind === 'satin' && !!m && !!areaOf(m) && !m.free && !m.lettering && !partOf(m);
      });
      if (!satins.length) return false;
      const o = pick(r, satins);
      const res = fillToLine(d.cur.p, o.index, T);
      return !!res && shapes(d, syncBorders(res.pattern, T));
    },
  },
];

/**
 * Outlines edited on the level Form, as the app does (one way back for every kind, see
 * reshapeObject): a node of a fill, a satin over an area, a band or a line moved a little.
 */
export const SHAPE_OPS: Op[] = [
  {
    name: 'edit outline',
    run: (d, r) => {
      const p = d.cur.p;
      const kinds = stitchKinds(p);
      const objs = sewObjects(p, kinds);
      const can = objs.filter((o) => {
        const m = remembered(p, o);
        return !!m && !m.free && !m.lettering && !m.outline && !m.blendOf && !partOf(m);
      });
      if (!can.length) return false;
      const o = pick(r, can);
      const geo = guessGeo(p, o, kinds);
      if (!geo?.paths.length) return false;
      const k = Math.floor(r() * geo.paths.length);
      const nodes = geo.paths[k].nodes;
      if (!nodes.length) return false;
      const i = Math.floor(r() * nodes.length);
      const dx = between(r, -1.5, 1.5);
      const dy = between(r, -1.5, 1.5);
      const by = (q: [number, number]): [number, number] => [q[0] + dx, q[1] + dy];
      // Now and then a path opened or closed (the last closed one of a fill opened: it becomes a line, its fill kept).
      const toggle = r() < 0.15 && (geo.paths[k].closed || nodes.length >= 3);
      const next: Form = toggle
        ? { ...geo, paths: geo.paths.map((x, j) => (j !== k ? x : { ...x, closed: !x.closed })) }
        : { ...geo, paths: geo.paths.map((x, j) => (j !== k ? x : { ...x, nodes: x.nodes.map((n, m) => (m !== i ? n : { ...n, p: by(n.p), a: by(n.a), b: by(n.b) })) })) };
      const before = remembered(p, o);
      const res = reshapeObject(p, objs, o, kinds, next, T);
      if (process.env.TORTURE_TRACE) console.log('edit outline', o.index, toggle ? 'toggle' : 'move');
      // As the app: what follows a fill sewn as a line now goes with it.
      const opened = !!res && geoUse(res.memory[0]) === 'line' && !!before?.fill;
      return !!res && took(d, res, opened ? new Set(followerLinks(before)) : undefined);
    },
  },
  {
    // A vein in a leaf: an open path inside a fill, which the fill leaves unfilled and its border runs along.
    name: 'add open path',
    run: (d, r) => {
      const p = d.cur.p;
      const kinds = stitchKinds(p);
      const objs = sewObjects(p, kinds);
      const can = objs.filter((o) => {
        const m = remembered(p, o);
        return !!areaOf(m) && !!m!.fill && !m!.piece && !m!.free;
      });
      if (!can.length) return false;
      const o = pick(r, can);
      const geo = areaOf(remembered(p, o))!;
      const b = boundsOf(geo);
      if (!b) return false;
      const at = (u: number, v: number): [number, number] => [b.minX + (b.maxX - b.minX) * u, b.minY + (b.maxY - b.minY) * v];
      const a = at(between(r, 0.3, 0.45), between(r, 0.3, 0.7));
      const z = at(between(r, 0.55, 0.7), between(r, 0.3, 0.7));
      const vein = { closed: false, nodes: [a, z].map((q) => ({ p: q, a: q, b: q, smooth: false })) };
      const res = reshapeObject(p, objs, o, kinds, { ...geo, paths: [...geo.paths, vein] }, T);
      return !!res && took(d, res);
    },
  },
];

export const LINE_OPS: Op[] = [
  {
    name: 'edit line',
    run: (d, r) => {
      // As the level Form: a node put in on a curve or added beyond an end, or the line closed or opened.
      const lines = d.objects.filter((o) => lineGeoOf(remembered(d.cur.p, o)) && remembered(d.cur.p, o)?.line && !remembered(d.cur.p, o)?.free && !partOf(remembered(d.cur.p, o)));
      if (!lines.length) return false;
      const o = pick(r, lines);
      const m = remembered(d.cur.p, o)!;
      const form = m.geo!;
      const k = Math.floor(r() * form.paths.length);
      const path = form.paths[k];
      const how = pick(r, ['insert', 'extend', 'toggle'] as const);
      let next: Form;
      if (how === 'insert' && segments(path)) next = insertNode(form, k, Math.floor(r() * segments(path)), between(r, 0.1, 0.9)).form;
      else if (how === 'extend' && !path.closed) next = extendPath(form, k, pick(r, [0, 1] as const), [between(r, 0, 60), between(r, 0, 60)]).form;
      else if (how === 'toggle' && (path.closed || path.nodes.length >= 3)) next = { ...form, paths: form.paths.map((x, j) => (j === k ? { ...x, closed: !x.closed } : x)) };
      else return false;
      const sewn = resewLine(d.cur.p, o.index, next, m.line!, T);
      return !!sewn && shapes(d, syncBorders(sewn.pattern, T));
    },
  },
  {
    name: 'fill closed line',
    run: (d, r) => {
      // As the kind switch on a closed line: Füllung fills it inside, the line its border (as it
      // was when it was a fill).
      const lines = d.objects.filter((o) => remembered(d.cur.p, o)?.line && !remembered(d.cur.p, o)?.free && !partOf(remembered(d.cur.p, o)) && fits(lineGeoOf(remembered(d.cur.p, o)), 'fill'));
      if (!lines.length) return false;
      const o = pick(r, lines);
      const s = digitizeDefaults(DEFAULT_PROFILE);
      const fill: FillSettings = { pattern: 'tatami', spacing: s.spacing, spacingEnd: 1, offset: 0.25, angle: NaN, stitch: s.stitch, underlay: s.underlay, edge: 0, tolerance: s.tolerance };
      const res = lineToFill(d.cur.p, o.index, fill, T);
      return !!res && took(d, res);
    },
  },
  {
    name: 'switch there and back',
    run: (d, r) => {
      // A fill made a line and filled again (the kind switch twice): the same form, the same fill.
      const fills = d.objects.filter((o) => {
        const m = remembered(d.cur.p, o);
        return !!m?.fill && !!areaOf(m) && !m.free && !m.outline && !m.blendOf && !m.piece && !m.knockout;
      });
      if (!fills.length) return false;
      const o = pick(r, fills);
      const m = remembered(d.cur.p, o)!;
      const line = fillsToLines(d.cur.p, [o.index], T);
      if (!line) return false;
      const back = lineToFill(line.pattern, o.index, m.fill!, T);
      if (!back?.starts.length) return false;
      const n = back.memory[0];
      // The fill and the border beside it, without the border's thread and link (sewn as a line between).
      const plain = (x: Remembered) => {
        const border = x.line && structuredClone(x.line);
        if (border) {
          delete border.color;
          delete border.link;
          // A fringe's side is the drawn line's or the border's (inside, outside): it goes on the way.
          delete border.fringeSide;
        }
        return sortedJson({ fill: x.fill, ...(border ? { border } : {}) });
      };
      expect(sortedJson(storeForm(n.geo!)), 'the form, switched there and back').toBe(sortedJson(storeForm(m.geo!)));
      expect(plain(n), 'the fill and its border, switched there and back').toBe(plain(m));
      return took(d, back, line.drop);
    },
  },
  {
    name: 'line again',
    run: (d, r) => {
      // As the kind switch on a fill with a form: Linie sews along its paths, its fill kept.
      const fills = d.objects.filter((o) => {
        const m = remembered(d.cur.p, o);
        return !!m?.fill && !!geoOf(m) && !m.free && !m.outline && !m.blendOf && !m.piece && !m.fill.deco?.blend;
      });
      if (!fills.length) return false;
      const o = pick(r, fills);
      const old = remembered(d.cur.p, o)!.line?.link;
      const res = fillToLine(d.cur.p, o.index, T);
      // As the app: a border in a thread of its own goes with the fill.
      return !!res && shapes(d, syncBorders(res.pattern, T, old ? new Set([old]) : undefined));
    },
  },
];

export function checkWellFormed(p: Pattern): void {
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
export function checkAllKnown(p: Pattern): void {
  const unknown = sewObjects(p).filter((o) => !remembered(p, o)).map((o) => `${o.index} (${o.kind})`);
  expect(unknown, 'objects that forgot what they are').toEqual([]);
}

/**
 * The parts an object was sewn in fit its stitches (they end at its last stitch), so the next edit
 * takes them as they are instead of telling parts apart again by how the stitches look.
 */
export function checkPartsFit(p: Pattern): void {
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
export function checkBorders(p: Pattern): void {
  const objs = sewObjects(p);
  const mem = objs.map((o) => remembered(p, o));
  const problems: string[] = [];
  const fills = new Map<string, number>();
  mem.forEach((m, k) => {
    const b = m?.line;
    if (!b?.link) return;
    const f = fills.get(b.link);
    if (f !== undefined && (!m!.piece || mem[f]!.piece !== m!.piece)) problems.push(`fills ${f} and ${k} share border link ${b.link}`);
    if (f === undefined) fills.set(b.link, k);
  });
  const pieces = new Map<string, number>();
  mem.forEach((m, k) => {
    if (!m?.piece || !m.region || !m.fill) return;
    const f = pieces.get(m.piece);
    if (f === undefined) return void pieces.set(m.piece, k);
    if (JSON.stringify(mem[f]!.line) !== JSON.stringify(m.line)) problems.push(`parts ${f} and ${k} of one whole have other borders`);
  });
  const borders = new Map<string, number>();
  mem.forEach((m, k) => {
    if (!m?.outline) return;
    if (borders.has(m.outline)) problems.push(`objects ${borders.get(m.outline)} and ${k} are the border ${m.outline}`);
    borders.set(m.outline, k);
    const f = fills.get(m.outline);
    if (f === undefined) problems.push(`border ${k} has no fill`);
    else if (!sameColor(objs[k].color, mem[f]!.line!.color ?? objs[f].color)) problems.push(`border ${k} not in its thread`);
  });
  // Unless nothing of its edge shows (all of it under shapes on top).
  // (A part cut apart on its own, e.g. a copy of one, counts as a whole: its border can vanish too, set inward of a small part.)
  const alone = (m: NonNullable<(typeof mem)[number]>) => !m.piece || mem.filter((x) => x?.piece === m.piece && x?.fill).length === 1;
  const hidden = (m: NonNullable<(typeof mem)[number]>) => alone(m) && !!m.region && borderStitches(m.region, m.line!, [0, 0], wholeOf(m.region, m)).length === 0;
  for (const [link, k] of fills) if (!borders.has(link) && !hidden(mem[k]!)) problems.push(`fill ${k} lost its border`);
  // A fill's open paths (a vein in a leaf): its border runs along them, where nothing lies on top.
  for (const [link, k] of fills) {
    const m = mem[k]!;
    const open = alone(m) ? openOf(m) : null;
    const at = borders.get(link);
    if (!open || at === undefined || mem[at]?.read) continue;
    if (mem[at]!.along !== formKey(open)) problems.push(`border ${at} not sewn along the open paths of fill ${k}`);
    if (m.knockout) continue;
    const sewn: [number, number][] = [];
    for (let i = objs[at].first; i <= objs[at].last; i++) if (p.cmd[i] === STITCH) sewn.push([p.x[i] / 10, p.y[i] / 10]);
    for (const path of open.paths) {
      const far = flatten(path).filter((_, j) => j % 10 === 5).some((q) => !sewn.some((s) => Math.hypot(s[0] - q[0], s[1] - q[1]) < 1.5 + (m.line!.width ?? 0)));
      if (far) problems.push(`border ${at} misses an open path of fill ${k}`);
    }
  }
  expect(problems.join('; '), 'border links').toBe('');
}

/** JSON with the keys of every object in order (typed arrays as lists), to compare what objects remember. */
const sortedJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (ArrayBuffer.isView(x) ? Array.from(x as Uint8Array) : x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/**
 * One form per object (vector model rule 1): never two of its places used at once, and taking its
 * form and putting it back changes nothing.
 */
export function checkOneGeo(p: Pattern): void {
  const problems: string[] = [];
  for (const o of sewObjects(p)) {
    const m = remembered(p, o);
    if (!m) continue;
    // One stitch type on it, and keeps no settings of what it is. A line beside a fill is its
    // border (the only place a border is): its thread and link are a border's only.
    if (m.fill && 'border' in m.fill) problems.push(`${o.index}: a border in the fill's settings`);
    if (!m.fill && m.line && (m.line.color || m.line.link || m.line.seams)) problems.push(`${o.index}: a line with a border's thread or link`);
    if (m.fill && m.satin) problems.push(`${o.index}: a fill that is also a satin`);
    if (m.satin && m.line) problems.push(`${o.index}: a satin that is also a line`);
    if (m.kept?.fill && m.fill) problems.push(`${o.index}: keeps the fill it is`);
    if (m.kept?.satinSettings && m.satin) problems.push(`${o.index}: keeps the satin it is`);
    // A satin kept to sew it again over its area is kept by a line along that area's edge.
    if (m.kept?.satinSettings && geoUse(m) !== 'line') problems.push(`${o.index}: keeps a satin and is not a line`);
    if (m.kept?.line && geoUse(m) === 'line') problems.push(`${o.index}: keeps the line it is`);
    if (m.kept && !geoOf(m)) problems.push(`${o.index}: keeps stitch types without a form`);
    // Known and guessed apart (rule 6): a form only read from the stitches is never kept as curves.
    if (m.read && m.geo) problems.push(`${o.index}: a form read from its stitches kept as known`);
    const geo = geoOf(m);
    if (geo && sortedJson(withGeo(m, geo)) !== sortedJson(m)) problems.push(`${o.index}: its form put back changes it`);
  }
  expect(problems.join('; '), 'one form').toBe('');
}

/** Its stitch type fits its form (see fits): a fill has a closed path that encloses an area, a line a path. */
export function checkFits(p: Pattern): void {
  const problems: string[] = [];
  for (const o of sewObjects(p)) {
    const m = remembered(p, o);
    const geo = geoOf(m);
    if (!m || !geo || m.free) continue;
    const use = geoUse(m);
    if (use === 'area' && m.fill && !fits(geo, 'fill')) problems.push(`${o.index}: a fill of a form with no closed area`);
    if (use === 'area' && m.satin && !fits(geo, 'fill')) problems.push(`${o.index}: a satin over a form with no closed area`);
    if ((use === 'line' || use === 'band') && !fits(geo, 'line')) problems.push(`${o.index}: a line without a path`);
  }
  expect(problems.join('; '), 'stitch type fits its form').toBe('');
}

/** No fill is empty: a fill without stitches inside is a line along its paths (its fill kept). */
export function checkEmptyFills(p: Pattern): void {
  const problems: string[] = [];
  for (const o of sewObjects(p)) {
    const m = remembered(p, o);
    if ((m?.fill?.pattern as string) === 'none' || (m?.kept?.fill?.pattern as string) === 'none') problems.push(`${o.index}: an empty fill`);
  }
  expect(problems.join('; '), 'empty fills').toBe('');
}

/** Each blending fill has one second thread in its blend thread, and every second thread its fill. */
export function checkBlends(p: Pattern): void {
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
 * A line's stitches are what its curve and settings (with its echo, sewn more than once) sew: every stitch lies on the
 * lines sewn anew from them, and every one of those lines has stitches, so an echo that moved,
 * turned, mirrored, scaled, was undone or saved never parts from what the line remembers.
 */
export function checkEchoes(p: Pattern): void {
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
    // Loosed from its curve (changed by hand), a line keeps the stitches it was given instead; so
    // does a shadow or echo object changed by hand (it is sewn anew only when its line changes).
    if (!lineGeoOf(m) || !m!.line || m!.free || (partOf(m) && m!.hand) || (!m!.line.echo && !((m!.line.repeat ?? 1) > 1))) continue;
    const fresh = lineStitches(m!.geo!, m!.line).flat();
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
export function checkLineParts(p: Pattern): void {
  const objs = sewObjects(p);
  const mem = objs.map((o) => remembered(p, o));
  const problems: string[] = [];
  const want = new Map<string, { line: number; part: LinePart }>();
  // A line's parts, and those of a fill's border (a border can do what a line can).
  const { holds, partsOf } = partHolders(mem);
  mem.forEach((_, k) => {
    if (!holds(k)) return;
    for (const part of partsOf(k)) {
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
    if (JSON.stringify(storeForm(m!.geo!)) !== JSON.stringify(storeForm(w.part.memory.geo!)) || JSON.stringify(m!.line) !== JSON.stringify(w.part.memory.line)) problems.push(`part ${k} not what its line says`);
  });
  // A copy with nothing to sew (no room for it beside the line) has no object.
  const sews = (w: { part: LinePart }) => lineStitches(w.part.memory.geo!, w.part.memory.line!).some((run) => run.length > 1);
  for (const [link, w] of want) if (!have.has(link) && sews(w)) problems.push(`line ${w.line} lost its part ${link}`);
  expect(problems.join('; '), 'line parts').toBe('');
}

/**
 * The object list of the version: every stitch in exactly one object, the objects in sewing order
 * without overlap, each with an id of its own, and what an object knows carries its id.
 */
export function checkObjectList(p: Pattern): void {
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
export function checkKeys(p: Pattern): void {
  const seen = new Map<string, number>();
  const problems: string[] = [];
  for (const o of sewObjects(p)) {
    const k = objectKey(p, o);
    if (seen.has(k)) problems.push(`objects ${seen.get(k)} and ${o.index} share key ${k}`);
    seen.set(k, o.index);
  }
  expect(problems.join('; '), 'objects sharing what they remember').toBe('');
}

/**
 * The rail points of a satin part shown in sections of its area (see Rails.split) that lie neither
 * on the area's edge nor on one of its cut lines: a part is its area cut along its cut lines, so
 * nothing else may run between its columns (a seam left after the cut lines went, say). A part
 * whose area no longer runs along its columns (cut away since) is read anew and not counted.
 */
export function strayRails(part: Rails[]): number {
  const sp = part.find((c) => c.split)?.split;
  if (!sp || !edgeAlong([...sp.outlines, ...sp.holes], part)) return 0;
  const segs: [number, number, number, number][] = [];
  for (const ring of [...sp.outlines, ...sp.holes]) ring.forEach((a, i) => segs.push([...a, ...ring[(i + 1) % ring.length]] as [number, number, number, number]));
  for (const [a, b] of sp.cuts) segs.push([a[0], a[1], b[0], b[1]]);
  const off = (x: number, y: number) =>
    segs.every(([ax, ay, bx, by]) => {
      const dx = bx - ax;
      const dy = by - ay;
      const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
      return Math.hypot(x - ax - t * dx, y - ay - t * dy) > 0.05;
    });
  return part.reduce((n, c) => n + [...c.left, ...c.right].filter(([x, y]) => off(x, y)).length, 0);
}

/** Every satin shown in sections of its area is that area cut along its cut lines (see strayRails). */
export function checkSatinSections(p: Pattern): void {
  const problems: string[] = [];
  for (const o of sewObjects(p)) {
    remembered(p, o)?.columns?.forEach((part, j) => {
      const n = strayRails(part);
      if (n) problems.push(`object ${o.index} part ${j}: ${n} rail points neither on its edge nor on a cut line`);
    });
  }
  expect(problems.join('; '), 'satin sections').toBe('');
}

/** What leaves out the shapes on top fits the shapes on top now. */
export function checkKnockouts(p: Pattern): void {
  expect(refreshKnockouts(p, T)?.changed ?? [], 'fills whose left-out parts are out of date').toEqual([]);
}

/**
 * The area a fill is sewn on comes from its form (masks from the form): its form rastered and grown
 * by the pull compensation it was made with, without what lies on top where it leaves that out.
 * Leaving out, reshaping, turning, duplicating and undo never lose the pull compensation.
 */
export function checkAreas(p: Pattern): void {
  const objs = sewObjects(p);
  const problems: string[] = [];
  for (const o of objs) {
    const m = remembered(p, o);
    if (!m?.region || !m.fill || m.free || m.hand || m.read || m.lettering || geoUse(m) !== 'area') continue;
    let want = m.knockout ? sewnArea(p, objs, o, m.geo!, true, m.region.pxMm) : fillArea(m, m.region.pxMm);
    // Leaving out with nothing sewable left: sewn whole, `cut` naming the rest it could not be sewn on.
    if (m.knockout && !sameRegion(want, m.region) && m.cut === cutKey(want) && !reshapeFill(p, objs, o, stitchKinds(p), m.geo!, T, true)?.starts.length) want = fillArea(m, m.region.pxMm);
    if (!sameRegion(want, m.region)) problems.push(`${o.index}: area ${m.region.areaMm2.toFixed(1)} mm² is not its form's ${want?.areaMm2.toFixed(1)} mm² (grow ${m.fill.areaGrow ?? 0}${m.knockout ? ', left out' : ''})`);
  }
  expect(problems, 'areas not from their form').toEqual([]);
}

/**
 * A border and a blend's second thread in a thread of their own have no area of their own: theirs
 * is the area of their fill (of all its parts together) after every step, not only after the next
 * change to some fill.
 */
export function checkFollowers(p: Pattern): void {
  const objs = sewObjects(p);
  const mem = objs.map((o) => remembered(p, o));
  const problems: string[] = [];
  mem.forEach((m, k) => {
    const link = m?.outline ?? m?.blendOf;
    if (!m?.region || !link) return;
    const leaders = mem.filter((x) => !!x?.region && !x.outline && !x.blendOf && (m.outline ? !!x.fill && x.line?.link === link : x.fill?.deco?.blend?.link === link));
    if (!leaders.length) return;
    const rs = leaders.map((x) => x!.region!);
    const area = rs.length === 1 ? rs[0] : unionOf(rs.filter((r) => r.pxMm === rs[0].pxMm));
    if (!sameRegion(area, m.region)) problems.push(`${m.outline ? 'border' : 'blend'} ${k}: not on the area of its fill`);
  });
  expect(problems, 'followers off their leader').toEqual([]);
}

/** Exported and read back, the stitches are the same. */
export function checkExport(p: Pattern): void {
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
export function checkSewDesign(p: Pattern): void {
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

export function describeObjects(p: Pattern): string {
  return sewObjects(p)
    .map((o) => {
      const m = remembered(p, o);
      const what = !m ? 'UNKNOWN' : [m.geo && `geo:${geoUse(m)}`, m.fill && 'fill', m.line && 'line', m.kept && `kept:${Object.keys(m.kept).join('+')}`, m.knockout && 'knockout', m.line?.link && `border->${m.line.link}`, m.outline && `outline=${m.outline}`, m.blendOf && `blendOf=${m.blendOf}`, m.fill?.deco?.blend && `blend->${m.fill.deco.blend.link}`].filter(Boolean).join(' ');
      return `\n  ${o.index} ${objectKey(p, o)} ${o.kind} block ${o.block} rgb(${o.color.r},${o.color.g},${o.color.b}) ${what}`;
    })
    .join('');
}

/**
 * A chain of random ops on one design, checked after each. `trace`: the tracing image is laid,
 * moved, sized and removed in between, from a random stream of its own (the ops of a seed stay the
 * ones it always had).
 */
export async function chain(seed: number, steps = STEPS, opts: { trace?: boolean } = {}): Promise<void> {
  const r = rng(seed);
  const rt = rng(seed + 7919);
  const rl = rng(seed + 104729);
  const rs = rng(seed + 15485863);
  const rsat = rng(seed + 32452843);
  const d = new Doc();
  const log: string[] = [];
  const at = () => `seed ${seed}: ${log.join(' > ')}`;
  for (let step = 0; step < steps; step++) {
    const op = blank(d.cur.p) ? OPS[0] : pick(r, OPS);
    let done: boolean;
    if (opts.trace && rt() < 0.4) {
      const top = pick(rt, TRACE_OPS);
      if (await top.run(d, rt)) {
        log.push(top.name);
        try {
          checkTrace(d);
        } catch (e) {
          throw new Error(`${at()}\n${(e as Error).message}`);
        }
      }
    }
    // Now and then a line edited or filled, beside the chain.
    if (!blank(d.cur.p) && rl() < 0.3) {
      const lop = pick(rl, LINE_OPS);
      if (await lop.run(d, rl)) {
        log.push(lop.name);
        if (process.env.TORTURE_TRACE) console.log(lop.name, describeObjects(d.cur.p));
        try {
          checkStep(d, false);
        } catch (e) {
          throw new Error(`${at()}\n${(e as Error).message}`);
        }
      }
    }
    // Now and then a satin over an area made a line, or a satin again, beside the chain.
    if (!blank(d.cur.p) && rsat() < 0.15) {
      const sat = pick(rsat, SATIN_OPS);
      if (await sat.run(d, rsat)) {
        log.push(sat.name);
        if (process.env.TORTURE_TRACE) console.log(sat.name, describeObjects(d.cur.p));
        try {
          checkStep(d, false);
        } catch (e) {
          throw new Error(`${at()}\n${(e as Error).message}`);
        }
      }
    }
    // Now and then an outline edited on the level Form, beside the chain.
    if (!blank(d.cur.p) && rs() < 0.25) {
      const sop = pick(rs, SHAPE_OPS);
      if (await sop.run(d, rs)) {
        log.push(sop.name);
        if (process.env.TORTURE_TRACE) console.log(sop.name, describeObjects(d.cur.p));
        try {
          checkStep(d, false);
        } catch (e) {
          throw new Error(`${at()}\n${(e as Error).message}`);
        }
      }
    }
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
      checkStep(d, op.name === 'save and open' || step === steps - 1);
    } catch (e) {
      throw new Error(`${at()}\n${(e as Error).message}`);
    }
  }
}


/** All the invariants, after a step; `full`: also the export and sewing the design. */
function checkStep(d: Doc, full: boolean): void {
  const p = d.cur.p;
  checkWellFormed(p);
  expect(knowledge(p), 'knowledge as stored with this version').toEqual(d.cur.known);
  checkAllKnown(p);
  checkKeys(p);
  checkObjectList(p);
  checkPartsFit(p);
  checkBorders(p);
  checkEmptyFills(p);
  checkOneGeo(p);
  checkFits(p);
  checkBlends(p);
  checkEchoes(p);
  checkLineParts(p);
  checkKnockouts(p);
  checkAreas(p);
  checkFollowers(p);
  checkSatinSections(p);
  checkTrace(d);
  if (full) {
    checkExport(p);
    checkSewDesign(p);
  }
}

/** A square with a running border in a thread of its own, made as the app makes it. */
export function borderedSquare(): Doc {
  const d = new Doc();
  shapes(d, addShape(empty, { form: parsePath(rectPath(0, 0, 20, 20, 0, 0), ID), kind: 'fill' }, COLORS[0], null, options)!.pattern);
  shapes(d, addShape(d.cur.p, { form: parsePath(ellipsePath(40, 10, 6, 6), ID), kind: 'fill' }, COLORS[0], 0, options)!.pattern);
  const fill = remembered(d.cur.p, d.objects[0])!.fill!;
  restitchFill(d, 0, fill, new Set(), { type: 'run', width: 2, length: 2.5, tolerance: 0.15, color: COLORS[1], link: 'sq' });
  return d;
}

export const borderOf = (d: Doc) => d.objects.findIndex((o) => remembered(d.cur.p, o)?.outline === 'sq');
export const squareOf = (d: Doc) => d.objects.find((o) => remembered(d.cur.p, o)?.line?.link === 'sq');
