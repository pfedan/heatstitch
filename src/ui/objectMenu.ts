import { onLangChange, t } from '../i18n';
import { closeMenu, showMenu, type MenuItem } from '../shell/ui';
import { objectMenuItems, ORDER_IDS } from '../areas/objects/commands';

type At = { x: number; y: number } | HTMLElement;

let open: HTMLElement | null = null;

/** Shows a menu built with showMenu (src/shell/ui.ts) and remembers it, so isOpen can tell. */
export function menuAt(items: MenuItem[], at: At, label: string): void {
  showMenu(items, at, label);
  const all = document.querySelectorAll<HTMLElement>('body > ul.menu');
  open = all[all.length - 1] ?? null;
}

/** The order commands as a menu of their own (the submenu "Reihenfolge"). */
export function showOrderMenu(at: At): void {
  menuAt(ORDER_IDS, at, t('objects.orderMenu'));
}

/**
 * The one menu of object actions for the selection: right click or a long press on the stage or
 * on a row of the list, and the "more" buttons. Its entries are commands, so they are enabled by
 * the same rules as the buttons, keys and the command search. "Reihenfolge" opens the order
 * commands as a second menu at the same place.
 */
export class ObjectMenu {
  constructor() {
    // A menu keeps the texts it was opened with; a language switch closes it.
    onLangChange(() => closeMenu());
  }

  get isOpen(): boolean {
    return !!open?.isConnected;
  }

  close(): void {
    if (this.isOpen) closeMenu();
  }

  /** Opens at the page position (`x`, `y`) or under an element, kept inside the window. */
  open(at: At): void {
    const point = at instanceof HTMLElement ? at : { x: at.x, y: at.y };
    menuAt(objectMenuItems(() => showOrderMenu(point)), point, t('object.menu'));
  }
}

/** Shared by the stage, the list and the object page. */
export const objectMenu = new ObjectMenu();
