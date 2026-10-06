import { getLang, t, type Key } from '../i18n';
import { signal } from './signal';

/**
 * Every action of the interface is one command: a button, a menu entry, a key and the command
 * search all run the same thing and are disabled by the same rule (design-system/heatstitch/konzept.md).
 */
export interface Command {
  id: string;
  label: Key;
  /** Group in the command search and the key overview. */
  group: Key;
  icon?: string;
  /** Keys as 'Mod+D', 'Shift+N', 'F', '?'. Mod is Ctrl, or Cmd on a Mac. */
  keys?: string[];
  /** false: the keys are handled elsewhere and only shown here. */
  bind?: boolean;
  /** Whether the command can run now; missing means always. */
  when?: () => boolean;
  run: () => void;
  /** false: not offered in the command search (still bound and shown in the overview). */
  palette?: boolean;
}

const registry = new Map<string, Command>();
/** Bumps on every (un)registration, so lists of commands can redraw. */
export const commandsVersion = signal(0);

export function command(c: Command): Command {
  registry.set(c.id, c);
  commandsVersion.update((n) => n + 1);
  return c;
}

export function commands(): Command[] {
  return [...registry.values()];
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id);
}

export function canRun(c: Command | string): boolean {
  const cmd = typeof c === 'string' ? registry.get(c) : c;
  if (!cmd) return false;
  try {
    return cmd.when ? cmd.when() : true;
  } catch {
    return false;
  }
}

export function runCommand(id: string): boolean {
  const c = registry.get(id);
  if (!c || !canRun(c)) return false;
  c.run();
  return true;
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** A key as shown to the user: "Strg+D", "⌘D", "Umschalt+N". */
export function keyLabel(spec: string): string {
  const de = getLang() === 'de';
  const parts = spec.split('+');
  const key = parts.pop()!;
  const mods = parts.map((m) => {
    if (m === 'Mod') return isMac ? '⌘' : de ? 'Strg' : 'Ctrl';
    if (m === 'Shift') return isMac ? '⇧' : de ? 'Umschalt' : 'Shift';
    if (m === 'Alt') return isMac ? '⌥' : 'Alt';
    return m;
  });
  const names: Record<string, [string, string]> = {
    Delete: ['Entf', 'Del'],
    Escape: ['Esc', 'Esc'],
    Enter: ['Enter', 'Enter'],
    Space: ['Leertaste', 'Space'],
    ArrowUp: ['↑', '↑'],
    ArrowDown: ['↓', '↓'],
    Home: ['Pos1', 'Home'],
    End: ['Ende', 'End'],
  };
  const k = names[key] ? names[key][de ? 0 : 1] : key.length === 1 ? key.toUpperCase() : key;
  return isMac ? mods.join('') + k : [...mods, k].join('+');
}

/** Whether a keydown matches a key spec. */
export function matches(e: KeyboardEvent, spec: string): boolean {
  const parts = spec.split('+');
  const key = parts.pop()!;
  const mod = parts.includes('Mod');
  const shift = parts.includes('Shift');
  const alt = parts.includes('Alt');
  if ((isMac ? e.metaKey : e.ctrlKey) !== mod || e.altKey !== alt) return false;
  // Printable keys like '?' carry their shift in the character itself.
  if (key.length === 1 && !/[a-z0-9]/i.test(key)) return e.key === key;
  if (e.shiftKey !== shift) return false;
  if (key === 'Space') return e.key === ' ';
  return e.key.toLowerCase() === key.toLowerCase();
}

const typing = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** Runs bound commands from the keyboard. Keys with Mod also work while typing in a field. */
export function bindCommandKeys(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.defaultPrevented || e.repeat) return;
      for (const c of registry.values()) {
        if (c.bind === false || !c.keys) continue;
        for (const k of c.keys) {
          if (!matches(e, k)) continue;
          if (typing(e.target) && !k.includes('Mod')) continue;
          if (!canRun(c)) continue;
          e.preventDefault();
          e.stopImmediatePropagation();
          c.run();
          return;
        }
      }
    },
    { capture: true },
  );
}

/** Label of a command with its first key, for a title attribute. */
export function commandTitle(c: Command): string {
  const k = c.keys?.[0];
  return k ? `${t(c.label)} (${keyLabel(k)})` : t(c.label);
}
