import type { ObjectPanel } from '../ui/objectPanel';
import type { FileList } from '../ui/fileList';
import type { Form } from '../shape/path';
import type { LayersPanel } from '../ui/layersPanel';
import type { Measurement } from '../validation/measure';
import type { PathStitch } from '../model/along';
import { isReadFromFile, type Pattern } from '../model/pattern';
import type { RungTool } from '../ui/rungTool';
import type { Sequence } from './types';
import type { Settings } from '../settings';
import type { ShapeOutline } from '../render/scene';
import { hasPart, partOf, withoutPart } from '../model/shadow';
import { SATIN_SHARE } from '../model/covers';
import { currentSettings } from '../correct/plan';
import { isCovered, setOverlapShare } from '../model/knockout';
import { isStroke, SATIN_MAX, pullFor, digitizeDefaults } from '../digitize/digitize';
import { lineOf, lineSettings, lineToFill } from '../model/line';
import { outline } from '../digitize/region';
import { recommendedSpacing } from '../validation/profiles';
import { recordOfStitch } from '../model/sequence';
import { rememberObjects, type SewObject } from '../model/objects';
import { loosable } from '../model/handEdit';
import { backToOriginal, originalOf } from '../model/original';
import { newLink, shareBorders, syncBorders } from '../model/border';
import { readBorder } from '../model/readBorder';
import { t, type Key } from '../i18n';
import { type ShapeTrust, analyze, remembered, measureFill, measureSatin, measureRun, shapeTrust, type Remembered, remember, rememberedIn, restitch, type Settings as RestitchSettings, type RestitchResult, objectKey } from '../model/restitch';
import { type StitchInfo, StitchPanel } from '../ui/stitchPanel';
import { ui } from './state';

/** What bindStitches needs from the rest of the app. */
export interface StitchesApp {
  readonly objectPanel: ObjectPanel;
  readonly applyEdit: (p: Pattern, measurement?: Measurement | undefined) => void;
  readonly closeRungs: () => void;
  readonly files: FileList;
  readonly isLineObject: (p: Pattern, o: SewObject) => boolean;
  readonly knockoutObjects: (which: number[], on: boolean) => void;
  readonly layers: LayersPanel;
  readonly redraw: () => void;
  readonly rungTool: RungTool;
  readonly selectObjects: (objs: number[], toggle: boolean) => void;
  readonly seq: (p: Pattern) => Sequence;
  readonly seqCache: WeakMap<Pattern, Sequence>;
  readonly settings: Settings;
  readonly sewAlongLines: () => void;
  readonly suggestLines: () => void;
  readonly sewLine: (o: number, path: Form | null, st: PathStitch | null, final: boolean) => boolean;
  readonly sewLineAgain: (o: number) => void;
  /** Stichart Satin on one fill as R and Vorschlagen do it; false when the shape is not lines (see bindRungs). */
  readonly convertToSatin: (o: number) => boolean;
  readonly toggleGuides: () => void;
  readonly togglePoints: () => void;
  readonly toggleRungs: () => void;
  readonly takeShapes: (next: Pattern, select: number[]) => void;
}

/** The stitch panel of the selected objects: what it shows, sewing them anew with new settings, and loose objects. */
export function bindStitches(app: StitchesApp) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  function stitchInfo(p: Pattern, q: Sequence): StitchInfo {
    if (ui.stitchCache?.p === p && ui.stitchCache.key === ui.selectionKey) return ui.stitchCache.info;
    const measured: StitchInfo['measured'] = {};
    const counts: StitchInfo['counts'] = {};
    const shapes: ShapeOutline[] = [];
    let worst: ShapeTrust | undefined;
    const rank: Record<ShapeTrust, number> = { kept: 0, good: 1, approximate: 2 };
    let stroke = true;
    let depth: number | undefined;
    for (const o of [...ui.selectedObjects].sort((a, b) => a - b)) {
      const obj = q.objects[o];
      if (!obj) continue;
      const seen = new Set<string>();
      const an = analyze(p, obj, q.kinds);
      for (const [j, pt] of an.parts.entries()) {
        // A run between two fill pieces is travel inside the fill, not a run of its own.
        if (pt.kind === 'run' && an.parts[j - 1]?.kind === 'fill' && an.parts[j + 1]?.kind === 'fill' && !an.parts[j + 1].border) continue;
        if (!seen.has(pt.kind)) counts[pt.kind] = (counts[pt.kind] ?? 0) + 1;
        seen.add(pt.kind);
        if (pt.kind === 'fill') measured.fill ??= remembered(p, obj)?.fill ?? measureFill(p, an);
        else if (pt.kind === 'satin') measured.satin ??= remembered(p, obj)?.satin ?? measureSatin(p, pt, q.kinds);
        else measured.run ??= measureRun(p, pt);
      }
      if (an.fill) {
        const trust = shapeTrust(p, obj, an, (remembered(p, obj)?.fill ?? measureFill(p, an)).spacing);
        if (!worst || rank[trust] > rank[worst]) worst = trust;
        shapes.push({ lines: outline(an.fill), approximate: trust === 'approximate', resting: !!remembered(p, obj)?.free });
        let deep = 0;
        for (const v of an.fill.sdf) if (-v > deep) deep = -v;
        depth = Math.min(depth ?? Infinity, deep);
        // Satin needs a stroke: narrow, about even in width (the same test as in Image mode).
        if (stroke && an.parts.some((pt) => pt.kind === 'fill')) stroke = !!isStroke(remembered(p, obj)?.shape ?? an.fill, SATIN_MAX);
      }
    }
    const hand = [...ui.selectedObjects].reduce((a, o) => a + (q.objects[o] ? (remembered(p, q.objects[o])?.hand ?? 0) : 0), 0);
    const firstFill = [...ui.selectedObjects].sort((a, b) => a - b).find((o) => q.objects[o]?.kind === 'fill') ?? [...ui.selectedObjects][0];
    // Fills with curves can leave out what lies on top.
    const shaped = [...ui.selectedObjects].map((o) => q.objects[o]).filter((obj) => obj && remembered(p, obj)?.form);
    const ons = new Set(shaped.map((obj) => !!remembered(p, obj)?.knockout));
    const knockout: StitchInfo['knockout'] = shaped.length
      ? { on: ons.size > 1 ? 'mixed' : ons.has(true), covered: shaped.some((obj) => isCovered(p, q.objects, obj)), share: remembered(p, shaped[0])?.overlapShare ?? SATIN_SHARE }
      : undefined;
    const locks = new Set([...ui.selectedObjects].map((o) => !!(q.objects[o] && remembered(p, q.objects[o])?.lock)));
    const lock = locks.size > 1 ? 'mixed' : locks.has(true);
    const free = freeOf(p, q);
    const fixed = ui.selectedObjects.size === 1 && q.objects[[...ui.selectedObjects][0]] ? remembered(p, q.objects[[...ui.selectedObjects][0]])?.fixed : undefined;
    const firstOf = (k: string) => [...ui.selectedObjects].sort((a, b) => a - b).map((o) => q.objects[o]).find((obj) => obj?.kind === k);
    const fillObj = firstOf('fill');
    // A fill from a file with a line sewn along its edge: that is its border (see syncBorders).
    if (fillObj && ui.selectedObjects.size === 1 && measured.fill && !measured.fill.border && !remembered(p, fillObj)?.fill) {
      const found = readBorder(p, q.objects, fillObj, q.kinds);
      if (found) measured.fill = { ...measured.fill, border: { ...found.border, link: newLink() } };
    }
    const fabricPull = {
      fill: fillObj ? pullFor(app.settings.profile, 'fill', analyze(p, fillObj, q.kinds).fill?.areaMm2).edge : undefined,
      satin: pullFor(app.settings.profile, 'satin'),
    };
    const defaults = digitizeDefaults(app.settings.profile);
    const auto = { fillSpacing: defaults.spacing, satinSpacing: defaults.satinSpacing, stitch: defaults.stitch };
    // A part of a fill cut apart: its border goes around all parts.
    const piece = fillObj && remembered(p, fillObj)?.piece;
    const pieces = piece ? q.objects.filter((obj) => obj.kind === 'fill' && remembered(p, obj)?.piece === piece).length : 0;
    const info: StitchInfo = { key: ui.selectionKey, lock, free, fixed, fabricPull, auto, hand, measured, counts, recommended: recommendedSpacing(app.settings.profile), shape: worst, outlines: shapes, toSatin: stroke, knockout, depth, color: q.objects[firstFill]?.color, area: (fillObj && remembered(p, fillObj)?.region) || undefined, ...(pieces > 1 ? { pieces } : {}) };
    const runs = [...ui.selectedObjects].map((o) => q.objects[o]).filter((obj) => obj?.kind === 'run');
    if (runs.length && runs.every((obj) => remembered(p, obj)?.path)) info.line = true;
    const one = ui.selectedObjects.size === 1 ? q.objects[[...ui.selectedObjects][0]] : undefined;
    if (one && app.isLineObject(p, one)) {
      const form = lineOf(p, one, q.kinds);
      info.path = { st: lineSettings(p, one, q.kinds), traced: !remembered(p, one)?.path, closed: !!form?.paths.length && form.paths.every((x) => x.closed), color: one.color };
    }
    if (one && remembered(p, one)?.asLine) info.asLine = true;
    const orig = app.files.active?.pattern === p ? app.files.active.original : undefined;
    if (orig && orig !== p && isReadFromFile(orig)) {
      const was = app.seq(orig).objects;
      if ([...ui.selectedObjects].some((o) => q.objects[o] && originalOf(p, orig, q.objects[o], q.objects, was))) info.original = true;
    }
    const own = ui.selectedObjects.size === 1 && q.objects[firstFill] ? remembered(p, q.objects[firstFill]) : undefined;
    if (own?.outline || own?.blendOf) {
      const fill = q.objects.findIndex((o) => partnerOf(remembered(p, o), own));
      info.outline = { fill: fill >= 0 ? fill : null, blend: !own.outline };
      // A border's settings are its fill's: shown and set here as they are there.
      const fm = fill >= 0 ? remembered(p, q.objects[fill]) : undefined;
      if (own.outline && fm?.fill?.border && !fm.free) {
        info.outline.of = { fill: structuredClone(fm.fill), color: q.objects[fill].color };
        info.color = q.objects[fill].color;
      }
    }
    // A line's shadow: set at its line.
    const shade = one && remembered(p, one);
    if (partOf(shade)) {
      const line = q.objects.findIndex((o) => partnerOf(remembered(p, o), shade!));
      info.outline = { fill: line >= 0 ? line : null, shadow: shade!.shadowOf ? true : undefined, echo: shade!.echoOf ? true : undefined };
      const lo = line >= 0 ? q.objects[line] : undefined;
      const lm = lo && remembered(p, lo);
      if (lo && lm?.path && lm.line && !lm.free) {
        const form = lineOf(p, lo, q.kinds);
        info.outline.of = { line: lineSettings(p, lo, q.kinds), closed: !!form?.paths.length && form.paths.every((x) => x.closed), color: lo.color };
      }
    }
    ui.stitchCache = { p, key: ui.selectionKey, info };
    return info;
  }

  /** Whether `fill` is the fill the border or second blend thread `own` belongs to. */
  const partnerOf = (fill: Remembered | undefined, own: Remembered): boolean =>
    own.outline
      ? fill?.fill?.border?.link === own.outline
      : own.blendOf
        ? fill?.fill?.deco?.blend?.link === own.blendOf
        : !!partOf(own) && hasPart(fill, partOf(own)!);

  /**
   * The selected objects loosed from their shape (`on`), or sewn from their resting shape again with
   * their own settings. The stitches loosed stay loosed for undo.
   */
  function looseObjects(on: boolean): void {
    const f = app.files.active;
    const p = f?.pattern;
    if (!f || !p) return;
    const q = app.seq(p);
    const objs = [...ui.selectedObjects].sort((a, b) => a - b).flatMap((o) => (q.objects[o] ? [q.objects[o]] : []));
    if (on) {
      let n = 0;
      for (const obj of objs) {
        const mem = remembered(p, obj);
        if (!mem || mem.free || !loosable(mem)) continue;
        remember(p, obj, { ...mem, free: true });
        n++;
      }
      if (!n) return;
      app.closeRungs();
      app.files.setObjects(f, rememberedIn(p, q.objects));
      ui.selectionKey++;
      ui.stitchCache = null;
      app.layers.say(t('free.done', { n }));
      return app.redraw();
    }
    const freed = objs.flatMap((obj) => {
      const mem = remembered(p, obj);
      return mem?.free ? [{ obj, mem }] : [];
    });
    if (!freed.length) return;
    for (const { obj, mem } of freed) remember(p, obj, { ...mem, free: undefined });
    const r = restitch(p, q.objects, freed.map((x) => x.obj.index), (o) => currentSettings(p, o, q.kinds), q.kinds, app.settings.trimMm);
    // The loosed stitches stay loosed: undo brings them back as they were.
    for (const { obj, mem } of freed) remember(p, obj, mem);
    applyRestitched(r, 'free.failed', true);
  }

  /** Whether the selected objects' stitches are loosed from their shape, and whether any can be. */
  function freeOf(p: Pattern, q: Sequence): StitchInfo['free'] {
    const mems = [...ui.selectedObjects].map((o) => (q.objects[o] ? remembered(p, q.objects[o]) : undefined));
    const frees = new Set(mems.map((m) => !!m?.free));
    return { on: frees.size > 1 ? 'mixed' : frees.has(true), can: mems.some(loosable) };
  }

  /**
   * The objects the panel's settings go to: the selection, or the fill or line that the one
   * selected border, shadow or echo follows (its settings are set there).
   */
  function targets(): number[] {
    const p = app.files.active?.pattern;
    if (!p) return [];
    const sel = [...ui.selectedObjects].sort((a, b) => a - b);
    const o = sel.length === 1 ? stitchInfo(p, app.seq(p)).outline : undefined;
    return o?.of && o.fill !== null ? [o.fill] : sel;
  }

  /**
   * How to find the one selected border, shadow or echo again after its fill or line was sewn anew
   * (null from the finder: it is gone), or null when the selection is none of them.
   */
  function dependentFinder(): ((p: Pattern) => number | null) | null {
    const p0 = app.files.active?.pattern;
    if (!p0 || ui.selectedObjects.size !== 1) return null;
    const obj = app.seq(p0).objects[[...ui.selectedObjects][0]];
    const m = obj && remembered(p0, obj);
    const link = m?.outline;
    const part = partOf(m);
    if (!link && !part) return null;
    // Echo copies are found by their line's link and the first copy of their thread, which can move.
    const base = part?.includes(':') ? part.slice(0, part.lastIndexOf(':') + 1) : null;
    return (p) => {
      const objs = app.seq(p).objects;
      const find = (ok: (x: Remembered | undefined) => boolean) => objs.findIndex((x) => ok(remembered(p, x)));
      let i = link ? find((x) => x?.outline === link) : find((x) => partOf(x) === part);
      if (i < 0 && base) i = find((x) => !!partOf(x)?.startsWith(base));
      return i >= 0 ? i : null;
    };
  }

  /** The active pattern with new stitches for the objects the settings go to. */
  function restitched(s: RestitchSettings) {
    const p = app.files.active?.pattern;
    const which = targets();
    if (!p || !which.length) return null;
    const q = app.seq(p);
    return restitch(p, q.objects, which, s, q.kinds, app.settings.trimMm);
  }

  /** Links of the borders and second threads of the fills `which`: new stitches may take them away. */
  function linksOf(p: Pattern, which: number[]): Set<string> {
    const q = app.seq(p);
    return new Set(
      which
        .flatMap((o) => {
          const f = q.objects[o] && remembered(p, q.objects[o])?.fill;
          return [f?.border?.link ?? '', f?.deco?.blend?.link ?? ''];
        })
        .filter(Boolean),
    );
  }

  /**
   * Takes over new stitches for the selected objects; `failed` is said for objects left as they
   * were. With `remeasure` (another kind of stitch), the panel measures the objects again.
   */
  function applyRestitched(r: RestitchResult | null, failed: Key, remeasure = false, find: ((p: Pattern) => number | null) | null = null): void {
    const f = app.files.active;
    ui.flowPreview = null;
    if (!f || !r) return app.redraw();
    const say = () => {
      if (r.failed.length) app.layers.say(t(failed, { n: r.failed.length }), true);
    };
    if (!r.starts.length) {
      // Nothing could be sewn this way: the panel goes back to what the objects have.
      ui.selectionKey++;
      say();
      return app.redraw();
    }
    const key = ui.selectionKey;
    // Each object stays one, also where its new stitches are trimmed inside.
    r.starts.forEach((a, k) => rememberObjects(r.pattern, [a], r.ends[k]));
    // The same objects stay selected (found by their first stitch), and the settings stay as set.
    const nq = app.seq(r.pattern);
    // An object can come out in several pieces (new trims inside): all of them stay selected.
    const sel = new Set<number>();
    r.starts.forEach((a, k) => {
      const pieces = new Set<number>();
      for (let n = a + 1; n <= r.ends[k]; n++) {
        const o = nq.objectAt[recordOfStitch(nq.numbers, n)];
        if (o >= 0) pieces.add(o);
      }
      for (const o of pieces) sel.add(o);
      // An object that stayed one keeps its shape and settings for the next edit.
      if (pieces.size === 1) remember(r.pattern, nq.objects[[...pieces][0]], r.memory[k]);
    });
    // What the objects remember can change their kind (a fill with a satin border).
    app.seqCache.delete(r.pattern);
    // The parts of a fill cut apart share the border given to one of them.
    shareBorders(r.pattern, [...sel].map((o) => nq.objects[o]));
    // Borders in a thread of their own follow their fills; the selection is found again by its stitches.
    const p = syncBorders(r.pattern, app.settings.trimMm, dropLinks);
    dropLinks = new Set();
    let selNow = sel;
    if (p !== r.pattern) {
      const keys = new Set([...sel].map((o) => objectKey(r.pattern, nq.objects[o])));
      const pq = app.seq(p);
      selNow = new Set(pq.objects.flatMap((o, i) => (keys.has(objectKey(p, o)) ? [i] : [])));
    }
    app.applyEdit(p);
    app.files.setObjects(f, rememberedIn(p, app.seq(p).objects));
    if (selNow.size) ui.selectedObjects = selNow;
    // A border set from its own page stays selected; gone (no border, or in the fill's thread now), its fill is.
    if (find) {
      const i = find(p);
      if (i !== null) ui.selectedObjects = new Set([i]);
      else remeasure = true;
    }
    ui.selectionKey = remeasure ? key + 1 : key;
    // New stitches have a shape they can be loosed from; the outlines follow a changed area (a
    // fill along a line gets wider), an object of a file sewn anew can go back to the file's
    // stitches, and the measured values stay as set in the panel.
    const kept = ui.stitchCache && !remeasure && p === r.pattern ? ui.stitchCache.info : null;
    ui.stitchCache = null;
    if (kept) {
      const now = stitchInfo(p, app.seq(p));
      ui.stitchCache = { p, key: ui.selectionKey, info: { ...kept, free: freeOf(p, app.seq(p)), outlines: now.outlines, original: now.original } };
    }
    say();
    app.redraw();
  }

  /** Links of borders in their own thread that the next new stitches may take away (their fill was changed). */
  let dropLinks: ReadonlySet<string> = new Set();

  /** Settings to start from when the selected objects change from one kind of stitch to the other. */
  function convertSettings(to: 'fill' | 'satin', info: StitchInfo): RestitchSettings | null {
    if (to === 'satin') {
      const f = info.measured.fill;
      if (!f) return null;
      // Compensation by the fabric as a satin gets it (half fixed, half by width), not a fill's whole.
      const pull = pullFor(app.settings.profile, 'satin');
      return { kind: 'satin', s: { spacing: f.spacing, edge: pull.edge, edgeShare: pull.edgeShare, edgeAuto: true, short: true, underlay: f.underlay, tolerance: f.tolerance } };
    }
    const s = info.measured.satin;
    if (!s) return null;
    const spacing = s.spacing;
    return { kind: 'fill', s: { pattern: 'tatami', spacing, spacingEnd: Math.min(1.2, Math.round(spacing * 250) / 100), offset: 0.25, angle: NaN, stitch: 4, underlay: s.underlay, edge: 0, tolerance: s.tolerance } };
  }

  const stitchPanel = new StitchPanel($('object-stitches'), {
    preview: (s) => {
      ui.previewResult = s ? restitched(s) : null;
      ui.flowPreview = ui.previewResult?.pattern ?? null;
      app.redraw();
    },
    apply: (s) => {
      const pat = s.kind === 'fill' ? s.s.pattern : null;
      const p = app.files.active?.pattern;
      if (p) dropLinks = linksOf(p, targets());
      const find = dependentFinder();
      applyRestitched(restitched(s), pat === 'spiral' ? 'stitch.failedSpiral' : pat === 'contour' || pat === 'follow' ? 'stitch.failedCurved' : pat === 'guided' ? 'stitch.guide.failed' : 'stitch.failed', false, find);
    },
    convert: (to) => {
      const p = app.files.active?.pattern;
      if (!p || !ui.selectedObjects.size) return;
      const one = ui.selectedObjects.size === 1 ? [...ui.selectedObjects][0] : -1;
      // A wide line: as a fill of its area, and back to the line it was.
      if (to === 'line') {
        if (one >= 0) app.sewLineAgain(one);
        return;
      }
      if (to === 'fill' && one >= 0 && remembered(p, app.seq(p).objects[one])?.path) {
        const d = digitizeDefaults(app.settings.profile);
        const fill = { pattern: 'tatami' as const, spacing: d.spacing, spacingEnd: Math.min(1.2, Math.round(d.spacing * 250) / 100), offset: 0.25, angle: NaN, stitch: d.stitch, underlay: d.underlay, edge: 0, tolerance: d.tolerance };
        const r = lineToFill(p, one, fill, app.settings.trimMm);
        applyRestitched(r, 'stitch.failed', true);
        if (r?.starts.length) app.layers.say(t('stitch.lineFilled'));
        return;
      }
      // One fill to satin: cut and crossed as by hand (Vorschlagen), the same as with R.
      if (to === 'satin' && one >= 0 && app.convertToSatin(one)) return;
      const s = convertSettings(to, stitchInfo(p, app.seq(p)));
      if (!s) return;
      const q = app.seq(p);
      const r = restitch(p, q.objects, [...ui.selectedObjects].sort((a, b) => a - b), s, q.kinds, app.settings.trimMm, to === 'satin' ? 'fill' : 'satin');
      applyRestitched(r, to === 'satin' ? 'stitch.toSatin.failed' : 'stitch.failed', true);
    },
    direction: (a) => {
      if (a === 'tool') return app.toggleRungs();
      if (a === 'rung' || a === 'cut') return app.rungTool.setCutMode(a === 'cut');
      if (!app.rungTool.active || app.rungTool.mode !== 'satin') return;
      if (a === 'corners') app.rungTool.corners();
      else if (a === 'sections') app.rungTool.sections();
      else if (a === 'order') app.rungTool.bestOrder();
      else if (a === 'even') app.rungTool.even();
      else app.rungTool.follow();
    },
    spacingHere: (v) => app.rungTool.setSpacingHere(v),
    draw: (a) => (a === 'tool' ? app.toggleRungs() : app.sewAlongLines()),
    guide: (a) => {
      if (a === 'tool') return app.toggleGuides();
      if (app.rungTool.mode === 'guide') app.closeRungs();
    },
    points: (a) => {
      if (a === 'tool') return app.togglePoints();
      if (app.rungTool.mode === 'points') app.closeRungs();
    },
    line: (st, final) => {
      const which = targets();
      if (which.length !== 1) return;
      // A shadow or echo is set at its line, and stays selected (gone, its line is).
      const find = final ? dependentFinder() : null;
      if (!app.sewLine(which[0], null, st, final) || !find) return;
      const p = app.files.active?.pattern;
      const i = p ? find(p) : null;
      if (i === null) return;
      ui.selectedObjects = new Set([i]);
      ui.selectionKey++;
      ui.stitchCache = null;
      app.redraw();
    },
    knockout: (on) => app.knockoutObjects([...ui.selectedObjects].sort((a, b) => a - b), on),
    overlapShare: (share) => {
      const f = app.files.active;
      const p = f?.pattern;
      if (!f || !p) return;
      const r = setOverlapShare(p, [...ui.selectedObjects].sort((a, b) => a - b), share, app.settings.trimMm);
      if (!r) return;
      const sel = ui.selectedObjects;
      if (r.pattern !== p) app.applyEdit(r.pattern);
      app.files.setObjects(f, rememberedIn(r.pattern, app.seq(r.pattern).objects));
      ui.selectedObjects = sel;
      ui.selectionKey++;
      ui.stitchCache = null;
      app.redraw();
    },
    free: (on) => looseObjects(on),
    original: () => {
      const f = app.files.active;
      const p = f?.pattern;
      if (!f?.original || !p) return;
      const r = backToOriginal(p, f.original, [...ui.selectedObjects].sort((a, b) => a - b), app.settings.trimMm);
      if (!r) return;
      // What the panel shows is measured from the stitches again.
      applyRestitched(r, 'free.failed', true);
      app.layers.say(t('original.done'));
    },
    lock: (on) => {
      const p = app.files.active?.pattern;
      if (!p) return;
      const q = app.seq(p);
      for (const o of ui.selectedObjects) {
        const obj = q.objects[o];
        if (!obj) continue;
        const mem = remembered(p, obj);
        if (!mem && !on) continue;
        remember(p, obj, { ...(mem ?? { region: null }), lock: on || undefined });
      }
      if (app.files.active) app.files.setObjects(app.files.active, rememberedIn(p, q.objects));
      ui.selectionKey++;
      ui.stitchCache = null;
      app.redraw();
    },
    highlight: (what) => {
      ui.highlight = what;
      app.redraw();
    },
    blend: (anchor) => app.objectPanel.pickBlend(anchor),
    outline: (a) => {
      const p = app.files.active?.pattern;
      if (!p || ui.selectedObjects.size !== 1) return;
      const q = app.seq(p);
      const own = q.objects[[...ui.selectedObjects][0]];
      const mem = own && remembered(p, own);
      if (!mem || (!mem.outline && !mem.blendOf && !partOf(mem))) return;
      const blend = !mem.outline && !!mem.blendOf;
      const part = partOf(mem);
      const shadow = !!part;
      const fill = q.objects.findIndex((o) => partnerOf(remembered(p, o), mem));
      if (a === 'fill') {
        if (fill >= 0) app.selectObjects([fill], false);
        app.layers.reveal([...ui.selectedObjects]);
        return app.redraw();
      }
      // Its own object from now on: the fill forgets its border (or second thread), and it its fill.
      const fm = fill >= 0 ? remembered(p, q.objects[fill]) : undefined;
      if (shadow) {
        if (fm?.line) remember(p, q.objects[fill], withoutPart(fm, part!));
        remember(p, own, { ...mem, shadowOf: undefined, echoOf: undefined });
      } else {
        if (fm?.fill && blend) remember(p, q.objects[fill], { ...fm, fill: { ...fm.fill, deco: { ...fm.fill.deco, blend: undefined } } });
        else if (fm?.fill) remember(p, q.objects[fill], { ...fm, fill: { ...fm.fill, border: undefined } });
        remember(p, own, blend ? { ...mem, blendOf: undefined } : { ...mem, outline: undefined, border: undefined });
      }
      if (app.files.active) app.files.setObjects(app.files.active, rememberedIn(p, q.objects));
      ui.selectionKey++;
      ui.stitchCache = null;
      app.layers.say(t(shadow ? (mem.echoOf ? 'stitch.echoOf.detached' : 'stitch.shadowOf.detached') : blend ? 'stitch.blendOf.detached' : 'stitch.outline.detached'));
      app.redraw();
    },
  });

  return { applyRestitched, convertSettings, looseObjects, stitchInfo, stitchPanel };
}
