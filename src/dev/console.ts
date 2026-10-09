/**
 * Developer tools in the browser console, under `heatstitch`: recording a session for bug reports
 * and tutorial drafts (src/dev/recorder.ts, loaded only when asked for), and what a replay needs
 * to drive and check the app (tools/recording). Nothing here shows for a normal user.
 *
 *   heatstitch.record()  starts recording, until the page is reloaded or stop() is called
 *   heatstitch.stop()    ends it; saving the project still writes what was recorded
 *   heatstitch.save()    saves the project with the recording (also when no design is open)
 */
import type { FileList } from '../ui/fileList';
import type { Viewport } from '../render/viewport';
import type { Project } from '../storage/project';
import type { Pattern } from '../model/pattern';
import type { Recorder, Recording } from './recorder';

/** What the console tools need from the app. */
export interface DevApp {
  readonly canvas: HTMLCanvasElement;
  readonly vp: Viewport;
  readonly files: FileList;
  readonly redraw: () => void;
  /** Everything open, as saving a project writes it. */
  readonly project: () => Project;
  /** Saves the project (with the recording, while there is one). */
  readonly save: () => Promise<void>;
}

/** The active design in a form a replay compares: its name, size and a hash of its stitches and colors. */
export interface DesignState {
  file: string | null;
  /** Records (stitches, jumps, trims, color changes). */
  n: number;
  /** Earlier versions kept for undo. */
  undo: number;
  /** FNV-1a over coordinates, commands and colors, as 8 hex digits. */
  h: string;
}

/** The view as a replay restores it: pixels per mm and the point (mm) in the middle of the stage. */
export interface ViewState {
  scale: number;
  cx: number;
  cy: number;
}

let recorder: Recorder | null = null;

/** The recording to store in a project being saved, if one was made since the page loaded. */
export function recordingForSave(): Recording | undefined {
  return recorder?.recording();
}

export function hashPattern(p: Pattern): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= v >>> 24;
    h = Math.imul(h, 0x01000193);
  };
  for (let i = 0; i < p.cmd.length; i++) {
    mix(p.x[i]);
    mix(p.y[i]);
    mix(p.cmd[i]);
  }
  for (const c of p.colors) mix((c.r << 16) | (c.g << 8) | c.b);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function designState(files: FileList): DesignState {
  const f = files.active;
  const p = f?.pattern;
  return { file: f?.fileName ?? null, n: p?.cmd.length ?? 0, undo: f?.undo.length ?? 0, h: p ? hashPattern(p) : '' };
}

export function viewState(app: DevApp): ViewState {
  const r = app.canvas.getBoundingClientRect();
  const [cx, cy] = app.vp.toWorld(r.width / 2, r.height / 2);
  return { scale: app.vp.scale, cx, cy };
}

/** Installs `window.heatstitch`. */
export function installDevConsole(app: DevApp): void {
  const tools = {
    async record(): Promise<string> {
      if (recorder?.running) return 'Aufzeichnung läuft schon. / Already recording.';
      const { startRecorder } = await import('./recorder');
      recorder = await startRecorder(app);
      return 'Aufzeichnung läuft bis zum Neuladen; Projekt speichern schreibt sie in die Datei. / Recording until reload; saving the project stores it.';
    },
    stop(): string {
      if (!recorder?.running) return 'Keine Aufzeichnung. / Not recording.';
      recorder.stop();
      return `Aufzeichnung beendet: ${recorder.recording().events.length} Schritte. Projekt speichern oder heatstitch.save(). / Stopped.`;
    },
    async save(): Promise<void> {
      await app.save();
    },
    /** The active design, for a replay to compare with what was recorded. */
    state: (): DesignState => designState(app.files),
    view: (): ViewState => viewState(app),
    /** Sets the view (see ViewState). */
    setView(v: ViewState): void {
      const r = app.canvas.getBoundingClientRect();
      app.vp.scale = v.scale;
      app.vp.offsetX = r.width / 2 - v.cx * v.scale;
      app.vp.offsetY = r.height / 2 - v.cy * v.scale;
      app.redraw();
    },
    /** A point of the design (mm) in page pixels, where a replay clicks for it. */
    toPage(x: number, y: number): [number, number] {
      const r = app.canvas.getBoundingClientRect();
      const [sx, sy] = app.vp.toScreen(x, y);
      return [r.left + sx, r.top + sy];
    },
  };
  (window as unknown as { heatstitch: typeof tools }).heatstitch = tools;
}
