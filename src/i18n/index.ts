import { de } from './de';
import { en } from './en';

export type Lang = 'de' | 'en';
export type Key = keyof typeof de;

const dicts: Record<Lang, Record<Key, string>> = { de, en };
let lang: Lang = 'en';

export function detectLang(stored: string | null): Lang {
  if (stored === 'de' || stored === 'en') return stored;
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function setLang(l: Lang): void {
  lang = l;
  document.documentElement.lang = l;
  applyI18n(document.body);
}

export function getLang(): Lang {
  return lang;
}

export function t(key: Key): string {
  return dicts[lang][key];
}

/** Fills every element carrying data-i18n="key" (text) or data-i18n-title="key" (title attribute). */
export function applyI18n(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as Key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle as Key);
  });
}

export function formatNumber(v: number, digits = 0): string {
  return v.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
