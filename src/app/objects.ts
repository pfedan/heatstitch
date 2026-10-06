import type { AsideRole } from '../model/aside';
import type { Editor } from '../ui/editor';
import type { FileList } from '../ui/fileList';
import type { Form } from '../shape/path';
import type { Lettering } from '../lettering/layout';
import type { Measurement } from '../validation/measure';
import type { Pattern } from '../model/pattern';
import type { RungTool } from '../ui/rungTool';
import type { Sequence } from './types';
import type { Settings } from '../settings';
import type { ShapeTool } from '../ui/shapeTool';
import { LayersPanel, kindLabel, blockName } from '../ui/layersPanel';
import { ObjectPanel } from '../ui/objectPanel';
import { numberInColor, rememberObjects, type SewObject, splitObject } from '../model/objects';
import { sameColor } from '../model/recolor';
import { recordOfStitch } from '../model/sequence';
import { remembered, measureFill, analyze, unionRegion, remember, restitch, type RestitchResult } from '../model/restitch';
import { reversible, reverseObjects } from '../model/reverse';
import { t, type Key } from '../i18n';
import { ui } from './state';
import { unionForm, recolorObjects } from '../model/shapeOps';
import { blendObject } from '../model/blend';
import { recolorBlock } from '../model/border';
import { violations, conflicts, reorder } from '../model/order';
import { wholeArea } from '../model/knockout';

/** What bindObjects needs from the rest of the app. */
export interface ObjectsApp {
  readonly applyEdit: (p: Pattern, measurement?: Measurement | undefined) => void;
  readonly applyRestitched: (r: RestitchResult | null, failed: Key, remeasure?: boolean) => void;
  readonly closeRungs: () => void;
  readonly closeShape: () => void;
  readonly deleteSelected: () => void;
  readonly duplicateSelected: () => void;
  readonly editor: Editor;
  readonly enterShape: (o: number, fit: boolean) => void;
  readonly files: FileList;
  readonly frameObjects: () => number[];
  readonly history: (step: 'undo' | 'redo' | 'revert') => void;
  readonly letteringsOf: (p: Pattern, q: Sequence) => (Lettering | undefined)[];
  readonly mirrorSelected: (axis: 'x' | 'y') => void;
  readonly orderStats: (p: Pattern) => { colorChanges: number; trims: number; travelMm: number; };
  readonly overOf: (q: Sequence, p: Pattern) => number[][];
  readonly putAside: (role: AsideRole) => void;
  readonly redraw: () => void;
  readonly rungTool: RungTool;
  readonly seq: (p: Pattern) => Sequence;
  readonly setEditing: (on: boolean) => void;
  readonly settings: Settings;
  readonly shapeTarget: (p: Pattern, q: Sequence, o: number) => Form | null;
  readonly shapeTool: ShapeTool;
  readonly showObjectMenu: (o: number, clientX: number, clientY: number) => boolean;
  readonly subtractSelected: () => void;
  readonly takeShapes: (next: Pattern, select: number[]) => void;
  readonly updateLevel: () => void;
}

/**
 * The object list of the Ablauf mode and what it does with the objects (select, move, merge,
 * reverse, split), and the object panel with its actions.
 */
export function bindObjects(app: ObjectsApp) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  const layers = new LayersPanel({
    toggle: (b) => {
      const next = new Set(ui.hiddenBlocks);
      if (!next.delete(b)) next.add(b);
      ui.hiddenBlocks = next;
      if (ui.focusBlock === b) ui.focusBlock = null;
      app.redraw();
    },
    focus: (b, sticky) => {
      if (sticky) {
        ui.focusBlock = b;
        ui.hoverBlock = null;
      } else ui.hoverBlock = b;
      app.redraw();
    },
    showAll: () => {
      ui.hiddenBlocks = new Set();
      ui.focusBlock = ui.hoverBlock = null;
      app.redraw();
    },
    // Only the colors change, so the density measurement still holds.
    recolor: (b, color) => {
      const f = app.files.active;
      if (f?.pattern) app.applyEdit(recolorBlock(f.pattern, b, color), f.measurement);
    },
    select: (objs, toggle) => selectObjects(objs, toggle),
    hover: (o) => {
      if (ui.hoverObject === o) return;
      ui.hoverObject = o;
      app.redraw();
    },
    move: (order, moved, into) => moveObjects(order, moved, into),
    menu: (o, x, y) => void app.showObjectMenu(o, x, y),
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
    // While editing an outline, choosing another object goes on with that one's (or back to the objects).
    if (app.shapeTool.active && (next.size !== 1 || !next.has(ui.shapeObject!))) {
      const one = next.size === 1 ? [...next][0] : null;
      const p = app.files.active?.pattern;
      const form = one !== null && p ? app.shapeTarget(p, app.seq(p), one) : null;
      if (form && one !== null && p) {
        app.shapeTool.open(form);
        ui.shapeObject = one;
        ui.shapePattern = p;
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
    const next = reorder(p, q.objects, order, app.settings.trimMm, starts, { into: new Map(recolored.map((o) => [o, into!])) });
    if (next === p) return;
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
    const undo = t('object.undo');
    if (target && recolored.length) {
      const own = q.objects[recolored[0]];
      const ownColors = new Set(recolored.map((o) => q.objects[o].block));
      const one = now(recolored[0]);
      const what = recolored.length > 1 ? t('object.many', { n: recolored.length }) : one >= 0 ? `${kindLabel(nq.objects[one].kind)} ${numberInColor(nq.objects, nq.objects[one])}` : objectName(q, recolored[0]);
      layers.say({
        text: [warning, t('object.movedInto', { a: what, color: blockName(target) }), undo].filter(Boolean).join(' ') + ' ',
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
    } else layers.say({ text: [warning, t(warning ? 'object.movedAnyway' : 'object.moved'), undo].filter(Boolean).join(' '), warn: !!warning });
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
    const done = (n: number) => layers.say({ text: [warning, t('object.merged', { n })].filter(Boolean).join(' '), warn: !!warning });
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
        if (form) layers.say(t('object.joined', { n: sel.length }));
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
    const which = [...ui.selectedObjects].sort((a, b) => a - b).filter((o) => reversible(q.objects[o]));
    if (!which.length) return;
    const r = reverseObjects(p, q.objects, which, q.kinds, app.settings.trimMm);
    const failed = r.failed.length;
    const failText = failed ? t(failed === 1 ? 'object.reverse.failed.one' : 'object.reverse.failed', { n: failed }) : null;
    if (!r.starts.length) {
      layers.say(failText ?? '', true);
      return;
    }
    const before = app.orderStats(p);
    app.applyRestitched({ ...r, failed: [] }, 'stitch.failed');
    const now = app.files.active?.pattern;
    if (!now) return;
    const after = app.orderStats(now);
    const dt = before.trims - after.trims;
    const saved = dt > 0 ? t(dt === 1 ? 'order.fewerTrims.one' : 'order.fewerTrims', { n: dt }) : after.travelMm < before.travelMm - 1 ? t('order.shorterTravel') : null;
    const done = saved ? t('object.reversedSaves', { what: saved }) : t('object.reversed');
    layers.say({ text: [failText, done, t('object.undo')].filter(Boolean).join(' '), warn: !!failText });
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
    layers.say(t('object.splitDone', { n: ui.selectedObjects.size }));
    app.redraw();
  }

  const objectPanel = new ObjectPanel({
    merge: () => mergeObjects(),
    duplicate: () => app.duplicateSelected(),
    mirror: (axis) => app.mirrorSelected(axis),
    subtract: () => app.subtractSelected(),
    remove: () => app.deleteSelected(),
    aside: (role) => app.putAside(role),
    thread: (c) => {
      const p = app.files.active?.pattern;
      const sel = app.frameObjects();
      const next = p && recolorObjects(p, sel, c, app.settings.trimMm);
      if (!next) return;
      const q = app.seq(next);
      // The objects keep their place in the order, so their indices stay.
      app.takeShapes(next, sel.filter((o) => o < q.objects.length));
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
      layers.say(t('object.blend.done'));
    },
    split: splitSelected,
    step: (dir) => {
      const p = app.files.active?.pattern;
      if (!p || ui.selectedObjects.size !== 1) return;
      const o = [...ui.selectedObjects][0];
      const n = app.seq(p).objects.length;
      const k = o + dir;
      if (k < 0 || k >= n) return;
      const order = Array.from({ length: n }, (_, i) => i);
      order[o] = k;
      order[k] = o;
      moveObjects(order, [o]);
    },
    reverse: () => reverseSelected(),
    clear: () => {
      if (app.editor.active) app.setEditing(false);
      ui.selectedObjects = new Set();
      ui.selectionKey++;
      ui.flowPreview = null;
      app.redraw();
    },
    editStitches: (on) => app.setEditing(on),
    editShape: (on) => {
      if (!on) return app.closeShape();
      if (ui.selectedObjects.size === 1) app.enterShape([...ui.selectedObjects][0], true);
    },
    deleteNode: () => app.shapeTool.deleteSelected(),
    toggleNode: () => app.shapeTool.toggleSmooth(),
    closeLine: () => app.shapeTool.toggleClosed(),
    deleteSelection: () => app.editor.deleteSelection(),
    splitStitch: () => app.editor.splitSelected(),
  });

  return { layers, mergeBlocked, objectName, objectPanel, selectObjects };
}
