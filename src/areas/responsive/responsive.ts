import './responsive.css';
import { onLangChange, t, type Key } from '../../i18n';
import { STORAGE_NS } from '../../storage/namespace';
import { command, commandTitle, getCommand, runCommand } from '../../shell/commands';
import { h, icon } from '../../shell/h';

/**
 * Narrow screens (design-system/heatstitch/konzept.md, "Kleinere Bildschirme" and "Touch").
 *
 * Tablet (761 to 1100 px): the stage gets the width; the object list and the inspector are drawers
 * over it, opened from the top bar. Phone (up to 760 px): the tool rail is a bar at the bottom, the
 * inspector a sheet from below (peek, half, full), the object list a drawer from the left, and the
 * top bar keeps the design switcher, the two views, Save and the "more" menu.
 *
 * The object list is a navigator: it lies over the stage with a veil, a tap beside it closes it.
 * The inspector is a working panel: the stage stays usable next to it and it follows the selection;
 * a tap on an empty spot of the stage, Esc in it or its close button closes it. On the phone, a
 * selection opens the sheet at its small height (peek), so the selected object and the way to its
 * settings show without hiding the design; on the tablet it does not open by itself, because the
 * drawer would cover the part of the stage just tapped (once open, it stays open for the session).
 */

type Sheet = 'closed' | 'peek' | 'half' | 'full';
type Layout = 'desk' | 'tablet' | 'phone';

const KEY = `${STORAGE_NS}.ui.drawers`;
const TABLET = matchMedia('(max-width: 1100px)');
const PHONE = matchMedia('(max-width: 760px)');

const ICONS: Record<string, string> = {
  'rs-list': '<rect x="3" y="3.5" width="14" height="13" rx="2"/><path d="M8 3.5v13M10.5 7.5h4M10.5 10.5h4M10.5 13.5h2.5"/>',
  'rs-panel': '<rect x="3" y="3.5" width="14" height="13" rx="2"/><path d="M12 3.5v13M5.5 7.5h4M5.5 10.5h4M5.5 13.5h2.5"/>',
  'rs-close': '<path d="M5 5l10 10M15 5 5 15"/>',
  'rs-undo': '<path d="M7.5 4.5 4 8l3.5 3.5"/><path d="M4 8h7.5a4.5 4.5 0 0 1 0 9H8"/>',
  'rs-redo': '<path d="M12.5 4.5 16 8l-3.5 3.5"/><path d="M16 8H8.5a4.5 4.5 0 0 0 0 9H12"/>',
};

function addIcons(): void {
  const ns = 'http://www.w3.org/2000/svg';
  const sprite = document.querySelector<SVGSVGElement>('svg.sprite');
  if (!sprite) return;
  const markup = Object.entries(ICONS)
    .map(([id, d]) => `<symbol id="i-${id}" viewBox="0 0 20 20">${d}</symbol>`)
    .join('');
  const doc = new DOMParser().parseFromString(`<svg xmlns="${ns}">${markup}</svg>`, 'image/svg+xml');
  for (const s of [...doc.documentElement.children]) sprite.appendChild(document.importNode(s, true));
}

const read = (): { side?: boolean; insp?: Sheet } => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as { side?: boolean; insp?: Sheet };
  } catch {
    return {};
  }
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function initResponsive(): void {
  addIcons();
  const body = document.body;
  const layout = $('layout');
  const side = document.querySelector<HTMLElement>('.layout > .sidebar')!;
  const insp = $('inspector');
  const canvas = $<HTMLCanvasElement>('canvas');
  const mode = () => body.dataset.mode ?? 'flow';
  const layoutNow = (): Layout => (PHONE.matches ? 'phone' : TABLET.matches ? 'tablet' : 'desk');
  /** The image assistant keeps its own panels: they are its steps, not tools beside the work. */
  const drawers = () => layoutNow() !== 'desk' && mode() !== 'image';
  const selected = () => !$('object-panel').hidden || !$('lettering-panel').hidden;

  // State, kept for the session per drawer. The sheet's own size counts only on the phone.
  const stored = read();
  let sideOpen = !!stored.side;
  let sheet: Sheet = stored.insp ?? 'closed';
  /** The sheet was opened by a selection, not by a tap: it closes again with the selection. */
  let autoPeek = false;
  const save = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ side: sideOpen, insp: sheet }));
    } catch {
      /* private mode: just not kept */
    }
  };

  // Elements ------------------------------------------------------------------------------------
  const toggle = (id: string, cls: string, ico: string, cmd: string, label?: HTMLElement) =>
    h('button', { type: 'button', id, class: `rs-toggle ${cls}`, 'aria-expanded': 'false', onclick: () => runCommand(cmd) }, icon(ico), label ?? null, h('span', { class: 'rs-dot', 'aria-hidden': 'true' }));
  const topSide = toggle('rs-side-top', 'rs-top', 'rs-list', 'layout.objects');
  const topLabel = h('span', { class: 'rs-label' });
  const topInsp = toggle('rs-insp-top', 'rs-top', 'rs-panel', 'layout.inspector', topLabel);
  const dockLabel = h('span', { class: 'rs-label' });
  const dockSide = toggle('rs-side-dock', 'rs-dock rs-dock-side', 'rs-list', 'layout.objects');
  const dockInsp = toggle('rs-insp-dock', 'rs-dock rs-dock-insp', 'rs-panel', 'layout.inspector', dockLabel);
  document.querySelector('.topbar-start')!.append(topSide);
  document.querySelector('.topbar-end')!.prepend(topInsp);
  layout.append(dockSide, dockInsp);

  const scrim = h('div', { class: 'rs-scrim', 'aria-hidden': 'true' });
  scrim.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    setSide(false);
  });
  layout.append(scrim);

  const closeBtn = (cmd: string) => h('button', { type: 'button', class: 'rs-close', onclick: () => runCommand(cmd) }, icon('rs-close'));
  const sideClose = closeBtn('layout.objects');
  const inspClose = closeBtn('layout.inspector');
  const sideTitle = h('span', { class: 'rs-title' });
  const inspTitle = h('span', { class: 'rs-title' });
  const handle = h('button', { type: 'button', class: 'rs-handle' });
  const sideHead = h('div', { class: 'rs-head' }, sideTitle, sideClose);
  const inspHead = h('div', { class: 'rs-head rs-sheet-head' }, handle, inspTitle, inspClose);
  side.prepend(sideHead);
  insp.prepend(inspHead);

  // Undo, redo and the command search move into the "more" menu on the phone.
  const moreRow = (cmd: string, ico: string, label: Key) => {
    const b = h('button', { type: 'button', class: 'pop-row rs-phone-row', onclick: () => {
      $('more-pop').hidden = true;
      $('more-button').setAttribute('aria-expanded', 'false');
      runCommand(cmd);
    } }, icon(ico), h('span', { 'data-i18n': label }, t(label)));
    return b;
  };
  const undoRow = moreRow('edit.undo', 'rs-undo', 'edit.undo');
  const redoRow = moreRow('edit.redo', 'rs-redo', 'edit.redo');
  const searchRow = moreRow('shell.palette', 'search', 'shell.palette');
  const sep = h('div', { class: 'menu-sep rs-phone-row', role: 'separator' });
  $('more-pop').prepend(undoRow, redoRow, searchRow, sep);
  // Enabled as the commands are, each time the menu opens.
  $('more-button').addEventListener('click', () => {
    undoRow.toggleAttribute('disabled', !getCommand('edit.undo')?.when?.());
    redoRow.toggleAttribute('disabled', !getCommand('edit.redo')?.when?.());
  });

  // Drawing the state ---------------------------------------------------------------------------
  const render = () => {
    const l = layoutNow();
    const on = drawers();
    body.dataset.layout = l;
    body.classList.toggle('rs-drawers', on);
    const sideShown = on && sideOpen && mode() !== 'density';
    const inspState: Sheet = on ? (l === 'phone' ? sheet : sheet === 'closed' ? 'closed' : 'full') : 'closed';
    layout.classList.toggle('rs-side-open', sideShown);
    layout.dataset.sheet = inspState;
    if (inspState === 'closed' || !on) insp.style.removeProperty('height');
    for (const b of [topSide, dockSide]) b.setAttribute('aria-expanded', String(sideShown));
    for (const b of [topInsp, dockInsp]) {
      b.setAttribute('aria-expanded', String(inspState !== 'closed'));
      b.classList.toggle('marked', selected() && mode() === 'flow');
    }
    // Hidden drawers are out of the tab order and away from screen readers.
    side.inert = on && !sideShown;
    insp.inert = on && inspState === 'closed';
    if (!on) {
      side.inert = false;
      insp.inert = false;
    }
    // In the check, the findings are what the view is for: the toggle says so.
    dockLabel.textContent = topLabel.textContent = mode() === 'density' ? t('responsive.inspector.check') : '';
  };

  const texts = () => {
    sideTitle.textContent = t('responsive.objects');
    inspTitle.textContent = mode() === 'density' ? t('mode.density') : t('responsive.inspector');
    for (const [b, cmd] of [[topSide, 'layout.objects'], [dockSide, 'layout.objects'], [topInsp, 'layout.inspector'], [dockInsp, 'layout.inspector']] as const) {
      const c = getCommand(cmd)!;
      b.title = commandTitle(c);
      b.setAttribute('aria-label', t(c.label));
    }
    for (const b of [sideClose, inspClose]) {
      b.title = t('responsive.close');
      b.setAttribute('aria-label', t('responsive.close'));
    }
    // On the phone the head is the sheet's handle; the bar on it is a button for the keyboard.
    inspHead.title = layoutNow() === 'phone' ? t('responsive.sheet') : '';
    handle.title = t('responsive.sheet');
    handle.setAttribute('aria-label', t('responsive.sheet'));
    $('layout').querySelector('.toolrail')?.setAttribute('aria-label', t('responsive.tools'));
    render();
  };

  function setSide(open: boolean, remember = true): void {
    sideOpen = open;
    if (open && layoutNow() === 'phone' && sheet !== 'closed') sheet = 'closed';
    if (remember) save();
    render();
    if (open) side.querySelector<HTMLElement>('.rs-close')?.focus({ preventScroll: true });
  }

  function setSheet(s: Sheet, remember = true): void {
    sheet = s;
    autoPeek = false;
    if (s !== 'closed' && layoutNow() === 'phone') sideOpen = false;
    if (remember) save();
    render();
  }

  command({
    id: 'layout.objects',
    label: 'responsive.objects.toggle',
    group: 'responsive.group',
    icon: 'rs-list',
    when: () => drawers() && mode() !== 'density',
    run: () => setSide(!(sideOpen && layout.classList.contains('rs-side-open'))),
  });
  command({
    id: 'layout.inspector',
    label: 'responsive.inspector.toggle',
    group: 'responsive.group',
    icon: 'rs-panel',
    when: drawers,
    run: () => {
      const open = layout.dataset.sheet !== 'closed';
      setSheet(open ? 'closed' : layoutNow() === 'phone' ? 'half' : 'full');
    },
  });

  // Closing --------------------------------------------------------------------------------------
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !drawers() || document.querySelector('.menu, .popover:not([hidden]), .palette-back:not([hidden])')) return;
      if (layout.classList.contains('rs-side-open')) {
        setSide(false);
        topSide.focus({ preventScroll: true });
      } else if (layout.dataset.sheet !== 'closed' && insp.contains(document.activeElement)) {
        setSheet('closed');
        (layoutNow() === 'phone' ? dockInsp : topInsp).focus({ preventScroll: true });
      } else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    { capture: true },
  );

  // A tap on an empty spot of the stage (it selects nothing) closes the inspector.
  let tap: { x: number; y: number; id: number } | null = null;
  let fingers = 0;
  canvas.addEventListener('pointerdown', (e) => {
    fingers++;
    tap = fingers === 1 ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
  });
  const lift = (e: PointerEvent) => {
    fingers = Math.max(0, fingers - 1);
    const t0 = tap;
    tap = null;
    if (!t0 || t0.id !== e.pointerId || Math.hypot(e.clientX - t0.x, e.clientY - t0.y) > 8) return;
    if (!drawers() || mode() !== 'flow' || layout.dataset.sheet === 'closed') return;
    if ($('draw-pointer')?.getAttribute('aria-pressed') !== 'true') return;
    // After the stage has handled the tap.
    setTimeout(() => {
      if (!selected() && document.querySelector('.level-radios input[value="objects"]:checked')) setSheet('closed');
    }, 0);
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', () => {
    fingers = Math.max(0, fingers - 1);
    tap = null;
  });

  // The phone sheet: drag the head, or tap it to go peek, half, full and back to peek. -----------
  const heights = () => {
    const H = layout.clientHeight;
    return { peek: Math.min(176, H * 0.4), half: Math.round(H * 0.55), full: H };
  };
  let drag: { y: number; h: number; moved: boolean } | null = null;
  inspHead.addEventListener('pointerdown', (e) => {
    if (layoutNow() !== 'phone' || (e.target as HTMLElement).closest('.rs-close')) return;
    inspHead.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, h: insp.getBoundingClientRect().height, moved: false };
  });
  inspHead.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 6) return;
    drag.moved = true;
    insp.classList.add('rs-dragging');
    insp.style.height = `${Math.max(0, Math.min(heights().full, drag.h - dy))}px`;
  });
  const endDrag = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    insp.classList.remove('rs-dragging');
    if (!d.moved) {
      setSheet(sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'peek');
      return;
    }
    const now = insp.getBoundingClientRect().height;
    insp.style.removeProperty('height');
    const hs = heights();
    const options: [Sheet, number][] = [['closed', 0], ['peek', hs.peek], ['half', hs.half], ['full', hs.full]];
    options.sort((a, b) => Math.abs(a[1] - now) - Math.abs(b[1] - now));
    setSheet(options[0][0]);
  };
  inspHead.addEventListener('pointerup', endDrag);
  inspHead.addEventListener('pointercancel', endDrag);
  // The keyboard: Enter or Space on the bar grows the sheet, the arrows go up and down a size.
  handle.addEventListener('click', (e) => {
    if (e.detail === 0) setSheet(sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'peek');
  });
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const order: Sheet[] = ['closed', 'peek', 'half', 'full'];
    const i = order.indexOf(sheet) + (e.key === 'ArrowUp' ? 1 : -1);
    setSheet(order[Math.max(0, Math.min(3, i))]);
  });

  // Following the selection and the mode ----------------------------------------------------------
  let had = selected();
  const follow = () => {
    const has = selected();
    if (has !== had && layoutNow() === 'phone' && drawers() && mode() === 'flow') {
      if (has && sheet === 'closed') {
        sheet = 'peek';
        autoPeek = true;
      } else if (!has && autoPeek && sheet === 'peek') {
        sheet = 'closed';
        autoPeek = false;
      }
    }
    had = has;
    render();
  };
  const watch = new MutationObserver(follow);
  for (const id of ['object-panel', 'lettering-panel']) watch.observe($(id), { attributes: true, attributeFilter: ['hidden'] });
  let lastMode = mode();
  new MutationObserver(() => {
    if (mode() === lastMode) return;
    lastMode = mode();
    insp.scrollTop = 0;
    // The check is what the view is for: on the phone its summary shows at once.
    if (lastMode === 'density' && layoutNow() === 'phone' && sheet === 'closed') {
      sheet = 'peek';
      autoPeek = true;
    }
    texts();
  }).observe(body, { attributes: true, attributeFilter: ['data-mode'] });

  // On the phone the list closes once an object in it is chosen, so the stage shows it.
  $('layer-list').addEventListener('click', (e) => {
    if (layoutNow() !== 'phone' || !layout.classList.contains('rs-side-open')) return;
    const row = (e.target as HTMLElement).closest('.object');
    if (!row || (e.target as HTMLElement).closest('button, input, select, .row-more')) return;
    setTimeout(() => setSide(false), 120);
  });

  TABLET.addEventListener('change', texts);
  PHONE.addEventListener('change', texts);
  onLangChange(texts);
  texts();
}
