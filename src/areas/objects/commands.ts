import { t, type Key } from '../../i18n';
import { canRun, command, getCommand, runCommand } from '../../shell/commands';
import type { MenuItem } from '../../shell/ui';
import type { AsideRole } from '../../model/aside';
import type { ObjectInfo } from '../../ui/objectPanel';

/** Where an object or a whole selection goes in the sewing order. */
export type Shift = 'first' | 'earlier' | 'later' | 'last';

/**
 * What the commands of the area need from the app (built in src/app/objects.ts). The predicates
 * are the one place that says when an action can run: the panel, the menus, the keys and the
 * command search all ask them.
 */
export interface ObjectActions {
  /** Gestalten with a design that has objects. */
  flow(): boolean;
  /** Why no object action can run now (no design, another mode, a line being drawn); undefined: none of that. */
  blocked(): Key | undefined;
  /** Objects in the design. */
  count(): number;
  /** The objects the frame is on (empty while editing stitches, drawing, in the order card...). */
  frame(): number[];
  /** What the object page shows about the selection (null: nothing selected or a lettering). */
  info(): ObjectInfo | null;
  /** The selection is a lettering (it has its own panel). */
  lettering(): boolean;
  /** Something blocks the object actions: a line being drawn. */
  drawing(): boolean;
  /** A text field has the focus (Mod+A then selects its text). */
  typing(): boolean;
  hasSelection(): boolean;
  frameActive(): boolean;

  selectAll(): void;
  clear(): void;
  duplicate(inPlace?: boolean): void;
  /** Ctrl+C: remembers the selected objects; false when nothing is selected. */
  copy(): boolean;
  /** Ctrl+V: the remembered objects once more beside them; false when nothing was copied. */
  paste(): boolean;
  canPaste(): boolean;
  remove(): void;
  canShift(s: Shift): boolean;
  shift(s: Shift): void;
  mirror(axis: 'x' | 'y'): void;
  reverse(): void;
  split(): void;
  combine(): void;
  subtract(): void;
  contour(): void;
  /** Whether the selected fills leave out what lies on them: all, some or none (null: no fills). */
  knockoutState(): 'on' | 'off' | null;
  knockout(): void;
  overlapShown(): boolean;
  overlapCut(): void;
  blend(): void;
  color(): void;
  aside(role: AsideRole): void;
  openShape(): void;
  openStitches(): void;
  nudge(dx: number, dy: number): void;
  canOptimize(): boolean;
  optimize(): void;

  /** The color block the color commands work on: the one whose menu is open, or the selection's. */
  colorTarget(): number | null;
  colorFocused(): number | null;
  colorHidden(b: number): boolean;
  colorSelect(b: number): void;
  colorFocus(b: number): void;
  colorHide(b: number): void;
  colorRecolor(b: number): void;
  canColorShift(b: number, dir: -1 | 1): boolean;
  colorShift(b: number, dir: -1 | 1): void;
  canShowAll(): boolean;
  showAll(): void;
  expandAll(open: boolean): void;

}

/** What the commands for the shapes "not sewn" need (built in src/app/aside.ts). */
export interface AsideActions {
  flow(): boolean;
  /** The shape the commands work on: the one whose row was used last. */
  target(): number | null;
  roleOf(id: number): AsideRole | null;
  sew(id: number): void;
  role(id: number, role: AsideRole): void;
  drop(id: number): void;
}

const G = 'objects.group' as const;
const O = 'objects.group.order' as const;
const C = 'objects.group.colors' as const;

/** Registers every action of the area as a command. */
export function registerObjectCommands(a: ObjectActions): void {
  actions = a;
  /** Objects selected that the object actions work on (not a lettering, not while drawing). */
  const some = () => a.flow() && a.frame().length > 0 && !a.lettering() && !a.drawing() && !a.info()?.shaping;
  const info = () => a.info();
  /** What to do first while `some` is false, for the hint in the command search. */
  const needSome = (): Key | undefined =>
    a.blocked() ??
    (a.lettering() ? 'objects.need.lettering' : a.info()?.shaping ? 'objects.need.shaping' : a.info()?.editing ? undefined : a.frame().length === 0 ? 'objects.need.select' : undefined);
  /** The hint of `some`, else `more` when only the extra condition of a command is missing. */
  const then = (more?: () => Key | undefined) => (): Key | undefined => (some() ? more?.() : needSome());
  const one = () => (info()?.selected.length === 1 ? undefined : 'objects.need.single');
  /** For actions on several objects: with none selected, ask for two or more right away. */
  const several = (more: () => Key | undefined) => (): Key | undefined => {
    const k = then(more)();
    return k === 'objects.need.select' ? 'objects.need.two' : k;
  };

  // While stitches are edited by hand, Mod+A selects all their needle points (edit.selectAll).
  command({ id: 'object.selectAll', label: 'objects.selectAll', group: G, keys: ['Mod+A'], when: () => a.flow() && a.count() > 0 && !a.typing() && !canRun('edit.selectAll'), need: () => a.blocked() ?? (a.count() === 0 ? 'objects.need.empty' : undefined), run: a.selectAll });
  command({ id: 'object.clear', label: 'objects.clear', group: G, keys: ['Escape'], bind: false, when: a.hasSelection, run: a.clear });
  // Mod+D and Delete are read by src/app/keys.ts; the rules here are the same ones it asks.
  command({ id: 'object.duplicate', label: 'objects.duplicate', group: G, icon: 'obj-duplicate', when: some, need: then(), run: () => a.duplicate() });
  command({ id: 'object.duplicateInPlace', label: 'objects.duplicateInPlace', group: G, keys: ['Mod+D'], bind: false, when: some, need: then(), run: () => a.duplicate(true) });
  command({ id: 'object.copy', label: 'objects.copy', group: G, keys: ['Mod+C'], bind: false, when: some, need: then(), run: () => void a.copy() });
  command({ id: 'object.paste', label: 'objects.paste', group: G, keys: ['Mod+V'], bind: false, when: () => a.flow() && a.canPaste() && !a.drawing(), need: () => a.blocked() ?? (a.canPaste() ? undefined : 'objects.need.copy'), run: () => void a.paste() });
  command({ id: 'object.delete', label: 'objects.delete', group: G, icon: 'obj-delete', keys: ['Delete', 'Backspace'], bind: false, when: () => a.flow() && a.frame().length > 0 && !a.drawing(), need: () => a.blocked() ?? needSome(), run: a.remove });
  command({ id: 'object.openShape', label: 'objects.openShape', group: G, icon: 'obj-shape', keys: ['Enter'], bind: false, when: () => !!info()?.shapeable && info()!.selected.length === 1 && !info()!.shaping && !info()!.editing, need: then(one), run: a.openShape });
  // E is edit.stitches (src/areas/stitches); this is the object page's button for the one selected object.
  command({ id: 'object.openStitches', label: 'objects.openStitches', group: G, icon: 'obj-stitches', palette: false, when: () => info()?.selected.length === 1 && !info()!.editing, run: a.openStitches });
  // The thread also while the outline is open (level Form, right after drawing): it leaves the outline as it is.
  const colorable = () => a.flow() && a.frame().length > 0 && !a.lettering() && !a.drawing();
  command({ id: 'object.color', label: 'objects.color', group: G, icon: 'obj-color', when: colorable, need: () => (colorable() ? undefined : needSome()), run: a.color });
  command({ id: 'object.blend', label: 'objects.blend', group: G, icon: 'obj-blend', when: () => some() && !!info()?.blend, need: then(() => one() ?? 'objects.need.fill'), run: a.blend });
  command({ id: 'object.mirrorH', label: 'objects.mirrorH', group: G, icon: 'obj-mirror-h', when: some, need: then(), run: () => a.mirror('x') });
  command({ id: 'object.mirrorV', label: 'objects.mirrorV', group: G, icon: 'obj-mirror-v', when: some, need: then(), run: () => a.mirror('y') });
  command({ id: 'object.split', label: 'objects.split', group: G, icon: 'obj-split', when: () => some() && info()?.selected.length === 1 && (info()!.objects[info()!.selected[0]]?.sections ?? 0) > 1, need: then(() => one() ?? 'objects.need.parts'), run: a.split });
  command({ id: 'object.combine', label: 'objects.combine', group: G, icon: 'obj-combine', when: () => some() && (info()?.selected.length ?? 0) > 1 && !info()!.mergeBlocked, need: several(() => ((info()?.selected.length ?? 0) > 1 ? (info()?.mergeBlocked ?? undefined) : 'objects.need.two')), run: a.combine });
  command({ id: 'object.subtract', label: 'objects.subtract', group: G, icon: 'obj-subtract', when: () => some() && !!info()?.subtractable, need: several(() => ((info()?.selected.length ?? 0) > 1 ? undefined : 'objects.need.two')), run: a.subtract });
  // Also around a lettering (a contour around a text), not while an outline or points are edited.
  const around = () => a.flow() && a.frame().length > 0 && !a.drawing() && !info()?.shaping && !info()?.editing;
  command({ id: 'object.contour', label: 'objects.contour', group: G, icon: 'obj-contour', when: around, need: () => (around() ? undefined : needSome()), run: a.contour });
  command({ id: 'object.knockout', label: 'objects.knockout', group: G, icon: 'obj-knockout', when: () => some() && a.knockoutState() !== null, need: then(() => 'objects.need.fill'), run: a.knockout });
  command({ id: 'object.overlapCut', label: 'objects.overlapCut', group: G, icon: 'obj-knockout', when: () => a.flow() && a.overlapShown(), need: a.blocked, run: a.overlapCut });
  command({ id: 'object.putAside', label: 'objects.putAside', group: G, icon: 'obj-aside', when: () => some() && a.count() > a.frame().length, need: then(), run: () => a.aside('off') });
  command({ id: 'object.guide', label: 'objects.guide', group: G, icon: 'obj-guide', when: () => some() && a.count() > a.frame().length, need: then(), run: () => a.aside('guide') });
  const nudge = (id: string, label: 'objects.nudgeLeft' | 'objects.nudgeRight' | 'objects.nudgeUp' | 'objects.nudgeDown', key: string, dx: number, dy: number) =>
    command({ id, label, group: G, keys: [key, `Shift+${key}`], bind: false, palette: false, when: a.frameActive, run: () => a.nudge(dx, dy) });
  nudge('object.nudgeLeft', 'objects.nudgeLeft', 'ArrowLeft', -0.1, 0);
  nudge('object.nudgeRight', 'objects.nudgeRight', 'ArrowRight', 0.1, 0);
  nudge('object.nudgeUp', 'objects.nudgeUp', 'ArrowUp', 0, -0.1);
  nudge('object.nudgeDown', 'objects.nudgeDown', 'ArrowDown', 0, 0.1);

  // Order: the ways besides dragging in the list (keyboard, touch, menu).
  const order = (id: string, label: 'objects.first' | 'objects.earlier' | 'objects.later' | 'objects.last', icon: string, key: string, s: Shift) =>
    command({ id, label, group: O, icon, keys: [key], when: () => some() && a.canShift(s), need: then(), run: () => a.shift(s) });
  order('object.first', 'objects.first', 'obj-first', 'Alt+Shift+ArrowUp', 'first');
  order('object.earlier', 'objects.earlier', 'obj-earlier', 'Alt+ArrowUp', 'earlier');
  order('object.later', 'objects.later', 'obj-later', 'Alt+ArrowDown', 'later');
  order('object.last', 'objects.last', 'obj-last', 'Alt+Shift+ArrowDown', 'last');
  command({ id: 'object.reverse', label: 'objects.reverse', group: O, icon: 'obj-reverse', when: () => some() && !!info()?.reversible && !info()!.editing, need: then(), run: a.reverse });
  command({ id: 'order.optimize', label: 'order.button', group: O, icon: 'obj-order', when: a.canOptimize, need: a.blocked, run: a.optimize });

  // Colors: the block whose menu is open, or the one of the selection.
  const target = (fn: (b: number) => void) => () => {
    const b = a.colorTarget();
    if (b !== null) fn(b);
  };
  const hasTarget = () => a.flow() && a.colorTarget() !== null;
  const needTarget = (): Key | undefined => a.blocked() ?? (a.colorTarget() === null ? 'objects.need.color' : undefined);
  command({ id: 'color.select', label: 'objects.color.select', group: C, when: hasTarget, need: needTarget, run: target(a.colorSelect) });
  command({ id: 'color.focus', label: 'objects.color.focus', group: C, icon: 'obj-focus', when: hasTarget, need: needTarget, run: target(a.colorFocus) });
  command({ id: 'color.hide', label: 'objects.color.hide', group: C, icon: 'obj-eye', when: hasTarget, need: needTarget, run: target(a.colorHide) });
  command({ id: 'color.recolor', label: 'objects.color.recolor', group: C, icon: 'obj-color', when: hasTarget, need: needTarget, run: target(a.colorRecolor) });
  command({ id: 'color.earlier', label: 'objects.color.earlier', group: C, icon: 'obj-earlier', when: () => hasTarget() && a.canColorShift(a.colorTarget()!, -1), need: needTarget, run: target((b) => a.colorShift(b, -1)) });
  command({ id: 'color.later', label: 'objects.color.later', group: C, icon: 'obj-later', when: () => hasTarget() && a.canColorShift(a.colorTarget()!, 1), need: needTarget, run: target((b) => a.colorShift(b, 1)) });
  command({ id: 'layers.showAll', label: 'layers.showAll', group: C, when: () => a.flow() && a.canShowAll(), need: a.blocked, run: a.showAll });
  command({ id: 'layers.expandAll', label: 'objects.expandAll', group: C, when: a.flow, need: a.blocked, run: () => a.expandAll(true) });
  command({ id: 'layers.collapseAll', label: 'objects.collapseAll', group: C, when: a.flow, need: a.blocked, run: () => a.expandAll(false) });
}

/** The commands for a shape "not sewn"; they work on the one whose row was used last. */
export function registerAsideCommands(a: AsideActions): void {
  const run = (fn: (id: number) => void) => () => {
    const id = a.target();
    if (id !== null) fn(id);
  };
  const has = () => a.flow() && a.target() !== null;
  command({ id: 'aside.sew', label: 'objects.aside.sew', group: G, icon: 'obj-sew', palette: false, when: has, run: run(a.sew) });
  command({ id: 'aside.toGuide', label: 'objects.aside.toGuide', group: G, icon: 'obj-guide', palette: false, when: () => has() && a.roleOf(a.target()!) === 'off', run: run((id) => a.role(id, 'guide')) });
  command({ id: 'aside.toOff', label: 'objects.aside.toOff', group: G, icon: 'obj-aside', palette: false, when: () => has() && a.roleOf(a.target()!) === 'guide', run: run((id) => a.role(id, 'off')) });
  command({ id: 'aside.drop', label: 'objects.aside.drop', group: G, icon: 'obj-delete', palette: false, when: has, run: run(a.drop) });
}

let actions: ObjectActions | null = null;

/** Shown in a menu only when it applies; the others show, greyed out, also when they cannot run. */
const OPTIONAL = new Set(['object.blend', 'object.split', 'draw.cut', 'object.combine', 'object.subtract', 'object.knockout', 'object.openShape', 'object.openStitches', 'object.guide']);

const can = (id: string): boolean => {
  const c = getCommand(id);
  try {
    return !!c && (!c.when || c.when());
  } catch {
    return false;
  }
};

/** Menu entries for these command ids: optional ones only when they can run. */
function entries(ids: (string | '-')[]): MenuItem[] {
  return ids.filter((id) => id === '-' || !OPTIONAL.has(id) || can(id));
}

/** The order commands, as the submenu "Reihenfolge" and the order button of the object page. */
export const ORDER_IDS = ['object.first', 'object.earlier', 'object.later', 'object.last', '-', 'object.reverse', '-', 'order.optimize'];

/**
 * The one menu of object actions: right click or long press on the stage and on a row of the list,
 * the button "…" of a row and of the object page. Same commands as the buttons of the page.
 */
export function objectMenuItems(openOrder: () => void): MenuItem[] {
  return [
    ...entries(['object.openShape', 'object.openStitches', '-', 'object.duplicate', 'object.color', 'object.blend', '-']),
    { label: `${t('objects.orderMenu')} …`, run: openOrder, disabled: !ORDER_IDS.some((id) => id !== '-' && can(id)) },
    ...entries(['-', 'object.mirrorH', 'object.mirrorV', '-', 'draw.cut', 'object.split', 'object.combine', 'object.subtract', 'object.contour']),
    // A switch: the entry says what a click does now.
    ...(can('object.knockout') ? [actions?.knockoutState() === 'on' ? { label: t('objects.knockout.off'), run: () => runCommand('object.knockout') } : 'object.knockout'] : []),
    ...entries(['-', 'object.putAside', 'object.guide']),
    '-',
    'object.delete',
  ];
}

/** The menu of a color block (its row's right click, long press or button). */
export function colorMenuItems(b: number): MenuItem[] {
  const a = actions;
  if (!a) return [];
  const focused = a.colorFocused() === b;
  const hidden = a.colorHidden(b);
  return [
    'color.select',
    'color.recolor',
    '-',
    { label: t(focused ? 'objects.color.unfocus' : 'objects.color.focus'), run: () => runCommand('color.focus') },
    { label: t(hidden ? 'objects.color.show' : 'objects.color.hide'), run: () => runCommand('color.hide') },
    ...(can('layers.showAll') ? ['layers.showAll'] : []),
    '-',
    'color.earlier',
    'color.later',
    '-',
    'layers.expandAll',
    'layers.collapseAll',
  ];
}
