import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { langPage } from '../src/build/langPages';
import { expandVideos } from '../src/build/videoHtml';
import { cardPath, GROUPS, VIDEOS } from '../src/videos/catalog';

const read = (f: string) => new TextDecoder().decode(readFileSync(new URL(`../${f}`, import.meta.url)));
const article = (html: string, lang: string) => html.slice(html.indexOf(`<article lang="${lang}">`), html.indexOf('</article>', html.indexOf(`<article lang="${lang}">`)));
const count = (html: string, s: string) => html.split(s).length - 1;

describe('the tutorial videos', () => {
  it('each video has its own key, a part in order, a length, a group and both languages', () => {
    expect(new Set(VIDEOS.map((v) => v.key)).size).toBe(VIDEOS.length);
    VIDEOS.forEach((v, i) => {
      if (i) expect(v.part).toBeGreaterThan(VIDEOS[i - 1].part);
      expect(v.key).toMatch(new RegExp(`^${String(v.part).padStart(2, '0')}-[a-z0-9-]+$`));
      expect(v.length).toMatch(/^\d:[0-5]\d$/);
      expect(GROUPS.map((g) => g.id)).toContain(v.group);
      for (const l of ['de', 'en'] as const) {
        expect(v.title[l].trim()).not.toBe('');
        expect(v.goal[l]).toMatch(/\.$/);
      }
      for (const f of v.files) expect(f).toMatch(/^[\w.-]+\.(pes|dst|svg|jpg|png)$/);
    });
  });

  it('each video has its card picture with the site', () => {
    for (const v of VIDEOS) expect(existsSync(new URL(`../public/${cardPath(v.key)}`, import.meta.url)), v.key).toBe(true);
  });

  it('the guide shows every video at the top and beside at least one section, in both languages', () => {
    const docs = expandVideos(read('docs.html'));
    expect(docs).not.toContain('<!-- video:');
    expect(count(docs, '<dialog class="video-dialog"')).toBe(1);
    for (const l of ['de', 'en']) {
      const a = article(docs, l);
      for (const v of VIDEOS) {
        expect(count(a, `<li class="video" id="video-${v.key}"`), `${l} card ${v.key}`).toBe(1);
        expect(a, `${l} section link ${v.key}`).toContain(`class="video-ref" href="videos.html#video-${v.key}"`);
      }
    }
  });

  it('the video page shows every video once per language, in its group', () => {
    const page = expandVideos(read('videos.html'));
    for (const l of ['de', 'en']) {
      const a = article(page, l);
      for (const g of GROUPS) expect(a).toContain(`<h2 id="${l}-${g.id}">`);
      for (const v of VIDEOS) {
        expect(count(a, `id="video-${v.key}"`)).toBe(1);
        const group = a.slice(a.indexOf(`<h2 id="${l}-${v.group}">`));
        expect(group.slice(0, group.indexOf('</section>'))).toContain(`id="video-${v.key}"`);
      }
    }
  });

  it('the German video page keeps its links in de/ and the files of the site one folder up', () => {
    const de = langPage(expandVideos(read('videos.html')), 'videos', 'de');
    expect(de).not.toContain('<article lang="en">');
    expect(de).toContain('<link rel="canonical" href="https://pfedan.github.io/heatstitch/de/videos.html" />');
    expect(de).toMatch(/<title>heatstitch Videos/);
    expect(de).toContain('href="docs.html"');
    const docs = langPage(expandVideos(read('docs.html')), 'docs', 'de');
    expect(docs).toContain('href="videos.html#video-02-schrift"');
  });

  it('a placeholder naming an unknown video stops the build', () => {
    expect(() => expandVideos('<!-- video:ref de 99-gibt-es-nicht -->')).toThrow(/99-gibt-es-nicht/);
    expect(() => expandVideos('<!-- video:cards -->')).toThrow(/language/);
  });
});
