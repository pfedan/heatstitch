import { onLangChange } from '../i18n';

/**
 * One tooltip for the whole app instead of the browser's title box, which comes late, cannot be
 * styled and never shows on touch or keyboard focus.
 *
 * Code and markup keep writing `title` (by hand, data-i18n-title, commandTitle): the moment one is
 * set, it moves to `data-tip`, so the browser has nothing of its own to show. A language switch
 * that writes the title anew moves it again. An element with no name of its own (a bare icon) gets
 * the text as its aria-label, so a screen reader still has one.
 *
 * Shown after a short rest of the mouse, at once while moving along a row of buttons, on keyboard
 * focus and on a long press on touch (which then does not click). A key at the end of the text,
 * "Duplizieren (Strg+D)", is set apart as a key.
 *
 * Where a picture says it better than words, `data-tip-img="name"` adds a small screenshot from
 * public/tips/name.webp (made by tools/tips/shoot.mjs) above the text.
 */

const SHOW_MS = 450;
/** A tooltip closed less than this ago: the next one shows at once (moving along a toolbar). */
const WARM_MS = 400;
const FOCUS_MS = 150;
const PRESS_MS = 500;
const TOUCH_STAY_MS = 1600;
const GAP = 6;
const EDGE = 8;

/** Elements whose title stays the browser's: options of a native list are drawn by the system. */
const NATIVE = new Set(['OPTION', 'OPTGROUP', 'IFRAME', 'LINK', 'STYLE', 'ABBR']);

const MOD = '(?:Strg|Ctrl|Umschalt|Shift|Alt|Cmd|⌘|⇧|⌥)';
const KEY = '(?:[A-Z0-9?+\\-.,/<>#]|F\\d{1,2}|Entf|Del|Esc|Enter|Tab|Leertaste|Space|Pos1|Home|Ende|End|Rücktaste|Backspace|Bild↑|Bild↓|[↑↓←→])';
const COMBO = `(?:${MOD}\\+?)*${KEY}`;
/** "(Strg+D)", "(H)", "(Taste G)", "(key G)", "(Strg+C, Strg+V)" at the end of a text. */
const KEYS_AT_END = new RegExp(`^([\\s\\S]*?)\\s*\\((?:Taste |key )?(${COMBO}(?:\\s*(?:,|/)\\s*${COMBO})*)\\)$`, 'i');

/** Splits a tooltip text into what it says and the keys at its end, if any. */
export function splitKeys(text: string): { text: string; keys: string[] } {
  const m = KEYS_AT_END.exec(text.trim());
  if (!m || !m[1]) return { text: text.trim(), keys: [] };
  return { text: m[1], keys: m[2].split(/\s*[,/]\s*/) };
}

let tip: HTMLDivElement;
let current: HTMLElement | null = null;
let timer = 0;
/** The element whose tooltip is waiting for its delay. */
let pending: HTMLElement | null = null;
let hiddenAt = 0;
let byTouch = false;
let swallowClickUntil = 0;

/** Moves a title to data-tip; an element with no name of its own keeps the text as aria-label. */
function adopt(el: Element): void {
  if (!(el instanceof HTMLElement || el instanceof SVGElement) || NATIVE.has(el.tagName)) return;
  const title = el.getAttribute('title');
  if (title === null) return;
  el.removeAttribute('title');
  if (title.trim()) el.setAttribute('data-tip', title);
  else el.removeAttribute('data-tip');
  // Our own label from an earlier title follows the new one; a label the code set itself stays.
  const ours = el.hasAttribute('data-tip-label');
  if (ours || (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && !el.textContent?.trim())) {
    if (title.trim()) {
      el.setAttribute('aria-label', splitKeys(title).text);
      el.setAttribute('data-tip-label', '');
    }
  }
  if (el === current) {
    if (title.trim()) render(el);
    else hide();
  }
}

function adoptAll(root: ParentNode): void {
  if (root instanceof Element && root.hasAttribute('title')) adopt(root);
  root.querySelectorAll('[title]').forEach(adopt);
}

const pictures = new Map<string, HTMLImageElement>();

/** The screenshot for `name`, sized before it loads so the box is placed right at once. */
function picture(name: string): HTMLImageElement {
  let img = pictures.get(name);
  if (!img) {
    img = Object.assign(document.createElement('img'), { className: 'tip-img', src: `${import.meta.env.BASE_URL}tips/${name}.webp`, alt: '', width: 200, height: 125, decoding: 'async' });
    pictures.set(name, img);
  }
  return img;
}

function render(el: HTMLElement): void {
  const { text, keys } = splitKeys(el.getAttribute('data-tip') ?? '');
  const body = document.createElement('span');
  body.className = 'tip-text';
  body.textContent = text;
  const parts: Node[] = [body];
  if (keys.length) {
    const k = document.createElement('span');
    k.className = 'tip-keys';
    for (const key of keys) k.appendChild(Object.assign(document.createElement('kbd'), { textContent: key }));
    parts.push(k);
  }
  const img = el.getAttribute('data-tip-img');
  if (img) parts.unshift(picture(img));
  tip.classList.toggle('has-img', !!img);
  tip.replaceChildren(...parts);
  place(el);
}

/**
 * Below the element, centred; above it when there is no room below. Beside a standing toolbar (the
 * tool rail) to its right, where it covers no other tool. Always inside the window.
 */
function place(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  tip.style.left = '0px';
  tip.style.top = '0px';
  const w = tip.offsetWidth;
  const hgt = tip.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const bar = el.closest('[role=toolbar]');
  const standing = !!bar && bar.clientHeight > bar.clientWidth * 2;
  let left: number;
  let top: number;
  let side: string;
  if (standing && r.right + GAP + w <= vw - EDGE) {
    left = r.right + GAP;
    top = r.top + r.height / 2 - hgt / 2;
    side = 'right';
  } else {
    left = r.left + r.width / 2 - w / 2;
    top = r.bottom + GAP;
    side = 'below';
    if (top + hgt > vh - EDGE && r.top - GAP - hgt >= EDGE) {
      top = r.top - GAP - hgt;
      side = 'above';
    }
  }
  left = Math.min(Math.max(EDGE, left), vw - EDGE - w);
  top = Math.min(Math.max(EDGE, top), vh - EDGE - hgt);
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  tip.dataset.side = side;
}

function show(el: HTMLElement): void {
  clearTimeout(timer);
  pending = null;
  if (!el.isConnected || !el.hasAttribute('data-tip')) return;
  if (current && current !== el) current.removeAttribute('aria-describedby');
  current = el;
  // A modal dialog lies above everything else on the page, so the tooltip goes into it.
  const host = el.closest('dialog[open]') ?? document.body;
  if (tip.parentNode !== host) host.appendChild(tip);
  // Shown before it is filled and placed: a hidden box has no size to place by.
  tip.hidden = false;
  render(el);
  // Read out as a description, unless it already is the element's name.
  const named = el.hasAttribute('data-tip-label') || el.getAttribute('aria-label') === el.getAttribute('data-tip');
  if (!named && !el.hasAttribute('aria-describedby')) el.setAttribute('aria-describedby', tip.id);
  // The fade starts from the hidden state only once the box is placed.
  requestAnimationFrame(() => tip.classList.add('on'));
}

function hide(): void {
  clearTimeout(timer);
  pending = null;
  if (current) {
    if (current.getAttribute('aria-describedby') === tip.id) current.removeAttribute('aria-describedby');
    hiddenAt = performance.now();
  }
  current = null;
  byTouch = false;
  tip.classList.remove('on');
  tip.hidden = true;
}

function schedule(el: HTMLElement, ms: number): void {
  if (el === pending) return;
  clearTimeout(timer);
  pending = el;
  if (current && current !== el) hide();
  const warm = performance.now() - hiddenAt < WARM_MS;
  if (ms === 0 || warm) show(el);
  else timer = window.setTimeout(() => show(el), ms);
}

const tipOf = (t: EventTarget | null): HTMLElement | null =>
  t instanceof Element ? (t.closest('[data-tip]') as HTMLElement | null) : null;

/** Starts the tooltip layer once, for everything on the page now and later. */
export function initTooltips(): void {
  if (tip) return;
  tip = document.createElement('div');
  tip.className = 'tip';
  tip.id = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);

  adoptAll(document.body);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') adopt(r.target as Element);
      else r.addedNodes.forEach((n) => n instanceof Element && adoptAll(n));
    }
    if (current && !current.isConnected) hide();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = tipOf(e.target);
    if (el === current && el) return;
    if (el) schedule(el, SHOW_MS);
    else if (!byTouch) hide();
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch' || byTouch) return;
    const el = tipOf(e.target);
    if (!el) return;
    const to = e.relatedTarget;
    if (to instanceof Node && el.contains(to)) return;
    if (el === current) hide();
    else if (el === pending) {
      clearTimeout(timer);
      pending = null;
    }
  });

  // Touch: a long press shows the text and stays a moment after lifting; it does not also click.
  let pressAt: [number, number] | null = null;
  document.addEventListener('pointerdown', (e) => {
    const el = e.pointerType === 'touch' ? tipOf(e.target) : null;
    if (!el) {
      hide();
      return;
    }
    hide();
    pressAt = [e.clientX, e.clientY];
    timer = window.setTimeout(() => {
      show(el);
      byTouch = true;
    }, PRESS_MS);
  });
  document.addEventListener('pointermove', (e) => {
    if (!pressAt || e.pointerType !== 'touch') return;
    if (Math.hypot(e.clientX - pressAt[0], e.clientY - pressAt[1]) > 10) {
      pressAt = null;
      if (!byTouch) clearTimeout(timer);
    }
  });
  const lift = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    pressAt = null;
    if (byTouch) {
      swallowClickUntil = performance.now() + 800;
      timer = window.setTimeout(hide, TOUCH_STAY_MS);
    } else clearTimeout(timer);
  };
  document.addEventListener('pointerup', lift);
  document.addEventListener('pointercancel', lift);
  document.addEventListener(
    'click',
    (e) => {
      if (performance.now() < swallowClickUntil) {
        swallowClickUntil = 0;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  document.addEventListener('contextmenu', (e) => {
    if (byTouch && tipOf(e.target) === current) e.preventDefault();
  });

  // Keyboard: focus by Tab shows it, a click's focus does not.
  document.addEventListener('focusin', (e) => {
    const el = tipOf(e.target);
    if (!el) return;
    let keyboard = false;
    try {
      keyboard = (e.target as Element).matches(':focus-visible');
    } catch {
      /* old browsers: no tooltip on focus */
    }
    if (keyboard) schedule(el, FOCUS_MS);
  });
  document.addEventListener('focusout', (e) => {
    if (tipOf(e.target) === current) hide();
  });
  document.addEventListener(
    'keydown',
    (e) => {
      if (!current) return;
      if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') hide();
    },
    true,
  );
  window.addEventListener('scroll', hide, true);
  window.addEventListener('wheel', hide, { passive: true });
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
  // The titles are written anew in the other language and moved again; an open one follows.
  onLangChange(() => queueMicrotask(() => current && render(current)));
}
