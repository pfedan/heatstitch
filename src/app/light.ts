import type { Editor } from '../ui/editor';
import type { ImageMode } from '../ui/imageMode';
import { lightFromTilt, sweep } from '../render/light';
import { saveSettings, type Settings } from '../settings';

/** What bindLight needs from the rest of the app. */
export interface LightApp {
  readonly controls: { refresh: () => void; };
  readonly editor: Editor;
  readonly imageMode: ImageMode;
  readonly redraw: () => void;
  readonly settings: Settings;
}

/** Living thread: the light of the realistic view follows the pointer or the tilt of a phone. */
export function bindLight(app: LightApp) {
  const $ = (id: string) => document.getElementById(id) as HTMLElement;

  /** Whether the canvas shows realistic threads right now. */
  const threadsShown = () =>
    app.settings.realistic &&
    (app.settings.mode === 'flow' || (app.settings.mode === 'density' && (app.settings.overlay || app.editor.active)) || (app.settings.mode === 'image' && app.settings.image.view === 'stitches'));

  let tiltListening = false;
  function listenTilt(): void {
    if (tiltListening) return;
    tiltListening = true;
    window.addEventListener('deviceorientation', (e) => {
      if (e.beta === null || e.gamma === null || !app.settings.liveLight || !threadsShown()) return;
      lightFromTilt(e.beta, e.gamma);
      app.redraw();
    });
  }
  /** iOS asks before a page may read the tilt, and only from a tap. */
  const tiltPermission = (window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined)?.requestPermission;
  async function allowTilt(): Promise<void> {
    if (!tiltPermission) return listenTilt();
    try {
      if ((await tiltPermission.call(window.DeviceOrientationEvent)) === 'granted') {
        listenTilt();
        $('allow-tilt').hidden = true;
      }
    } catch {
      // Refused or not over HTTPS: the pointer still moves the light.
    }
  }
  if ('DeviceOrientationEvent' in window && !tiltPermission) listenTilt();
  $('allow-tilt').hidden = !tiltPermission;
  $('allow-tilt').addEventListener('click', () => void allowTilt());

  /** Shows the converted image as sewn thread and lets the light go round once. */
  function shine(): void {
    app.settings.realistic = true;
    app.settings.liveLight = true;
    app.settings.image.view = 'stitches';
    saveSettings(app.settings);
    app.controls.refresh();
    app.imageMode.render();
    sweep(app.redraw);
  }
  $('image-shine').addEventListener('click', () => {
    void allowTilt();
    shine();
  });

  return { shine, threadsShown };
}
