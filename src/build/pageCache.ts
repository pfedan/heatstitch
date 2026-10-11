/**
 * How the service worker treats the guide and the video page. The app itself is precached and only
 * switches to a new version when the user clicks reload (src/ui/updateNotice.ts). The guide and the
 * video page are plain reading pages: precached, they would stay at the old version until that click.
 * So they stay out of the install and are fetched from the network first; a copy is kept for offline.
 */
import { pagePath, type Lang } from './langPages';

const LANGS: Lang[] = ['en', 'de'];
const files = LANGS.flatMap((lang) => (['docs', 'videos'] as const).map((page) => pagePath(page, lang)));

/** The guide and video pages, as paths in the build (docs.html, de/docs.html, ...). */
export const READING_PAGES: readonly string[] = files;

/** Matches a request for one of them, with or without a query. */
export const READING_PAGE_URL = new RegExp(
  `/(?:${files.map((f) => f.replace(/[.]/g, '\\.')).join('|')})(?:\\?.*)?$`,
);

/** The workbox runtime rule: newest page when online, the last one seen when offline. */
export const readingPageCache = {
  urlPattern: READING_PAGE_URL,
  handler: 'NetworkFirst' as const,
  // A slow connection falls back to the kept copy instead of a blank page.
  options: { cacheName: 'reading-pages', networkTimeoutSeconds: 4, expiration: { maxEntries: 8 } },
};
