import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hreflangLinks, langPage, SITE, type Page } from '../src/build/langPages';

const read = (f: string) => new TextDecoder().decode(readFileSync(new URL(`../${f}`, import.meta.url)));
const source: Record<Page, string> = { app: read('index.html'), docs: read('docs.html') };
const head = (html: string) => html.slice(0, html.indexOf('</head>'));
const meta = (html: string, key: string) => new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`).exec(html)?.[1];

describe('one address per language', () => {
  it('the German guide has only the German article, a German head and links one folder up', () => {
    const de = langPage(source.docs, 'docs', 'de');
    expect(de).toContain('<html lang="de" data-lang="de" data-page-lang="de"');
    expect(de).toContain('<article lang="de">');
    expect(de).not.toContain('<article lang="en">');
    expect(head(de)).toMatch(/<title>heatstitch Anleitung/);
    expect(meta(de, 'description')).toMatch(/^Wie heatstitch/);
    expect(meta(de, 'og:url')).toBe(`${SITE}de/docs.html`);
    expect(meta(de, 'og:locale')).toBe('de_DE');
    expect(de).toContain(`<link rel="canonical" href="${SITE}de/docs.html" />`);
    // Files of the site are one folder up; the app (./) and the anchors stay.
    expect(de).toContain('href="../examples/demos/overlap.pes"');
    expect(de).toContain('href="../fonts/licenses/');
    expect(de).toContain('<a class="doc-open" href="./">');
    expect(de).toContain('href="#de-check"');
    expect(de).not.toMatch(/\s(?:href|src)="(?:examples|fonts|guide)\//);
  });

  it('the English guide keeps only the English article and its English head', () => {
    const en = langPage(source.docs, 'docs', 'en');
    expect(en).toContain('<html lang="en" data-lang="en" data-page-lang="en"');
    expect(en).toContain('<article lang="en">');
    expect(en).not.toContain('<article lang="de">');
    expect(meta(en, 'og:url')).toBe(`${SITE}docs.html`);
    expect(en).toContain('href="examples/demos/overlap.pes"');
  });

  it('the German app starts in German; the app at its own address keeps choosing by settings and browser', () => {
    const de = langPage(source.app, 'app', 'de');
    expect(de).toContain('data-page-lang="de"');
    expect(head(de)).toMatch(/<title>heatstitch: kostenlose Sticksoftware/);
    expect(meta(de, 'twitter:title')).toBe(meta(de, 'og:title'));
    expect(de).toContain('href="docs.html"');
    expect(langPage(source.app, 'app', 'en')).not.toContain('data-page-lang');
  });

  it('every page names both languages and English as the default', () => {
    for (const page of ['app', 'docs'] as const) {
      for (const lang of ['de', 'en'] as const) expect(langPage(source[page], page, lang)).toContain(hreflangLinks(page));
    }
    expect(hreflangLinks('docs')).toContain(`hreflang="x-default" href="${SITE}docs.html"`);
  });

  it('a head tag that is gone stops the build instead of leaving English under de/', () => {
    expect(() => langPage(source.app.replace(/<meta property="og:title"[^>]*>/, ''), 'app', 'de')).toThrow(/og:title/);
  });
});
