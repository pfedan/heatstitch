import type { Editor } from '../ui/editor';
import type { FileList } from '../ui/fileList';
import type { LayersPanel } from '../ui/layersPanel';
import type { LeftOut } from '../ui/imageMode';
import { compose, type Mat } from '../shape/path';
import type { Measurement } from '../validation/measure';
import type { OrderCard } from '../ui/objectPanel';
import type { RungTool } from '../ui/rungTool';
import type { Sequence } from './types';
import type { Settings } from '../settings';
import type { ShapeTool } from '../ui/shapeTool';
import type { ThreadColor, Pattern } from '../model/pattern';
import type { Pt } from '../digitize/skeleton';
import { DrawTool, type DrawKind, type GapLook } from '../ui/drawTool';
import { FrameTool, type ContourGrip, type SnapTargets } from '../ui/frameTool';
import { digitizeDefaults, type Digitized, digitizeShapes } from '../digitize/digitize';
import { nearestThread } from '../image/prepare';
import { coveredPart, overlapsIn, setKnockout } from '../model/knockout';
import { outline } from '../digitize/region';
import { unionOf } from '../shape/rasterize';
import { rememberedIn, objectKey } from '../model/restitch';
import { rgbToLab } from '../image/color';
import { transformObjects, type TransformedAll } from '../model/reshape';
import { isRigid, stitchesBefore, transformObject } from '../model/transform';
import { LiveResew, type LiveResult } from '../resew/client';
import { syncBorders } from '../model/border';
import { canSplit, splitFill } from '../model/splitFill';
import { gapFinder, type GapMode, type GapResult } from '../shape/ops';
import { gapPlace, obstaclesOf } from '../model/gapFill';
import type { Obstacle } from '../shape/ops';
import { t, formatNumber } from '../i18n';
import { type NewShape, addShape } from '../model/addShape';
import { ui } from './state';

/** Gap between the frame and the outline on the level Form, CSS pixels: its corner handles beside a node, not on it. */
const FORM_FRAME_PAD_PX = 12;

/** The map undoing `m`. */
const invert = (m: Mat): Mat => {
  const d = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / d;
  const b = -m[1] / d;
  const c = -m[2] / d;
  const e = m[0] / d;
  return [a, b, c, e, -(a * m[4] + c * m[5]), -(b * m[4] + e * m[5])];
};

/** A map too close to doing nothing to be worth applying. */
const nearIdentity = (m: Mat): boolean =>
  Math.abs(m[0] - 1) < 1e-6 && Math.abs(m[3] - 1) < 1e-6 && Math.abs(m[1]) < 1e-6 && Math.abs(m[2]) < 1e-6 && Math.abs(m[4]) < 1e-3 && Math.abs(m[5]) < 1e-3;

/** What bindDrawing needs from the rest of the app. */
export interface DrawingApp {
  readonly addDigitized: (d: Digitized & { leftOut?: LeftOut[] | undefined; }, name: string) => Promise<void>;
  readonly applyEdit: (p: Pattern, measurement?: Measurement | undefined) => void;
  readonly closeRungs: () => void;
  readonly closeShape: () => void;
  readonly contourGrip: (p: Pattern, q: Sequence, o: number) => (ContourGrip & { d: number }) | null;
  readonly setContourGap: (d: number, final: boolean) => boolean;
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

  const drawTool = new DrawTool({ done: (s) => void drawn(s), cut: (line) => cutSelected(line), gapAt: (x, y) => gapLook(x, y), gap: (look) => gapMade(look), redraw: app.redraw });

  // Flächen-Werkzeug: the shapes shown, and the free parts between them, worked out once per design,
  // shown blocks, gap and mode; the pointer only looks up the part it is in.
  let obstacleCache: { p: Pattern; hidden: ReadonlySet<number>; list: Obstacle[] } | null = null;
  let finderCache: { obstacles: Obstacle[]; d: number; mode: GapMode; at: (q: Pt) => GapResult } | null = null;
  function shownObstacles(p: Pattern): Obstacle[] {
    if (obstacleCache?.p !== p || obstacleCache.hidden !== ui.hiddenBlocks) {
      const objs = app.seq(p).objects.filter((o) => !ui.hiddenBlocks.has(o.block));
      obstacleCache = { p, hidden: ui.hiddenBlocks, list: obstaclesOf(p, objs) };
    }
    return obstacleCache.list;
  }
  function gapLook(x: number, y: number): GapLook | null {
    const p = app.files.active?.pattern;
    if (!p) return null;
    const obstacles = shownObstacles(p);
    const d = drawTool.gapMm;
    const mode = drawTool.gapMode;
    if (finderCache?.obstacles !== obstacles || finderCache.d !== d || finderCache.mode !== mode) finderCache = { obstacles, d, mode, at: gapFinder(obstacles, d, mode) };
    return finderCache.at([x, y]);
  }
  /** A click of the Flächen-Werkzeug: the area there a new fill, sewn before the shapes around it (or, wrapped, under it). */
  function gapMade(look: GapLook): void {
    if ('none' in look) {
      if (look.none === 'outside' && drawTool.gapMode === 'closed')
        return app.layers.say({ text: t('shapes.gap.outside'), action: { label: t('shapes.gap.hull'), run: () => setGapMode('hull') } });
      return app.layers.say(t(look.none === 'outside' ? 'shapes.gap.outside' : look.none === 'empty' ? 'shapes.gap.empty' : 'shapes.gap.covered'), true);
    }
    const p = app.files.active?.pattern;
    if (!p) return;
    const obstacles = shownObstacles(p);
    const shown = app.seq(p).objects.filter((o) => !ui.hiddenBlocks.has(o.block));
    const k = gapPlace(look.form, obstacles, drawTool.gapMm + 0.5);
    // Before that object in the whole list (hidden blocks count too).
    const after = k === null ? null : shown[k].index - 1;
    void drawn({ form: look.form, kind: 'fill' }, { after, keepTool: true, done: drawTool.gapMode === 'wrap' ? 'draw.done.wrap' : 'draw.done.gap', fillOnly: true });
  }
  /** Switches the Flächen-Werkzeug between shapes all round, the convex hull, and the hull as a shape. */
  function setGapMode(mode: GapMode): void {
    drawTool.gapMode = mode;
    drawTool.preview = null;
    drawTool.gapNone = null;
    app.redraw();
  }

  /** Picks a drawing tool, or none (the pointer). Drawing belongs to the level Form. The tool rail runs it (src/areas/shapes). */
  function setDrawing(kind: DrawKind | null): void {
    if (kind && app.settings.mode !== 'flow') return;
    // Zerteilen works on the selected fills where they are: the level and the selection stay.
    if (kind === 'cut' && !cuttable().length) return app.layers.say(t('cut.none'), true);
    if (kind) {
      if (kind !== 'cut') ui.formLevel = true;
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

  /** The selected objects that are fills that can be cut apart. */
  function cuttable(): number[] {
    const p = app.files.active?.pattern;
    return p ? [...ui.selectedObjects].filter((o) => canSplit(p, o)) : [];
  }

  /**
   * The selected fills cut along `line` (world mm), as one undo step: each part an object of its own
   * with its own row direction, the parts selected after it (so a next cut can go on).
   */
  function cutSelected(line: Pt[]): void {
    const f = app.files.active;
    const p = f?.pattern;
    if (!f || !p) return;
    const fills = cuttable().sort((a, b) => b - a);
    if (!fills.length) return app.layers.say(t('cut.none'), true);
    let cur = p;
    let sel = [...ui.selectedObjects];
    let parts = 0;
    let plain = 0;
    // The last fill first, so the ones before keep their place; what comes after moves on by the new parts.
    for (const o of fills) {
      const r = splitFill(cur, o, [line], app.settings.trimMm);
      if (r === 'whole') continue;
      if (!r) return app.layers.say(t('cut.failed'), true);
      const added = app.seq(r.pattern).objects.length - app.seq(cur).objects.length;
      sel = sel.flatMap((s) => (s > o ? [s + added] : s === o ? r.parts : [s]));
      parts += r.parts.length;
      plain += r.plain;
      cur = r.pattern;
    }
    if (cur === p) return app.layers.say(t('cut.whole'), true);
    const synced = syncBorders(cur, app.settings.trimMm);
    app.applyEdit(synced);
    app.files.setObjects(f, rememberedIn(synced, app.seq(synced).objects));
    ui.selectedObjects = new Set(sel);
    ui.selectionKey++;
    app.followKnockouts();
    app.layers.say(`${t('cut.done', { n: formatNumber(parts) })}${plain ? ` ${t('cut.plain', { n: formatNumber(plain) })}` : ''} ${t('object.undo')}`);
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

  async function drawn(shape: NewShape, how: { after?: number | null; keepTool?: boolean; done?: 'draw.done.gap' | 'draw.done.wrap'; fillOnly?: boolean } = {}): Promise<void> {
    const f = app.files.active;
    const p = f?.pattern ?? null;
    // A filled gap is a background: a fill, never a satin, however narrow it is.
    const options = { ...digitizeDefaults(app.settings.profile), trimMm: app.settings.trimMm, ...(how.fillOnly ? { satinMin: 0, satinMax: 0 } : {}) };
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
    const last = sel.length ? sel[sel.length - 1] : q.objects.length ? q.objects.length - 1 : null;
    const after = how.after !== undefined ? how.after : last;
    // The thread of the selected object (or the last one); a gap's fill takes it too.
    const color = last !== null ? q.objects[last].color : FIRST_THREAD;
    const r = addShape(p, shape, color, after, options);
    if (!r) return app.layers.say(t('draw.failed'), true);
    app.applyEdit(r.pattern);
    app.files.setObjects(f, rememberedIn(r.pattern, app.seq(r.pattern).objects));
    const nq = app.seq(r.pattern);
    const mine = nq.objects.findIndex((o) => stitchesBefore(r.pattern, o.first) === r.start);
    app.followKnockouts();
    // The Flächen-Werkzeug stays on for the next gap; the new fill is selected all the same.
    if (!how.keepTool) setDrawing(null);
    if (mine >= 0) app.selectObjects([mine], false);
    app.layers.say(t(how.done ?? (shape.kind === 'fill' ? 'draw.done.fill' : 'draw.done.line')));
    app.redraw();
  }

  // The card that offers leaving out what lies on top, when shapes overlap (never done unasked).
  let overlapCache: { p: Pattern; list: number[]; lines?: Pt[][] } | null = null;
  /** Files whose overlaps the user chose to keep as they are. */
  const overlapKept = new WeakSet<object>();

  function overlapping(p: Pattern): number[] {
    if (overlapCache?.p !== p) overlapCache = { p, list: overlapsIn(p, app.seq(p).objects) };
    return overlapCache.list;
  }

  /** Where the fills of the card are sewn twice (mm): what leaving out would take away. */
  function overlapLines(p: Pattern): Pt[][] {
    const c = overlapCache!;
    if (!c.lines) {
      const objs = app.seq(p).objects;
      // As one area: where several fills lie under the same one, their parts overlap.
      const all = unionOf(c.list.map((i) => coveredPart(p, objs, objs[i])).filter((r) => !!r));
      c.lines = all ? outline(all) : [];
    }
    return c.lines;
  }

  /** The pointer is on the card (or it was tapped), or the focus is in it: the overlaps are marked. */
  let cardHot = { pointer: false, focus: false };

  function updateOverlapCard(): void {
    const f = app.files.active;
    const p = f?.pattern;
    const list = f && p && app.settings.mode === 'flow' && !overlapKept.has(f) && !app.shapeTool.active ? overlapping(p) : [];
    const card = $('overlap-card');
    card.hidden = !list.length;
    if (list.length) $('overlap-text').textContent = t(list.length === 1 ? 'knockout.card.one' : 'knockout.card', { n: formatNumber(list.length) });
    if (!list.length) cardHot = { pointer: false, focus: false };
    const lines = list.length && (cardHot.pointer || cardHot.focus) ? overlapLines(p!) : null;
    const was = ui.overlapMarks;
    ui.overlapMarks = lines ? { p: p!, lines } : null;
    // The card is brought up to date after the canvas is drawn: drawn again when its marks changed.
    if ((was?.lines ?? null) !== lines) app.redraw();
  }

  /** Marks the overlaps on the canvas or takes the marks away as the card is pointed at. */
  function heatCard(what: keyof typeof cardHot, on: boolean): void {
    if (cardHot[what] === on) return;
    cardHot = { ...cardHot, [what]: on };
    updateOverlapCard();
  }
  const overlapCard = $('overlap-card');
  overlapCard.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && heatCard('pointer', true));
  overlapCard.addEventListener('pointerleave', (e) => e.pointerType !== 'touch' && heatCard('pointer', false));
  // On touch there is no pointing: tapping the text shows the overlaps, tapping again hides them.
  $('overlap-text').addEventListener('pointerup', (e) => e.pointerType === 'touch' && heatCard('pointer', !cardHot.pointer));
  overlapCard.addEventListener('focusin', () => heatCard('focus', true));
  overlapCard.addEventListener('focusout', (e) => !overlapCard.contains(e.relatedTarget as Node | null) && heatCard('focus', false));

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
  // Scaling is sewn anew in a worker while dragging; the newest result back, shown stretched by what
  // the frame did since (nothing, once the pointer rests).
  let live: LiveResult | null = null;
  let asked: Mat | null = null;
  const resewer = new LiveResew((r) => {
    if (frameTool.dragging === null || r.from !== app.files.active?.pattern) return;
    live = r;
    showFrame();
  });

  /** The selection as the frame has it now, in the next frame of the screen. */
  function showFrame(): void {
    if (frameFrame) return;
    frameFrame = requestAnimationFrame(() => {
      frameFrame = 0;
      const p = app.files.active?.pattern;
      const m = pendingFrame;
      if (!p || !m) return;
      const objs = frameObjects();
      // A lettering is set anew when let go, the rest is sewn anew as it grows.
      const scales = !isRigid(m) && !ui.lettering;
      if (scales && m !== asked) resewer.ask(p, objs, m, app.settings.trimMm);
      asked = m;
      // From the newest stitches sewn for this drag, else the ones there were.
      const base = scales && live?.from === p ? live.pattern : p;
      const map = base === p ? m : compose(m, invert(live!.m));
      // The stitches dragged along as they are (scaling sews them anew when let go, or before). The
      // last object first, so the records of the ones before stay where they are.
      const at = app.seq(base).objects;
      let next = base;
      if (!nearIdentity(map)) for (const o of [...objs].reverse()) next = transformObject(next, at[o], map).pattern;
      ui.flowPreview = next !== p ? next : null;
      app.redraw();
    });
  }

  const frameTool = new FrameTool({
    gap: (d, final) => void app.setContourGap(d, final),
    pad: () => (app.shapeTool.active ? FORM_FRAME_PAD_PX : 0),
    change: (m, final) => {
      if (final) {
        pendingFrame = null;
        cancelAnimationFrame(frameFrame);
        frameFrame = 0;
        ui.flowPreview = null;
        resewer.stop();
        const last = live;
        live = null;
        asked = null;
        return isRigid(m) || ui.lettering || resewer.failed ? commitTransform(m) : commitScaled(m, last);
      }
      pendingFrame = m;
      showFrame();
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
    frameTool.open(box, snapTargets(q.objects.filter((o) => !ui.selectedObjects.has(o.index))));
    const grip = sel.length === 1 ? app.contourGrip(p, q, sel[0]) : null;
    frameTool.gap = grip;
    if (grip) frameTool.gapValue = grip.d;
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

  // Scalings let go are sewn in the worker, one after the other: a large design takes seconds and
  // the page stays usable meanwhile, the scaled stitches shown as dragged until the new ones come.
  let scaling: Promise<unknown> = Promise.resolve();
  let scalings = 0;

  /** The frame's scaling `m` let go, sewn anew in the worker; `last`, the newest stitches it sewed while dragging. */
  function commitScaled(m: Mat, last: LiveResult | null): boolean {
    const f = app.files.active;
    const p = f?.pattern;
    const sel = frameObjects();
    if (!f || !p || !sel.length) {
      app.redraw();
      return false;
    }
    // Until the new stitches come: the ones sewn while dragging, stretched by what the frame did since.
    const base = last?.from === p ? last.pattern : p;
    const map = base === p ? m : compose(m, invert(last!.m));
    const at = app.seq(base).objects;
    let shown = base;
    if (!nearIdentity(map)) for (const o of [...sel].reverse()) shown = transformObject(shown, at[o], map).pattern;
    ui.flowPreview = shown;
    scalings++;
    document.body.classList.add('sew-busy');
    app.redraw();
    scaling = scaling.then(async () => {
      // A scaling let go while one before was still sewn applies to the design that one made.
      const from = app.files.active === f ? f.pattern : null;
      const now = from === p ? sel : from ? frameObjects() : [];
      const r = from && now.length ? await resewer.commit(from, now, m, app.settings.trimMm) : null;
      if (--scalings === 0) document.body.classList.remove('sew-busy');
      if (ui.flowPreview === shown) ui.flowPreview = null;
      // Something else changed the design meanwhile (undo, another edit): that one stays.
      if (!from || app.files.active !== f || f.pattern !== from) return app.redraw();
      if (!r) {
        // The worker stopped: sewn here, rather than not at all.
        if (resewer.failed) return void commitTransform(m);
        app.layers.say(t('frame.failed'), true);
        return app.redraw();
      }
      applyTransformed(f, from, now, ui.selectedObjects, false, r);
    });
    return true;
  }

  /**
   * The selected objects (or `objs`, the selection staying as it is) moved, turned or scaled by `m`
   * together (one undo step). `done` is that already worked out (see fitScaling). False when that did not work.
   */
  function commitTransform(m: Mat, objs?: number[], done?: TransformedAll): boolean {
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
    // The objects stay as many as they were.
    // A core call that failed (out of memory on a huge design) loses this transform only.
    let r: TransformedAll | null;
    try {
      r = done ?? transformObjects(p, sel, m, app.settings.trimMm, app.seq);
    } catch (e) {
      console.error(e);
      r = null;
    }
    if (!r) {
      app.layers.say(t('frame.failed'), true);
      app.redraw();
      return false;
    }
    const { pattern: cur, hand, restitched, stretched } = r;
    // Borders in a thread of their own go along (sewn anew on the moved area).
    const keys = new Set(sel.map((o) => objectKey(cur, app.seq(cur).objects[o])));
    const synced = syncBorders(cur, app.settings.trimMm);
    const moved = synced !== cur ? app.seq(synced).objects.flatMap((o, i) => (keys.has(objectKey(synced, o)) ? [i] : [])) : null;
    applyTransformed(f, p, sel, kept, !!objs, { pattern: synced, hand, restitched, stretched, moved });
    return true;
  }

  /** A transform of the objects `sel` of `p` worked out (`r`, borders along) taken over as one undo step. */
  function applyTransformed(f: NonNullable<typeof app.files.active>, p: Pattern, sel: number[], kept: ReadonlySet<number>, keep: boolean, r: { pattern: Pattern; hand: number; restitched: boolean; stretched: number; moved: number[] | null }): void {
    const synced = r.pattern;
    app.applyEdit(synced);
    const nq = app.seq(synced);
    app.files.setObjects(f, rememberedIn(synced, nq.objects));
    const same = nq.objects.length === app.seq(p).objects.length;
    if (keep) ui.selectedObjects = same ? kept : new Set();
    else ui.selectedObjects = r.moved ? new Set(r.moved) : same ? new Set(sel) : new Set();
    ui.selectionKey++;
    if (r.restitched && r.hand) app.layers.say(t('shape.handReplaced', { n: formatNumber(r.hand) }));
    else if (r.stretched) app.layers.say(t(r.stretched === 1 ? 'frame.stretched.one' : 'frame.stretched', { n: formatNumber(r.stretched) }));
    app.followKnockouts();
    app.redraw();
  }

  return { commitTransform, drawTool, frameObjects, frameTool, knockoutObjects, setDrawing, setGapMode, syncFrame, updateOverlapCard };
}
