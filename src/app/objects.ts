import { syncBorders } from '../model/border';
import type { AsideRole } from '../model/aside';
import type { DrawTool } from '../ui/drawTool';
import type { Editor } from '../ui/editor';
import { FileList } from '../ui/fileList';
import { ColorList } from '../ui/colorList';
import { scaling, translation, type Form, type Mat } from '../shape/path';
import type { Lettering } from '../lettering/layout';
import type { Measurement } from '../validation/measure';
import type { Pattern } from '../model/pattern';
import type { RungTool } from '../ui/rungTool';
import type { Sequence } from './types';
import type { Settings } from '../settings';
import type { ShapeTool } from '../ui/shapeTool';
import { LayersPanel, kindLabel, blockName } from '../ui/layersPanel';
import { ObjectPanel, type ObjectInfo, type OrderCard } from '../ui/objectPanel';
import { menuAt, objectMenu } from '../ui/objectMenu';
import { colorMenuItems, registerObjectCommands, type Shift } from '../areas/objects/commands';
import { addObjectIcons } from '../areas/objects/icons';
import '../areas/objects/objects.css';
import { numberInColor, rememberObjects, type SewObject, splitObject } from '../model/objects';
import { sameColor } from '../model/recolor';
import { recordOfStitch } from '../model/sequence';
import { remembered, rememberedIn, measureFill, analyze, unionRegion, remember, restitch, type RestitchResult } from '../model/restitch';
import { isLine, reverseLines, reversible, reverseObjects } from '../model/reverse';
import { formatNumber, t, type Key } from '../i18n';
import { ui } from './state';
import { unionForm, recolorObjects } from '../model/shapeOps';
import { blendObject } from '../model/blend';
import { recolorBlock, takeThreads } from '../model/border';
import { violations, conflicts, reorder } from '../model/order';
import { wholeArea } from '../model/knockout';

/** What bindObjects needs from the rest of the app. */
export interface ObjectsApp {
  readonly applyEdit: (p: Pattern, measurement?: Measurement | undefined) => void;
  readonly applyRestitched: (r: RestitchResult | null, failed: Key, remeasure?: boolean) => void;
  readonly closeRungs: () => void;
  readonly closeShape: () => void;
  readonly commitTransform: (m: Mat) => void;
  readonly deleteSelected: () => void;
  readonly drawTool: DrawTool;
  readonly duplicateSelected: () => void;
  readonly editor: Editor;
  readonly enterShape: (o: number, fit: boolean) => void;
  readonly files: FileList;
  readonly followKnockouts: () => void;
  readonly frameObjects: () => number[];
  readonly history: (step: 'undo' | 'redo' | 'revert') => void;
  readonly knockoutObjects: (which: number[], on: boolean) => void;
  readonly letteringsOf: (p: Pattern, q: Sequence) => (Lettering | undefined)[];
  readonly mirrorSelected: (axis: 'x' | 'y') => void;
  readonly objectInfo: (p: Pattern, q: Sequence) => ObjectInfo;
  readonly orderCard: OrderCard;
  readonly orderStats: (p: Pattern) => { colorChanges: number; trims: number; travelMm: number; };
  readonly overOf: (q: Sequence, p: Pattern) => number[][];
  readonly putAside: (role: AsideRole) => void;
  readonly redraw: () => void;
  readonly rungTool: RungTool;
  readonly seq: (p: Pattern) => Sequence;
  readonly setEditing: (on: boolean) => void;
  readonly settings: Settings;
  readonly shapeTarget: (p: Pattern, q: Sequence, o: number) => Form | null;
  readonly showBand: (p: Pattern, q: Sequence, o: number) => void;
  readonly shapeTool: ShapeTool;
  readonly showObjectMenu: (o: number, clientX: number, clientY: number) => boolean;
  readonly subtractSelected: () => void;
  readonly takeShapes: (next: Pattern, select: number[]) => void;
  readonly updateLevel: () => void;
}

/**
 * The object list of Gestalten and what it does with the objects (select, move, merge, reverse,
 * split), the object page, and the commands of all object actions (src/areas/objects/commands.ts).
 */
export function bindObjects(app: ObjectsApp) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  addObjectIcons();

  function toggleBlock(b: number): void {
    const next = new Set(ui.hiddenBlocks);
    if (!next.delete(b)) next.add(b);
    ui.hiddenBlocks = next;
    if (ui.focusBlock === b) ui.focusBlock = null;
    app.redraw();
  }

  function focusBlock(b: number | null, sticky: boolean): void {
    if (sticky) {
      ui.focusBlock = b;
      ui.hoverBlock = null;
    } else ui.hoverBlock = b;
    app.redraw();
  }

  function showAll(): void {
    ui.hiddenBlocks = new Set();
    ui.focusBlock = ui.hoverBlock = null;
    app.redraw();
  }

  const layers = new LayersPanel({
    toggle: toggleBlock,
    focus: focusBlock,
    showAll,
    // Only the colors change, so the density measurement still holds.
    recolor: (b, color) => {
      const f = app.files.active;
      if (!f?.pattern) return;
      app.applyEdit(recolorBlock(f.pattern, b, color), f.measurement);
      layers.say({ text: t('objects.recolored'), undo: undoable() });
    },
    select: (objs, toggle) => selectObjects(objs, toggle),
    hover: (o) => {
      if (ui.hoverObject === o) return;
      ui.hoverObject = o;
      app.redraw();
    },
    move: (order, moved, into) => moveObjects(order, moved, into),
    menu: (o, x, y) => void app.showObjectMenu(o, x, y),
    colorMenu: (b, at) => colorMenu(b, at),
  });

  /** Name of an object as the list shows it: kind and number within its color. */
  function objectName(q: Sequence, i: number): string {
    const o = q.objects[i];
    const k = numberInColor(q.objects, o);
    return `${kindLabel(o.kind)} ${k} (${blockName({ index: o.block, color: o.color })})`;
  }

  /**
   * What a new order puts on top that lay underneath before (null: nothing): the first moved object
   * sewn before something it lies on, or after something lying on it, and whether it is covered now.
   */
  function coverConflict(q: Sequence, p: Pattern, order: number[], moved: ReadonlySet<number>): { a: number; c: number; covered: boolean } | null {
    const over = app.overOf(q, p);
    const bad = violations(order, over);
    if (!bad.length) return null;
    const a = order[bad.find((k) => moved.has(order[k])) ?? bad[0]];
    const c = conflicts(order, over, a)[0];
    // `a` lies on `c` but now comes first: `c` covers it. Otherwise `a` now covers `c`.
    return c === undefined ? null : { a, c, covered: over[a].includes(c) };
  }

  /** The warning for a conflict, with the objects named by `name` (as the list shows them after the edit). */
  function coverWarning(w: { a: number; c: number; covered: boolean } | null, name: (o: number) => string): string | null {
    if (!w) return null;
    return t(w.covered ? 'object.coveredBy' : 'object.covers', { a: name(w.a), b: name(w.c) });
  }

  function selectObjects(objs: number[], toggle: boolean): void {
    let next: Set<number>;
    if (toggle) {
      next = new Set(ui.selectedObjects);
      for (const o of objs) if (!next.delete(o)) next.add(o);
    } else next = new Set(objs);
    // A lettering is chosen as a whole: all its objects, or none of them.
    const p0 = app.files.active?.pattern;
    if (p0) {
      const q0 = app.seq(p0);
      const all = app.letteringsOf(p0, q0);
      for (const o of objs) {
        const id = all[o]?.id;
        if (!id) continue;
        all.forEach((l, k) => {
          if (l?.id !== id) return;
          if (next.has(o)) next.add(k);
          else next.delete(k);
        });
      }
    }
    ui.selectedObjects = next;
    ui.selectionKey++;
    ui.flowPreview = null;
    if (next.size) ui.focusBlock = null;
    if (app.rungTool.active && (next.size !== 1 || !next.has(ui.rungObject!))) app.closeRungs();
    // Level Form: the one selected object shows its outline (another one chosen goes on with that one's).
    if ((app.shapeTool.active || ui.formLevel) && (next.size !== 1 || !next.has(ui.shapeObject!))) {
      const one = next.size === 1 ? [...next][0] : null;
      const p = app.files.active?.pattern;
      const form = one !== null && p && ui.formLevel && !ui.letterMode && !app.drawTool.active ? app.shapeTarget(p, app.seq(p), one) : null;
      if (form && one !== null && p) {
        app.shapeTool.open(form);
        app.showBand(p, app.seq(p), one);
        ui.shapeObject = one;
        ui.shapePattern = p;
        app.updateLevel();
      } else app.closeShape();
    }
    // While editing points, choosing another object (in the list too) goes on with that one.
    if (app.editor.active && app.settings.mode === 'flow') {
      const one = next.size === 1 ? [...next][0] : null;
      if (one !== ui.editObject) {
        app.editor.reset();
        ui.editObject = one;
        app.updateLevel();
      }
    }
    layers.reveal([...next]);
    app.redraw();
    if (next.size) requestAnimationFrame(() => $('object-panel').scrollIntoView({ block: 'nearest' }));
  }

  /**
   * Sews the objects in `order` (an edit that can be undone). With `into`, the moved objects take
   * the thread of that color block. Also a place where an object comes to lie over what lay on it
   * is taken (a shared edge often is all of it): the message says so, undo goes back. The moved
   * objects stay selected.
   */
  function moveObjects(order: number[], moved: number[], into: number | null = null): void {
    const f = app.files.active;
    const p = f?.pattern;
    if (!f || !p) return;
    const q = app.seq(p);
    const movedSet = new Set(moved);
    const target = into === null ? undefined : q.blocks[into];
    const recolored = target ? moved.filter((o) => !sameColor(q.objects[o].color, target.color)) : [];
    const starts: number[] = [];
    const next = reorder(p, q.objects, order, app.settings.trimMm, starts, { into: new Map(recolored.map((o) => [o, into!])), whole: true });
    if (next === p) return;
    // A border or a blend's second thread moved into another color keeps it from now on.
    if (recolored.length) {
      const nk = app.seq(next);
      takeThreads(next, recolored.map((o) => nk.objectAt[recordOfStitch(nk.numbers, starts[order.indexOf(o)] + 1)]).filter((o) => o >= 0));
    }
    const conflict = coverConflict(q, p, order, movedSet);
    const keepHidden = ui.hiddenBlocks.size;
    app.applyEdit(next, f.measurement);
    if (keepHidden) ui.hiddenBlocks = new Set();
    // The objects are found again by their first stitch; the moved ones stay selected.
    const nq = app.seq(next);
    const now = (o: number) => nq.objectAt[recordOfStitch(nq.numbers, starts[order.indexOf(o)] + 1)];
    const nameNow = (o: number) => (now(o) >= 0 ? objectName(nq, now(o)) : objectName(q, o));
    const warning = coverWarning(conflict, nameNow);
    ui.selectedObjects = new Set(moved.map(now).filter((o) => o >= 0));
    ui.selectionKey++;
    layers.reveal([...ui.selectedObjects]);
    // What leaves out the shapes on top follows the new order (same undo step).
    app.followKnockouts();
    const undo = undoable();
    if (target && recolored.length) {
      const own = q.objects[recolored[0]];
      const ownColors = new Set(recolored.map((o) => q.objects[o].block));
      const one = now(recolored[0]);
      const what = recolored.length > 1 ? t('object.many', { n: recolored.length }) : one >= 0 ? `${kindLabel(nq.objects[one].kind)} ${numberInColor(nq.objects, nq.objects[one])}` : objectName(q, recolored[0]);
      layers.say({
        text: [warning, t('object.movedInto', { a: what, color: blockName(target) })].filter(Boolean).join(' '),
        warn: !!warning,
        // The other way to read the drop: sewn at that time, but in its own thread.
        action: {
          label: ownColors.size === 1 ? t('object.keepColor', { color: blockName({ index: own.block, color: own.color }) }) : t('object.keepColors'),
          title: t('object.keepColor.hint'),
          run: () => {
            if (app.files.active !== f || f.pattern !== next) return;
            app.history('undo');
            moveObjects(order, moved, null);
          },
        },
      });
    } else layers.say({ text: [warning, t(warning ? 'object.movedAnyway' : 'object.moved'), warning ? t('object.undo') : ''].filter(Boolean).join(' '), warn: !!warning, undo });
    app.redraw();
  }

  /**
   * Sews the selected objects as one: they move to where the first one is sewn (as when moving
   * them, also where that puts one over what lay on it, with a warning), and fills become one area,
   * sewn anew with the first one's settings.
   */
  function mergeObjects(): void {
    const f = app.files.active;
    const p = f?.pattern;
    if (!f || !p || ui.selectedObjects.size < 2) return;
    const q = app.seq(p);
    const sel = [...ui.selectedObjects].sort((a, b) => a - b);
    const objs = sel.map((o) => q.objects[o]);
    if (mergeBlocked(objs)) return;
    const set = new Set(sel);
    const order = [...q.objects.keys()].filter((o) => o < sel[0] || (o > sel[0] && !set.has(o)));
    order.splice(sel[0], 0, ...sel);
    const warning = coverWarning(coverConflict(q, p, order, set), (o) => objectName(q, o));
    const done = (n: number) => layers.say({ text: [warning, t('object.merged', { n })].filter(Boolean).join(' '), warn: !!warning, undo: undoable() });
    const starts: number[] = [];
    const next = reorder(p, q.objects, order, app.settings.trimMm, starts);
    // A new pattern also when nothing moved: undo goes back to the one that shows them apart.
    const target: Pattern = next === p ? { ...p } : next;
    const k = sel[0];
    rememberObjects(target, [starts[k]], starts[k + sel.length] ?? Infinity);
    const nq = app.seq(target);
    const merged = nq.objectAt[recordOfStitch(nq.numbers, starts[k] + 1)];
    const fills = objs.every((o) => o.kind === 'fill');
    const fill = fills ? (remembered(p, objs[0])?.fill ?? measureFill(p, analyze(p, objs[0], q.kinds))) : null;
    // Fills with curves become one outline (editable as a shape), the others one area.
    const forms = fills ? objs.map((o) => remembered(p, o)?.form) : [];
    const form = forms.length && forms.every(Boolean) ? unionForm(forms as Form[]) : null;
    const area = form ? wholeArea(form) : fills ? unionRegion(objs.flatMap((o) => remembered(p, o)?.region ?? analyze(p, o, q.kinds).fill ?? [])) : null;
    if (merged >= 0 && fill && area) {
      remember(target, nq.objects[merged], form ? { region: area, fill, form } : { region: area, fill });
      const r = restitch(target, nq.objects, [merged], { kind: 'fill', s: fill }, nq.kinds, app.settings.trimMm);
      if (r.starts.length) {
        ui.selectedObjects = new Set([merged]);
        app.applyRestitched(r, 'stitch.failed', true);
        if (form) layers.say({ text: t('object.joined', { n: sel.length }), undo: undoable() });
        else done(sel.length);
        return;
      }
    }
    app.applyEdit(target);
    if (merged >= 0) ui.selectedObjects = new Set([merged]);
    ui.selectionKey++;
    done(sel.length);
    app.redraw();
  }

  /**
   * Sews the selected satins and fills from the other side (new stitches, an edit that can be
   * undone), and says what that saved in trims or travel.
   */
  function reverseSelected(): void {
    const f = app.files.active;
    const p = f?.pattern;
    if (!f || !p || !ui.selectedObjects.size) return;
    const q = app.seq(p);
    const selected = [...ui.selectedObjects].sort((a, b) => a - b);
    // Lines are turned by their curve (in place, so the others keep their numbers), the rest sewn from the other side.
    const lines = selected.filter((o) => isLine(p, q.objects[o]));
    const which = selected.filter((o) => !lines.includes(o) && reversible(q.objects[o]));
    if (!which.length && !lines.length) return;
    const turned = reverseLines(p, lines, app.settings.trimMm);
    // Shadows and echo copies in threads of their own follow their lines.
    const pl = turned.pattern === p ? p : syncBorders(turned.pattern, app.settings.trimMm);
    const ql = app.seq(pl);
    const r = which.length ? reverseObjects(pl, ql.objects, which, ql.kinds, app.settings.trimMm) : null;
    const failed = (r?.failed.length ?? 0) + turned.failed.length;
    const failText = failed ? t(failed === 1 ? 'object.reverse.failed.one' : 'object.reverse.failed', { n: failed }) : null;
    if (!r?.starts.length && pl === p) {
      layers.say(failText ?? '', true);
      return;
    }
    const before = app.orderStats(p);
    if (r?.starts.length) app.applyRestitched({ ...r, failed: [] }, 'stitch.failed');
    else {
      app.applyEdit(pl);
      app.files.setObjects(f, rememberedIn(pl, app.seq(pl).objects));
      ui.stitchCache = null;
      app.redraw();
    }
    const now = app.files.active?.pattern;
    if (!now) return;
    const after = app.orderStats(now);
    const dt = before.trims - after.trims;
    const saved = dt > 0 ? t(dt === 1 ? 'order.fewerTrims.one' : 'order.fewerTrims', { n: dt }) : after.travelMm < before.travelMm - 1 ? t('order.shorterTravel') : null;
    const done = saved ? t('object.reversedSaves', { what: saved }) : t('object.reversed');
    layers.say({ text: [failText, done].filter(Boolean).join(' '), warn: !!failText, undo: undoable() });
  }

  /** Why the objects cannot be sewn as one, or null. */
  function mergeBlocked(objs: SewObject[]): Key | null {
    if (objs.some((o) => o.block !== objs[0].block)) return 'object.merge.color';
    const together = objs.every((o, k) => !k || o.index === objs[k - 1].index + 1);
    if (!together && objs.some((o) => o.kind !== 'fill')) return 'object.merge.kind';
    return null;
  }

  /** Shows the selected object as its sections, each one an object. */
  function splitSelected(): void {
    const f = app.files.active;
    const p = f?.pattern;
    if (!f || !p || ui.selectedObjects.size !== 1) return;
    const o = app.seq(p).objects[[...ui.selectedObjects][0]];
    if (!o || o.sections < 2) return;
    // A copy of the stitches: undo goes back to the pattern that still shows one object.
    const next: Pattern = { ...p };
    splitObject(next, o);
    app.applyEdit(next);
    const nq = app.seq(next);
    ui.selectedObjects = new Set(nq.objects.flatMap((x, i) => (x.first >= o.first && x.last <= o.last ? [i] : [])));
    ui.selectionKey++;
    layers.reveal([...ui.selectedObjects]);
    layers.say({ text: t('object.splitDone', { n: ui.selectedObjects.size }), undo: undoable() });
    app.redraw();
  }

  /** Takes back the edit just made, if it is still the latest one of the same design. */
  function undoable(): () => void {
    const f = app.files.active;
    const p = f?.pattern;
    return () => {
      if (f && app.files.active === f && f.pattern === p) app.history('undo');
    };
  }

  /**
   * Runs an edit made elsewhere and says what it did as a note with "Undo" (no question before:
   * undo is the way back). `text` replaces what the edit said, when it changed the design.
   */
  function withUndo(run: () => void, text?: () => string): void {
    const f = app.files.active;
    const before = f?.pattern;
    const said = layers.capture(run);
    const changed = !!f && app.files.active === f && f.pattern !== before;
    if (said && (said.warn || said.action)) return layers.say(said);
    const message = changed && text ? text() : said?.text;
    if (message) layers.say({ text: message, undo: changed ? undoable() : undefined });
  }

  /**
   * The order with the selected objects moved: to the front or the end, or each one place earlier
   * or later (past the next object that is not selected). Null when nothing would change.
   */
  function shiftedOrder(s: Shift): { order: number[]; moved: number[] } | null {
    const p = app.files.active?.pattern;
    const sel = app.frameObjects();
    if (!p || !sel.length) return null;
    const n = app.seq(p).objects.length;
    const set = new Set(sel);
    const rest = [...Array(n).keys()].filter((o) => !set.has(o));
    let order: number[];
    if (s === 'first') order = [...sel, ...rest];
    else if (s === 'last') order = [...rest, ...sel];
    else {
      order = [...Array(n).keys()];
      const swap = (i: number, j: number) => ([order[i], order[j]] = [order[j], order[i]]);
      if (s === 'earlier') {
        for (let i = 1; i < n; i++) if (set.has(order[i]) && !set.has(order[i - 1])) swap(i, i - 1);
      } else for (let i = n - 2; i >= 0; i--) if (set.has(order[i]) && !set.has(order[i + 1])) swap(i, i + 1);
    }
    return order.some((o, k) => o !== k) ? { order, moved: sel } : null;
  }

  /** The objects of color block `b`, in sewing order. */
  function blockObjects(b: number): number[] {
    const p = app.files.active?.pattern;
    return p ? app.seq(p).objects.filter((o) => o.block === b).map((o) => o.index) : [];
  }

  /** The order with color block `b` sewn before the color before it (-1) or after the one after it (1). */
  function colorOrder(b: number, dir: -1 | 1): number[] | null {
    const p = app.files.active?.pattern;
    if (!p) return null;
    const q = app.seq(p);
    const other = q.blocks[b + dir];
    const mine = blockObjects(b);
    if (!other || !mine.length) return null;
    const theirs = new Set(blockObjects(other.index));
    const moving = new Set(mine);
    const rest = q.objects.map((o) => o.index).filter((o) => !moving.has(o));
    // Before the first object of the color before, or after the last one of the color after.
    const at = dir < 0 ? rest.findIndex((o) => theirs.has(o)) : rest.length - [...rest].reverse().findIndex((o) => theirs.has(o));
    if (at < 0) return null;
    const order = [...rest.slice(0, at), ...mine, ...rest.slice(at)];
    return order.some((o, k) => o !== k) ? order : null;
  }

  /** The color block of the selection, when all of it is in one. */
  function selectionBlock(): number | null {
    const p = app.files.active?.pattern;
    if (!p || !ui.selectedObjects.size) return null;
    const objs = app.seq(p).objects;
    const blocks = new Set([...ui.selectedObjects].map((o) => objs[o]?.block));
    return blocks.size === 1 ? ([...blocks][0] ?? null) : null;
  }

  /** The block whose menu is open now (the color commands work on it), else the selection's. */
  let menuBlock: number | null = null;

  /** The selected fills with an outline, and whether they leave out what lies on them. */
  function knockoutState(): 'on' | 'off' | null {
    const p = app.files.active?.pattern;
    if (!p) return null;
    const objs = app.seq(p).objects;
    const shaped = app.frameObjects().map((o) => objs[o] && remembered(p, objs[o])).filter((m) => !!m?.form && !m.free);
    if (!shaped.length) return null;
    return shaped.every((m) => !!m?.knockout) ? 'on' : 'off';
  }

  const objectPanel = new ObjectPanel({
    thread: (c) => {
      const p = app.files.active?.pattern;
      const sel = app.frameObjects();
      const next = p && recolorObjects(p, sel, c, app.settings.trimMm);
      if (!next) return;
      const q = app.seq(next);
      // The objects keep their place in the order, so their indices stay.
      app.takeShapes(next, sel.filter((o) => o < q.objects.length));
      layers.say({ text: t('objects.recolored'), undo: undoable() });
    },
    blend: (c) => {
      const p = app.files.active?.pattern;
      if (!p || ui.selectedObjects.size !== 1) return;
      const o = [...ui.selectedObjects][0];
      const next = blendObject(p, o, c, app.settings.trimMm);
      if (!next) return layers.say(t('object.blend.failed'), true);
      // Both layers selected: the blend shows in full, not dimmed behind the original.
      const objs = app.seq(next).objects;
      const link = remembered(next, objs[o])?.fill?.deco?.blend?.link;
      const partner = objs.findIndex((x) => !!link && remembered(next, x)?.blendOf === link);
      app.takeShapes(next, partner < 0 ? [o] : [o, partner]);
      layers.say({ text: t('object.blend.done'), undo: undoable() });
    },
    clear: () => {
      if (app.editor.active) app.setEditing(false);
      selectObjects([], false);
    },
    editStitches: (on) => app.setEditing(on),
    closeShape: () => app.closeShape(),
    deleteNode: () => app.shapeTool.deleteSelected(),
    toggleNode: () => app.shapeTool.toggleSmooth(),
    resize: (sx, sy) => {
      const p = app.files.active?.pattern;
      const sel = app.frameObjects();
      if (!p || !sel.length) return;
      const objs = sel.map((o) => app.seq(p).objects[o]);
      const cx = (Math.min(...objs.map((o) => o.minX)) + Math.max(...objs.map((o) => o.maxX))) / 20;
      const cy = (Math.min(...objs.map((o) => o.minY)) + Math.max(...objs.map((o) => o.maxY))) / 20;
      app.commitTransform(scaling(sx, sy, cx, cy));
    },
    move: (dx, dy) => {
      if (app.frameObjects().length) app.commitTransform(translation(dx, dy));
    },
    simplify: () => {
      const r = app.shapeTool.simplify();
      if (!r) return layers.say(t('shape.simplify.none'), true);
      layers.say(t('shape.simplified', { before: formatNumber(r.before), after: formatNumber(r.after) }));
      app.shapeTool.commit();
    },
    closeLine: () => app.shapeTool.toggleClosed(),
    deleteSelection: () => app.editor.deleteSelection(),
    splitStitch: () => app.editor.splitSelected(),
  });

  const pattern = () => app.files.active?.pattern ?? null;
  const count = () => {
    const p = pattern();
    return p ? app.seq(p).objects.length : 0;
  };
  const flow = () => app.settings.mode === 'flow' && !!pattern();
  const objectCount = (n: number) => (n === 1 ? t('objects.deleted.one') : t('objects.deleted', { n }));

  registerObjectCommands({
    flow,
    count,
    frame: () => app.frameObjects(),
    // What the page shows, or worked out now when the selection changed since (a right click selects first).
    info: () => {
      const p = pattern();
      if (!p || !ui.selectedObjects.size || ui.lettering || app.settings.mode !== 'flow') return null;
      const q = app.seq(p);
      const cur = objectPanel.current;
      const sel = [...ui.selectedObjects].sort((a, b) => a - b).join();
      return cur && cur.objects === q.objects && cur.selected.join() === sel ? cur : app.objectInfo(p, q);
    },
    lettering: () => !!ui.lettering,
    drawing: () => app.drawTool.busy,
    typing: () => {
      const el = document.activeElement;
      return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    },
    hasSelection: () => ui.selectedObjects.size > 0,
    frameActive: () => app.settings.mode === 'flow' && !!objectPanel.current?.frame,

    selectAll: () => {
      if (app.editor.active) app.setEditing(false);
      selectObjects([...Array(count()).keys()], false);
    },
    clear: () => {
      if (app.editor.active) app.setEditing(false);
      selectObjects([], false);
    },
    duplicate: () => withUndo(app.duplicateSelected),
    remove: () => {
      const n = app.frameObjects().length;
      withUndo(app.deleteSelected, () => objectCount(n));
    },
    canShift: (s) => !!shiftedOrder(s),
    shift: (s) => {
      const r = shiftedOrder(s);
      if (r) moveObjects(r.order, r.moved);
    },
    mirror: (axis) => withUndo(() => app.mirrorSelected(axis)),
    reverse: () => reverseSelected(),
    split: () => splitSelected(),
    combine: () => mergeObjects(),
    subtract: () => withUndo(app.subtractSelected),
    knockoutState,
    knockout: () => {
      const on = knockoutState() !== 'on';
      withUndo(() => app.knockoutObjects(app.frameObjects(), on));
    },
    overlapShown: () => !$('overlap-card').hidden,
    overlapCut: () => withUndo(() => $('overlap-cut').click()),
    blend: () => objectPanel.pickBlend(),
    color: () => objectPanel.pickColor(),
    aside: (role) => withUndo(() => app.putAside(role)),
    openShape: () => {
      if (ui.selectedObjects.size === 1) app.enterShape([...ui.selectedObjects][0], true);
    },
    openStitches: () => {
      app.closeRungs();
      app.setEditing(true);
    },
    nudge: (dx, dy) => {
      if (app.frameObjects().length) app.commitTransform(translation(dx, dy));
    },
    canOptimize: () => flow() && count() > 1,
    optimize: () => (app.orderCard.isOpen ? app.orderCard.close(true) : app.orderCard.show()),

    colorTarget: () => (menuBlock !== null && menuBlock < (pattern() ? app.seq(pattern()!).blocks.length : 0) ? menuBlock : selectionBlock()),
    colorFocused: () => ui.focusBlock,
    colorHidden: (b) => ui.hiddenBlocks.has(b),
    colorSelect: (b) => selectObjects(blockObjects(b), false),
    colorFocus: (b) => focusBlock(ui.focusBlock === b ? null : b, true),
    colorHide: (b) => toggleBlock(b),
    colorRecolor: (b) => layers.recolor(b),
    canColorShift: (b, dir) => !!colorOrder(b, dir),
    colorShift: (b, dir) => {
      const order = colorOrder(b, dir);
      if (order) moveObjects(order, blockObjects(b));
    },
    canShowAll: () => ui.hiddenBlocks.size > 0 || ui.focusBlock !== null,
    showAll: () => showAll(),
    expandAll: (open) => layers.openAll(open),
  });

  // The menu of a color block: its commands work on it while the menu is open.
  function colorMenu(b: number, at: { x: number; y: number } | HTMLElement): void {
    menuBlock = b;
    menuAt(colorMenuItems(b), at, t('objects.color.menu'));
    // Back to the selection's color once the menu is gone (a choice runs before it closes).
    const until = () => {
      if (objectMenu.isOpen) return void requestAnimationFrame(until);
      menuBlock = null;
    };
    requestAnimationFrame(until);
  }

  // The threads in sewing order, to print, and switching them all to one brand.
  const colorList = new ColorList();
  $('color-list').addEventListener('click', () => {
    const f = app.files.active;
    if (!f?.pattern) return;
    colorList.open({
      pattern: f.pattern,
      name: FileList.baseName(f) || f.pattern.name,
      spm: app.settings.machineSpm,
      apply: (colors) => {
        const g = app.files.active;
        if (!g?.pattern) return;
        let next = g.pattern;
        colors.forEach((c, b) => (next = recolorBlock(next, b, c)));
        app.applyEdit(next, g.measurement);
      },
    });
  });

  return { colorList, layers, mergeBlocked, objectName, objectPanel, selectObjects };
}
