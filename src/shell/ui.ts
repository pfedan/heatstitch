import { t, type Key } from '../i18n';
import { STORAGE_NS } from '../storage/namespace';
import { canRun, getCommand, keyLabel, type Command } from './commands';
import { h } from './h';

/* Building blocks of the new interface, styled in shell.css (design-system/heatstitch/MASTER.md). */

// Toast --------------------------------------------------------------------------------------------

let toastBox: HTMLElement | null = null;
let toastTimer = 0;

/**
 * A short note at the bottom of the stage instead of a dialog: "3 Objekte gelöscht · Rückgängig".
 * The action button runs once; the note goes away by itself after a few seconds.
 */
export function toast(message: string, action?: { label: string; run: () => void }): void {
  if (!toastBox) {
    toastBox = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: true });
    document.body.appendChild(toastBox);
  }
  const box = toastBox;
  const btn = action
    ? h('button', {
        type: 'button',
        class: 'link',
        onclick: () => {
          box.hidden = true;
          action.run();
        },
      }, action.label)
    : null;
  box.replaceChildren(...[h('span', null, message), btn].filter((n): n is HTMLElement => !!n));
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (box.hidden = true), action ? 6000 : 3500);
}

// Menu ---------------------------------------------------------------------------------------------

export type MenuItem = string | Command | '-' | { label: string; run: () => void; disabled?: boolean; danger?: boolean };

let openMenu: { el: HTMLElement; close: () => void } | null = null;

/** Fingers on the screen: a menu opened by a long press must not take the lifting finger as a tap. */
let touches = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && touches++, true);
  for (const ev of ['pointerup', 'pointercancel'] as const) document.addEventListener(ev, (e) => e.pointerType === 'touch' && (touches = Math.max(0, touches - 1)), true);
}

/**
 * A menu at a point (context menu) or under an element. Items are command ids (shown with their
 * keys, disabled when they cannot run), plain entries or '-' for a line.
 */
export function showMenu(items: MenuItem[], at: { x: number; y: number } | HTMLElement, label?: string): void {
  openMenu?.close();
  // Opened under a finger (long press): its lifting is no choice; the next touch or key is.
  let held = touches > 0;
  const rows: HTMLElement[] = [];
  for (const it of items) {
    if (it === '-') {
      if (rows.length && !rows[rows.length - 1].classList.contains('menu-sep')) rows.push(h('li', { class: 'menu-sep', role: 'separator' }));
      continue;
    }
    const cmd = typeof it === 'string' ? getCommand(it) : 'id' in it ? it : null;
    if (typeof it === 'string' && !cmd) continue;
    const text = cmd ? t(cmd.label) : (it as { label: string }).label;
    const disabled = cmd ? !canRun(cmd) : !!(it as { disabled?: boolean }).disabled;
    const run = cmd ? cmd.run : (it as { run: () => void }).run;
    const danger = !cmd && !!(it as { danger?: boolean }).danger;
    rows.push(
      h(
        'li',
        { role: 'none' },
        h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            class: danger ? 'danger' : '',
            disabled,
            onclick: () => {
              if (held) return;
              close();
              run();
            },
          },
          h('span', null, text),
          cmd?.keys?.length ? h('kbd', null, keyLabel(cmd.keys[0])) : null,
        ),
      ),
    );
  }
  while (rows.length && rows[rows.length - 1].classList.contains('menu-sep')) rows.pop();
  const el = h('ul', { class: 'menu', role: 'menu', 'aria-label': label ?? '' }, rows);
  el.addEventListener('pointerdown', () => (held = false), true);
  el.addEventListener('keydown', () => (held = false), true);
  document.body.appendChild(el);
  const r = at instanceof HTMLElement ? at.getBoundingClientRect() : null;
  const x = r ? r.left : (at as { x: number }).x;
  const y = r ? r.bottom + 4 : (at as { y: number }).y;
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  el.style.left = `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(y, innerHeight - hgt - 8))}px`;
  el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });

  const onDown = (e: PointerEvent) => {
    if (!el.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const bs = [...el.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const i = bs.indexOf(document.activeElement as HTMLButtonElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]?.focus();
    }
  };
  const close = () => {
    el.remove();
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
    if (openMenu?.el === el) openMenu = null;
  };
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);
  openMenu = { el, close };
}

export function closeMenu(): void {
  openMenu?.close();
}

// Section ------------------------------------------------------------------------------------------

const SECTIONS = `${STORAGE_NS}.ui.sections`;
const readSections = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
};

/** A collapsible group in the inspector; whether it is open is remembered per id. */
export function section(id: string, title: Key | (() => string), body: Node[], opts: { open?: boolean; extra?: Node } = {}): HTMLDetailsElement {
  const stored = readSections()[id];
  const head = h('span', { class: 'sec-title' });
  const label = () => (typeof title === 'function' ? title() : t(title));
  head.textContent = label();
  const d = h('details', { class: 'sec', 'data-sec': id }, h('summary', null, head, opts.extra ?? null), ...body);
  d.open = stored ?? opts.open ?? true;
  d.addEventListener('toggle', () => {
    try {
      localStorage.setItem(SECTIONS, JSON.stringify({ ...readSections(), [id]: d.open }));
    } catch {
      /* private mode: the state is just not kept */
    }
  });
  return d;
}

// Fields -------------------------------------------------------------------------------------------

/**
 * A slider with its value and unit. `auto`: the value comes from the automatic choice; a small
 * dot shows that and a click on it goes back to automatic when the user set an own value.
 */
export function slider(opts: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  format?: (v: number) => string;
  auto?: { on: boolean; reset: () => void; hint: string };
  oninput?: (v: number) => void;
  onchange?: (v: number) => void;
}): HTMLElement {
  const fmt = opts.format ?? ((v: number) => String(v));
  const out = h('output', null, `${fmt(opts.value)}${opts.unit ? ` ${opts.unit}` : ''}`);
  const input = h('input', { type: 'range', min: opts.min, max: opts.max, step: opts.step, value: opts.value });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = `${fmt(v)}${opts.unit ? ` ${opts.unit}` : ''}`;
    opts.oninput?.(v);
  });
  input.addEventListener('change', () => opts.onchange?.(Number(input.value)));
  const dot = opts.auto
    ? h('button', {
        type: 'button',
        class: `auto-dot ${opts.auto.on ? 'on' : ''}`,
        title: opts.auto.hint,
        'aria-label': opts.auto.hint,
        disabled: opts.auto.on,
        onclick: opts.auto.reset,
      })
    : null;
  return h('label', { class: 'field' }, h('span', { class: 'label' }, h('span', null, opts.label), dot, out), input);
}
