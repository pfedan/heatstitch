import './files.css';
import { onLangChange, t, type Key } from '../../i18n';
import type { Mode, Settings } from '../../settings';
import { command, runCommand } from '../../shell/commands';
import { h, icon } from '../../shell/h';
import { toast } from '../../shell/ui';
import { FileList, type LoadedFile } from '../../ui/fileList';
import { hoopLabel, hoopMessage } from '../../ui/hoopPanel';

/** What the area "Dateien" needs from the app: the file list and the ways to open and save. */
export interface FilesAreaApp {
  files: FileList;
  settings: Settings;
  setMode(m: Mode): void;
  newDesign(): Promise<void>;
  loadExample(path: string): Promise<void>;
  /** Saves everything open, or with `only` just that design. */
  saveProject(only?: LoadedFile): Promise<void>;
  /** Whether Bild umwandeln holds a picture, which a whole project takes along. */
  hasImage(): boolean;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const G = 'files.title' as const;

/** Icons of this area, added to the page once (Lucide style, 20 px grid like the frame's sprite). */
const SPRITE = `
<symbol id="i-files-open" viewBox="0 0 20 20"><path d="M3 15.5V5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 2h5.5A1.5 1.5 0 0 1 16 7v1" /><path d="M3 15.5 5.2 9.3A1.5 1.5 0 0 1 6.6 8.3h10a1 1 0 0 1 .9 1.4l-2 5.2a1.5 1.5 0 0 1-1.4.9H3z" /></symbol>
<symbol id="i-files-blank" viewBox="0 0 20 20"><path d="M12.5 3.5 16.5 7.5 7.5 16.5H3.5v-4z" /><path d="m10.5 5.5 4 4" /></symbol>
<symbol id="i-files-example" viewBox="0 0 20 20"><circle cx="10" cy="8" r="2" /><path d="M10 6a2.5 2.5 0 1 1 2.4-3.2M12 8a2.5 2.5 0 1 1 3.2 2.4M10 10a2.5 2.5 0 1 1-2.4 3.2M8 8a2.5 2.5 0 1 1-3.2-2.4" /><path d="M10 10v7.5M10 15c1.5-1.8 3.2-2.3 4.5-2" /></symbol>
<symbol id="i-files-project" viewBox="0 0 20 20"><path d="m10 3 7 3.5-7 3.5-7-3.5z" /><path d="m3 10 7 3.5 7-3.5" /><path d="m3 13.5 7 3.5 7-3.5" /></symbol>
<symbol id="i-files-layer" viewBox="0 0 20 20"><path d="m10 6.5 7 3.5-7 3.5-7-3.5z" /></symbol>
<symbol id="i-files-print" viewBox="0 0 20 20"><path d="M6 7.5V3.5h8v4" /><rect x="3" y="7.5" width="14" height="6.5" rx="1.5" /><path d="M6 12h8v4.5H6z" /></symbol>
<symbol id="i-files-check" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" /><path d="m7 10.2 2 2 4-4.2" /></symbol>
<symbol id="i-files-alert" viewBox="0 0 20 20"><path d="M10 3.2 17.5 16H2.5z" /><path d="M10 8v3.5" /><circle cx="10" cy="13.7" r=".6" class="fill" /></symbol>
<symbol id="i-files-hoop" viewBox="0 0 20 20"><rect x="3" y="3" width="14" height="14" rx="4" /><rect x="5.5" y="5.5" width="9" height="9" rx="2" stroke-dasharray="2 1.6" /></symbol>
<symbol id="i-files-x" viewBox="0 0 20 20"><path d="m6 6 8 8M14 6l-8 8" /></symbol>
<symbol id="i-files-lock" viewBox="0 0 20 20"><path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" /><rect x="4.5" y="9" width="11" height="8" rx="1.5" /></symbol>
<symbol id="i-files-recent" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 1.5" /></symbol>`;

function addSprite(): void {
  if (document.getElementById('i-files-open')) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'sprite');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.innerHTML = SPRITE;
  document.body.prepend(svg);
}

/** A popover of the top bar, opened and closed through its button so it keeps its own state. */
const pop = (button: string, panel: string) => ({
  open: () => $(panel).hidden && $(button).click(),
  close: () => !$(panel).hidden && $(button).click(),
  isOpen: () => !$(panel).hidden,
});

/**
 * Area A "Dateien": the start page on the empty stage, the design switcher (open designs,
 * new, open, examples, picture), the save popover (hoop check, format, name, project, PNG,
 * color list, back to the original), dropping files anywhere, and the commands for all of it.
 */
export function initFilesArea(app: FilesAreaApp): void {
  addSprite();
  const designPop = pop('design-button', 'design-pop');
  const savePop = pop('save-button', 'save-pop');
  const input = $<HTMLInputElement>('file-input');
  const active = (): LoadedFile | null => app.files.active;
  const designs = () => app.files.files.filter((f) => f.pattern);
  const notImage = () => app.settings.mode !== 'image';
  // A design picked while Bild umwandeln is open is shown: the assistant closes (its picture stays for later).
  app.files.onPick = (f) => {
    if (f?.pattern && app.settings.mode === 'image') app.setMode('flow');
  };

  // Examples -----------------------------------------------------------------------------------

  /** The examples, as the design switcher lists them in index.html. */
  const examples = [...document.querySelectorAll<HTMLButtonElement>('#load-example [data-example]')].map((b) => ({
    path: b.dataset.example!,
    cmd: b.dataset.cmd!,
    label: b.querySelector('[data-i18n]')!.getAttribute('data-i18n') as Key,
    kind: b.querySelector('.ex-kind')?.textContent ?? '',
  }));
  let loading: string | null = null;
  const showLoading = () => {
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-example]')) {
      const on = b.dataset.example === loading;
      b.disabled = !!loading;
      b.toggleAttribute('aria-busy', on);
      b.querySelector('.ex-busy')?.remove();
      if (on) b.append(h('small', { class: 'ex-busy' }, t('files.loading')));
    }
  };
  async function openExample(path: string): Promise<void> {
    if (loading) return;
    loading = path;
    showLoading();
    try {
      await app.loadExample(path);
      designPop.close();
    } catch (err) {
      console.error('Loading the example failed', err);
      toast(t('files.example.failed'));
    } finally {
      loading = null;
      showLoading();
    }
  }
  document.addEventListener('click', (e) => {
    const b = (e.target as Element).closest?.<HTMLButtonElement>('[data-example]');
    if (b && !b.disabled) void openExample(b.dataset.example!);
  });

  // Commands -----------------------------------------------------------------------------------

  const openPicker = () => {
    designPop.close();
    input.click();
  };
  command({ id: 'files.new', label: 'files.cmd.new', group: G, icon: 'plus', run: () => {
    designPop.close();
    void app.newDesign();
  } });
  command({ id: 'files.open', label: 'files.cmd.open', group: G, icon: 'files-open', run: openPicker });
  for (const ex of examples) {
    command({ id: `files.example.${ex.cmd}`, label: `files.cmd.example.${ex.cmd}` as Key, group: G, when: () => !loading, run: () => void openExample(ex.path) });
  }
  command({
    id: 'files.rename',
    label: 'files.cmd.rename',
    group: G,
    when: () => !!active()?.pattern,
    run: () => {
      const f = active();
      if (!f) return;
      runCommand('shell.designs');
      // After the command search has closed and given the focus back.
      setTimeout(() => app.files.startRename(f.id));
    },
  });
  command({ id: 'files.remove', label: 'files.cmd.remove', group: G, when: () => !!active(), run: () => app.files.removeWithUndo(active()!.id) });
  const several = () => designs().length > 1 && notImage();
  command({ id: 'files.next', label: 'files.cmd.next', group: G, keys: ['J', 'ArrowDown'], bind: false, when: several, run: () => app.files.step(1) });
  command({ id: 'files.prev', label: 'files.cmd.prev', group: G, keys: ['K', 'ArrowUp'], bind: false, when: several, run: () => app.files.step(-1) });

  const saveBtn = $<HTMLButtonElement>('save-file');
  const pngBtn = $<HTMLButtonElement>('export');
  const colorBtn = $<HTMLButtonElement>('color-list');
  const revertBtn = $<HTMLButtonElement>('revert');
  command({ id: 'save.file', label: 'files.cmd.save', group: G, icon: 'save', when: () => !!active()?.pattern && notImage() && !saveBtn.disabled, run: () => saveBtn.click() });
  command({ id: 'save.project', label: 'files.cmd.project', group: G, icon: 'files-project', when: () => designs().length > 0, run: () => void app.saveProject() });
  command({ id: 'save.project.single', label: 'files.cmd.project.single', group: G, icon: 'files-layer', when: () => !!active()?.pattern && notImage() && !$('save-project-more').hidden, run: () => void app.saveProject(active()!) });
  command({ id: 'view.png', label: 'files.cmd.png', group: G, icon: 'image', when: () => notImage() && !pngBtn.disabled, run: () => pngBtn.click() });
  command({ id: 'colorList.open', label: 'files.cmd.colors', group: G, icon: 'files-print', when: () => !!active()?.pattern && !colorBtn.hidden, run: () => colorBtn.click() });
  command({ id: 'edit.revert', label: 'files.cmd.revert', group: 'shell.group.edit', when: () => notImage() && !revertBtn.hidden && !revertBtn.disabled, run: () => revertBtn.click() });

  // Design switcher ----------------------------------------------------------------------------

  $('open-file').addEventListener('click', openPicker);
  $('new-design').addEventListener('click', () => designPop.close());
  const exampleBox = $<HTMLDetailsElement>('dp-examples');
  // With nothing open yet, the examples are what there is to choose from.
  new MutationObserver(() => {
    if (designPop.isOpen()) exampleBox.open = !app.files.files.length;
  }).observe($('design-pop'), { attributes: true, attributeFilter: ['hidden'] });

  // Save popover -------------------------------------------------------------------------------

  const formatSelect = $<HTMLSelectElement>('save-format');
  const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="save-fmt"]')];
  const fmtNote = $('save-fmt-note');
  const showFormat = () => {
    for (const r of radios) r.checked = r.value === formatSelect.value;
    fmtNote.textContent = t(`files.fmt.${formatSelect.value}.note` as Key);
  };
  for (const r of radios) {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      formatSelect.value = r.value;
      formatSelect.dispatchEvent(new Event('change'));
      showFormat();
    });
  }

  const hoopLine = $('save-hoop');
  const showHoop = () => {
    const p = active()?.pattern;
    hoopLine.hidden = !p;
    if (!p) return;
    const hoop = app.settings.hoop;
    const msg = hoopMessage(p.bounds, hoop);
    const state = !hoop ? 'none' : msg ? (msg.turned ? 'turned' : 'over') : 'fits';
    hoopLine.dataset.state = state;
    const text = !hoop ? t('files.save.hoop.none') : msg ? msg.text : t('files.save.hoop.fits', { hoop: hoopLabel(hoop).replace(/ /g, '\u00a0') });
    const change = h(
      'button',
      { type: 'button', class: 'link', title: t('files.save.hoop.hint'), onclick: goToHoop },
      t(hoop ? 'files.save.hoop.change' : 'files.save.hoop.pick'),
    );
    hoopLine.replaceChildren(icon(state === 'fits' ? 'files-check' : state === 'none' ? 'files-hoop' : 'files-alert'), h('span', null, text), change);
  };
  /** The hoop is chosen on the design page of the inspector (Gestalten). */
  function goToHoop(): void {
    savePop.close();
    if (app.settings.mode !== 'flow') app.setMode('flow');
    document.querySelector<HTMLButtonElement>('#insp-tabs [data-tab="design"]')?.click();
    const select = $<HTMLSelectElement>('hoop');
    select.scrollIntoView({ block: 'nearest' });
    select.focus();
  }

  // "Als Projekt speichern" as a split button. The arrow is only there when the active design alone
  // is something else than everything: other designs, or a picture in Bild umwandeln, are open too.
  const moreBtn = $<HTMLButtonElement>('save-project-more');
  const oneMenu = $('save-project-menu');
  const oneBtn = $<HTMLButtonElement>('save-project-design');
  const showOne = (open: boolean) => {
    oneMenu.hidden = !open;
    moreBtn.setAttribute('aria-expanded', String(open));
  };
  const showSplit = () => {
    const f = active();
    moreBtn.hidden = !f?.pattern || designs().length + (app.hasImage() ? 1 : 0) < 2;
    showOne(false);
  };
  moreBtn.addEventListener('click', () => {
    const open = moreBtn.getAttribute('aria-expanded') !== 'true';
    showOne(open);
    if (open) oneBtn.focus();
  });
  // Like every menu: a click anywhere else closes it.
  document.addEventListener('pointerdown', (e) => {
    if (!oneMenu.hidden && !moreBtn.contains(e.target as Node) && !oneMenu.contains(e.target as Node)) showOne(false);
  });
  oneBtn.addEventListener('click', () => {
    const f = active();
    if (f?.pattern) void app.saveProject(f);
  });

  const showSave = () => {
    showFormat();
    showHoop();
    showSplit();
  };
  new MutationObserver(() => savePop.isOpen() && showSave()).observe($('save-pop'), { attributes: true, attributeFilter: ['hidden'] });
  // Once something is saved or opened elsewhere, the popover has done its job.
  for (const b of [saveBtn, pngBtn, colorBtn, $('save-project'), oneBtn]) b.addEventListener('click', () => setTimeout(() => savePop.close()));
  $('save-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') setTimeout(() => savePop.close());
  });

  // Start page ---------------------------------------------------------------------------------

  const empty = $('empty');
  const card = (cmd: string, ic: string, title: Key, sub: Key, main = false) =>
    h(
      'button',
      { type: 'button', class: `start-card${main ? ' main' : ''}`, onclick: () => runCommand(cmd) },
      h('span', { class: 'start-icon' }, icon(ic)),
      h('span', { class: 'start-text' }, h('strong', null, t(title)), h('small', null, t(sub))),
    );
  const recentRow = (f: LoadedFile) =>
    h(
      'li',
      null,
      h(
        'button',
        {
          type: 'button',
          class: 'start-recent',
          disabled: !f.pattern,
          title: f.error ? `${t('files.error')}: ${f.error}` : FileList.displayName(f),
          onclick: () => app.files.pick(f.id),
        },
        icon('files-recent'),
        h('span', { class: 'start-recent-name' }, FileList.displayName(f)),
        f.error ? h('small', { class: 'err' }, t('files.error')) : !f.own ? h('small', null, f.pattern!.format.toUpperCase()) : null,
      ),
    );
  const renderStart = () => {
    const recent = app.files.files.slice(-6).reverse();
    const more = examples.filter((ex) => ex.cmd !== 'demo');
    const sheet = h(
      'div',
      { class: 'start', 'data-mode': 'flow density' },
      h('h2', { class: 'start-title' }, t('files.start.title')),
      h('p', { class: 'start-lead' }, t('files.start.lead')),
      h(
        'div',
        { class: 'start-cards' },
        card('files.open', 'files-open', 'files.start.open', 'files.start.open.sub', true),
        card('mode.image', 'image', 'files.start.image', 'files.start.image.sub'),
        card('files.new', 'files-blank', 'files.start.blank', 'files.start.blank.sub'),
        card('files.example.demo', 'files-example', 'files.start.example', 'files.start.example.sub'),
      ),
      recent.length
        ? h('section', { class: 'start-section' }, h('h3', null, t('files.start.recent')), h('ul', { class: 'start-recent-list' }, recent.map(recentRow)))
        : null,
      h(
        'section',
        { class: 'start-section' },
        h('h3', null, t('files.start.more')),
        h(
          'div',
          { class: 'start-chips' },
          more.map((ex) => h('button', { type: 'button', class: 'chip', 'data-example': ex.path }, t(ex.label), h('small', { class: 'ex-kind' }, ex.kind))),
        ),
      ),
      h(
        'p',
        { class: 'privacy-note start-privacy', title: t('files.privacy.detail') },
        icon('files-lock'),
        h('span', null, t('files.privacy')),
      ),
    );
    // On the phone the steps of the assistant stand above the stage, not left of it.
    empty.replaceChildren(
      sheet,
      h('p', { class: 'start-image', 'data-mode': 'image' }, h('span', { class: 'start-image-wide' }, t('canvas.empty.image')), h('span', { class: 'start-image-narrow' }, t('files.start.image.above'))),
    );
    showLoading();
  };
  // The list redraws whenever a design is added, renamed, measured or removed.
  new MutationObserver(() => {
    if (!empty.hidden) renderStart();
  }).observe($('file-list'), { childList: true });
  new MutationObserver(() => !empty.hidden && renderStart()).observe(empty, { attributes: true, attributeFilter: ['hidden'] });

  // Dropping files anywhere ----------------------------------------------------------------------

  const lang = () => {
    document.body.dataset.dropText = t('files.drop.release');
    renderStart();
    // Texts drawn here follow the language even while the popover is closed.
    showSave();
  };
  onLangChange(lang);
  lang();
}
