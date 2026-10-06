import { onLangChange, t } from '../i18n';
import { canRun, commands, keyLabel, type Command } from './commands';
import { h } from './h';

/** Folds case and German umlauts so "loschen" finds "Löschen". */
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Score of a command for a query: all words must occur; earlier and word-start matches rank higher. */
function score(c: Command, words: string[]): number {
  const label = fold(t(c.label));
  const hay = `${label} ${fold(t(c.group))}`;
  let s = 0;
  for (const w of words) {
    const i = hay.indexOf(w);
    if (i < 0) return -1;
    s += i === 0 ? 30 : hay[i - 1] === ' ' ? 20 : 10 - Math.min(9, i / 10);
  }
  return s;
}

/**
 * The command search (Mod+K): type a few letters, the matching commands that can run now are
 * listed with their keys, Enter runs the first or the chosen one. Closes with Esc or a click beside it.
 */
export function createPalette(): { open: () => void; close: () => void } {
  const input = h('input', {
    type: 'search',
    class: 'palette-input',
    spellcheck: false,
    autocomplete: 'off',
  });
  const list = h('ul', { class: 'palette-list', role: 'listbox' });
  const box = h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'false' }, input, list);
  const back = h('div', { class: 'palette-back', hidden: true }, box);
  document.body.appendChild(back);

  let shown: Command[] = [];
  let at = 0;
  let before: HTMLElement | null = null;

  const draw = () => {
    const words = fold(input.value).split(/\s+/).filter(Boolean);
    shown = commands()
      .filter((c) => c.palette !== false && canRun(c))
      .map((c) => ({ c, s: words.length ? score(c, words) : 0 }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || t(a.c.group).localeCompare(t(b.c.group)) || t(a.c.label).localeCompare(t(b.c.label)))
      .map((x) => x.c)
      .slice(0, 40);
    at = Math.min(at, Math.max(0, shown.length - 1));
    list.replaceChildren(
      ...(shown.length
        ? shown.map((c, i) =>
            h(
              'li',
              {
                role: 'option',
                class: i === at ? 'on' : '',
                'aria-selected': String(i === at),
                onmousemove: () => {
                  if (at !== i) {
                    at = i;
                    mark();
                  }
                },
                onclick: () => pick(c),
              },
              h('span', { class: 'palette-label' }, t(c.label)),
              h('span', { class: 'palette-group' }, t(c.group)),
              c.keys?.length ? h('kbd', null, keyLabel(c.keys[0])) : null,
            ),
          )
        : [h('li', { class: 'palette-empty' }, t('shell.palette.none'))]),
    );
  };
  const mark = () => {
    [...list.children].forEach((li, i) => {
      li.classList.toggle('on', i === at);
      li.setAttribute('aria-selected', String(i === at));
    });
    list.children[at]?.scrollIntoView({ block: 'nearest' });
  };
  const pick = (c: Command) => {
    close();
    if (canRun(c)) c.run();
  };
  const open = () => {
    before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.placeholder = t('shell.palette.placeholder');
    input.value = '';
    at = 0;
    back.hidden = false;
    draw();
    input.focus();
  };
  const close = () => {
    if (back.hidden) return;
    back.hidden = true;
    input.blur();
    before?.focus({ preventScroll: true });
    before = null;
  };

  input.addEventListener('input', () => {
    at = 0;
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') at = Math.min(shown.length - 1, at + 1);
    else if (e.key === 'ArrowUp') at = Math.max(0, at - 1);
    else if (e.key === 'Enter') {
      if (shown[at]) pick(shown[at]);
    } else if (e.key === 'Escape') close();
    else return;
    e.preventDefault();
    e.stopPropagation();
    mark();
  });
  back.addEventListener('mousedown', (e) => {
    if (e.target === back) close();
  });
  onLangChange(() => {
    if (!back.hidden) draw();
  });
  return { open, close };
}

/** The key overview (?): every command with keys, grouped, generated from the commands. */
export function createKeyOverview(): { toggle: () => void } {
  const body = h('div', { class: 'keys-body' });
  const title = h('h2');
  const closeBtn = h('button', { type: 'button', class: 'icon', onclick: () => (back.hidden = true) }, '×');
  const box = h('div', { class: 'keys-sheet', role: 'dialog', 'aria-modal': 'false' }, h('div', { class: 'keys-head' }, title, closeBtn), body);
  const back = h('div', { class: 'palette-back', hidden: true }, box);
  document.body.appendChild(back);
  const draw = () => {
    title.textContent = t('shell.keys.title');
    closeBtn.title = t('shell.close');
    const groups = new Map<string, Command[]>();
    for (const c of commands()) {
      if (!c.keys?.length) continue;
      const g = t(c.group);
      groups.set(g, [...(groups.get(g) ?? []), c]);
    }
    body.replaceChildren(
      ...[...groups].map(([g, cs]) =>
        h(
          'section',
          null,
          h('h3', null, g),
          h(
            'dl',
            null,
            cs.flatMap((c) => [h('dt', null, t(c.label)), h('dd', null, c.keys!.map((k) => h('kbd', null, keyLabel(k))))]),
          ),
        ),
      ),
    );
  };
  back.addEventListener('mousedown', (e) => {
    if (e.target === back) back.hidden = true;
  });
  window.addEventListener('keydown', (e) => {
    if (!back.hidden && e.key === 'Escape') {
      back.hidden = true;
      e.stopImmediatePropagation();
    }
  }, { capture: true });
  onLangChange(() => {
    if (!back.hidden) draw();
  });
  return {
    toggle: () => {
      if (back.hidden) draw();
      back.hidden = !back.hidden;
    },
  };
}
