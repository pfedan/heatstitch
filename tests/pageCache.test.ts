import { describe, expect, it } from 'vitest';
import { pagePath } from '../src/build/langPages';
import { READING_PAGES, READING_PAGE_URL, readingPageCache } from '../src/build/pageCache';

const url = (path: string) => `https://heatstitch.app/${path}`;

/** The guide and the video page must show their newest version without the app's update click. */
describe('service worker: guide and video pages', () => {
  it('keeps every guide and video page out of the precache', () => {
    for (const lang of ['en', 'de'] as const) {
      expect(READING_PAGES).toContain(pagePath('docs', lang));
      expect(READING_PAGES).toContain(pagePath('videos', lang));
    }
  });

  it('fetches them from the network first', () => {
    expect(readingPageCache.handler).toBe('NetworkFirst');
    for (const page of READING_PAGES) {
      expect(READING_PAGE_URL.test(url(page))).toBe(true);
      expect(READING_PAGE_URL.test(url(`${page}?lang=de`))).toBe(true);
    }
  });

  it('leaves the app itself to the precache and its update notice', () => {
    for (const path of ['', 'index.html', 'de/', 'de/index.html', 'umzug.html', 'guide/cat-de.jpg']) {
      expect(READING_PAGE_URL.test(url(path))).toBe(false);
    }
  });
});
