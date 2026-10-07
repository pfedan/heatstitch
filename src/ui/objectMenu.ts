import { onLangChange } from '../i18n';
import type { ObjectAction } from './objectPanel';

/**
 * The actions of the object panel as a small menu at the pointer: right click on an object, or a
 * long press on a touch screen. Closes on a choice, Escape, a press elsewhere, scrolling or a resize.
 */
export class ObjectMenu {
  private pop: HTMLElement | null = null;

  constructor() {
    document.addEventListener('pointerdown', (e) => {
      if (this.pop && !this.pop.contains(e.target as Node)) this.close();
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
    window.addEventListener('wheel', () => this.close(), { passive: true });
    onLangChange(() => this.close());
  }

  get isOpen(): boolean {
    return !!this.pop;
  }

  close(): void {
    this.pop?.remove();
    this.pop = null;
  }

  /** Opens at the page position (`x`, `y`), kept inside the window. */
  open(x: number, y: number, actions: ObjectAction[], label: string): void {
    this.close();
    if (!actions.length) return;
    const pop = document.createElement('div');
    pop.className = 'object-menu';
    pop.setAttribute('role', 'menu');
    pop.setAttribute('aria-label', label);
    for (const a of actions) {
      const b = Object.assign(document.createElement('button'), { type: 'button', title: a.hint });
      b.setAttribute('role', 'menuitem');
      b.innerHTML = a.icon;
      b.append(a.label);
      b.addEventListener('click', () => {
        // Run first: a popup it opens is placed next to the entry before the menu goes.
        a.run(b);
        this.close();
      });
      pop.append(b);
    }
    pop.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.append(pop);
    this.pop = pop;
    const r = pop.getBoundingClientRect();
    const m = 8;
    pop.style.left = `${Math.max(m, Math.min(x, innerWidth - r.width - m))}px`;
    pop.style.top = `${Math.max(m, Math.min(y, innerHeight - r.height - m))}px`;
    pop.querySelector('button')?.focus({ preventScroll: true });
  }
}
