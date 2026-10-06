import type { Editor } from '../ui/editor';
import type { FileList } from '../ui/fileList';
import type { LayersPanel } from '../ui/layersPanel';
import type { LeftOut } from '../ui/imageMode';
import type { Mat } from '../shape/path';
import type { Measurement } from '../validation/measure';
import type { OrderCard } from '../ui/objectPanel';
import type { RungTool } from '../ui/rungTool';
import type { Sequence } from './types';
import type { Settings } from '../settings';
import type { ShapeTool } from '../ui/shapeTool';
import type { ThreadColor, Pattern } from '../model/pattern';
import { DrawTool, type DrawKind } from '../ui/drawTool';
import { FrameTool, type SnapTargets } from '../ui/frameTool';
import { digitizeDefaults, type Digitized, digitizeShapes } from '../digitize/digitize';
import { nearestThread } from '../image/prepare';
import { overlapsIn, setKnockout } from '../model/knockout';
import { rememberedIn, remembered, objectKey } from '../model/restitch';
import { rgbToLab } from '../image/color';
import { scaleBlocked, transformSewObject } from '../model/reshape';
import { stitchesBefore, transformObject } from '../model/transform';
import { syncBorders } from '../model/border';
import { t, formatNumber } from '../i18n';
import { type NewShape, addShape } from '../model/addShape';
import { ui } from './state';

/** What bindDrawing needs from the rest of the app. */
export interface DrawingApp {
  readonly addDigitized: (d: Digitized & { leftOut?: LeftOut[] | undefined; }, name: string) => Promise<void>;
  readonly applyEdit: (p: Pattern, measurement?: Measurement | undefined) => void;
  readonly closeRungs: () => void;
  readonly closeShape: () => void;
  readonly editor: Editor;
  readonly files: FileList;
  readonly followKnockouts: () => void;
  readonly layers: LayersPanel;
  readonly openSelectedForm: () => void;
  readonly orderCard: OrderCard;
  readonly redraw: () => void;
  readonly rungTool: RungTool;
  readonly selectObjects: (objs: number[], toggle: boolean) => void;
  readonly seq: (p: Pattern) => Sequence;
  readonly setEditing: (on: boolean) => void;
  readonly setLetterMode: (on: boolean) => void;
  readonly settings: Settings;
  readonly shapeTool: ShapeTool;
  readonly stage: HTMLElement;
  readonly transformLettering: (m: Mat) => void;
  readonly updateLevel: () => void;
}

/** Drawing new shapes (rectangle, ellipse, pen, freehand) and the frame that moves, scales and turns objects. */
export function bindDrawing(app: DrawingApp) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  /** A thread for the first shape of a new design: a Brother orange, clear on dark and light fabric. */
  const FIRST_THREAD: ThreadColor = nearestThread(rgbToLab(240, 140, 40)).thread;

  const drawTool = new DrawTool({ done: (s) => void drawn(s), redraw: app.redraw });

  /** Picks a drawing tool, or none (the pointer). Drawing belongs to the level Form. The tool rail runs it (src/areas/shapes). */
  function setDrawing(kind: DrawKind | null): void {
    if (kind && app.settings.mode !== 'flow') return;
    if (kind) {
      ui.formLevel = true;
      if (app.editor.active) app.setEditing(false);
      if (app.shapeTool.active) app.closeShape();
      if (app.rungTool.active) app.closeRungs();
      if (ui.letterMode) app.setLetterMode(false);
    }
    drawTool.start(kind);
    app.stage.classList.toggle('drawing', !!kind);
    if (!kind) app.openSelectedForm();
    app.updateLevel();
    app.redraw();
  }

  /** A shape is drawn: sewn in the thread of the selected object right after it, else after the last one. */
  /** No stitches yet. */
  const EMPTY: Pattern = { x: new Int32Array(0), y: new Int32Array(0), cmd: new Uint8Array(0), colors: [] } as unknown as Pattern;

  /** The first shape of a new design; a line keeps its curves to be sewn along. */
  function firstShape(shape: NewShape, options: ReturnType<typeof digitizeDefaults> & { trimMm: number }): Digitized | null {
    const line = shape.kind === 'stroke' ? addShape(EMPTY, shape, FIRST_THREAD, null, options) : null;
    if (line) return { pattern: line.pattern, objects: [{ kind: 'run', label: 0, areaMm2: 0, path: shape.form }], starts: [0] };
    const d = digitizeShapes([{ color: 0, ...shape }], [FIRST_THREAD], options, { w: 0, h: 0 }, false, 'shape');
    return d.objects.length ? d : null;
  }

  async function drawn(shape: NewShape): Promise<void> {
    const f = app.files.active;
    const p = f?.pattern ?? null;
    const options = { ...digitizeDefaults(app.settings.profile), trimMm: app.settings.trimMm };
    if (!f || !p) {
      // Nothing open yet: the shape starts a new design.
      const d = firstShape(shape, options);
      if (!d) return app.layers.say(t('draw.failed'), true);
      ui.keepView = true;
      // Back to the pointer: the new shape is chosen, ready to be moved or shaped.
      setDrawing(null);
      await app.addDigitized(d, t('draw.newName'));
      ui.keepView = false;
      app.selectObjects([0], false);
      return;
    }
    const q = app.seq(p);
    const sel = [...ui.selectedObjects].sort((a, b) => a - b);
    const after = sel.length ? sel[sel.length - 1] : q.objects.length ? q.objects.length - 1 : null;
    const color = after !== null ? q.objects[after].color : FIRST_THREAD;
    const r = addShape(p, shape, color, after, options);
    if (!r) return app.layers.say(t('draw.failed'), true);
    app.applyEdit(r.pattern);
    app.files.setObjects(f, rememberedIn(r.pattern, app.seq(r.pattern).objects));
    const nq = app.seq(r.pattern);
    const mine = nq.objects.findIndex((o) => stitchesBefore(r.pattern, o.first) === r.start);
    app.followKnockouts();
    setDrawing(null);
    if (mine >= 0) app.selectObjects([mine], false);
    app.layers.say(t(shape.kind === 'fill' ? 'draw.done.fill' : 'draw.done.line'));
    app.redraw();
  }

  // The card that offers leaving out what lies on top, when shapes overlap (never done unasked).
  let overlapCache: { p: Pattern; list: number[] } | null = null;
  /** Files whose overlaps the user chose to keep as they are. */
  const overlapKept = new WeakSet<object>();

  function overlapping(p: Pattern): number[] {
    if (overlapCache?.p !== p) overlapCache = { p, list: overlapsIn(p, app.seq(p).objects) };
    return overlapCache.list;
  }

  function updateOverlapCard(): void {
    const f = app.files.active;
    const p = f?.pattern;
    const list = f && p && app.settings.mode === 'flow' && !overlapKept.has(f) && !app.shapeTool.active ? overlapping(p) : [];
    const card = $('overlap-card');
    card.hidden = !list.length;
    if (list.length) $('overlap-text').textContent = t(list.length === 1 ? 'knockout.card.one' : 'knockout.card', { n: formatNumber(list.length) });
  }

  $('overlap-cut').addEventListener('click', () => {
    const p = app.files.active?.pattern;
    if (p) knockoutObjects(overlapping(p), true);
  });
  $('overlap-keep').addEventListener('click', () => {
    if (app.files.active) overlapKept.add(app.files.active);
    app.layers.say(t('knockout.card.kept'));
    app.redraw();
  });

  /** Turns leaving out what lies on top on or off for the objects `which`, as one undo step. */
  function knockoutObjects(which: number[], on: boolean): void {
    const f = app.files.active;
    const p = f?.pattern;
    if (!f || !p) return;
    const r = setKnockout(p, which, on, app.settings.trimMm);
    if (!r) return;
    const sel = ui.selectedObjects;
    app.applyEdit(r.pattern);
    app.files.setObjects(f, rememberedIn(r.pattern, app.seq(r.pattern).objects));
    ui.selectedObjects = sel;
    ui.selectionKey++;
    app.layers.say(t(on ? 'knockout.done' : 'knockout.undone', { n: formatNumber(r.changed) }) + ' ' + t('object.undo'));
    app.redraw();
  }

  // The frame around the one selected object (level Objects): move, turn, scale.
  let frameFrame = 0;
  let pendingFrame: Mat | null = null;

  const frameTool = new FrameTool({
    change: (m, final) => {
      if (final) {
        pendingFrame = null;
        cancelAnimationFrame(frameFrame);
        frameFrame = 0;
        ui.flowPreview = null;
        return commitTransform(m);
      }
      pendingFrame = m;
      if (frameFrame) return;
      frameFrame = requestAnimationFrame(() => {
        frameFrame = 0;
        const p = app.files.active?.pattern;
        // The stitches dragged along as they are; scaling sews them anew when let go. The last
        // object first, so the records of the ones before stay where they are.
        let next = p ?? null;
        if (p && pendingFrame) for (const o of frameObjects().reverse()) next = transformObject(next!, app.seq(p).objects[o], pendingFrame).pattern;
        ui.flowPreview = next !== p ? next : null;
        app.redraw();
      });
    },
  });

  /** The objects the frame is on: the selected ones in the Ablauf mode, levels Form and Objects (in sewing order). */
  function frameObjects(): number[] {
    if (app.settings.mode !== 'flow' || !ui.selectedObjects.size || app.editor.active || drawTool.active || app.rungTool.active || app.orderCard.isOpen || ui.letterMode) return [];
    const n = app.files.active?.pattern ? app.seq(app.files.active.pattern).objects.length : 0;
    return [...ui.selectedObjects].filter((o) => o < n).sort((a, b) => a - b);
  }

  /** Puts the frame around the selected objects (or takes it away). */
  let frameKey: { p: Pattern; sel: ReadonlySet<number> } | null = null;
  function syncFrame(): void {
    const p = app.files.active?.pattern;
    const sel = frameObjects();
    if (!p || !sel.length) {
      if (frameTool.active) frameTool.close();
      frameKey = null;
      return;
    }
    if (frameTool.dragging !== null || (frameTool.active && frameKey?.p === p && frameKey.sel === ui.selectedObjects)) return;
    frameKey = { p, sel: ui.selectedObjects };
    const q = app.seq(p);
    const objs = sel.map((o) => q.objects[o]);
    const box = {
      minX: Math.min(...objs.map((o) => o.minX)) / 10,
      minY: Math.min(...objs.map((o) => o.minY)) / 10,
      maxX: Math.max(...objs.map((o) => o.maxX)) / 10,
      maxY: Math.max(...objs.map((o) => o.maxY)) / 10,
    };
    frameTool.open(box, objs.every((o) => scaleBlocked(p, o, q.kinds) === null), snapTargets(q.objects.filter((o) => !ui.selectedObjects.has(o.index))));
  }

  /** What a moved selection snaps to: the edges and middles of the other objects, and the middle of them all. */
  function snapTargets(others: { minX: number; minY: number; maxX: number; maxY: number }[]): SnapTargets | null {
    if (!others.length) return null;
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (const o of others) {
      for (const v of [o.minX, (o.minX + o.maxX) / 2, o.maxX]) xs.add(v / 10);
      for (const v of [o.minY, (o.minY + o.maxY) / 2, o.maxY]) ys.add(v / 10);
    }
    // The middle of the rest is where the hoop's middle will be.
    xs.add((Math.min(...others.map((o) => o.minX)) + Math.max(...others.map((o) => o.maxX))) / 20);
    ys.add((Math.min(...others.map((o) => o.minY)) + Math.max(...others.map((o) => o.maxY))) / 20);
    return { xs: [...xs], ys: [...ys] };
  }

  /**
   * The selected objects (or `objs`, the selection staying as it is) moved, turned or scaled by `m`
   * together (one undo step). False when that did not work.
   */
  function commitTransform(m: Mat, objs?: number[]): boolean {
    const f = app.files.active;
    const p = f?.pattern;
    const sel = objs ?? frameObjects();
    if (!f || !p || !sel.length) {
      app.redraw();
      return false;
    }
    // A lettering keeps its text: it is set anew where the frame put it.
    if (ui.lettering && !objs) {
      app.transformLettering(m);
      return true;
    }
    const kept = ui.selectedObjects;
    let cur = p;
    let hand = 0;
    let restitched = false;
    // The last object first: the ones before keep their records. The objects stay as many as they were.
    for (const o of [...sel].reverse()) {
      const q = app.seq(cur);
      const obj = q.objects[o];
      hand += remembered(cur, obj)?.hand ?? 0;
      const r = obj && transformSewObject(cur, q.objects, obj, q.kinds, m, app.settings.trimMm);
      if (!r) {
        app.layers.say(t('frame.failed'), true);
        app.redraw();
        return false;
      }
      restitched ||= r.restitched;
      cur = r.pattern;
    }
    // Borders in a thread of their own go along (sewn anew on the moved area).
    const keys = new Set(sel.map((o) => objectKey(cur, app.seq(cur).objects[o])));
    const synced = syncBorders(cur, app.settings.trimMm);
    app.applyEdit(synced);
    const nq = app.seq(synced);
    app.files.setObjects(f, rememberedIn(synced, nq.objects));
    const same = nq.objects.length === app.seq(p).objects.length;
    if (objs) ui.selectedObjects = same ? kept : new Set();
    else ui.selectedObjects = synced !== cur ? new Set(nq.objects.flatMap((o, i) => (keys.has(objectKey(synced, o)) ? [i] : []))) : same ? new Set(sel) : new Set();
    ui.selectionKey++;
    if (restitched && hand) app.layers.say(t('shape.handReplaced', { n: formatNumber(hand) }));
    app.followKnockouts();
    app.redraw();
    return true;
  }

  return { commitTransform, drawTool, frameObjects, frameTool, knockoutObjects, setDrawing, syncFrame, updateOverlapCard };
}
