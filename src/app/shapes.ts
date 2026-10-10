import type { Editor } from '../ui/editor';
import type { FileList } from '../ui/fileList';
import type { Form, Mat } from '../shape/path';
import type { FrameTool } from '../ui/frameTool';
import type { LayersPanel } from '../ui/layersPanel';
import type { Measurement } from '../validation/measure';
import type { PathStitch } from '../model/along';
import { nextVersion, type Pattern } from '../model/pattern';
import type { Sequence } from './types';
import type { Settings } from '../settings';
import type { SewObject } from '../model/objects';
import type { Viewport } from '../render/viewport';
import { ShapeTool } from '../ui/shapeTool';
import { deleteObjects, duplicateObjects, mirrorMatrix, subtractTop } from '../model/shapeOps';
import { fillsToLines, reshapeObject } from '../model/reshape';
import { resewLine, lineSettings, lineToFill, reshapeLineFill } from '../model/line';
import { refreshKnockouts } from '../model/knockout';
import { borderOf, objectKey, remember, remembered, rememberedIn, restitch, type Remembered, type RestitchResult } from '../model/restitch';
import { followerLinks, syncBorders } from '../model/border';
import { partOf } from '../model/shadow';
import { stitchKey } from '../model/objects';
import { t, formatNumber, type Key } from '../i18n';
import { ui } from './state';
import { bandArea, fillArea, fits, fitsOf, geoOf, geoUse, guessGeo, guessLine, sewnAlong, withGeo } from '../model/geo';

/** What bindShapes needs from the rest of the app. */
export interface ShapesApp {
  readonly applyEdit: (p: Pattern, measurement?: Measurement | undefined) => void;
  readonly applyRestitched: (r: RestitchResult | null, failed: Key, remeasure?: boolean, find?: null, drop?: ReadonlySet<string>) => void;
  readonly history: (step: 'undo' | 'redo' | 'revert') => void;
  readonly closeRungs: () => void;
  readonly commitTransform: (m: Mat) => void;
  readonly editor: Editor;
  readonly enterObject: (o: number, fit: boolean) => void;
  readonly files: FileList;
  readonly frameObjects: () => number[];
  readonly frameTool: FrameTool;
  readonly layers: LayersPanel;
  readonly objectName: (q: Sequence, i: number) => string;
  readonly recompute: () => void;
  readonly redraw: () => void;
  readonly selectObjects: (objs: number[], toggle: boolean) => void;
  readonly seq: (p: Pattern) => Sequence;
  readonly settings: Settings;
  readonly syncPlayer: () => void;
  readonly updateLevel: () => void;
  readonly vp: Viewport;
}

/** The shape tool (level Form: outlines and lines), and objects as shapes: delete, duplicate, mirror, cut out. */
export function bindShapes(app: ShapesApp) {
  const shapeTool = new ShapeTool({
    change: (form) => commitShape(form),
    redraw: () => app.redraw(),
    say: (key) => {
      app.layers.say(t(key), true);
      app.redraw();
    },
    width: (w) => setLineWidth(w),
  });

  /**
   * The band of object `o` on the level Form: a line where it covers an area (sewn as satin, or as a
   * fill along it), or the satin border of a fill; null for running and triple stitch.
   */
  function bandOf(p: Pattern, q: Sequence, o: number): { width: number; offset: number } | null {
    const obj = q.objects[o];
    const known = obj && remembered(p, obj);
    if (geoUse(known) === 'band') return { width: known!.fill!.lineWidth!, offset: 0 };
    const border = borderOf(known);
    if (border?.type === 'satin' || border?.type === 'zigzag') return { width: border.width, offset: border.offset ?? 0 };
    if (!obj || !isLineObject(p, obj)) return null;
    const st = lineSettings(p, obj, q.kinds);
    return st.type === 'satin' || st.type === 'zigzag' ? { width: st.width, offset: 0 } : null;
  }

  /** The shape tool shows the band of object `o`, when it has one. */
  function showBand(p: Pattern, q: Sequence, o: number): void {
    const b = bandOf(p, q, o);
    shapeTool.band = b?.width ?? null;
    shapeTool.bandOffset = b?.offset ?? 0;
  }

  /**
   * The selected object's band made `w` mm wide (its grip on the level Form): a line sewn as satin or
   * as a fill along it, or the satin border of a fill.
   */
  function setLineWidth(w: number): void {
    const p = app.files.active?.pattern;
    const o = ui.shapeObject;
    if (!p || o === null) return;
    const q = app.seq(p);
    const obj = q.objects[o];
    if (!obj) return;
    const known = remembered(p, obj);
    const band = geoUse(known) === 'band';
    const border = borderOf(known);
    if (band || border) {
      const fill = known!.fill && structuredClone(known!.fill);
      const r = band
        ? reshapeLineFill(p, q.objects, obj, q.kinds, shapeTool.form, app.settings.trimMm, w)
        : fill && border && restitch(p, q.objects, [o], { kind: 'fill', s: fill, line: { ...border, width: w } }, q.kinds, app.settings.trimMm);
      if (!r || !r.starts.length) {
        showBand(p, q, o);
        app.layers.say(t('shape.failed'), true);
        return app.redraw();
      }
      app.applyRestitched(r, 'shape.failed', true);
      app.layers.say(t('shape.width.set', { w: formatNumber(w, 1) }));
      followKnockouts();
      return;
    }
    const st = lineSettings(p, obj, q.kinds);
    if (!sewLine(o, shapeTool.form, { ...st, width: w }, true)) shapeTool.band = st.width;
    else app.layers.say(t('shape.width.set', { w: formatNumber(w, 1) }));
    app.redraw();
  }

  /**
   * Objects sewn along a line: drawn or SVG lines (their curves are known) and running stitches of a
   * file (their curve is traced); not the borders of fills and not letters.
   */
  function isLineObject(p: Pattern, o: SewObject): boolean {
    return sewnAlong(p, o);
  }

  /**
   * The form of the one selected object of the Ablauf mode, to edit on the level Form: given, or
   * guessed from its stitches (a satin of a file: the outline of its columns). A letter has none of
   * its own (its form comes from the font), nor has a border, second blend thread, shadow or echo in
   * a thread of its own (it follows its fill or line).
   */
  function shapeTarget(p: Pattern, q: Sequence, o: number): Form | null {
    const obj = q.objects[o];
    const m = obj && remembered(p, obj);
    if (!obj || m?.lettering || m?.outline || m?.blendOf || partOf(m)) return null;
    return guessGeo(p, obj, q.kinds);
  }

  /**
   * Line `o` sewn anew along `path` with `st` (one undo step), or only shown while settings are
   * being changed (`final` false).
   */
  function sewLine(o: number, path: Form | null, st: PathStitch | null, final: boolean): boolean {
    const f = app.files.active;
    const p = f?.pattern;
    if (!f || !p) return false;
    const q = app.seq(p);
    const obj = q.objects[o];
    if (!obj) return false;
    const line = path ?? guessLine(p, obj, q.kinds);
    if (!line) return false;
    const sewn = resewLine(p, o, line, st ?? lineSettings(p, obj, q.kinds), app.settings.trimMm);
    // Its shadow follows (sewn before it: a new one moves the line one place on).
    const synced = sewn && syncBorders(sewn.pattern, app.settings.trimMm);
    const r = sewn && synced && { pattern: synced, key: stitchKey(sewn.pattern, sewn.first, sewn.last) };
    if (!final) {
      ui.flowPreview = r?.pattern ?? null;
      app.redraw();
      return !!r;
    }
    ui.flowPreview = null;
    if (!r) {
      app.layers.say(t('stitch.failed', { n: 1 }), true);
      app.redraw();
      return false;
    }
    const hand = remembered(p, obj)?.hand ?? 0;
    app.applyEdit(r.pattern);
    const nq = app.seq(r.pattern);
    app.files.setObjects(f, rememberedIn(r.pattern, nq.objects));
    const now = nq.objects.findIndex((x) => objectKey(r.pattern, x) === r.key);
    if (now >= 0 && ui.shapeObject === o) ui.shapeObject = now;
    ui.selectedObjects = new Set([now >= 0 ? now : o]);
    ui.selectionKey++;
    ui.stitchCache = null;
    if (hand) app.layers.say(t('shape.handReplaced', { n: formatNumber(hand) }));
    followKnockouts();
    app.redraw();
    return true;
  }

  /**
   * Fills `objs` sewn as lines along their paths (one undo step), their fills kept to fill them
   * again as they were; a band is the line it was again.
   */
  function sewLineAgain(objs: number[]): void {
    const p = app.files.active?.pattern;
    if (!p || !objs.length) return;
    const bands = objs.every((o) => geoUse(remembered(p, app.seq(p).objects[o])) === 'band');
    const r = fillsToLines(p, objs, app.settings.trimMm);
    if (!r) return app.layers.say(t('stitch.failed', { n: objs.length }), true);
    app.applyRestitched(r, 'stitch.failed', true, null, r.drop);
    if (!bands && !r.failed.length) app.layers.say(t('stitch.lineAgain', { n: r.starts.length }));
    followKnockouts();
  }

  /** Line `o` that was a fill filled again as it was (one undo step). */
  function fillLineAgain(o: number): void {
    const p = app.files.active?.pattern;
    const obj = p && app.seq(p).objects[o];
    const was = obj && remembered(p, obj)?.kept?.fill;
    if (!p || !was) return;
    app.applyRestitched(lineToFill(p, o, was, app.settings.trimMm), 'stitch.failed', true);
    followKnockouts();
  }

  /** The open paths of the form of object `o` closed, and the object sewn in it (one undo step). */
  function closeOpenPaths(o: number): void {
    const p = app.files.active?.pattern;
    const obj = p && app.seq(p).objects[o];
    const geo = obj && geoOf(remembered(p, obj));
    if (!geo) return;
    const closed = { ...geo, paths: geo.paths.map((x) => (x.closed || x.nodes.length < 3 ? x : { ...x, closed: true })) };
    if (sewShape(o, closed)) syncShape();
  }

  /** Edits the outline of object `o` (level Form, with the frame around it); objects without an outline go to their stitches. */
  function enterShape(o: number, fit: boolean): void {
    const p = app.files.active?.pattern;
    if (!p || app.settings.mode !== 'flow') return;
    const q = app.seq(p);
    const form = shapeTarget(p, q, o);
    if (!form) {
      // A letter: its form comes from the font.
      if (q.objects[o] && remembered(p, q.objects[o])?.lettering) app.layers.say(t('shape.lettering'));
      return app.enterObject(o, fit);
    }
    app.closeRungs();
    if (app.editor.active) {
      app.editor.setActive(false);
      ui.editObject = null;
    }
    ui.formLevel = true;
    shapeTool.open(form);
    showBand(p, q, o);
    ui.shapeObject = o;
    ui.shapePattern = p;
    if (!ui.selectedObjects.has(o) || ui.selectedObjects.size !== 1) app.selectObjects([o], false);
    const obj = q.objects[o];
    if (fit) {
      const w = ((obj.maxX - obj.minX) / 10) * app.vp.scale;
      const h = ((obj.maxY - obj.minY) / 10) * app.vp.scale;
      if (Math.max(w / ui.stageW, h / ui.stageH) < 0.4) app.vp.fit(obj.minX / 10, obj.minY / 10, obj.maxX / 10, obj.maxY / 10, ui.stageW, ui.stageH, 60);
    }
    app.updateLevel();
    app.redraw();
  }

  function closeShape(): void {
    if (!shapeTool.active) return;
    shapeTool.close();
    ui.shapeObject = null;
    ui.shapePattern = null;
    app.updateLevel();
    app.redraw();
  }

  /** Keeps the shape tool on its object after new stitches, undo or redo; it closes when the object has no fill any more. */
  function syncShape(): void {
    if (!shapeTool.active) return;
    const p = app.files.active?.pattern;
    if (!p || app.settings.mode !== 'flow' || ui.selectedObjects.size !== 1) return closeShape();
    if (p === ui.shapePattern) return;
    const q = app.seq(p);
    const o = [...ui.selectedObjects][0];
    const form = shapeTarget(p, q, o);
    if (!form) return closeShape();
    shapeTool.setForm(form);
    showBand(p, q, o);
    ui.shapeObject = o;
    ui.shapePattern = p;
  }

  /**
   * The fill or line sewn anew in its changed outline (one undo step); one loosed from its shape keeps
   * its stitches and only its resting shape changes (see restShape).
   */
  function commitShape(form: Form): void {
    const p = app.files.active?.pattern;
    if (!p || ui.shapeObject === null) return;
    const q = app.seq(p);
    const obj = q.objects[ui.shapeObject];
    if (!obj) return;
    if (remembered(p, obj)?.free) return restShape(p, obj, form);
    if (!sewShape(ui.shapeObject, form)) shapeTool.setForm(shapeTarget(p, q, ui.shapeObject) ?? form);
  }

  /** Object `o` sewn anew in `form` (one undo step), or only shown with `preview`. False when it could not be. */
  function sewShape(o: number, form: Form, preview = false): boolean {
    const f = app.files.active;
    const p = f?.pattern;
    if (!f || !p) return false;
    const q = app.seq(p);
    const obj = q.objects[o];
    if (!obj) return false;
    const before = remembered(p, obj);
    const hand = before?.hand ?? 0;
    const was = guessGeo(p, obj, q.kinds);
    const r = reshapeObject(p, q.objects, obj, q.kinds, form, app.settings.trimMm);
    if (preview) {
      ui.flowPreview = r?.starts.length ? r.pattern : null;
      app.redraw();
      return !!ui.flowPreview;
    }
    if (!r || !r.starts.length) {
      // Nothing to sew there (too small, or the outline crosses itself away): back to the old one.
      app.layers.say(t('shape.failed'), true);
      app.redraw();
      return false;
    }
    const now = r.memory[0];
    // Its last closed path opened: a fill is sewn along its paths now; what follows it in a thread of its own goes.
    const opened = !sewnAlong(p, obj) && geoUse(now) === 'line';
    app.applyRestitched(r, 'shape.failed', true, null, opened ? new Set(followerLinks(before)) : undefined);
    followKnockouts();
    if (hand) app.layers.say(t('shape.handReplaced', { n: formatNumber(hand) }));
    else if (opened) app.layers.say({ text: t('shape.opened'), undo: () => app.history('undo') });
    else if (geoUse(now) === 'line' && now.kept?.fill && fits(form, 'fill') && !fits(was, 'fill'))
      app.layers.say({ text: t('shape.closedAgain'), action: { label: t('shape.fillAgain'), run: () => fillLineAgain(o) } });
    else if (geoUse(now) === 'area' && now.fill) {
      // Open paths beside closed ones are not filled: said when there are more of them than before.
      const n = fitsOf(form).openBeside;
      if (n > fitsOf(was).openBeside) app.layers.say({ text: t(borderOf(now) ? 'shape.openBesideBorder' : 'shape.openBeside', { n }), action: { label: t('shape.closePaths', { n }), run: () => closeOpenPaths(o) } });
    }
    return true;
  }

  /**
   * The resting shape of `obj`, loosed from it, changed to `form` (one undo step): its stitches stay as
   * they were set by hand. Sewing it from the new shape is offered, with a look at the result.
   */
  function restShape(p: Pattern, obj: SewObject, form: Form): void {
    const f = app.files.active;
    const mem = remembered(p, obj);
    if (!f || !mem) return;
    const line = isLineObject(p, obj);
    // A line read from a file is sewn along its form from now on, with the stitch it has.
    const rested: Remembered = withGeo(line && !mem.line ? { ...mem, line: lineSettings(p, obj) } : mem, form);
    const use = geoUse(rested);
    if (use === 'area') rested.region = fillArea(rested, mem.region?.pxMm ?? 0.1) ?? mem.region;
    else if (use === 'band') rested.region = bandArea(form, rested.fill!, mem.region?.pxMm ?? 0.1) ?? mem.region;
    const next = nextVersion(p, {});
    remember(next, obj, rested);
    app.applyEdit(next);
    app.files.setObjects(f, rememberedIn(next, app.seq(next).objects));
    ui.stitchCache = null;
    const id = obj.id;
    // Sewn from the shape it rests in now: loosed only for that try, as it was otherwise.
    const fromShape = (preview: boolean): boolean => {
      const cur = app.files.active?.pattern;
      const cq = cur && app.seq(cur);
      const o = cq ? cq.objects.findIndex((x) => x.id === id) : -1;
      const at = cq?.objects[o];
      const m = at && remembered(cur!, at);
      if (!cur || !cq || !at || !m?.free) return false;
      remember(cur, at, { ...m, free: undefined });
      const shape = shapeTarget(cur, cq, o);
      const ok = !!shape && sewShape(o, shape, preview);
      remember(cur, at, m);
      if (ok && !preview) app.selectObjects([app.seq(app.files.active!.pattern!).objects.findIndex((x) => x.id === id)].filter((k) => k >= 0), false);
      return ok;
    };
    app.layers.say({
      text: t('shape.rested'),
      action: {
        label: t('shape.rested.sew'),
        title: t('shape.rested.sew.hint'),
        run: () => void fromShape(false),
        preview: (on) => {
          if (on) fromShape(true);
          else {
            ui.flowPreview = null;
            app.redraw();
          }
        },
      },
    });
    app.redraw();
  }

  /**
   * After shapes changed: fills that leave out what lies on top are sewn anew where that changed, in
   * the same undo step as the change.
   */
  function followKnockouts(): void {
    const f = app.files.active;
    const p = f?.pattern;
    if (!f || !p) return;
    const r = refreshKnockouts(p, app.settings.trimMm);
    if (!r) return;
    const sel = ui.selectedObjects;
    app.files.setPattern(f, r.pattern, { record: false });
    app.syncPlayer();
    app.recompute();
    app.files.setObjects(f, rememberedIn(r.pattern, app.seq(r.pattern).objects));
    ui.selectedObjects = sel;
    ui.selectionKey++;
    const q = app.seq(r.pattern);
    app.layers.say(t('knockout.followed', { list: r.changed.map((o) => (q.objects[o] ? app.objectName(q, o) : '')).filter(Boolean).join(', ') }));
    app.redraw();
  }

  // Objects as shapes: delete, duplicate, mirror, cut out ------------------------

  /** Takes over a pattern made from the objects, selecting `select` in it. */
  function takeShapes(next: Pattern, select: number[]): void {
    const f = app.files.active;
    if (!f) return;
    app.applyEdit(next);
    app.files.setObjects(f, rememberedIn(next, app.seq(next).objects));
    ui.selectedObjects = new Set(select);
    ui.selectionKey++;
    followKnockouts();
    app.redraw();
  }

  function deleteSelected(): void {
    const p = app.files.active?.pattern;
    const sel = app.frameObjects();
    if (!p || !sel.length) return;
    const next = deleteObjects(p, sel, app.settings.trimMm);
    if (!next) return;
    takeShapes(next, []);
    app.layers.say(sel.length === 1 ? t('object.deleted.one') : t('object.deleted', { n: sel.length }));
  }

  /**
   * The selected objects once more, sewn right after their originals: 2 mm beside them (the
   * button, Ctrl+C and Ctrl+V), or `inPlace` exactly on them (Ctrl+D). The copies are selected.
   */
  function duplicateSelected(inPlace = false): void {
    duplicate(app.frameObjects(), inPlace);
  }

  function duplicate(sel: number[], inPlace: boolean): void {
    const p = app.files.active?.pattern;
    if (!p || !sel.length) return;
    const r = duplicateObjects(p, sel, app.settings.trimMm, inPlace ? 0 : undefined);
    if (!r) return app.layers.say(t('frame.failed'), true);
    takeShapes(r.pattern, r.copies);
    const n = r.copies.length;
    const said = inPlace ? (n === 1 ? t('object.duplicatedHere.one') : t('object.duplicatedHere', { n })) : n === 1 ? t('object.duplicated') : t('object.duplicated.many', { n });
    app.layers.say([said, r.nudged ? t('object.duplicatedHere.nudged') : ''].filter(Boolean).join(' '));
  }

  /** Objects copied with Ctrl+C: their design and their stitches (found again by them for Ctrl+V). */
  let copied: { file: unknown; keys: string[] } | null = null;

  /** Ctrl+C: remembers the selected objects; false when none is selected (the page copies text then). */
  function copySelected(): boolean {
    const f = app.files.active;
    const p = f?.pattern;
    const sel = app.frameObjects();
    if (!p || !sel.length) return false;
    const q = app.seq(p);
    copied = { file: f, keys: sel.flatMap((o) => (q.objects[o] ? [objectKey(p, q.objects[o])] : [])) };
    app.layers.say(sel.length === 1 ? t('object.copied.one') : t('object.copied', { n: sel.length }));
    return true;
  }

  /** Ctrl+V: the objects copied last once more, 2 mm beside them (each paste a step further). */
  function pasteCopied(): boolean {
    const f = app.files.active;
    if (!copied || !f?.pattern) return false;
    if (copied.file !== f) {
      app.layers.say(t('object.paste.otherDesign'), true);
      return true;
    }
    const p = f.pattern;
    const q = app.seq(p);
    const keys = new Set(copied.keys);
    const sel = q.objects.flatMap((o, i) => (keys.has(objectKey(p, o)) ? [i] : []));
    if (!sel.length) {
      app.layers.say(t('object.paste.gone'), true);
      return true;
    }
    duplicate(sel, false);
    return true;
  }

  function mirrorSelected(axis: 'x' | 'y'): void {
    const p = app.files.active?.pattern;
    const sel = app.frameObjects();
    if (!p || !sel.length) return;
    const objs = sel.map((o) => app.seq(p).objects[o]);
    const box = {
      minX: Math.min(...objs.map((o) => o.minX)) / 10,
      minY: Math.min(...objs.map((o) => o.minY)) / 10,
      maxX: Math.max(...objs.map((o) => o.maxX)) / 10,
      maxY: Math.max(...objs.map((o) => o.maxY)) / 10,
    };
    app.commitTransform(mirrorMatrix(axis, box));
    app.layers.say(t('object.mirrored'));
  }

  function subtractSelected(): void {
    const p = app.files.active?.pattern;
    const sel = app.frameObjects();
    if (!p || sel.length < 2) return;
    const r = subtractTop(p, sel, app.settings.trimMm);
    if (!r) return app.layers.say(t('object.subtract.nothing'), true);
    takeShapes(r.pattern, r.cut);
    const q = app.seq(r.pattern);
    const list = r.cut.map((o) => (q.objects[o] ? app.objectName(q, o) : '')).filter(Boolean).join(', ');
    app.layers.say([list ? t('object.subtracted', { list }) : '', r.covered ? t('object.subtracted.covered') : ''].filter(Boolean).join(' '));
  }

  /** Whether Ctrl+V has something to paste. */
  const canPaste = (): boolean => !!copied;

  return { canPaste, closeShape, copySelected, deleteSelected, duplicateSelected, pasteCopied, enterShape, followKnockouts, isLineObject, mirrorSelected, sewLine, sewLineAgain, shapeTarget, shapeTool, showBand, subtractSelected, syncShape, takeShapes };
}
