import type { Editor } from '../ui/editor';
import type { FileList } from '../ui/fileList';
import type { Form, Mat } from '../shape/path';
import type { FrameTool } from '../ui/frameTool';
import type { LayersPanel } from '../ui/layersPanel';
import type { Measurement } from '../validation/measure';
import type { PathStitch } from '../model/along';
import type { Pattern } from '../model/pattern';
import type { Sequence } from './types';
import type { Settings } from '../settings';
import type { SewObject } from '../model/objects';
import type { Viewport } from '../render/viewport';
import { ShapeTool } from '../ui/shapeTool';
import { deleteObjects, duplicateObject, mirrorMatrix, subtractTop } from '../model/shapeOps';
import { formOf, reshapeFill } from '../model/reshape';
import { lineOf, resewLine, lineSettings, fillToLine } from '../model/line';
import { refreshKnockouts } from '../model/knockout';
import { remembered, rememberedIn, type RestitchResult } from '../model/restitch';
import { t, formatNumber, type Key } from '../i18n';
import { ui } from './state';

/** What bindShapes needs from the rest of the app. */
export interface ShapesApp {
  readonly applyEdit: (p: Pattern, measurement?: Measurement | undefined) => void;
  readonly applyRestitched: (r: RestitchResult | null, failed: Key, remeasure?: boolean) => void;
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
  });

  /**
   * Objects sewn along a line: drawn or SVG lines (their curves are known) and running stitches of a
   * file (their curve is traced); not the borders of fills and not letters.
   */
  function isLineObject(p: Pattern, o: SewObject): boolean {
    const m = remembered(p, o);
    if (m?.path) return true;
    return o.kind === 'run' && !m?.outline && !m?.lettering;
  }

  /** The one selected object of the Ablauf mode, when it has a fill whose outline can be edited, or is a line. */
  function shapeTarget(p: Pattern, q: Sequence, o: number): Form | null {
    const obj = q.objects[o];
    // Stitches loosed from their shape are edited as stitches; the shape rests.
    if (!obj || remembered(p, obj)?.free) return null;
    return isLineObject(p, obj) ? lineOf(p, obj, q.kinds) : formOf(p, obj, q.kinds);
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
    const line = path ?? lineOf(p, obj, q.kinds);
    if (!line) return false;
    const r = resewLine(p, o, line, st ?? lineSettings(p, obj, q.kinds), app.settings.trimMm);
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
    app.files.setObjects(f, rememberedIn(r.pattern, app.seq(r.pattern).objects));
    ui.selectedObjects = new Set([o]);
    ui.selectionKey++;
    ui.stitchCache = null;
    if (hand) app.layers.say(t('shape.handReplaced', { n: formatNumber(hand) }));
    followKnockouts();
    app.redraw();
    return true;
  }

  /** A fill that was a wide line sewn as that line again. */
  function sewLineAgain(o: number): void {
    const f = app.files.active;
    const p = f?.pattern;
    if (!f || !p) return;
    const r = fillToLine(p, o, app.settings.trimMm);
    if (!r) return app.layers.say(t('stitch.failed', { n: 1 }), true);
    ui.flowPreview = null;
    app.applyEdit(r.pattern);
    app.files.setObjects(f, rememberedIn(r.pattern, app.seq(r.pattern).objects));
    ui.selectedObjects = new Set([o]);
    ui.selectionKey++;
    ui.stitchCache = null;
    followKnockouts();
    app.redraw();
  }

  /** Edits the outline of object `o` (level Form); objects without a fill go to their stitches. */
  function enterShape(o: number, fit: boolean): void {
    const p = app.files.active?.pattern;
    if (!p || app.settings.mode !== 'flow') return;
    const q = app.seq(p);
    const form = shapeTarget(p, q, o);
    if (!form) return app.enterObject(o, fit);
    app.closeRungs();
    if (app.editor.active) {
      app.editor.setActive(false);
      ui.editObject = null;
    }
    if (!ui.selectedObjects.has(o) || ui.selectedObjects.size !== 1) app.selectObjects([o], false);
    shapeTool.open(form);
    ui.shapeObject = o;
    ui.shapePattern = p;
    app.frameTool.close();
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
    ui.shapeObject = o;
    ui.shapePattern = p;
  }

  /** The fill sewn anew in its changed outline (one undo step). */
  function commitShape(form: Form): void {
    const f = app.files.active;
    const p = f?.pattern;
    if (!f || !p || ui.shapeObject === null) return;
    const q = app.seq(p);
    const obj = q.objects[ui.shapeObject];
    if (!obj) return;
    if (isLineObject(p, obj)) {
      if (!sewLine(ui.shapeObject, form, null, true)) shapeTool.setForm(shapeTarget(p, q, ui.shapeObject) ?? form);
      return;
    }
    const hand = remembered(p, obj)?.hand ?? 0;
    const r = reshapeFill(p, q.objects, obj, q.kinds, form, app.settings.trimMm);
    if (!r || !r.starts.length) {
      // Nothing to fill there (too small, or the outline crosses itself away): back to the old one.
      shapeTool.setForm(shapeTarget(p, q, ui.shapeObject) ?? form);
      app.layers.say(t('shape.failed'), true);
      return app.redraw();
    }
    app.applyRestitched(r, 'shape.failed', true);
    if (hand) app.layers.say(t('shape.handReplaced', { n: formatNumber(hand) }));
    followKnockouts();
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
    if (!next) return app.layers.say(t('object.deleteLast'), true);
    takeShapes(next, []);
    app.layers.say(sel.length === 1 ? t('object.deleted.one') : t('object.deleted', { n: sel.length }));
  }

  function duplicateSelected(): void {
    const p = app.files.active?.pattern;
    const sel = app.frameObjects();
    if (!p || sel.length !== 1) return;
    const r = duplicateObject(p, sel[0], app.settings.trimMm);
    if (!r) return app.layers.say(t('frame.failed'), true);
    takeShapes(r.pattern, [r.index]);
    app.layers.say(t('object.duplicated'));
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

  return { closeShape, deleteSelected, duplicateSelected, enterShape, followKnockouts, isLineObject, mirrorSelected, sewLine, sewLineAgain, shapeTarget, shapeTool, subtractSelected, syncShape, takeShapes };
}
