import './ready.css';
import { formatNumber, onLangChange, t, type Key } from '../../i18n';
import type { Pattern } from '../../model/pattern';
import type { Mode, Settings } from '../../settings';
import { command, runCommand } from '../../shell/commands';
import { h, icon } from '../../shell/h';
import { section, toast } from '../../shell/ui';
import { FileList } from '../../ui/fileList';
import { STORAGE_NS } from '../../storage/namespace';
import { cardView, renderCard, type CardView } from './card';
import { designFigures } from './figures';
import { addIcons } from './icons';
import { recipeCard } from './recipes';
import { openSheet } from './sheet';

/** What the area needs from the app. */
export interface ReadyApp {
  readonly files: FileList;
  readonly settings: Settings;
  setMode(m: Mode): void;
  /** Height in mm of the smallest lettering in the design, or null. */
  minLetterMm(p: Pattern): number | null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const FOLD = `${STORAGE_NS}.ready.more`;
const readFold = () => {
  try {
    return localStorage.getItem(FOLD) === '1';
  } catch {
    return false;
  }
};

/**
 * Area "ready" (Bereit zum Sticken): a card on the design page, right under Material, that turns
 * the chosen fabric and the design into what to prepare (stabilizer, topping, needle, thread,
 * speed, hooping, tips); a short line of it in the save popover; and the printable stitch sheet.
 */
export function initReady(app: ReadyApp): { render: () => void } {
  addIcons();
  const s = app.settings;
  const active = () => app.files.active;
  const pattern = () => active()?.pattern ?? null;
  const notImage = () => s.mode !== 'image';

  /** The card for the active design, worked out again only when something it reads changed. */
  let memo: { key: unknown[]; view: CardView } | null = null;
  const view = (): CardView | null => {
    const f = active();
    const p = f?.pattern;
    if (!p) return null;
    const minLetter = app.minLetterMm(p);
    const key = [p, f.measurement, s.profile.fabric, s.profile.thread, minLetter, t('ready.title')];
    if (memo && memo.key.every((k, i) => k === key[i])) return memo.view;
    const card = recipeCard(s.profile.fabric, s.profile.thread, designFigures(p, f.measurement, minLetter));
    memo = { key, view: cardView(card) };
    return memo.view;
  };

  // Design page: a section right under Material -------------------------------------------------

  const sum = h('span', { class: 'sec-sum' });
  const body = h('div', { class: 'ready-card' });
  const sec = section('design.ready', 'ready.title', [body], { extra: sum });
  sec.classList.add('ready-sec');
  const place = () => {
    const page = $('design-page');
    const material = page?.querySelector('[data-sec="design.material"]');
    if (material && sec.previousElementSibling !== material) material.after(sec);
  };
  place();

  const reveal = () => {
    if (s.mode === 'image') app.setMode('flow');
    document.querySelector<HTMLButtonElement>('#insp-tabs [data-tab="design"]')?.click();
    place();
    sec.open = true;
    sec.scrollIntoView({ block: 'nearest' });
    sec.querySelector('summary')?.focus({ preventScroll: true });
  };

  // Save popover: one line before stitching, and the sheet next to the color list --------------

  const saveLine = h('p', { class: 'ready-save', role: 'status' });
  const sheetRow = h(
    'button',
    { type: 'button', id: 'stitch-sheet', class: 'pop-row save-row', onclick: () => runCommand('ready.print') },
    icon('ready-sheet'),
    h('span', null, h('span', { class: 'ready-sheet-label' }), h('small', { class: 'ready-sheet-sub' })),
  );
  $('save-hoop')?.after(saveLine);
  $('color-list')?.after(sheetRow);
  const savePop = $('save-pop');
  const closeSave = () => {
    if (savePop && !savePop.hidden) $('save-button')?.click();
  };

  // Commands -------------------------------------------------------------------------------------

  const G = 'ready.group' as const;
  const ready = () => !!pattern() && notImage();
  command({ id: 'ready.show', label: 'ready.cmd.show', group: G, icon: 'ready-stab', when: () => !!pattern(), run: reveal });
  command({
    id: 'ready.print',
    label: 'ready.cmd.print',
    group: G,
    icon: 'ready-sheet',
    when: ready,
    run: () => {
      const f = active();
      const v = view();
      if (!f?.pattern || !v) return;
      closeSave();
      openSheet(
        { pattern: f.pattern, name: FileList.baseName(f) || f.pattern.name, hoop: s.hoop, profile: s.profile, spm: s.machineSpm, card: v },
        () => toast(t('ready.sheet.blocked')),
      );
    },
  });

  // Rendering --------------------------------------------------------------------------------------

  let drawn: CardView | null = null;
  const render = () => {
    place();
    const v = view();
    sheetRow.hidden = !v;
    saveLine.hidden = !v;
    if (!v) return;
    if (v === drawn) return;
    drawn = v;
    sum.textContent = v.summary;
    body.replaceChildren(
      ...renderCard(v, {
        foldOpen: readFold(),
        onFold: (open) => {
          try {
            localStorage.setItem(FOLD, open ? '1' : '0');
          } catch {
            /* private mode: not kept */
          }
        },
      }),
    );
    const f = active()!;
    body.prepend(
      h(
        'p',
        { class: 'ready-for' },
        t('ready.for', {
          fabric: t(`fabric.${s.profile.fabric}` as Key).split(',')[0],
          thread: s.profile.thread,
          stitches: formatNumber(f.stats?.stitches ?? 0),
        }),
      ),
    );
    saveLine.replaceChildren(
      icon('ready-stab'),
      h('span', null, h('b', null, t('ready.save.label')), ' ', v.summary),
      h(
        'button',
        {
          type: 'button',
          class: 'link',
          title: t('ready.save.more.hint'),
          onclick: () => {
            closeSave();
            runCommand('ready.show');
          },
        },
        t('ready.save.more'),
      ),
    );
    sheetRow.title = t('ready.cmd.print');
    sheetRow.querySelector('.ready-sheet-label')!.textContent = t('ready.save.sheet');
    sheetRow.querySelector('.ready-sheet-sub')!.textContent = t('ready.save.sheet.sub');
  };
  onLangChange(() => {
    drawn = null;
    memo = null;
    sec.querySelector<HTMLElement>('.sec-title')!.textContent = t('ready.title');
    render();
  });

  return { render };
}
