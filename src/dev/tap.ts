/**
 * Listens to input on the window before anything else in the app does (main.ts imports this
 * first), so a recording sees every step, also the ones a handler ends with
 * stopImmediatePropagation (the command keys, menus). Does nothing until a recording sets a sink.
 */
const TYPES = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'contextmenu', 'dblclick', 'wheel', 'dragstart', 'dragover', 'drop', 'dragend', 'keydown', 'input', 'change'] as const;

let sink: ((e: Event) => void) | null = null;

for (const type of TYPES) window.addEventListener(type, (e) => sink?.(e), { capture: true, passive: true });

export function tapInput(fn: ((e: Event) => void) | null): void {
  sink = fn;
}
