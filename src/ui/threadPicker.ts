import { t } from '../i18n';
import type { ThreadColor } from '../model/pattern';
import { pecThreads } from '../parsers/pecPalette';

export const cssColor = (c: ThreadColor) => `rgb(${c.r}, ${c.g}, ${c.b})`;
export const hexColor = (c: ThreadColor) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');

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
 * Popup with the thread colors of the Brother palette and a free color, next to a swatch button.
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
      btn.title = c.name ?? hexColor(c);
      btn.setAttribute('aria-label', btn.title);
      if (current) btn.setAttribute('aria-current', 'true');
      btn.addEventListener('click', () => pick(c));
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

    const grid = document.createElement('div');
    grid.className = 'color-grid';
    let marked = false;
    for (const c of pecThreads()) {
      const cur: boolean = !marked && c.r === o.current.r && c.g === o.current.g && c.b === o.current.b;
      marked ||= cur;
      grid.append(swatch(c, cur));
    }
    pop.append(grid);

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
    // Next to the swatch, kept on screen.
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    const below = r.bottom + 6;
    const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, r.top - h - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    (pop.querySelector<HTMLElement>('[aria-current]') ?? pop.querySelector<HTMLElement>('.pick'))?.focus();
  }
}
