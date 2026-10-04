import type { PanelWidths } from '../settings';

export type PanelSide = keyof PanelWidths;

/** Narrowest and widest a side column may be dragged to, in px. */
export const PANEL_LIMITS: Record<PanelSide, { min: number; max: number }> = {
  side: { min: 220, max: 560 },
  inspector: { min: 240, max: 600 },
};

/** The canvas keeps at least this much width while a column is dragged wider. */
export const STAGE_MIN = 320;

const STEP = 16;
const BIG_STEP = 64;

/** Keeps a column width inside its limits and leaves the canvas room next to the other column. */
export function clampPanel(which: PanelSide, px: number, layoutWidth: number, otherWidth: number): number {
  const { min, max } = PANEL_LIMITS[which];
  const room = layoutWidth - otherWidth - STAGE_MIN;
  return Math.round(Math.max(min, Math.min(max, room, px)));
}

const VAR: Record<PanelSide, string> = { side: '--side-w', inspector: '--insp-w' };

/**
 * Makes the edges between the side columns and the canvas draggable, with arrow keys on the
 * focused edge as well. Double click or Enter goes back to the width that follows the window.
 */
export function installPanelResize(layout: HTMLElement, widths: PanelWidths, save: () => void): void {
  const column = (which: PanelSide) => layout.querySelector<HTMLElement>(which === 'side' ? '.sidebar' : '.inspector')!;
  const current = (which: PanelSide) => column(which).getBoundingClientRect().width;
  const other = (which: PanelSide): PanelSide => (which === 'side' ? 'inspector' : 'side');

  const apply = (which: PanelSide) => {
    const w = widths[which];
    if (w === null) layout.style.removeProperty(VAR[which]);
    else layout.style.setProperty(VAR[which], `${w}px`);
  };
  const sync = (handle: HTMLElement, which: PanelSide) => {
    handle.setAttribute('aria-valuenow', String(Math.round(current(which))));
  };
  const set = (handle: HTMLElement, which: PanelSide, px: number | null) => {
    widths[which] = px === null ? null : clampPanel(which, px, layout.clientWidth, current(other(which)));
    apply(which);
    sync(handle, which);
  };

  for (const handle of layout.querySelectorAll<HTMLElement>('.resizer')) {
    const which = handle.dataset.panel as PanelSide;
    const { min, max } = PANEL_LIMITS[which];
    handle.setAttribute('aria-valuemin', String(min));
    handle.setAttribute('aria-valuemax', String(max));
    apply(which);
    sync(handle, which);
    // The left edge grows its column to the right, the right edge to the left.
    const dir = which === 'side' ? 1 : -1;

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const x0 = e.clientX;
      const w0 = current(which);
      document.body.classList.add('resizing');
      handle.classList.add('dragging');
      const move = (ev: PointerEvent) => set(handle, which, w0 + dir * (ev.clientX - x0));
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing');
        handle.classList.remove('dragging');
        save();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });

    handle.addEventListener('dblclick', () => {
      set(handle, which, null);
      save();
    });

    handle.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? BIG_STEP : STEP;
      let px: number | null;
      if (e.key === 'ArrowRight') px = current(which) + dir * step;
      else if (e.key === 'ArrowLeft') px = current(which) - dir * step;
      else if (e.key === 'Home') px = min;
      else if (e.key === 'End') px = max;
      else if (e.key === 'Enter') px = null;
      else return;
      e.preventDefault();
      // Keys like 1 to 3 switch modes elsewhere; the edge keeps its own.
      e.stopPropagation();
      set(handle, which, px);
      save();
    });
  }

  // A narrower window can leave a stored width too wide; the CSS caps it, the value follows here.
  new ResizeObserver(() => {
    for (const handle of layout.querySelectorAll<HTMLElement>('.resizer')) sync(handle, handle.dataset.panel as PanelSide);
  }).observe(layout);
}
