import { de } from './de';
import { en } from './en';

export type Lang = 'de' | 'en';
export type Key = keyof typeof de;

const dicts: Record<Lang, Record<Key, string>> = { de, en };
let lang: Lang = 'en';
const listeners = new Set<() => void>();

export function detectLang(stored: string | null): Lang {
  if (stored === 'de' || stored === 'en') return stored;
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

/**
 * Switches the language at once, without a reload: the static texts (data-i18n) here, everything
 * drawn with t() by whoever listens (see onLangChange).
 */
export function setLang(l: Lang): void {
  lang = l;
  document.documentElement.lang = l;
  applyI18n(document.body);
  for (const fn of listeners) fn();
}

/**
 * Runs fn after every language change. Whatever writes text with t() and keeps it on the page (a
 * panel, a card, a menu, a hint) draws it anew here; a check in its own cache would keep the old
 * language until the next reload. Returns the way to stop listening.
 */
export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getLang(): Lang {
  return lang;
}

export function t(key: Key, vars?: Record<string, string | number>): string {
  const s = dicts[lang][key];
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/**
 * Fills every element carrying data-i18n="key" (text), data-i18n-title="key" (title),
 * data-i18n-aria="key" (aria-label) or, on an optgroup, data-i18n-label="key" (label).
 */
export function applyI18n(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as Key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle as Key);
  });
  root.querySelectorAll<HTMLOptGroupElement>('optgroup[data-i18n-label]').forEach((el) => {
    el.label = t(el.dataset.i18nLabel as Key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria as Key));
  });
}

export function formatNumber(v: number, digits = 0): string {
  return v.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
