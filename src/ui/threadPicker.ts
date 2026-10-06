import { t } from '../i18n';
import type { ThreadColor } from '../model/pattern';
import { BROTHER, brotherCatalog, catalogsNow, chooseCatalog, chosenCatalog, closeness, inCatalog, loadCatalogs, nearest, search as searchThreads, threadNumber, type Catalog } from '../threads/catalog';

export const cssColor = (c: ThreadColor) => `rgb(${c.r}, ${c.g}, ${c.b})`;
export const hexColor = (c: ThreadColor) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');

/** Number and name of a thread ("1610 Celestial Blue"), or its color code. */
export const threadTitle = (c: ThreadColor) => [threadNumber(c), c.name].filter(Boolean).join(' ') || hexColor(c);

export interface PickerOptions {
  /** Identifies what the picker is open for; opening it again for the same key closes it. */
  key: string;
  title: string;
  current: ThreadColor;
  /** Offered as the first row (e.g. the color as loaded), with its label. */
  original?: { color: ThreadColor; label: string } | null;
  /** Small print under the colors. */
  note?: string;
  onPick: (c: ThreadColor) => void;
}

/**
 * Popup with the threads of a catalog (Brother or another maker, searchable by number or name, the
 * nearest ones to the current color first) and a free color, next to a swatch button.
 * Closes on a pick, Escape, a click elsewhere (except on `trigger` elements, which toggle it) or a
 * resize.
 */
export class ThreadPicker {
  private pop: HTMLElement | null = null;

  constructor(trigger: string) {
    document.addEventListener('pointerdown', (e) => {
      if (this.pop && !this.pop.contains(e.target as Node) && !(e.target as Element).closest?.(trigger)) this.close();
    });
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && this.pop) {
          e.stopPropagation();
          this.close();
        }
      },
      true,
    );
    window.addEventListener('resize', () => this.close());
  }

  close(): void {
    this.pop?.remove();
    this.pop = null;
  }

  /** Opens next to `anchor`, or closes when it is already open for the same key. */
  toggle(anchor: HTMLElement, o: PickerOptions): void {
    if (this.pop?.dataset.key === o.key) return this.close();
    this.close();
    const pop = document.createElement('div');
    pop.className = 'color-pop';
    pop.dataset.key = o.key;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', o.title);
    const pick = (c: ThreadColor) => {
      this.close();
      o.onPick(c);
    };
    const swatch = (c: ThreadColor, current: boolean) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pick';
      btn.style.background = cssColor(c);
      btn.title = threadTitle(c);
      btn.setAttribute('aria-label', btn.title);
      if (current) btn.setAttribute('aria-current', 'true');
      btn.addEventListener('click', () => pick(c));
      // The name shows at once under the colors (the tooltip comes only after a while).
      const show = () => (name.textContent = btn.title);
      btn.addEventListener('pointerenter', show);
      btn.addEventListener('focus', show);
      return btn;
    };

    const head = document.createElement('div');
    head.className = 'color-pop-head';
    head.textContent = o.title;
    pop.append(head);

    if (o.original) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'color-pop-orig';
      const sw = document.createElement('span');
      sw.className = 'sw';
      sw.style.background = cssColor(o.original.color);
      row.append(sw, o.original.label);
      const c = o.original.color;
      row.addEventListener('click', () => pick(c));
      pop.append(row);
    }

    const currentName = threadTitle(o.current);
    const name = document.createElement('div');
    name.className = 'color-pop-name';
    name.setAttribute('aria-hidden', 'true');
    name.textContent = currentName;

    // Which maker's threads: the choice is the same for every color list.
    const select = document.createElement('select');
    select.className = 'color-pop-catalog';
    select.setAttribute('aria-label', t('threads.catalog'));
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'color-pop-search';
    search.placeholder = t('threads.search');
    search.setAttribute('aria-label', t('threads.search'));
    search.autocomplete = 'off';
    search.enterKeyHint = 'done';
    const tools = document.createElement('div');
    tools.className = 'color-pop-tools';
    tools.append(select, search);

    const near = document.createElement('div');
    near.className = 'color-pop-near';
    const grid = document.createElement('div');
    grid.className = 'color-grid';
    grid.addEventListener('pointerleave', () => (name.textContent = currentName));
    pop.append(tools, near, grid, name);

    const fillSelect = () => {
      const all = catalogsNow();
      const groups: [string, Catalog[]][] = [
        [t('threads.common'), all.filter((c) => c.common)],
        [t('threads.more'), all.filter((c) => !c.common)],
      ];
      select.replaceChildren(
        ...groups
          .filter(([, cs]) => cs.length)
          .map(([label, cs]) => {
            const g = document.createElement('optgroup');
            g.label = label;
            for (const c of cs) g.append(new Option(`${c.name} (${c.threads.length})`, c.id));
            return g;
          }),
      );
      select.value = all.some((c) => c.id === chosenCatalog()) ? chosenCatalog() : BROTHER;
    };
    const catalog = () => catalogsNow().find((c) => c.id === select.value) ?? brotherCatalog();

    const render = () => {
      const cat = catalog();
      name.textContent = currentName;
      const own = inCatalog(o.current, cat);
      // Not one of these threads: the nearest ones first, with how close they come.
      near.replaceChildren();
      if (!own && !search.value.trim()) {
        const label = document.createElement('span');
        label.className = 'muted small';
        label.textContent = t('threads.nearest');
        near.append(label);
        for (const m of nearest(o.current, cat, 3)) {
          const btn = swatch(m.thread, false);
          btn.className = 'pick near-pick';
          btn.title = `${threadTitle(m.thread)} · ${t(`threads.dE.${closeness(m.dE)}`)}`;
          btn.setAttribute('aria-label', btn.title);
          const num = document.createElement('span');
          num.textContent = threadNumber(m.thread) || m.thread.name || '';
          btn.append(num);
          near.append(btn);
        }
      }
      near.hidden = !near.childElementCount;
      const shown = searchThreads(cat, search.value);
      grid.replaceChildren(...shown.map((c) => swatch(c, c === own)));
      if (!shown.length) grid.append(Object.assign(document.createElement('p'), { className: 'muted small color-pop-none', textContent: t('threads.none', { catalog: cat.name }) }));
    };

    select.addEventListener('change', () => {
      chooseCatalog(select.value);
      render();
    });
    search.addEventListener('input', render);
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const first = searchThreads(catalog(), search.value)[0];
      if (first && search.value.trim()) pick(first);
    });

    fillSelect();
    render();
    if (catalogsNow().length === 1) {
      void loadCatalogs()
        .then(() => {
          if (this.pop !== pop) return;
          fillSelect();
          render();
          this.place(pop, anchor);
        })
        .catch(() => {
          if (this.pop === pop) name.textContent = t('threads.loadFailed');
        });
    }

    const own = document.createElement('label');
    own.className = 'color-pop-own';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = hexColor(o.current);
    input.addEventListener('change', () => {
      const v = input.value;
      pick({ r: parseInt(v.slice(1, 3), 16), g: parseInt(v.slice(3, 5), 16), b: parseInt(v.slice(5, 7), 16) });
    });
    own.append(input, t('layers.ownColor'));
    pop.append(own);

    if (o.note) {
      const note = document.createElement('p');
      note.className = 'muted small';
      note.textContent = o.note;
      pop.append(note);
    }

    document.body.append(pop);
    this.pop = pop;
    this.place(pop, anchor);
    // The current thread, or the search with a keyboard at hand (a touch screen would open its keyboard).
    const cur = pop.querySelector<HTMLElement>('.color-grid [aria-current]');
    if (cur) cur.focus({ preventScroll: false });
    else if (matchMedia('(pointer: fine)').matches) search.focus();
  }

  /** Next to the swatch, kept on screen. */
  private place(pop: HTMLElement, anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    const below = r.bottom + 6;
    const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, r.top - h - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }
}
