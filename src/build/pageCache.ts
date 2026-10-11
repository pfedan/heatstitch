/**
 * What the service worker answers. It only serves the app: the app's pages and the files it needs,
 * precached, so the app opens offline and only switches to a new version when the user clicks reload
 * (src/ui/updateNotice.ts). Every other page (the guide, the video page, the moving page) and every
 * other file (sitemap.xml, robots.txt, a guide picture) goes to the server as it is, so it is always
 * the version the server has, exactly as if there were no service worker.
 */
import { pagePath, type Lang } from './langPages';

const LANGS: Lang[] = ['en', 'de'];

/** The app's page in each language, as built files (index.html, de/index.html). */
export const APP_PAGES: readonly string[] = LANGS.map((lang) => `${pagePath('app', lang)}index.html`);

/**
 * Navigations the service worker answers with the cached app: the app's folders and their
 * index.html, with any query (a file handed over by the system arrives at the app's address).
 * Workbox matches it against path and query.
 */
export const APP_NAVIGATION = new RegExp(
  `^/(?:${LANGS.map((lang) => pagePath('app', lang).replace(/\//g, '\\/'))
    .filter(Boolean)
    .join('|')})?(?:index\\.html)?(?:\\?.*)?$`,
);
