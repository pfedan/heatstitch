import './shell.css';
import { onLangChange, t } from '../i18n';
import type { Mode } from '../settings';
import { FileList, type LoadedFile } from '../ui/fileList';
import { bindCommandKeys, command, commandTitle, getCommand, keyLabel } from './commands';
import { createKeyOverview, createPalette } from './palette';
import { popover } from './popover';
import { initTooltips } from './tooltip';

export interface ShellApp {
  files: FileList;
  mode: () => Mode;
  setMode: (m: Mode) => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Clicks a button of the page if it is there, shown and enabled: commands that still drive the old controls. */
const press = (id: string) => () => $<HTMLButtonElement>(id)?.click();
/**
 * Whether a button of the top bar can run in this mode. Not whether it is on screen: on the phone
 * undo and redo live in the menu "…" while their buttons are out of sight.
 */
const usable = (id: string) => () => {
  const b = $<HTMLButtonElement>(id);
  const modes = b?.closest<HTMLElement>('[data-mode]')?.dataset.mode;
  return !!b && !b.disabled && !b.hidden && (!modes || modes.split(' ').includes(document.body.dataset.mode ?? 'flow'));
};

/**
 * The frame of the new interface: the design switcher, save and more menus in the top bar, the
 * inspector pages, the command search and the key overview. The areas register their own commands.
 */
export function initShell(app: ShellApp): void {
  initTooltips();
  const designPop = popover($('design-button'), $('design-pop'));
  const savePop = popover($('save-button'), $('save-pop'));
  const morePop = popover($('more-button'), $('more-pop'));
  const palette = createPalette();
  const keys = createKeyOverview();

  // The design switcher shows the active design; it closes once a design is opened or chosen.
  const name = $('design-name');
  const showName = () => {
    const f: LoadedFile | null = app.files.active;
    name.textContent = f ? FileList.displayName(f) : t('shell.designs');
    $('save-empty').hidden = !!f?.pattern;
  };
  let last: LoadedFile | null = null;
  new MutationObserver(() => {
    showName();
    if (app.files.active !== last) {
      last = app.files.active;
      if (last) designPop.close();
      // Another design: its inspector starts at the top (its check summary), not where the last one was.
      $('inspector').scrollTop = 0;
    }
  }).observe($('file-list'), { childList: true, subtree: true, characterData: true });
  onLangChange(showName);
  showName();

  $('image-start').addEventListener('click', () => {
    designPop.close();
    app.setMode('image');
  });
  $('keys-open').addEventListener('click', () => {
    morePop.close();
    keys.toggle();
  });
  $('palette-open').addEventListener('click', () => palette.open());

  // Inspector pages: the object page follows the selection, the design page shows otherwise.
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('#insp-tabs [data-tab]')];
  const pages = [...document.querySelectorAll<HTMLElement>('.insp-page')];
  const objectShown = () => !$('object-panel').hidden || !$('lettering-panel').hidden;
  let page: 'object' | 'design' = 'design';
  let pinned = false;
  const showPage = (p: 'object' | 'design') => {
    page = p;
    for (const b of tabs) b.setAttribute('aria-selected', String(b.dataset.tab === p));
    for (const el of pages) el.classList.toggle('on', el.dataset.page === p || (app.mode() === 'density' && el.dataset.page === 'design'));
    $('object-empty').hidden = objectShown();
  };
  for (const b of tabs) {
    b.addEventListener('click', () => {
      pinned = b.dataset.tab !== (objectShown() ? 'object' : 'design');
      showPage(b.dataset.tab as 'object' | 'design');
    });
  }
  const follow = () => {
    const want = objectShown() ? 'object' : 'design';
    if (!pinned || want === 'object') {
      pinned = false;
      showPage(want);
    } else showPage(page);
  };
  const watch = new MutationObserver(follow);
  for (const id of ['object-panel', 'lettering-panel']) watch.observe($(id), { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => showPage(page)).observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
  follow();

  // Commands of the frame; the areas add theirs.
  const G = 'shell.group.general' as const;
  command({ id: 'shell.palette', label: 'shell.palette', group: G, keys: ['Mod+K'], run: () => palette.open(), palette: false });
  command({ id: 'shell.keys', label: 'shell.keys.title', group: G, keys: ['?'], run: () => keys.toggle() });
  command({ id: 'shell.designs', label: 'shell.designs.hint', group: G, keys: ['Mod+O'], run: () => designPop.open() });
  command({ id: 'shell.save', label: 'shell.save.open', group: G, keys: ['Mod+S'], when: () => !!app.files.active?.pattern && app.mode() !== 'image', need: () => (app.files.active?.pattern ? undefined : 'shell.need.design'), run: () => savePop.open() });
  command({ id: 'shell.more', label: 'shell.more', group: G, run: () => morePop.open(), palette: false });
  command({ id: 'mode.flow', label: 'mode.flow', group: 'shell.group.view', keys: ['1'], bind: false, when: () => app.mode() !== 'flow', run: () => app.setMode('flow') });
  command({ id: 'mode.density', label: 'mode.density', group: 'shell.group.view', keys: ['2'], bind: false, when: () => app.mode() !== 'density', run: () => app.setMode('density') });
  command({ id: 'mode.image', label: 'shell.image.start', group: 'files.title', keys: ['3'], bind: false, when: () => app.mode() !== 'image', run: () => app.setMode('image') });
  command({ id: 'edit.undo', label: 'edit.undo', group: 'shell.group.edit', keys: ['Mod+Z'], bind: false, when: usable('undo'), run: press('undo') });
  command({ id: 'edit.redo', label: 'edit.redo', group: 'shell.group.edit', keys: ['Mod+Shift+Z', 'Mod+Y'], bind: false, when: usable('redo'), run: press('redo') });
  // View, zoom and player: src/areas/design. Drawing, levels and lettering: src/areas/shapes. Order: src/areas/objects.
  bindCommandKeys();

  // Titles of the frame's buttons carry their keys.
  const titles = () => {
    $('palette-key').textContent = keyLabel('Mod+K');
    $('palette-open').title = commandTitle(getCommand('shell.palette')!);
    $('save-button').title = commandTitle(getCommand('shell.save')!);
    $('undo').title = commandTitle(getCommand('edit.undo')!);
    $('redo').title = commandTitle(getCommand('edit.redo')!);
  };
  onLangChange(titles);
  titles();
}
