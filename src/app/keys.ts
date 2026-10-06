import type { DrawKind, DrawTool } from '../ui/drawTool';
import type { Editor } from '../ui/editor';
import type { FrameTool } from '../ui/frameTool';
import type { OrderCard } from '../ui/objectPanel';
import type { Player } from '../ui/player';
import type { RungTool } from '../ui/rungTool';
import type { ShapeTool } from '../ui/shapeTool';
import { FileList, type LoadedFile } from '../ui/fileList';
import { saveSettings, type Mode, type Settings } from '../settings';
import { translation, type Mat } from '../shape/path';
import { ui } from './state';

/** What bindKeys needs from the rest of the app. */
export interface KeysApp {
  readonly closeRungs: () => void;
  readonly closeShape: () => void;
  readonly commitTransform: (m: Mat) => void;
  readonly controls: { refresh: () => void; };
  readonly deleteSelected: () => void;
  readonly drawTool: DrawTool;
  readonly duplicateSelected: () => void;
  readonly editor: Editor;
  readonly enterObject: (o: number, fit: boolean) => void;
  readonly enterShape: (o: number, fit: boolean) => void;
  readonly files: FileList;
  readonly fitView: (f?: LoadedFile | null) => void;
  readonly frameObjects: () => number[];
  readonly frameTool: FrameTool;
  readonly history: (step: 'undo' | 'redo' | 'revert') => void;
  readonly letterMoved: (at: number, dx0: number, dy0: number, wx: number, wy: number, final: boolean) => void;
  readonly newLettering: () => Promise<void>;
  readonly orderCard: OrderCard;
  readonly pinPlan: (ids: number[] | null) => void;
  readonly player: Player;
  readonly redraw: () => void;
  readonly revealRecord: (i: number) => void;
  readonly selectObjects: (objs: number[], toggle: boolean) => void;
  readonly rungTool: RungTool;
  readonly setComparing: (on: boolean) => void;
  readonly setDrawing: (kind: DrawKind | null) => void;
  readonly setEditing: (on: boolean) => void;
  readonly setFormLevel: (on: boolean) => void;
  readonly setLetterMode: (on: boolean) => void;
  readonly setMode: (mode: Mode) => void;
  readonly settings: Settings;
  readonly shapeTool: ShapeTool;
  readonly stepJump: (dir: 1 | -1) => void;
  readonly stepZone: (dir: 1 | -1) => void;
  readonly toggleGuides: () => void;
  readonly toggleRungs: () => void;
}

/** Keyboard shortcuts on the whole page (not while typing in a field). */
export function bindKeys(app: KeysApp) {
  window.addEventListener('keydown', (e) => {
    // Space passes a clicked switch (checkbox, radio) to reach the player below, like a button.
    const field = (e.target as HTMLElement).closest<HTMLElement>('input, select, textarea, [contenteditable]');
    const toggle = field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio');
    if (field && !(toggle && e.key === ' ')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && ['z', 'Z', 'y'].includes(e.key)) {
      e.preventDefault();
      app.history(e.key === 'y' || e.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (mod && !e.altKey && (e.key === 'd' || e.key === 'D') && app.settings.mode === 'flow' && app.frameObjects().length === 1) {
      e.preventDefault();
      app.duplicateSelected();
      return;
    }
    if (mod && e.key === 'a' && app.editor.active) {
      e.preventDefault();
      app.editor.selectAll();
      return;
    }
    if (mod || e.altKey) return;
    if (e.key === 'Escape' && ui.planPin) return app.pinPlan(null);
    if (app.drawTool.active && app.settings.mode === 'flow') {
      if (e.key === 'Escape') {
        if (app.drawTool.busy) {
          app.drawTool.cancel();
          app.redraw();
        } else app.setDrawing(null);
        return;
      }
      if (e.key === 'Enter' && app.drawTool.busy) {
        e.preventDefault();
        return app.drawTool.finish(false);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && app.drawTool.removeLast()) {
        e.preventDefault();
        return;
      }
    }
    // v and the keys of the drawing tools (m, o, b, p) are commands of the tool rail: src/areas/shapes.
    if (app.shapeTool.active && app.settings.mode === 'flow') {
      const step = e.shiftKey ? 0.5 : 0.1;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (e.key in arrows && app.shapeTool.selected) {
        e.preventDefault();
        app.shapeTool.nudge(...arrows[e.key]);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && app.shapeTool.deleteSelected()) {
        e.preventDefault();
        return;
      }
      if (e.key === 'c' && app.shapeTool.toggleSmooth()) return;
      // Esc: first the node, then one level back to the objects (the selection stays).
      if (e.key === 'Escape') {
        if (app.shapeTool.selected) {
          app.shapeTool.selected = null;
          app.redraw();
        } else app.setFormLevel(false);
        return;
      }
      if (e.key === 'Enter' && ui.shapeObject !== null) return app.enterObject(ui.shapeObject, false);
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && app.settings.mode === 'flow' && !app.drawTool.busy && app.frameObjects().length) {
      e.preventDefault();
      return app.deleteSelected();
    }
    // One object chosen (level Objects): the arrow keys move it, Enter goes into its outline.
    if (app.frameTool.active && app.settings.mode === 'flow' && !(e.target as HTMLElement).closest('button')) {
      const step = e.shiftKey ? 1 : 0.1;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (e.key in arrows) {
        e.preventDefault();
        app.commitTransform(translation(...arrows[e.key]));
        return;
      }
    }
    if (ui.lettering && app.settings.mode === 'flow' && !(e.target as HTMLElement).closest('button')) {
      if (ui.letterMode) {
        const step = e.shiftKey ? 1 : 0.1;
        const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (e.key in arrows && ui.letterAt !== null) {
          e.preventDefault();
          const o = ui.lettering.l.letters.find((v) => v.at === ui.letterAt);
          app.letterMoved(ui.letterAt, o?.dx ?? 0, o?.dy ?? 0, ...arrows[e.key], true);
          return;
        }
        if (e.key === 'Escape') {
          if (ui.letterAt !== null) {
            ui.letterAt = null;
            app.redraw();
          } else app.setLetterMode(false);
          return;
        }
        if (e.key === 'Enter') return;
      } else if (e.key === 'Enter') return app.setLetterMode(true);
      if (e.key === 'e' || e.key === 'r' || e.key === 'g') return;
    }
    if (app.rungTool.active && app.settings.mode === 'flow') {
      if ((e.key === 't' || e.key === 'T') && app.rungTool.mode !== 'guide' && !mod) return app.rungTool.setCutMode(!app.rungTool.cutMode);
      if ((e.key === 'Delete' || e.key === 'Backspace') && app.rungTool.deleteSelected()) {
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        if (app.rungTool.selected) {
          app.rungTool.selected = null;
          app.redraw();
        } else app.closeRungs();
        return;
      }
    }
    if (app.editor.active && app.editor.selection.size) {
      const step = e.shiftKey ? 5 : 1; // 0.1 mm, with Shift 0.5 mm
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (e.key in arrows) {
        e.preventDefault();
        app.editor.nudge(...arrows[e.key]);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        app.editor.deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        app.editor.selection.clear();
        app.redraw();
        return;
      }
      if (e.key === 'i') {
        app.editor.splitSelected();
        return;
      }
    }
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      app.setMode(e.key === '1' ? 'flow' : e.key === '2' ? 'density' : 'image');
      return;
    }
    if (app.settings.mode === 'image') {
      if (e.key === 'f') app.fitView();
      return;
    }
    if (e.key === 'h') return void document.getElementById('marks-toggle')?.click();
    if (app.settings.mode === 'flow') {
      // Enter still presses a focused button; Space always plays, not the button clicked last (Einpassen...).
      if (toggle || (e.target as HTMLElement).closest('button')) {
        if (e.key === 'Enter') return;
        if (e.key === ' ') {
          e.preventDefault();
          return app.player.toggle();
        }
      }
      if (e.key === 'e') {
        app.closeRungs();
        return app.setEditing(!app.editor.active);
      }
      if (e.key === 'r') return app.toggleRungs();
      if (e.key === 'g') return app.toggleGuides();
      if (e.key === 't' && !app.editor.active && !app.shapeTool.active && !app.rungTool.active) return void app.newLettering();
      if (app.editor.active) {
        if (e.key === 'Escape') return app.setEditing(false);
        if (e.key === ',' || e.key === '.') {
          e.preventDefault();
          const i = app.editor.step(e.key === '.' ? 1 : -1);
          if (i >= 0) app.revealRecord(i);
          return;
        }
      } else if (e.key === 'Enter' && ui.selectedObjects.size === 1) return app.enterShape([...ui.selectedObjects][0], true);
      if (e.key === ' ') {
        e.preventDefault();
        app.player.toggle();
      } else if (e.key === ',' || e.key === '.') app.player.step((e.key === '.' ? 1 : -1) * (e.shiftKey ? 100 : 1));
      else if (e.key === 'Home') app.player.set(0);
      else if (e.key === 'End') app.player.set(Number.MAX_SAFE_INTEGER);
      else if (e.key === 'n') app.stepJump(1);
      else if (e.key === 'N') app.stepJump(-1);
      else if (e.key === 'ArrowDown' || e.key === 'j') app.files.step(1);
      else if (e.key === 'ArrowUp' || e.key === 'k') app.files.step(-1);
      else if (e.key === 'f') app.fitView();
      else if (e.key === 'Escape') {
        if (app.orderCard.isOpen) app.orderCard.close(true);
        else if (ui.formLevel) app.setFormLevel(false);
        else if (ui.selectedObjects.size) ui.selectedObjects = new Set();
        else ui.selectedJump = ui.focusBlock = null;
        app.redraw();
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'j') app.files.step(1);
    else if (e.key === 'ArrowUp' || e.key === 'k') app.files.step(-1);
    else if (e.key === 'f') app.fitView();
    else if (e.key === 'e') app.setEditing(!app.editor.active);
    else if (e.key === 'c' && FileList.edited(app.files.active)) app.setComparing(!ui.comparing);
    else if (e.key === 'n') app.stepZone(1);
    else if (e.key === 'N') app.stepZone(-1);
    else if (e.key === 'v') {
      app.settings.showValidation = !app.settings.showValidation;
      saveSettings(app.settings);
      app.controls.refresh();
      app.redraw();
    } else if (e.key === 'Escape' && ui.selectedZone) {
      ui.selectedZone = null;
      app.redraw();
    } else if (e.key === 'Escape' && app.editor.active) app.setEditing(false);
  });
}
