import type { DrawTool } from '../ui/drawTool';
import type { Editor } from '../ui/editor';
import type { FileList, LoadedFile } from '../ui/fileList';
import type { FrameTool } from '../ui/frameTool';
import type { TraceTool } from '../ui/traceTool';
import type { ImageMode } from '../ui/imageMode';
import type { MeasureTool } from '../ui/measureTool';
import type { Lettering } from '../lettering/layout';
import type { OrderCard } from '../ui/objectPanel';
import type { Pattern } from '../model/pattern';
import type { RungTool } from '../ui/rungTool';
import type { Sequence } from './types';
import { shownMarks, type Settings } from '../settings';
import type { ShapeTool } from '../ui/shapeTool';
import type { Viewport } from '../render/viewport';
import { DIVIDER_GRAB_PX } from '../render/compare';
import { LONG_PRESS_MS } from '../ui/layersPanel';
import { objectMenu } from '../ui/objectMenu';
import { lightFromPointer } from '../render/light';
import { objectsInRect } from '../model/edit';
import { stitchAt, transitionAt, transitionShown, type StitchStyle } from '../render/flow';
import { ui } from './state';
import { updateTooltip } from '../ui/tooltip';

/** What bindPointer needs from the rest of the app. */
export interface PointerApp {
  readonly canvas: HTMLCanvasElement;
  readonly closeShape: () => void;
  readonly drawTool: DrawTool;
  readonly editor: Editor;
  readonly enterObject: (o: number, fit: boolean) => void;
  readonly enterShape: (o: number, fit: boolean) => void;
  readonly files: FileList;
  readonly fitView: (f?: LoadedFile | null) => void;
  readonly flowTooltip: (sx: number, sy: number) => void;
  readonly frameTool: FrameTool;
  readonly imageMode: ImageMode;
  readonly inPlanFrame: (sx: number, sy: number) => boolean;
  readonly letterDown: (x: number, y: number) => boolean;
  readonly letterDragTo: (x: number, y: number) => boolean;
  readonly letterUp: () => void;
  readonly measure: MeasureTool;
  readonly letteringsOf: (p: Pattern, q: Sequence) => (Lettering | undefined)[];
  readonly movePlanSplit: (sx: number) => void;
  readonly orderCard: OrderCard;
  readonly redraw: () => void;
  readonly rungTool: RungTool;
  readonly selectObjects: (objs: number[], toggle: boolean) => void;
  readonly seq: (p: Pattern) => Sequence;
  readonly setEditing: (on: boolean) => void;
  readonly settings: Settings;
  readonly shapeTool: ShapeTool;
  readonly showCompare: () => boolean;
  readonly stage: HTMLElement;
  readonly styleFor: (p: Pattern) => StitchStyle;
  readonly syncFrame: () => void;
  readonly threadsShown: () => boolean;
  readonly tooltip: HTMLElement;
  readonly traceTool: TraceTool;
  readonly vp: Viewport;
}

/** Pointer input on the canvas: zoom, pan, pinch, clicks, the tooltip and the object menu. */
export function bindPointer(app: PointerApp) {
  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = app.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // Wheel and trackpad, as in Figma, Miro or tldraw: scrolling (two fingers swiping, or the mouse
  // wheel) pans, a pinch zooms around the pointer. Browsers report a trackpad pinch as a wheel with
  // ctrlKey set; Ctrl or Cmd with the mouse wheel zooms the same way. Safari reports the pinch as
  // gesture events instead (on a touch screen besides the pointers). The page never scrolls.
  /** Pixels per wheel line, and the steepest zoom step one wheel event may take. */
  const LINE_PX = 16;
  const ZOOM_STEP = 18;
  let gestureScale = 0;
  app.canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const [sx, sy] = local(e);
      const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? app.canvas.clientHeight : 1;
      if (e.ctrlKey || e.metaKey) {
        if (gestureScale) return;
        // A pinch sends many small deltas, a mouse wheel notch one large one: the cap keeps a notch
        // a gentle step while the pinch follows the fingers.
        const d = Math.max(-ZOOM_STEP, Math.min(ZOOM_STEP, e.deltaY * unit));
        app.vp.zoomAt(sx, sy, Math.exp(-d * 0.01));
      } else {
        let dx = e.deltaX * unit;
        let dy = e.deltaY * unit;
        // Shift with a plain mouse wheel scrolls sideways where the browser does not already.
        if (e.shiftKey && !dx) [dx, dy] = [dy, 0];
        app.vp.pan(-dx, -dy);
      }
      showTooltip(sx, sy);
      app.redraw();
    },
    { passive: false },
  );
  type Gesture = UIEvent & { scale: number; clientX: number; clientY: number };
  app.canvas.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    gestureScale = (e as Gesture).scale || 1;
  });
  app.canvas.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    const g = e as Gesture;
    // On a touch screen Safari sends these besides the pointers, which pinch already.
    if (!gestureScale || !g.scale || pointers.size) return;
    const [sx, sy] = local(g);
    app.vp.zoomAt(sx, sy, g.scale / gestureScale);
    gestureScale = g.scale;
    showTooltip(sx, sy);
    app.redraw();
  });
  app.canvas.addEventListener('gestureend', (e) => {
    e.preventDefault();
    gestureScale = 0;
  });

  /** Tooltip for the side of the divider the pointer is on. */
  function showTooltip(sx: number, sy: number): void {
    if (app.settings.mode === 'image') return;
    // While measuring, the label on the line says what counts; a tip would cover it.
    if (app.measure.active) {
      app.tooltip.hidden = true;
      return;
    }
    // The width grip shows its own label, and stitching on the stitch to be set shows its length.
    if ((app.shapeTool.active && (app.shapeTool.bandDragging || app.shapeTool.hover?.part === 'width')) || (app.editor.active && app.editor.penOn)) {
      app.tooltip.hidden = true;
      return;
    }
    if (app.settings.mode === 'flow') return app.flowTooltip(sx, sy);
    const left = app.showCompare() && sx < ui.split * ui.stageW;
    const f = app.files.active;
    updateTooltip(app.tooltip, sx, sy, ui.stageW, app.vp, left ? ui.origGrid : ui.grid, app.settings, (left ? f?.originalValidation : f?.validation) ?? null);
  }

  const nearDivider = (sx: number) => app.showCompare() && Math.abs(sx - ui.split * ui.stageW) <= DIVIDER_GRAB_PX;

  const pointers = new Map<number, [number, number]>();
  let pinchDist = 0;
  let pinchMid: [number, number] | null = null;
  /** Where a one-finger or mouse press started, to tell a click from a drag. */
  let pressAt: [number, number] | null = null;
  /** What the press started as: a point drag, a rectangle or panning (a click when it did not move). */
  let pressMode: 'move' | 'band' | 'pan' | 'frame' | 'trace' = 'pan';
  /** Pointer painting a brush stroke in the Bild mode, or null. */
  let painting: number | null = null;
  /** Pointer dragging the frame of the cut in the Bild mode, or null. */
  let cropping: number | null = null;
  /** How near the frame of the cut a press grabs it (screen pixels). */
  const cropReach = (e: PointerEvent) => (e.pointerType === 'mouse' ? 10 : 22) / app.vp.scale;

  // A node put in by a click on a hollow dot waits a moment (it may be a double-click on the loop):
  // any other input sews it first, so it never lands in the middle of something else.
  window.addEventListener('pointerdown', (e) => e.target !== app.canvas && app.shapeTool.settle(), { capture: true });
  window.addEventListener('keydown', () => app.shapeTool.settle(), { capture: true });

  app.canvas.addEventListener('pointerdown', (e) => {
    app.canvas.setPointerCapture(e.pointerId);
    const pos = local(e);
    if (app.shapeTool.active) {
      const [x, y] = app.vp.toWorld(pos[0], pos[1]);
      app.shapeTool.settle({ x, y, scale: app.vp.scale });
    }
    pointers.set(e.pointerId, pos);
    pressAt = pointers.size === 1 ? pos : null;
    let mode: 'move' | 'band' | 'pan' | 'frame' | 'trace' = 'pan';
    if (app.settings.mode === 'image' && pointers.size === 1 && e.button === 0 && app.imageMode.cropDown(...app.vp.toWorld(pos[0], pos[1]), cropReach(e))) {
      cropping = e.pointerId;
      return;
    }
    // A second finger while cutting means zooming: the frame goes back.
    if (cropping !== null) {
      cropping = null;
      app.imageMode.cropCancel();
    }
    if (app.settings.mode === 'image' && app.imageMode.painting && pointers.size === 1 && e.button === 0) {
      painting = e.pointerId;
      app.imageMode.paintDown(...app.vp.toWorld(pos[0], pos[1]));
      return;
    }
    // A second finger while painting means zooming: the stroke is dropped.
    if (painting !== null) {
      painting = null;
      app.imageMode.paintCancel();
    }
    // On the comparison of a proposal: the line between before and after follows the finger or mouse.
    if (pointers.size === 1 && e.button === 0 && app.inPlanFrame(pos[0], pos[1])) {
      ui.planDrag = true;
      app.movePlanSplit(pos[0]);
      return;
    }
    if (pointers.size === 1 && e.button === 0 && nearDivider(pos[0])) {
      ui.splitDrag = true;
      app.stage.classList.add('splitting');
      return;
    }
    if (pointers.size === 1 && e.button === 0) {
      const [wx, wy] = app.vp.toWorld(pos[0], pos[1]);
      const flow = app.settings.mode === 'flow';
      // Measuring goes before every other tool: it changes nothing, so it may lie over any of them.
      if (app.measure.active) {
        app.measure.down(wx, wy, app.vp.scale, { shift: e.shiftKey, alt: e.altKey, touch: e.pointerType !== 'mouse' });
        mode = 'move';
      } else if (app.drawTool.active && flow) {
        app.drawTool.down(wx, wy, app.vp.scale, e.shiftKey);
        mode = 'move';
      } else if (ui.letterMode && flow) mode = app.letterDown(wx, wy) ? 'move' : 'pan';
      else if (app.rungTool.active && flow) mode = app.rungTool.down(wx, wy, app.vp.scale, e.shiftKey);
      // Level Form: nodes, handles and curves first, the frame around them takes the rest.
      else if (app.shapeTool.active && flow && app.shapeTool.pickAt(wx, wy, app.vp.scale)) mode = app.shapeTool.down(wx, wy, app.vp.scale, e.shiftKey);
      // Shift+drag beside the nodes, also within the frame: a rubber band adds the nodes inside it.
      else if (app.shapeTool.active && flow && e.shiftKey) {
        ui.objectBand = { x0: wx, y0: wy, x1: wx, y1: wy };
        mode = 'band';
      }
      else if (app.frameTool.active && flow && app.frameTool.down(wx, wy, app.vp.scale) !== null) mode = 'frame';
      else if (app.shapeTool.active && flow) mode = 'pan';
      // The tracing image, while it is not locked: its corners, and its inside where no object lies.
      else if (flow && app.traceTool.down(wx, wy, app.vp.scale, () => objectAt(pos) >= 0)) mode = 'trace';
      else mode = app.editor.down(wx, wy, pos[0], pos[1], e.shiftKey, app.vp.scale);
      // Shift+drag where it would pan: a rubber band adds the objects inside it to the selection.
      if (mode === 'pan' && e.shiftKey && bandAllowed()) {
        ui.objectBand = { x0: wx, y0: wy, x1: wx, y1: wy };
        mode = 'band';
      }
      // A press on an object that is not selected selects it, and a drag moves it right away, as in
      // Figma; beside the objects a drag still moves the view. A finger keeps moving the view, as a
      // design on a phone fills the stage. Ctrl or Cmd adds to the selection on the click instead.
      if (mode === 'pan' && e.pointerType !== 'touch' && !e.ctrlKey && !e.metaKey && !ui.formLevel && bandAllowed()) {
        const o = objectAt(pos);
        if (o >= 0 && !ui.selectedObjects.has(o)) {
          app.selectObjects([o], false);
          app.syncFrame();
          if (app.frameTool.active) {
            app.frameTool.grab(wx, wy);
            mode = 'frame';
          }
        }
      }
    }
    pressMode = mode;
    cancelLongPress();
    if (e.pointerType === 'touch' && pointers.size === 1 && app.settings.mode === 'flow') {
      const at = pos;
      const { clientX, clientY } = e;
      longPress = {
        at,
        timer: window.setTimeout(() => {
          longPress = null;
          if (objectMenu.isOpen || !pointers.size) return;
          if (!openObjectMenu(at, clientX, clientY)) {
            // A long press beside the objects starts a rubber band, the finger drags it open; on the
            // level Form one beside the nodes, also within the frame (for the nodes).
            const nodes = app.shapeTool.active && app.settings.mode === 'flow' && (pressMode === 'pan' || pressMode === 'frame');
            if (!nodes && (pressMode !== 'pan' || !bandAllowed() || objectAt(at) >= 0)) return;
            if (pressMode === 'frame') app.frameTool.cancel();
            const [wx, wy] = app.vp.toWorld(at[0], at[1]);
            ui.objectBand = { x0: wx, y0: wy, x1: wx, y1: wy };
            pressMode = 'band';
            pressAt = null;
            navigator.vibrate?.(15);
            app.canvas.classList.remove('panning');
            app.redraw();
            return;
          }
          // The finger lifted after this is no click, and nothing it started goes on.
          pressAt = null;
          app.editor.cancel();
          app.frameTool.cancel();
          app.traceTool.cancel();
          ui.flowPreview = null;
          app.redraw();
        }, LONG_PRESS_MS),
      };
    }
    if (mode === 'pan') app.canvas.classList.add('panning');
    if (pointers.size === 2) {
      ui.objectBand = null;
      app.editor.cancel();
      app.rungTool.cancel();
      app.shapeTool.cancel();
      app.drawTool.abortPress();
      app.traceTool.cancel();
      app.measure.abortPress();
      ui.letterDrag = null;
      if (app.frameTool.dragging !== null) {
        app.frameTool.cancel();
        ui.flowPreview = null;
      }
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      pinchMid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }
    app.redraw();
  });

  app.canvas.addEventListener('pointermove', (e) => {
    const pos = local(e);
    const prev = pointers.get(e.pointerId);
    const [wx, wy] = app.vp.toWorld(pos[0], pos[1]);
    if (app.settings.mode === 'image') {
      if (painting === e.pointerId) {
        app.imageMode.paintMove(wx, wy);
        return;
      }
      if (cropping === e.pointerId) {
        app.imageMode.cropMove(wx, wy);
        return;
      }
      if (e.pointerType === 'mouse') app.canvas.style.cursor = app.imageMode.cropCursor(wx, wy, cropReach(e));
      app.imageMode.hover(wx, wy);
      if (!prev && app.imageMode.painting) app.redraw();
    } else if (app.canvas.style.cursor) app.canvas.style.cursor = '';
    if (app.settings.liveLight && e.pointerType === 'mouse' && app.threadsShown()) {
      lightFromPointer(pos[0], pos[1], ui.stageW, ui.stageH);
      app.redraw();
    }
    if (ui.splitDrag) {
      ui.split = Math.min(0.98, Math.max(0.02, pos[0] / ui.stageW));
      app.redraw();
      return;
    }
    // A mouse over the comparison moves its line as it goes; a finger drags it.
    if (ui.planDrag || (!prev && e.pointerType === 'mouse' && app.inPlanFrame(pos[0], pos[1]))) {
      app.movePlanSplit(pos[0]);
      // The density tip would cover the comparison, so it stays away here.
      app.tooltip.hidden = true;
      app.canvas.classList.remove('on-divider');
      return;
    }
    app.canvas.classList.toggle('on-divider', !prev && nearDivider(pos[0]));
    if (longPress && (pointers.size > 1 || Math.hypot(pos[0] - longPress.at[0], pos[1] - longPress.at[1]) > 8)) cancelLongPress();
    // With the menu open after a long press, the finger moves nothing until it is lifted.
    if (prev && objectMenu.isOpen && e.pointerType === 'touch') return;
    if (prev) {
      if (pointers.size === 1 && ui.objectBand) {
        ui.objectBand.x1 = wx;
        ui.objectBand.y1 = wy;
      } else if (pointers.size === 1) {
        if (!app.measure.dragTo(wx, wy, { shift: e.shiftKey, alt: e.altKey, touch: e.pointerType !== 'mouse' }) && !app.drawTool.dragTo(wx, wy, e.shiftKey, e.altKey) && !app.letterDragTo(wx, wy) && !app.rungTool.dragTo(wx, wy) && !app.shapeTool.dragTo(wx, wy) && !app.frameTool.dragTo(wx, wy, e.shiftKey, app.vp.scale, e.altKey) && !app.traceTool.dragTo(wx, wy) && !app.editor.dragTo(wx, wy, pos[0], pos[1])) app.vp.pan(pos[0] - prev[0], pos[1] - prev[1]);
      } else if (pointers.size === 2) {
        pointers.set(e.pointerId, pos);
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        // Two fingers zoom around their middle and move the view with it.
        const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (pinchMid) app.vp.pan(mid[0] - pinchMid[0], mid[1] - pinchMid[1]);
        if (pinchDist > 0) app.vp.zoomAt(mid[0], mid[1], d / pinchDist);
        pinchDist = d;
        pinchMid = mid;
      }
      pointers.set(e.pointerId, pos);
      app.redraw();
    } else if (
      app.measure.active
        ? app.measure.hoverAt(wx, wy, app.vp.scale, { shift: e.shiftKey, alt: e.altKey, touch: e.pointerType !== 'mouse' })
        : app.drawTool.active
        ? app.drawTool.hoverAt(wx, wy, app.vp.scale, e.shiftKey)
        : app.rungTool.active
        ? app.rungTool.hoverAt(wx, wy, app.vp.scale)
        : app.shapeTool.active
          ? [app.shapeTool.hoverAt(wx, wy, app.vp.scale), app.frameTool.active && app.frameTool.hoverAt(wx, wy, app.vp.scale, !!app.shapeTool.hover)].some(Boolean)
          : (app.frameTool.active && app.frameTool.hoverAt(wx, wy, app.vp.scale)) ||
            [app.traceTool.hoverAt(wx, wy, app.vp.scale, () => objectAt(pos) >= 0), app.editor.hoverAt(wx, wy, app.vp.scale)].some(Boolean)
    )
      app.redraw();
    if (app.settings.mode === 'flow' && !app.drawTool.active) app.canvas.style.cursor = app.traceTool.cursor();
    if (!prev) app.canvas.classList.toggle('on-frame', app.frameTool.active && app.frameTool.hover !== null && !(app.shapeTool.active && app.shapeTool.hover));
    if (e.pointerType === 'mouse' || pointers.size <= 1) showTooltip(pos[0], pos[1]);
  });

  /** Whether a click at `pos` (on the stage) hits stitches outside the selection. */
  function clickedOther(p: Pattern, pos: [number, number]): boolean {
    const st = app.styleFor(p);
    const [x, y] = app.vp.toWorld(pos[0], pos[1]);
    const i = stitchAt(p, x * 10, y * 10, Math.max(3, 60 / app.vp.scale), st.limit, st.alpha);
    return i >= 0 && !ui.selectedObjects.has(app.seq(p).objectAt[i]);
  }

  const endPointer = (e: PointerEvent) => {
    const pos = local(e);
    cancelLongPress();
    if (cropping === e.pointerId) {
      cropping = null;
      pointers.delete(e.pointerId);
      if (e.type === 'pointerup') app.imageMode.cropUp();
      else app.imageMode.cropCancel();
      return;
    }
    if (painting === e.pointerId) {
      painting = null;
      pointers.delete(e.pointerId);
      if (e.type === 'pointerup') app.imageMode.paintUp();
      else app.imageMode.paintCancel();
      return;
    }
    if (ui.objectBand && pointers.has(e.pointerId)) {
      const band = ui.objectBand;
      ui.objectBand = null;
      // A Shift+click that did not move stays a click (it adds the object under it).
      if (pressAt && Math.hypot(pos[0] - pressAt[0], pos[1] - pressAt[1]) < 4) pressMode = 'pan';
      else if (e.type === 'pointerup') selectInBand(band);
    }
    // Bild, Smart: a click on an area opens its row in the list of areas.
    if (pressAt && e.type === 'pointerup' && e.button === 0 && app.settings.mode === 'image' && Math.hypot(pos[0] - pressAt[0], pos[1] - pressAt[1]) < 4) {
      app.imageMode.click(...app.vp.toWorld(pos[0], pos[1]));
    }
    // A drag of the tracing image lays it there; a press on it that did not move is a click like any other.
    if (pressMode === 'trace') pressMode = e.type === 'pointerup' && app.traceTool.up() ? 'move' : 'pan';
    if (pressMode === 'pan') app.traceTool.cancel();
    // A press on the frame that did not move is a click like any other.
    const frameClick = pressMode === 'frame' && app.frameTool.dragging !== null && !app.frameTool.up();
    if (pressMode === 'frame' && !frameClick) pressMode = 'move';
    if (pressAt && e.type === 'pointerup' && e.button === 0 && app.settings.mode === 'flow' && (pressMode === 'pan' || frameClick) && !app.rungTool.active && Math.hypot(pos[0] - pressAt[0], pos[1] - pressAt[1]) < 4) {
      const p = app.files.active?.pattern;
      if (p && ui.letterMode && !clickedOther(p, pos)) {
        // Moving single letters: a click beside the letters lets go of the chosen one.
        if (ui.letterAt !== null) {
          ui.letterAt = null;
          app.redraw();
        }
      } else if (p && app.shapeTool.active) {
        // Editing an outline: a click on another object goes on with its outline (Shift or Ctrl adds
        // it), a click beside it lets go of the object; the level stays Form.
        const st = app.styleFor(p);
        const [x, y] = app.vp.toWorld(pos[0], pos[1]);
        const i = stitchAt(p, x * 10, y * 10, Math.max(3, 60 / app.vp.scale), st.limit, st.alpha);
        const o = i >= 0 ? app.seq(p).objectAt[i] : -1;
        const add = e.shiftKey || e.ctrlKey || e.metaKey;
        if (o >= 0 && o !== ui.shapeObject && add) app.selectObjects([o], true);
        else if (o >= 0 && o !== ui.shapeObject && !app.shapeTool.near(x, y, app.vp.scale)) app.enterShape(o, false);
        else if (o < 0 && !app.shapeTool.selCount && !app.shapeTool.near(x, y, app.vp.scale) && !add) app.selectObjects([], false);
        else if (!add && app.shapeTool.clearSelection()) app.redraw();
      } else if (p && app.editor.active) {
        // Editing stitches: a click on another object goes on with that one, a click beside the
        // stitches (with no point selected) goes back to the objects.
        const st = app.styleFor(p);
        const [x, y] = app.vp.toWorld(pos[0], pos[1]);
        const i = stitchAt(p, x * 10, y * 10, Math.max(3, 60 / app.vp.scale), st.limit, st.alpha);
        const o = i >= 0 ? app.seq(p).objectAt[i] : -1;
        if (o >= 0 && o !== ui.editObject) app.enterObject(o, ui.editObject === null);
        else if (o < 0 && !app.editor.selection.size) app.setEditing(false);
      } else if (p) {
        const q = app.seq(p);
        const st = app.styleFor(p);
        const jumps = shownMarks(app.settings).jumps;
        // A finger is wide: within its reach an object wins over a dashed jump line across it, and
        // both are found a little further away than under the mouse.
        const touch = e.pointerType === 'touch';
        const [x, y] = app.vp.toWorld(pos[0], pos[1]);
        const i = stitchAt(p, x * 10, y * 10, Math.max(3, (touch ? 140 : 60) / app.vp.scale), st.limit, st.alpha);
        const o = i >= 0 ? q.objectAt[i] : -1;
        const k = touch && o >= 0 ? -1 : transitionAt(p, q.transitions, app.vp, pos[0], pos[1], touch ? 12 : 8, (t) => transitionShown(p, t, jumps, st));
        if (k >= 0 || ui.selectedJump !== null) {
          ui.selectedJump = k >= 0 ? k : null;
          app.redraw();
        }
        if (k < 0) {
          // A click on stitches selects their object, a click beside them clears the selection.
          const add = e.shiftKey || e.ctrlKey || e.metaKey;
          if (o >= 0) app.selectObjects([o], add);
          else if (!add && ui.selectedObjects.size) app.selectObjects([], false);
        }
      }
    }
    pressAt = null;
    ui.planDrag = false;
    if (ui.splitDrag) {
      ui.splitDrag = false;
      app.stage.classList.remove('splitting');
    }
    if (pointers.size === 1 && pointers.has(e.pointerId)) {
      if (e.type === 'pointerup') app.measure.up();
      else app.measure.abortPress();
      app.drawTool.up(...app.vp.toWorld(pos[0], pos[1]), e.shiftKey, e.altKey);
      app.letterUp();
      app.rungTool.up();
      app.shapeTool.up();
      if (app.frameTool.dragging !== null) app.frameTool.up();
      app.editor.up();
    }
    pointers.delete(e.pointerId);
    pinchDist = 0;
    pinchMid = null;
    if (!pointers.size) app.canvas.classList.remove('panning');
  };
  app.canvas.addEventListener('pointerup', endPointer);
  app.canvas.addEventListener('pointercancel', (e) => {
    app.drawTool.abortPress();
    ui.letterDrag = null;
    app.editor.cancel();
    app.rungTool.cancel();
    app.shapeTool.cancel();
    app.frameTool.cancel();
    ui.flowPreview = null;
    endPointer(e);
  });
  app.canvas.addEventListener('pointerleave', () => {
    app.tooltip.hidden = true;
    if (app.settings.mode === 'image') {
      app.imageMode.leave();
      app.redraw();
    }
    // No preview of the next stitch while the pointer is away.
    if (app.editor.active) {
      app.editor.leave();
      app.redraw();
    }
  });
  /** Whether a rubber band may select objects now (level Objects, no tool open). */
  function bandAllowed(): boolean {
    return app.settings.mode === 'flow' && !!app.files.active?.pattern && !app.measure.active && !app.editor.active && !app.shapeTool.active && !app.rungTool.active && !app.drawTool.active && !app.orderCard.isOpen && !ui.letterMode;
  }

  /** The object under `pos` (on the stage), or -1. */
  function objectAt(pos: [number, number]): number {
    const p = app.files.active?.pattern;
    if (!p) return -1;
    const st = app.styleFor(p);
    const [x, y] = app.vp.toWorld(pos[0], pos[1]);
    const i = stitchAt(p, x * 10, y * 10, Math.max(3, 60 / app.vp.scale), st.limit, st.alpha);
    return i >= 0 ? app.seq(p).objectAt[i] : -1;
  }

  /** Adds the shown objects lying wholly inside the band to the selection (on the level Form: the nodes). */
  function selectInBand(b: { x0: number; y0: number; x1: number; y1: number }): void {
    if (app.shapeTool.active) {
      app.shapeTool.selectInRect(b.x0, b.y0, b.x1, b.y1);
      return app.redraw();
    }
    const p = app.files.active?.pattern;
    if (!p) return app.redraw();
    const st = app.styleFor(p);
    const inside = objectsInRect(p, app.seq(p).objects, b.x0 * 10, b.y0 * 10, b.x1 * 10, b.y1 * 10, (o) => o.first <= st.limit && st.alpha[o.first] > 0);
    if (inside.length) app.selectObjects([...new Set([...ui.selectedObjects, ...inside.map((o) => o.index)])], false);
    app.redraw();
  }

  // The object actions at the pointer: right click, or a long press on a touch screen.
  let longPress: { timer: number; at: [number, number] } | null = null;

  function cancelLongPress(): void {
    if (longPress) clearTimeout(longPress.timer);
    longPress = null;
  }

  /** Opens the menu for the object under `pos` (on the stage), selecting it first; false when there is none. */
  function openObjectMenu(pos: [number, number], clientX: number, clientY: number): boolean {
    const p = app.files.active?.pattern;
    if (!p || app.settings.mode !== 'flow' || app.measure.active || app.editor.active || app.shapeTool.active || app.rungTool.active || app.drawTool.active || app.orderCard.isOpen || ui.letterMode) return false;
    const st = app.styleFor(p);
    const [x, y] = app.vp.toWorld(pos[0], pos[1]);
    const i = stitchAt(p, x * 10, y * 10, Math.max(3, 60 / app.vp.scale), st.limit, st.alpha);
    const o = i >= 0 ? app.seq(p).objectAt[i] : -1;
    return o >= 0 && showObjectMenu(o, clientX, clientY);
  }

  /** Opens the menu for object `o` (on the canvas or in the list), selecting it first unless it is selected. */
  function showObjectMenu(o: number, clientX: number, clientY: number): boolean {
    const p = app.files.active?.pattern;
    if (!p || app.settings.mode !== 'flow' || app.editor.active || app.shapeTool.active || app.rungTool.active || app.drawTool.active || app.orderCard.isOpen || ui.letterMode) return false;
    // On a selected object the menu is for the whole selection, on another one for that one.
    if (!ui.selectedObjects.has(o)) app.selectObjects([o], false);
    app.redraw();
    if (ui.lettering || !ui.selectedObjects.size) return false;
    objectMenu.open({ x: clientX, y: clientY });
    return objectMenu.isOpen;
  }

  app.canvas.addEventListener('contextmenu', (e) => {
    // The right button pans while painting.
    if (app.settings.mode === 'image') return e.preventDefault();
    // A long press opened it already (some browsers send this after a long press too).
    if (objectMenu.isOpen) return e.preventDefault();
    cancelLongPress();
    if (openObjectMenu(local(e), e.clientX, e.clientY)) e.preventDefault();
  });
  app.canvas.addEventListener('dblclick', (e) => {
    const pos = local(e);
    const [x, y] = app.vp.toWorld(pos[0], pos[1]);
    // Measuring: two quick clicks are two ends, not a reason to fit the view.
    if (app.measure.active) return;
    if (app.drawTool.active) {
      // The pen ends an open line; the other tools ignore it.
      app.drawTool.finish(false);
      return;
    }
    if (app.rungTool.active) return;
    if (app.shapeTool.active) {
      // A double-click on a loop selects all its nodes (as in vector programs); with Alt it puts a node there.
      if (e.altKey) app.shapeTool.insertAt(x, y, app.vp.scale);
      else app.shapeTool.selectLoopAt(x, y, app.vp.scale);
      return;
    }
    if (app.editor.active) {
      // Stitching on, each click of the two set a point already.
      if (!app.editor.penOn) app.editor.insertAt(x, y, app.vp.scale);
      return;
    }
    const p = app.files.active?.pattern;
    if (app.settings.mode === 'flow' && p) {
      // A double-click on an object opens its outline (a fill) or its stitches.
      const st = app.styleFor(p);
      const i = stitchAt(p, x * 10, y * 10, Math.max(3, 60 / app.vp.scale), st.limit, st.alpha);
      const o = i >= 0 ? app.seq(p).objectAt[i] : -1;
      // A lettering opens its text; one of its letters, while they are moved, nothing more.
      if (o >= 0 && app.letteringsOf(p, app.seq(p))[o]) {
        if (!ui.letterMode) {
          if (!ui.selectedObjects.has(o)) app.selectObjects([o], false);
          ui.focusText = true;
          app.redraw();
        }
        return;
      }
      if (o >= 0) return app.enterShape(o, true);
    }
    app.fitView();
  });

  return { showObjectMenu };
}
