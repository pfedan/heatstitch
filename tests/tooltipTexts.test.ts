import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';

/**
 * Tooltips stay short: a sentence on what the control does, a picture where words would not do.
 * Checked are the texts the code plainly sets as a title (data-i18n-title, `title: t('…')`,
 * `.title = t('…')`); texts built from several keys or passed through helpers are not seen here.
 */
const MAX_WORDS = 16;

const code = import.meta.glob<string>(['../src/**/*.ts', '!../src/i18n/**'], { query: '?raw', import: 'default', eager: true });
const files: [string, string][] = [['index.html', html], ...Object.entries(code)];

const titleKeys = new Set<string>();
for (const [, text] of files) {
  for (const m of text.matchAll(/data-i18n-title="([^"]+)"/g)) titleKeys.add(m[1]);
  for (const m of text.matchAll(/(?:title: |\.title = )t\('([\w.-]+)'/g)) titleKeys.add(m[1]);
}

/** Words, not the dots that separate the parts of a key list. */
const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length;

describe('tooltip texts', () => {
  it('finds the titles it checks', () => {
    expect(titleKeys.size).toBeGreaterThan(100);
  });

  it(`stay at ${MAX_WORDS} words or fewer`, () => {
    const long: string[] = [];
    for (const k of titleKeys) {
      for (const [lang, texts] of [['de', de], ['en', en]] as const) {
        const text = (texts as Record<string, string>)[k];
        if (text && words(text) > MAX_WORDS) long.push(`${lang} ${k}: ${words(text)} words`);
      }
    }
    expect(long).toEqual([]);
  });
});

describe('tooltip pictures', () => {
  const used = new Set<string>();
  for (const [file, text] of files) {
    // The tooltip's own comment names an example.
    if (file.endsWith('tooltip.ts')) continue;
    for (const m of text.matchAll(/data-tip-img="([\w-]+)"|'data-tip-img': '([\w-]+)'|tipImg = '([\w-]+)'|tipImg = `style-\$\{k\}`/g)) {
      if (m[0].includes('${k}')) ['style-smart', 'style-dynamic'].forEach((n) => used.add(n));
      else used.add(m[1] ?? m[2] ?? m[3]);
    }
  }
  const shipped = Object.keys(import.meta.glob('../public/tips/*.webp')).map((f) => f.slice('../public/tips/'.length, -'.webp'.length));

  it('exist for every tooltip that names one', () => {
    expect([...used].filter((n) => !shipped.includes(n))).toEqual([]);
  });

  it('are all used', () => {
    expect(shipped.filter((n) => !used.has(n))).toEqual([]);
  });
});
